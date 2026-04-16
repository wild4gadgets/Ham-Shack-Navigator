import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from dependencies import get_db, get_current_user, require_admin
from models import User, ShutdownStep, KasaPort
from schemas import ShutdownSequenceRequest, ShutdownStepResponse
from services.shutdown_service import execute_shutdown
from services.monitoring_service import set_last_shutdown

router = APIRouter(prefix="/shutdown", tags=["shutdown"])


@router.get("/sequence", response_model=list[ShutdownStepResponse])
async def get_sequence(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(ShutdownStep).order_by(ShutdownStep.step_order)
    )
    return result.scalars().all()


@router.put("/sequence", response_model=list[ShutdownStepResponse])
async def put_sequence(
    body: ShutdownSequenceRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin)
):
    # Validate steps
    for step in body.steps:
        if step.action == "pause":
            if step.delay_after_sec <= 0:
                raise HTTPException(status_code=400, detail="Pause step must have delay_after_sec > 0")
        elif step.action in ("on", "off"):
            result = await db.execute(select(KasaPort).where(KasaPort.id == step.kasa_port_id))
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=400, detail=f"Port ID {step.kasa_port_id} not found")
        else:
            raise HTTPException(status_code=400, detail="Action must be 'on', 'off', or 'pause'")

    # Replace entire sequence
    await db.execute(delete(ShutdownStep))
    for i, step_req in enumerate(body.steps, start=1):
        step = ShutdownStep(
            step_order=i,
            kasa_port_id=step_req.kasa_port_id if step_req.action != "pause" else None,
            action=step_req.action,
            delay_after_sec=step_req.delay_after_sec,
            description=step_req.description,
        )
        db.add(step)
    await db.commit()

    result = await db.execute(select(ShutdownStep).order_by(ShutdownStep.step_order))
    return result.scalars().all()


@router.post("/trigger")
async def trigger_shutdown(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    await set_last_shutdown(db)
    asyncio.create_task(_run_shutdown_bg("Manual trigger"))
    return {"detail": "Shutdown sequence triggered"}


async def _run_shutdown_bg(reason: str):
    from database import AsyncSessionLocal
    from ws_manager import manager
    from services.email_service import send_shutdown_notification
    from services.ifttt_service import send_ifttt_shutdown
    from services.telegram_service import send_telegram_shutdown
    from services.ha_service import push_state_to_ha, post_ha_event
    import json
    from sqlalchemy import select
    from models import Setting
    async with AsyncSessionLocal() as db:
        steps = await execute_shutdown(db, reason)
        await manager.broadcast({"type": "shutdown_alert", "reason": reason, "steps": steps})
        result = await db.execute(select(Setting).where(Setting.key == "notifications"))
        row = result.scalar_one_or_none()
        notifications = json.loads(row.value) if row else {}
        if notifications.get("shutdown_email", True):
            await send_shutdown_notification(db, reason, steps)
        await send_ifttt_shutdown(db, reason, steps)
        await send_telegram_shutdown(db, reason, steps)
        await push_state_to_ha(db)
        await post_ha_event(db, "shutdown", reason)
