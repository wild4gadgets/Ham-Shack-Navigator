import asyncio
import json
import secrets
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db, get_current_user, require_admin
from models import User, Setting
from services.monitoring_service import is_in_cooldown, log_event, set_last_shutdown
from ws_manager import manager

router = APIRouter(prefix="/monitoring", tags=["monitoring"])


async def _get_monitoring(db: AsyncSession) -> dict:
    result = await db.execute(select(Setting).where(Setting.key == "monitoring"))
    row = result.scalar_one_or_none()
    return json.loads(row.value) if row else {"enabled": False, "last_shutdown_at": None}


async def _save_monitoring(db: AsyncSession, data: dict):
    result = await db.execute(select(Setting).where(Setting.key == "monitoring"))
    row = result.scalar_one_or_none()
    if row:
        row.value = json.dumps(data)
    else:
        row = Setting(key="monitoring", value=json.dumps(data))
        db.add(row)
    await db.commit()


@router.get("/status")
async def get_status(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    monitoring = await _get_monitoring(db)
    in_cooldown = await is_in_cooldown(db)

    cooldown_remaining = 0
    if in_cooldown and monitoring.get("last_shutdown_at"):
        from models import Setting as S
        result = await db.execute(select(S).where(S.key == "thresholds"))
        row = result.scalar_one_or_none()
        thresholds = json.loads(row.value) if row else {}
        cooldown_min = thresholds.get("cooldown_min", 30)
        last_dt = datetime.fromisoformat(monitoring["last_shutdown_at"])
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds() / 60
        cooldown_remaining = max(0, cooldown_min - elapsed)

    return {
        "enabled": monitoring.get("enabled", False),
        "last_shutdown_at": monitoring.get("last_shutdown_at"),
        "in_cooldown": in_cooldown,
        "cooldown_remaining_min": round(cooldown_remaining, 1),
    }


@router.post("/enable")
async def enable_monitoring(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    monitoring = await _get_monitoring(db)
    monitoring["enabled"] = True
    await _save_monitoring(db, monitoring)
    await log_event(db, "monitoring_armed", "info", "Monitoring enabled")
    await manager.broadcast({"type": "monitoring_status", "enabled": True})
    return {"detail": "Monitoring enabled"}


@router.post("/disable")
async def disable_monitoring(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    monitoring = await _get_monitoring(db)
    monitoring["enabled"] = False
    await _save_monitoring(db, monitoring)
    await log_event(db, "monitoring_disarmed", "info", "Monitoring disabled")
    await manager.broadcast({"type": "monitoring_status", "enabled": False})
    return {"detail": "Monitoring disabled"}


@router.post("/webhook/trigger")
async def webhook_trigger(request: Request, db: AsyncSession = Depends(get_db)):
    """Public endpoint: IFTTT or any external system can call this to arm, disarm, or trigger shutdown."""
    # Load IFTTT config for the incoming secret
    result = await db.execute(select(Setting).where(Setting.key == "ifttt"))
    row = result.scalar_one_or_none()
    cfg = json.loads(row.value) if row else {}
    stored_secret = cfg.get("incoming_secret")

    if not stored_secret:
        raise HTTPException(status_code=403, detail="Webhook not enabled — configure an incoming secret in IFTTT settings first")

    provided = request.headers.get("X-Webhook-Secret")
    if not provided or not secrets.compare_digest(provided.encode(), stored_secret.encode()):
        raise HTTPException(status_code=403, detail="Invalid webhook secret")

    try:
        body = await request.json()
    except Exception:
        body = {}

    action = body.get("action", "trigger_shutdown")

    if action == "arm":
        monitoring = await _get_monitoring(db)
        monitoring["enabled"] = True
        await _save_monitoring(db, monitoring)
        await log_event(db, "monitoring_armed", "info", "Monitoring armed via webhook")
        await manager.broadcast({"type": "monitoring_status", "enabled": True})

    elif action == "disarm":
        monitoring = await _get_monitoring(db)
        monitoring["enabled"] = False
        await _save_monitoring(db, monitoring)
        await log_event(db, "monitoring_disarmed", "info", "Monitoring disarmed via webhook")
        await manager.broadcast({"type": "monitoring_status", "enabled": False})

    elif action == "trigger_shutdown":
        await set_last_shutdown(db)
        from routers.shutdown import _run_shutdown_bg
        asyncio.create_task(_run_shutdown_bg("Webhook trigger"))
        await manager.broadcast({"type": "shutdown_alert", "reason": "Webhook trigger"})

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")

    await log_event(db, "webhook_received", "info", f"Webhook action: {action}")
    return {"detail": "OK", "action": action}
