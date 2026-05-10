"""
Weather service: fetches OWM, Tomorrow.io, NWS, and AccuWeather data, writes to weather_cache.
"""
import json
import logging
import time as _time
from datetime import datetime, timezone

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import WeatherCache, Setting

logger = logging.getLogger(__name__)

OWM_BASE = "https://api.openweathermap.org/data/2.5"
TOMORROW_BASE = "https://api.tomorrow.io/v4"
NWS_API_BASE = "https://api.weather.gov"
ACCUWEATHER_BASE = "https://dataservice.accuweather.com"


async def _get_api_keys(db: AsyncSession) -> tuple[str | None, str | None, str | None]:
    result = await db.execute(select(Setting).where(Setting.key == "api_keys"))
    row = result.scalar_one_or_none()
    if not row:
        return None, None, None
    data = json.loads(row.value)
    return data.get("owm_key"), data.get("tomorrow_key"), data.get("accuweather_key")


async def _get_location(db: AsyncSession) -> tuple[float | None, float | None, str]:
    result = await db.execute(select(Setting).where(Setting.key == "location"))
    row = result.scalar_one_or_none()
    if not row:
        return None, None, "imperial"
    data = json.loads(row.value)
    return data.get("lat"), data.get("lon"), data.get("units", "imperial")


async def get_location(db: AsyncSession) -> tuple[float | None, float | None, str]:
    """Public wrapper for _get_location; used by scheduler."""
    return await _get_location(db)


async def _save_cache(db: AsyncSession, source: str, data: dict):
    result = await db.execute(select(WeatherCache).where(WeatherCache.source == source))
    cache = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if cache:
        cache.data = json.dumps(data)
        cache.fetched_at = now
    else:
        cache = WeatherCache(source=source, data=json.dumps(data), fetched_at=now)
        db.add(cache)
    await db.commit()


async def fetch_owm_current(db: AsyncSession) -> dict | None:
    owm_key, _, _ = await _get_api_keys(db)
    lat, lon, units = await _get_location(db)
    if not owm_key or lat is None:
        return None

    url = f"{OWM_BASE}/weather?lat={lat}&lon={lon}&appid={owm_key}&units={units}"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    await _save_cache(db, "owm_current", data)
                    return data
                else:
                    logger.warning("OWM current returned %d", resp.status)
                    return None
    except Exception as e:
        logger.error("OWM current fetch error: %s", e)
        return None


async def fetch_owm_forecast(db: AsyncSession) -> dict | None:
    owm_key, _, _ = await _get_api_keys(db)
    lat, lon, units = await _get_location(db)
    if not owm_key or lat is None:
        return None

    # 5-day/3h forecast; cnt=8 gives 24h worth
    url = f"{OWM_BASE}/forecast?lat={lat}&lon={lon}&appid={owm_key}&units={units}&cnt=8"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    await _save_cache(db, "owm_forecast", data)
                    return data
                else:
                    logger.warning("OWM forecast returned %d", resp.status)
                    return None
    except Exception as e:
        logger.error("OWM forecast fetch error: %s", e)
        return None


async def fetch_tomorrow_realtime(db: AsyncSession) -> dict | None:
    _, tomorrow_key, _ = await _get_api_keys(db)
    lat, lon, units = await _get_location(db)
    if not tomorrow_key or lat is None:
        return None

    # Tomorrow.io: lightningDistance is always returned in km regardless of units param
    url = (
        f"{TOMORROW_BASE}/weather/realtime"
        f"?location={lat},{lon}"
        f"&fields=lightningDistance,weatherCode,temperature,windSpeed"
        f"&apikey={tomorrow_key}&units={units}"
    )
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 429:
                    logger.warning("Tomorrow.io rate limit hit (429)")
                    return None
                if resp.status == 200:
                    data = await resp.json()
                    await _save_cache(db, "tomorrow_realtime", data)
                    return data
                else:
                    logger.warning("Tomorrow.io returned %d", resp.status)
                    return None
    except Exception as e:
        logger.error("Tomorrow.io fetch error: %s", e)
        return None


# Events that indicate lightning is actively occurring at the user's location
_NWS_WARNING_EVENTS = {"Severe Thunderstorm Warning", "Tornado Warning"}


async def fetch_nws_alerts(db: AsyncSession) -> dict | None:
    """
    Query the NWS active-alerts endpoint for severe weather at the user's location.
    Severe Thunderstorm Warnings and Tornado Warnings are treated as an imminent
    lightning threat and return lightningDistance=0 km.  No API key required.
    Only applicable to US locations; returns None for non-US coordinates.
    """
    lat, lon, _ = await _get_location(db)
    if lat is None:
        return None

    url = f"{NWS_API_BASE}/alerts/active?point={lat:.4f},{lon:.4f}"
    try:
        async with aiohttp.ClientSession(
            headers={"User-Agent": "Ham-Shack-Navigator (ham shack safety monitor)"}
        ) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 404:
                    # 404 from NWS typically means the point is outside the US
                    result = {"lightningDistance": None, "note": "outside_nws_coverage"}
                    await _save_cache(db, "nws_alerts", result)
                    return result
                if resp.status != 200:
                    logger.warning("NWS alerts returned %d", resp.status)
                    return None
                data = await resp.json(content_type=None)

        active_warnings = [
            f["properties"]["event"]
            for f in data.get("features", [])
            if f.get("properties", {}).get("event") in _NWS_WARNING_EVENTS
        ]

        all_alerts = [
            {
                "event":     f["properties"].get("event", ""),
                "headline":  f["properties"].get("headline", ""),
                "severity":  f["properties"].get("severity", "Unknown"),
                "urgency":   f["properties"].get("urgency", "Unknown"),
                "certainty": f["properties"].get("certainty", "Unknown"),
                "areaDesc":  f["properties"].get("areaDesc", ""),
                "effective": f["properties"].get("effective", ""),
                "expires":   f["properties"].get("expires", ""),
            }
            for f in data.get("features", [])
            if f.get("properties", {}).get("event")
        ]

        result = {
            "lightningDistance": 0.0 if active_warnings else None,
            "active_warnings": active_warnings,
            "alerts": all_alerts,
        }
        await _save_cache(db, "nws_alerts", result)
        return result

    except Exception as e:
        logger.error("NWS alerts fetch error: %s", e)
        return None


