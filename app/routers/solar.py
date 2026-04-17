import asyncio
import json
import math
import urllib.request
from datetime import datetime, timezone

import aiohttp
from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy import select

from database import AsyncSessionLocal
from dependencies import get_current_user
from models import Setting, User

router = APIRouter(prefix="/solar", tags=["solar"])

SOLAR_XML_URL = "https://www.hamqsl.com/solarxml.php"
GLOTEC_INDEX_URL = "https://services.swpc.noaa.gov/products/glotec/geojson_2d_urt.json"
GLOTEC_BASE_URL  = "https://services.swpc.noaa.gov"


def _fetch_solar_xml() -> bytes:
    with urllib.request.urlopen(SOLAR_XML_URL, timeout=10) as resp:
        return resp.read()


@router.get("/data")
async def get_solar_data(_: User = Depends(get_current_user)):
    content = await asyncio.to_thread(_fetch_solar_xml)
    return Response(content=content, media_type="application/xml")


async def _get_station_latlon() -> tuple[float, float] | None:
    """Read station lat/lon from the location setting."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Setting).where(Setting.key == "location"))
            row = result.scalar_one_or_none()
            if not row:
                return None
            data = json.loads(row.value)
            lat = float(data.get("lat", 0))
            lon = float(data.get("lon", 0))
            if lat == 0.0 and lon == 0.0:
                return None
            return lat, lon
    except Exception:
        return None


def _nearest_feature(features: list, lat: float, lon: float) -> dict | None:
    """Return the GloTEC feature closest to the given lat/lon."""
    best = None
    best_dist = float("inf")
    for feat in features:
        coords = feat.get("geometry", {}).get("coordinates", [])
        if len(coords) < 2:
            continue
        flon, flat = coords[0], coords[1]
        dist = (flat - lat) ** 2 + (flon - lon) ** 2
        if dist < best_dist:
            best_dist = dist
            best = feat
    return best


@router.get("/muf")
async def get_muf(_: User = Depends(get_current_user)):
    """
    Return the estimated MUF (Maximum Usable Frequency) at the station location.
    Derived from NOAA GloTEC NmF2 data using foF2 = sqrt(NmF2 / 1.24e10).
    MUF for a 3000 km path ≈ foF2 × 3.0 (standard M-factor).
    """
    latlon = await _get_station_latlon()
    if latlon is None:
        return {"error": "Station location not configured", "foF2": None, "muf_3000": None}

    lat, lon = latlon

    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
            # Step 1: fetch index to find latest snapshot URL
            async with session.get(GLOTEC_INDEX_URL) as resp:
                resp.raise_for_status()
                index = await resp.json(content_type=None)

            if not index:
                return {"error": "GloTEC index empty", "foF2": None, "muf_3000": None}

            latest_path = index[-1]["url"]
            snapshot_url = GLOTEC_BASE_URL + latest_path
            time_tag = index[-1].get("time_tag", "")

            # Step 2: fetch the GeoJSON snapshot
            async with session.get(snapshot_url) as resp:
                resp.raise_for_status()
                geojson = await resp.json(content_type=None)

        features = geojson.get("features", [])
        feat = _nearest_feature(features, lat, lon)
        if feat is None:
            return {"error": "No GloTEC data near station", "foF2": None, "muf_3000": None}

        props = feat.get("properties", {})
        nm_f2 = props.get("NmF2")
        if nm_f2 is None or nm_f2 <= 0:
            return {"error": "NmF2 unavailable", "foF2": None, "muf_3000": None}

        fo_f2 = math.sqrt(float(nm_f2) / 1.24e10)   # MHz
        muf_3000 = fo_f2 * 3.0                        # M-factor for 3000 km path

        return {
            "foF2":     round(fo_f2, 2),
            "muf_3000": round(muf_3000, 2),
            "time_tag": time_tag,
            "grid_lat": feat["geometry"]["coordinates"][1],
            "grid_lon": feat["geometry"]["coordinates"][0],
        }

    except Exception as exc:
        return {"error": str(exc), "foF2": None, "muf_3000": None}
