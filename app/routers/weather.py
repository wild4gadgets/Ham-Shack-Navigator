from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from dependencies import get_db, get_current_user
from models import User
from services.weather_service import fetch_all, get_cached
from ws_manager import manager

router = APIRouter(prefix="/weather", tags=["weather"])

_MILES_PER_KM = 0.621371


@router.get("/current")
async def get_current(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await get_cached(db, "owm_current") or {}


@router.get("/forecast")
async def get_forecast(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await get_cached(db, "owm_forecast") or {}


@router.get("/realtime")
async def get_realtime(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await get_cached(db, "tomorrow_realtime") or {}


@router.get("/lightning")
async def get_lightning(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """
    Aggregate lightning distance from all available sources (Tomorrow.io, Blitzortung,
    RainViewer) and return the nearest detection.
    """
    candidates = []

    tomorrow = await get_cached(db, "tomorrow_realtime")
    if tomorrow:
        km = tomorrow.get("data", {}).get("data", {}).get("values", {}).get("lightningDistance")
        if km is not None:
            candidates.append({
                "source": "Tomorrow.io",
                "distance_km": km,
                "distance_miles": round(km * _MILES_PER_KM, 1),
            })

    nws_cache = await get_cached(db, "nws_alerts")
    if nws_cache:
        nws = nws_cache.get("data", {})
        km = nws.get("lightningDistance")
        if km is not None:
            candidates.append({
                "source": "NWS Alert",
                "distance_km": km,
                "distance_miles": round(km * _MILES_PER_KM, 1),
                "active_warnings": nws.get("active_warnings", []),
            })

    rv_cache = await get_cached(db, "rainviewer_lightning")
    if rv_cache:
        rv = rv_cache.get("data", {})
        km = rv.get("lightningDistance")
        if km is not None:
            candidates.append({
                "source": "RainViewer",
                "distance_km": km,
                "distance_miles": round(km * _MILES_PER_KM, 1),
            })

    if not candidates:
        return {"lightningDistance": None, "lightningMiles": None, "source": None, "sources": []}

    nearest = min(candidates, key=lambda c: c["distance_km"])
    return {
        "lightningDistance": nearest["distance_km"],
        "lightningMiles": nearest["distance_miles"],
        "source": nearest["source"],
        "sources": candidates,
    }


@router.post("/refresh")
async def refresh_weather(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    results = await fetch_all(db)
    await manager.broadcast({"type": "weather_update", "source": "manual_refresh"})
    return {"detail": "Weather data refreshed", "sources_fetched": [k for k, v in results.items() if v]}
