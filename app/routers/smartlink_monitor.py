"""
API endpoints for SmartLink remote radio monitor.

Settings are stored under the 'smartlink_monitor' key in the settings table.
"""
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select

from database import AsyncSessionLocal
from dependencies import get_current_user, require_admin
from models import Setting, User
from services import smartlink_monitor_service as svc

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/smartlink-monitor", tags=["smartlink-monitor"])

MASKED = "****"


class SmartLinkSettings(BaseModel):
    enabled: bool = False
    email: str = ""
    password: str = ""          # send empty string to keep existing password
    check_interval_sec: int = 300
    notify_on_offline: bool = True
    notify_on_restore: bool = False
    watch_serials: list[str] = []   # empty = watch all radios on the account


async def _load_settings() -> dict:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Setting).where(Setting.key == "smartlink_monitor")
        )
        row = result.scalar_one_or_none()
        return json.loads(row.value) if row else {}


async def _save_settings(data: dict) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Setting).where(Setting.key == "smartlink_monitor")
        )
        row = result.scalar_one_or_none()
        value = json.dumps(data)
        if row:
            row.value = value
        else:
            db.add(Setting(key="smartlink_monitor", value=value))
        await db.commit()


@router.get("/settings")
async def get_settings(_: User = Depends(get_current_user)):
    """Return SmartLink monitor settings (password masked)."""
    cfg = await _load_settings()
    pw = cfg.get("password", "")
    return {
        "enabled": cfg.get("enabled", False),
        "email": cfg.get("email", ""),
        "password": (MASKED + pw[-4:]) if len(pw) > 4 else (MASKED if pw else ""),
        "check_interval_sec": cfg.get("check_interval_sec", 300),
        "notify_on_offline": cfg.get("notify_on_offline", True),
        "notify_on_restore": cfg.get("notify_on_restore", False),
        "watch_serials": cfg.get("watch_serials", []),
    }


@router.put("/settings")
async def save_settings(body: SmartLinkSettings, _: User = Depends(require_admin)):
    """Save SmartLink monitor settings. Send empty password to keep existing value."""
    existing = await _load_settings()
    password = (
        existing.get("password", "")
        if not body.password or body.password.startswith(MASKED)
        else body.password
    )
    data = {
        "enabled": body.enabled,
        "email": body.email.strip(),
        "password": password,
        "check_interval_sec": max(60, body.check_interval_sec),
        "notify_on_offline": body.notify_on_offline,
        "notify_on_restore": body.notify_on_restore,
        "watch_serials": [s.strip() for s in body.watch_serials if s.strip()],
    }
    await _save_settings(data)
    return {"ok": True}


@router.get("/status")
async def get_status(_: User = Depends(get_current_user)):
    """Return current SmartLink monitor state (radio list, last check, status)."""
    return svc.get_state()


@router.post("/check-now")
async def check_now(_: User = Depends(get_current_user)):
    """Trigger an immediate SmartLink check and return the result."""
    try:
        await svc.check_now()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return svc.get_state()


@router.post("/test")
async def test_connection(body: SmartLinkSettings, _: User = Depends(require_admin)):
    """
    Test SmartLink credentials and return the list of registered radios.
    Does NOT save settings or send notifications.
    """
    existing = await _load_settings()
    password = (
        existing.get("password", "")
        if not body.password or body.password.startswith(MASKED)
        else body.password
    )
    email = body.email.strip()
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password are required")

    try:
        from services.smartlink_monitor_service import _authenticate, _fetch_radios
        token = await _authenticate(email, password)
        radios = await _fetch_radios(token)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    return {"ok": True, "radios": radios, "count": len(radios)}
