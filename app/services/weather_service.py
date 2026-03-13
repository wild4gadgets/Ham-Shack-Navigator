"""
Weather service: fetches OWM and Tomorrow.io data, writes to weather_cache.
"""
import json
import logging
from datetime import datetime, timezone

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import WeatherCache, Setting

logger = logging.getLogger(__name__)

OWM_BASE = "https://api.openweathermap.org/data/2.5"
TOMORROW_BASE = "https://api.tomorrow.io/v4"


async def _get_api_keys(db: AsyncSession) -> tuple[str | None, str | None]:
    result = await db.execute(select(Setting).where(Setting.key == "api_keys"))
    row = result.scalar_one_or_none()
    if not row:
        return None, None
    data = json.loads(row.value)
    return data.get("owm_key"), data.get("tomorrow_key")


async def _get_location(db: AsyncSession) -> tuple[float | None, float | None, str]:
    result = await db.execute(select(Setting).where(Setting.key == "location"))
    row = result.scalar_one_or_none()
    if not row:
        return None, None, "imperial"
    data = json.loads(row.value)
    return data.get("lat"), data.get("lon"), data.get("units", "imperial")


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
    owm_key, _ = await _get_api_keys(db)
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
    owm_key, _ = await _get_api_keys(db)
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
    _, tomorrow_key = await _get_api_keys(db)
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


async def fetch_all(db: AsyncSession) -> dict:
    """Fetch all weather sources. Returns dict of results."""
    current = await fetch_owm_current(db)
    forecast = await fetch_owm_forecast(db)
    realtime = await fetch_tomorrow_realtime(db)
    return {"current": current, "forecast": forecast, "realtime": realtime}


async def get_cached(db: AsyncSession, source: str) -> dict | None:
    result = await db.execute(select(WeatherCache).where(WeatherCache.source == source))
    cache = result.scalar_one_or_none()
    if not cache:
        return None
    return {"data": json.loads(cache.data), "fetched_at": cache.fetched_at.isoformat()}
