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

    # Check lightning from Tomorrow.io
    realtime = await _get_cache(db, "tomorrow_realtime")
    if realtime:
        values = realtime.get("data", {}).get("values", {})
        lightning_km = values.get("lightningDistance")
        if lightning_km is not None:
            lightning_miles = lightning_km * MILES_PER_KM
            if lightning_miles <= lightning_threshold:
                meta = {"lightning_miles": lightning_miles, "threshold_miles": lightning_threshold}
                await log_event(db, "lightning_alert", "critical",
                              f"Lightning detected {lightning_miles:.1f} miles away (threshold: {lightning_threshold} miles)",
                              meta)
                return True, f"Lightning at {lightning_miles:.1f} miles", meta

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
