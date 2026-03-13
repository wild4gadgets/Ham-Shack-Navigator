"""
Home Assistant pull endpoint: exposes monitoring + weather state for HA REST sensors.
Uses a static bearer token (ha_poll_token) stored in home_assistant settings.
"""
import json
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db
from models import Setting
from services.ha_service import get_current_state

router = APIRouter(prefix="/ha", tags=["home-assistant"])

SENSOR_KEYS = {
    "wind_mph": ("mph", "Ham Shack Wind Speed"),
    "lightning_miles": ("mi", "Ham Shack Lightning Distance"),
    "monitoring_armed": (None, "Ham Shack Monitoring Armed"),
    "in_cooldown": (None, "Ham Shack In Cooldown"),
    "last_shutdown": (None, "Ham Shack Last Shutdown"),
}


async def _verify_ha_poll_token(request: Request, db: AsyncSession = Depends(get_db)):
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Bearer token")
    provided = auth_header[7:]

    result = await db.execute(select(Setting).where(Setting.key == "home_assistant"))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=401, detail="Home Assistant not configured")
    cfg = json.loads(row.value)
    stored = cfg.get("ha_poll_token")
    if not stored:
        raise HTTPException(status_code=401, detail="HA poll token not configured — save Home Assistant settings first")
    if not secrets.compare_digest(provided.encode(), stored.encode()):
        raise HTTPException(status_code=401, detail="Invalid token")


@router.get("/state")
async def ha_get_state(
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_verify_ha_poll_token),
):
    """Returns the full monitoring + weather state. Use this as a HA REST sensor resource."""
    return await get_current_state(db)


@router.get("/sensor/{slug}")
async def ha_get_sensor(
    slug: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_verify_ha_poll_token),
):
    """
    Returns a single value in HA REST sensor format.
    Valid slugs: wind_mph, lightning_miles, monitoring_armed, in_cooldown, last_shutdown
    """
    if slug not in SENSOR_KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown sensor slug. Valid: {', '.join(SENSOR_KEYS)}")

    state = await get_current_state(db)
    unit, friendly_name = SENSOR_KEYS[slug]

    # Map slug to state key
    key = "last_shutdown_at" if slug == "last_shutdown" else slug
    value = state.get(key)

    if isinstance(value, bool):
        state_str = "on" if value else "off"
    elif value is None:
        state_str = "unknown"
    else:
        state_str = str(value)

    result = {"state": state_str, "attributes": {"friendly_name": friendly_name}}
    if unit:
        result["attributes"]["unit_of_measurement"] = unit
    return result
