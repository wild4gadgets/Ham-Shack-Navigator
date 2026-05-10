"""
Monitoring service: evaluates thresholds and triggers shutdown when conditions are met.
"""
import json
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import Setting, WeatherCache, Event

logger = logging.getLogger(__name__)

MILES_PER_KM = 0.621371


async def _get_setting(db: AsyncSession, key: str) -> dict | None:
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if not row:
        return None
    return json.loads(row.value)


async def _get_cache(db: AsyncSession, source: str) -> dict | None:
    result = await db.execute(select(WeatherCache).where(WeatherCache.source == source))
    row = result.scalar_one_or_none()
    if not row:
        return None
    return json.loads(row.data)


async def log_event(db: AsyncSession, event_type: str, severity: str, message: str, metadata: dict | None = None):
    event = Event(
        event_type=event_type,
        severity=severity,
        message=message,
        meta=json.dumps(metadata) if metadata else None,
        created_at=datetime.now(timezone.utc),
    )
    db.add(event)
    await db.commit()
    return event


async def check_conditions(db: AsyncSession) -> tuple[bool, str, dict]:
    """
    Check weather conditions against thresholds.
    Returns (should_trigger, reason, metadata).
    """
    thresholds = await _get_setting(db, "thresholds")
    if not thresholds:
        thresholds = {
            "wind_mph": 35.0,
            "lightning_miles": 10.0,
            "poll_interval_sec": 300,
            "cooldown_min": 30,
        }

    wind_threshold = thresholds.get("wind_mph", 35.0)
    lightning_threshold = thresholds.get("lightning_miles", 10.0)

    # Check wind gusts from OWM current
    current = await _get_cache(db, "owm_current")
    if current:
        wind_gust = current.get("wind", {}).get("gust") or current.get("wind", {}).get("speed", 0)  # mph (units=imperial); fall back to speed if gust unavailable
        if wind_gust >= wind_threshold:
            meta = {"wind_gust_mph": wind_gust, "threshold_mph": wind_threshold}
            await log_event(db, "wind_alert", "warning",
                          f"Wind gust {wind_gust:.1f} mph exceeds threshold {wind_threshold} mph",
                          meta)
            return True, f"High wind gust: {wind_gust:.1f} mph", meta

    # Check lightning from all sources; use the nearest detection across all of them
    lightning_candidates: list[tuple[float, str]] = []  # (distance_miles, source_name)

    realtime = await _get_cache(db, "tomorrow_realtime")
    if realtime:
        km = realtime.get("data", {}).get("values", {}).get("lightningDistance")
        if km is not None:
            lightning_candidates.append((km * MILES_PER_KM, "Tomorrow.io"))

    nws = await _get_cache(db, "nws_alerts")
    if nws:
        km = nws.get("lightningDistance")
        if km is not None:
            label = "NWS " + ", ".join(nws.get("active_warnings", [])) if nws.get("active_warnings") else "NWS"
            lightning_candidates.append((km * MILES_PER_KM, label))

    rainviewer = await _get_cache(db, "rainviewer_lightning")
    if rainviewer:
        km = rainviewer.get("lightningDistance")
        if km is not None:
            lightning_candidates.append((km * MILES_PER_KM, "RainViewer"))

    if lightning_candidates:
        nearest_miles, nearest_source = min(lightning_candidates, key=lambda x: x[0])
        if nearest_miles <= lightning_threshold:
            meta = {
                "lightning_miles": round(nearest_miles, 1),
                "threshold_miles": lightning_threshold,
                "source": nearest_source,
            }
            await log_event(
                db, "lightning_alert", "critical",
                f"Lightning {nearest_miles:.1f} mi away via {nearest_source} "
                f"(threshold: {lightning_threshold} mi)",
                meta,
            )
            return True, f"Lightning at {nearest_miles:.1f} miles ({nearest_source})", meta

    # Check AccuWeather thunderstorm probability
    thunderstorm_threshold = thresholds.get("thunderstorm_prob_pct", 70)
    aw = await _get_cache(db, "accuweather_forecast")
    if aw:
        prob = aw.get("ThunderstormProbability")
        if prob is not None and prob >= thunderstorm_threshold:
            meta = {
                "thunderstorm_prob_pct": prob,
                "threshold_pct": thunderstorm_threshold,
                "phrase": aw.get("IconPhrase", ""),
            }
            await log_event(
                db, "lightning_alert", "critical",
                f"AccuWeather thunderstorm probability {prob}% "
                f"(threshold: {thunderstorm_threshold}%)",
                meta,
            )
            return True, f"Thunderstorm {prob}% likely (AccuWeather)", meta

    # Check OWM weather alerts
    if current:
        alerts = current.get("alerts", [])
        for alert in alerts:
            event_name = alert.get("event", "Unknown")
            description = alert.get("description", "")[:200]
            await log_event(db, "weather_alert", "warning",
                          f"Weather alert: {event_name}",
                          {"event": event_name, "description": description})

    return False, "", {}