async def fetch_rainviewer_lightning(db: AsyncSession) -> dict | None:
    """
    RainViewer lightning detection (placeholder).

    RainViewer removed lightning frames from their public weather-maps API in
    their v2.0 release.  This function is a no-op stub kept in place so that
    it can be re-enabled if/when RainViewer restores lightning data.
    """
    return None


async def _fetch_accuweather_location_key(
    db: AsyncSession, lat: float, lon: float, api_key: str
) -> str | None:
    """Resolve lat/lon to an AccuWeather location key, caching the result.
    Re-fetches only when the stored lat/lon differs from the current location."""
    result = await db.execute(
        select(WeatherCache).where(WeatherCache.source == "accuweather_location_key")
    )
    cached = result.scalar_one_or_none()
    if cached:
        payload = json.loads(cached.data)
        if payload.get("lat") == lat and payload.get("lon") == lon:
            return payload.get("location_key")

    url = f"{ACCUWEATHER_BASE}/locations/v1/geoposition/search"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                params={"apikey": api_key, "q": f"{lat},{lon}"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    # API may return either a single object or a list
                    if isinstance(data, list):
                        data = data[0] if data else {}
                    location_key = data.get("Key")
                    if location_key:
                        await _save_cache(db, "accuweather_location_key", {
                            "location_key": location_key,
                            "lat": lat,
                            "lon": lon,
                            "name": data.get("LocalizedName", ""),
                        })
                    return location_key
                else:
                    logger.warning("AccuWeather geoposition returned %d", resp.status)
                    return None
    except Exception as e:
        logger.error("AccuWeather geoposition error: %s", e)
        return None


async def fetch_accuweather_forecast(db: AsyncSession) -> dict | None:
    """Fetch AccuWeather 1-hour hourly forecast. Returns the first hourly period,
    which contains ThunderstormProbability and current conditions."""
    _, _, aw_key = await _get_api_keys(db)
    lat, lon, _ = await _get_location(db)
    if not aw_key or lat is None:
        return None

    location_key = await _fetch_accuweather_location_key(db, lat, lon, aw_key)
    if not location_key:
        return None

    url = f"{ACCUWEATHER_BASE}/forecasts/v1/hourly/1hour/{location_key}.json"
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                url,
                params={"apikey": aw_key, "details": "true", "metric": "false"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status == 401:
                    logger.warning("AccuWeather unauthorized — check API key")
                    return None
                if resp.status == 503:
                    logger.warning("AccuWeather quota exceeded (503)")
                    return None
                if resp.status == 200:
                    data = await resp.json()
                    # API returns a list; store the first (next-hour) period
                    period = data[0] if data else {}
                    payload = {
                        "location_key": location_key,
                        "ThunderstormProbability": period.get("ThunderstormProbability"),
                        "PrecipitationProbability": period.get("PrecipitationProbability"),
                        "WeatherIcon": period.get("WeatherIcon"),
                        "IconPhrase": period.get("IconPhrase", ""),
                        "HasPrecipitation": period.get("HasPrecipitation"),
                        "PrecipitationType": period.get("PrecipitationType"),
                        "Temperature": period.get("Temperature", {}).get("Value"),
                        "Wind": period.get("Wind", {}).get("Speed", {}).get("Value"),
                        "DateTime": period.get("DateTime", ""),
                    }
                    await _save_cache(db, "accuweather_forecast", payload)
                    return payload
                else:
                    logger.warning("AccuWeather forecast returned %d", resp.status)
                    return None
    except Exception as e:
        logger.error("AccuWeather forecast fetch error: %s", e)
        return None


async def fetch_all(db: AsyncSession) -> dict:
    """Fetch all weather sources. Returns dict of results."""
    current = await fetch_owm_current(db)
    forecast = await fetch_owm_forecast(db)
    realtime = await fetch_tomorrow_realtime(db)
    nws = await fetch_nws_alerts(db)
    rainviewer = await fetch_rainviewer_lightning(db)
    accuweather = await fetch_accuweather_forecast(db)
    return {
        "current": current,
        "forecast": forecast,
        "realtime": realtime,
        "nws_alerts": nws,
        "rainviewer_lightning": rainviewer,
        "accuweather": accuweather,
    }


async def get_cached(db: AsyncSession, source: str) -> dict | None:
    result = await db.execute(select(WeatherCache).where(WeatherCache.source == source))
    cache = result.scalar_one_or_none()
    if not cache:
        return None
    return {"data": json.loads(cache.data), "fetched_at": cache.fetched_at.isoformat()}
