"""
PSKReporter integration — fetches reception spots for a given callsign.
Caches results for 5 minutes to respect the PSKReporter rate limit.
"""
import asyncio
import json
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import aiohttp
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db, get_current_user, require_admin
from models import Setting, User, WeatherCache
from schemas import PskReporterSettings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pskreporter", tags=["pskreporter"])

PSK_API = "https://retrieve.pskreporter.info/query"
CACHE_TTL = 240  # 4 minutes — ensures 5-min frontend refresh always gets fresh data

BAND_RANGES = {
    "160m": (1_800_000,   2_000_000),
    "80m":  (3_500_000,   4_000_000),
    "60m":  (5_330_500,   5_403_500),
    "40m":  (7_000_000,   7_300_000),
    "30m": (10_100_000,  10_150_000),
    "20m": (14_000_000,  14_350_000),
    "17m": (18_068_000,  18_168_000),
    "15m": (21_000_000,  21_450_000),
    "12m": (24_890_000,  24_990_000),
    "10m": (28_000_000,  29_700_000),
     "6m": (50_000_000,  54_000_000),
     "2m": (144_000_000, 148_000_000),
}


def _freq_to_band(freq_hz: int) -> str:
    for band, (lo, hi) in BAND_RANGES.items():
        if lo <= freq_hz <= hi:
            return band
    return "?"


async def _get_setting(db: AsyncSession, key: str) -> dict:
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return json.loads(row.value) if row else {}


async def _save_setting(db: AsyncSession, key: str, value: dict):
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = json.dumps(value)
    else:
        row = Setting(key=key, value=json.dumps(value))
        db.add(row)
    await db.commit()


async def _get_cache(db: AsyncSession):
    result = await db.execute(
        select(WeatherCache).where(WeatherCache.source == "pskreporter_spots")
    )
    return result.scalar_one_or_none()


async def _save_cache(db: AsyncSession, data: dict):
    cache = await _get_cache(db)
    now = datetime.now(timezone.utc)
    if cache:
        cache.data = json.dumps(data)
        cache.fetched_at = now
    else:
        cache = WeatherCache(source="pskreporter_spots", data=json.dumps(data), fetched_at=now)
        db.add(cache)
    await db.commit()


async def _fetch_from_api(callsign: str, direction: str, mode: str | None, timespan: int) -> list[dict]:
    """Make one PSKReporter API request and return parsed spots."""
    params = {
        direction:          callsign.upper(),
        "flowStartSeconds": str(timespan),
        "rptlimit":         "500",
        "appcontact":       "ham-shack-cockpit",
    }
    if mode:
        params["mode"] = mode

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(PSK_API, params=params, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                if resp.status != 200:
                    logger.warning("PSKReporter returned HTTP %d", resp.status)
                    return []
                text = await resp.text()

        root = ET.fromstring(text)
        spots = []
        for rpt in root.iter("receptionReport"):
            try:
                freq = int(rpt.get("frequency", "0"))
            except ValueError:
                freq = 0
            try:
                ts = int(rpt.get("flowStartSeconds", "0"))
            except ValueError:
                ts = 0
            snr_raw = rpt.get("sNR", "")
            try:
                snr = int(snr_raw)
            except ValueError:
                snr = None

            spots.append({
                "receiverCallsign": rpt.get("receiverCallsign", ""),
                "receiverLocator":  rpt.get("receiverLocator", ""),
                "senderCallsign":   rpt.get("senderCallsign", ""),
                "senderLocator":    rpt.get("senderLocator", ""),
                "frequency":        freq,
                "band":             _freq_to_band(freq),
                "mode":             rpt.get("mode", ""),
                "snr":              snr,
                "timestamp":        ts,
            })
        return spots

    except Exception as exc:
        logger.error("PSKReporter fetch error: %s", exc)
        return []


@router.get("/settings")
async def get_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    data = await _get_setting(db, "pskreporter")
    return {
        "callsign":          data.get("callsign", ""),
        "default_direction": data.get("default_direction", "senderCallsign"),
        "default_modes":     data.get("default_modes", []),
        "default_bands":     data.get("default_bands", []),
        "default_timespan":  data.get("default_timespan", -3600),
    }


@router.put("/settings")
async def put_settings(
    body: PskReporterSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    await _save_setting(db, "pskreporter", body.model_dump())
    return {"detail": "PSKReporter settings saved"}


@router.get("/spots")
async def get_spots(
    callsign: str = Query(...),
    direction: str  = Query("senderCallsign"),
    modes: str      = Query(""),      # comma-separated; empty = all modes
    bands: str      = Query(""),      # comma-separated; empty = all bands
    timespan: int   = Query(-3600),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    callsign = callsign.strip().upper()
    if not callsign:
        return {"spots": [], "cached": False, "error": "No callsign provided"}

    selected_modes = [m.strip() for m in modes.split(",") if m.strip()] if modes else []
    selected_bands = [b.strip() for b in bands.split(",") if b.strip()] if bands else []

    cache_params = {
        "callsign":  callsign,
        "direction": direction,
        "modes":     sorted(selected_modes),
        "bands":     sorted(selected_bands),
        "timespan":  timespan,
    }

    # Return cached result if fresh and params match
    cache_row = await _get_cache(db)
    if cache_row:
        cached = json.loads(cache_row.data)
        age = (datetime.now(timezone.utc) - cache_row.fetched_at.replace(tzinfo=timezone.utc)).total_seconds()
        if age < CACHE_TTL and cached.get("params") == cache_params:
            return {
                "spots":      cached["spots"],
                "cached":     True,
                "fetched_at": cache_row.fetched_at.isoformat(),
                "count":      len(cached["spots"]),
            }

    # Fetch fresh — one request per selected mode (or one if all modes)
    if selected_modes:
        results = await asyncio.gather(*[
            _fetch_from_api(callsign, direction, mode, timespan)
            for mode in selected_modes
        ])
        all_spots = [s for sublist in results for s in sublist]
    else:
        all_spots = await _fetch_from_api(callsign, direction, None, timespan)

    # Filter by selected bands (server-side)
    if selected_bands:
        all_spots = [s for s in all_spots if s["band"] in selected_bands]

    # Deduplicate
    seen: set[tuple] = set()
    unique: list[dict] = []
    for s in all_spots:
        key = (s["senderCallsign"], s["receiverCallsign"], s["frequency"], s["timestamp"])
        if key not in seen:
            seen.add(key)
            unique.append(s)

    unique.sort(key=lambda x: x["timestamp"], reverse=True)

    await _save_cache(db, {"spots": unique, "params": cache_params})

    now_iso = datetime.now(timezone.utc).isoformat()
    return {
        "spots":      unique,
        "cached":     False,
        "fetched_at": now_iso,
        "count":      len(unique),
    }