async def log_weather_fetch_results(db: AsyncSession, results: dict):
    """Log each weather API result as a separate event. Called when log_weather_data is enabled."""
    current = results.get("current")
    realtime = results.get("realtime")
    nws = results.get("nws_alerts")
    accuweather = results.get("accuweather")

    forecast = results.get("forecast")
    if forecast:
        points = forecast.get("list", [])
        if points:
            temps = [p.get("main", {}).get("temp") for p in points if p.get("main", {}).get("temp") is not None]
            lo = round(min(temps), 1) if temps else None
            hi = round(max(temps), 1) if temps else None
            meta = {"points": len(points)}
            parts = [f"{len(points)} periods"]
            if lo is not None and hi is not None:
                parts.append(f"Temp range: {lo}°–{hi}°")
                meta["temp_lo"] = lo
                meta["temp_hi"] = hi
            await log_event(db, "weather_data", "info", "OWM Forecast: " + " | ".join(parts), meta)

    if current:
        wind = current.get("wind", {})
        speed = wind.get("speed")
        gust = wind.get("gust")
        temp = current.get("main", {}).get("temp")
        conditions = (current.get("weather") or [{}])[0].get("description", "")
        parts, meta = [], {}
        if temp is not None:
            parts.append(f"Temp: {temp:.1f}°")
            meta["temp"] = round(temp, 1)
        if speed is not None:
            w = f"Wind: {speed:.1f}"
            if gust is not None:
                w += f" (gust {gust:.1f})"
            parts.append(w)
            meta["wind"] = round(speed, 1)
            if gust is not None:
                meta["gust"] = round(gust, 1)
        if conditions:
            parts.append(conditions)
        await log_event(db, "weather_data", "info",
                        "OWM: " + (" | ".join(parts) if parts else "no data"), meta)

    if realtime:
        vals = realtime.get("data", {}).get("values", {})
        lightning_km = vals.get("lightningDistance")
        temp = vals.get("temperature")
        wind = vals.get("windSpeed")
        parts, meta = [], {}
        if temp is not None:
            parts.append(f"Temp: {temp:.1f}°")
            meta["temp"] = round(temp, 1)
        if wind is not None:
            parts.append(f"Wind: {wind:.1f}")
            meta["wind"] = round(wind, 1)
        if lightning_km is not None:
            miles = round(lightning_km * MILES_PER_KM, 1)
            parts.append(f"Lightning: {miles} mi")
            meta["lightning_mi"] = miles
        else:
            parts.append("Lightning: none")
        await log_event(db, "weather_data", "info",
                        "Tomorrow.io: " + (" | ".join(parts) if parts else "no data"), meta)

    if nws and nws.get("note") != "outside_nws_coverage":
        warnings = nws.get("active_warnings", [])
        alerts = nws.get("alerts", [])
        if warnings:
            await log_event(db, "weather_data", "warning",
                            f"NWS: Active warnings: {', '.join(warnings)}",
                            {"warnings": warnings})
        else:
            msg = f"NWS: {len(alerts)} active alert(s)" if alerts else "NWS: Clear"
            await log_event(db, "weather_data", "info", msg, {"alert_count": len(alerts)})

    if accuweather:
        prob = accuweather.get("ThunderstormProbability")
        precip_prob = accuweather.get("PrecipitationProbability")
        phrase = accuweather.get("IconPhrase", "")
        parts, meta = [], {}
        if prob is not None:
            parts.append(f"Thunderstorm: {prob}%")
            meta["thunderstorm_prob_pct"] = prob
        if precip_prob is not None:
            parts.append(f"Precip: {precip_prob}%")
            meta["precip_prob_pct"] = precip_prob
        if phrase:
            parts.append(phrase)
        await log_event(db, "weather_data", "info",
                        "AccuWeather: " + (" | ".join(parts) if parts else "no data"), meta)



async def is_in_cooldown(db: AsyncSession) -> bool:
    """Check if we're within the cooldown period after last shutdown."""
    monitoring = await _get_setting(db, "monitoring")
    if not monitoring:
        return False

    last_shutdown = monitoring.get("last_shutdown_at")
    if not last_shutdown:
        return False

    thresholds = await _get_setting(db, "thresholds") or {}
    cooldown_min = thresholds.get("cooldown_min", 30)

    last_dt = datetime.fromisoformat(last_shutdown)
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)

    elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds() / 60
    return elapsed < cooldown_min


async def set_last_shutdown(db: AsyncSession):
    """Record shutdown timestamp before executing shutdown."""
    result = await db.execute(select(Setting).where(Setting.key == "monitoring"))
    row = result.scalar_one_or_none()
    now_iso = datetime.now(timezone.utc).isoformat()
    if row:
        data = json.loads(row.value)
        data["last_shutdown_at"] = now_iso
        row.value = json.dumps(data)
    else:
        row = Setting(key="monitoring", value=json.dumps({
            "enabled": True,
            "last_shutdown_at": now_iso,
        }))
        db.add(row)
    await db.commit()


_NOTIFICATION_COOLDOWN_MIN = 30


async def is_notification_in_cooldown(db: AsyncSession) -> bool:
    """Return True if a notification was sent within the last 30 minutes."""
    monitoring = await _get_setting(db, "monitoring")
    if not monitoring:
        return False
    last_notif = monitoring.get("last_notification_at")
    if not last_notif:
        return False
    last_dt = datetime.fromisoformat(last_notif)
    if last_dt.tzinfo is None:
        last_dt = last_dt.replace(tzinfo=timezone.utc)
    elapsed_min = (datetime.now(timezone.utc) - last_dt).total_seconds() / 60
    return elapsed_min < _NOTIFICATION_COOLDOWN_MIN


async def set_last_notification(db: AsyncSession):
    """Record that notifications were just sent."""
    result = await db.execute(select(Setting).where(Setting.key == "monitoring"))
    row = result.scalar_one_or_none()
    now_iso = datetime.now(timezone.utc).isoformat()
    if row:
        data = json.loads(row.value)
        data["last_notification_at"] = now_iso
        row.value = json.dumps(data)
    else:
        row = Setting(key="monitoring", value=json.dumps({
            "enabled": True,
            "last_notification_at": now_iso,
        }))
        db.add(row)
    await db.commit()
