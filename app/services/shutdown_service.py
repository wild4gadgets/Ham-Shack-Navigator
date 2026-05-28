"""
Shutdown service: executes the system shutdown workflow with delays.
"""
import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from models import Workflow, WorkflowStep, KasaPort, KasaDevice
from services.kasa_service import control_port
from services.monitoring_service import log_event

logger = logging.getLogger(__name__)


async def execute_shutdown(db: AsyncSession, reason: str = "Manual trigger") -> list[str]:
    """Execute the system shutdown workflow in order. Returns list of step descriptions."""
    wf_result = await db.execute(select(Workflow).where(Workflow.is_system == True, Workflow.name == "Shutdown"))
    workflow = wf_result.scalar_one_or_none()

    if not workflow:
        logger.warning("No system shutdown workflow found")
        await log_event(db, "shutdown_triggered", "warning",
                        f"Shutdown triggered ({reason}) but no shutdown workflow configured",
                        {"reason": reason})
        return []

    result = await db.execute(
        select(WorkflowStep)
        .where(WorkflowStep.workflow_id == workflow.id)
        .options(selectinload(WorkflowStep.kasa_port).selectinload(KasaPort.device))
        .order_by(WorkflowStep.step_order)
    )
    steps = result.scalars().all()

    if not steps:
        logger.warning("Shutdown triggered but no steps configured")
        await log_event(db, "shutdown_triggered", "warning",
                        f"Shutdown triggered ({reason}) but no steps configured",
                        {"reason": reason})
        return []

    await log_event(db, "shutdown_triggered", "critical",
                    f"Shutdown sequence started: {reason}",
                    {"reason": reason, "step_count": len(steps)})

    executed = []
    for step in steps:
        if step.action == "pause":
            dur = step.delay_after_sec
            action_desc = f"Step {step.step_order}: PAUSE {dur}s"
            logger.info("Shutdown step %d: pause %ds", step.step_order, dur)
            await log_event(db, "kasa_action", "info", f"Pause {dur}s", {"duration_sec": dur})
            await asyncio.sleep(dur)
            executed.append(action_desc + " \u2713")
            continue

        port = step.kasa_port
        device = port.device
        label = port.label or f"Port {port.port_index}"
        action_desc = f"Step {step.step_order}: {step.action.upper()} {label} ({device.ip_address})"

        try:
            await control_port(device.ip_address, device.device_type, port.port_index, step.action)
            executed.append(action_desc + " \u2713")
            await log_event(db, "kasa_action", "info",
                            f"{step.action.upper()} {label}",
                            {"device": device.name, "port": label, "action": step.action})
            logger.info("Shutdown step %d: %s %s", step.step_order, step.action, label)
        except Exception as e:
            error_desc = action_desc + f" FAILED: {e}"
            executed.append(error_desc)
            await log_event(db, "error", "critical",
                            f"Kasa action failed: {step.action} {label}: {e}",
                            {"device": device.name, "port": label, "action": step.action, "error": str(e)})
            logger.error("Shutdown step %d failed: %s", step.step_order, e)

        if step.delay_after_sec > 0:
            logger.info("Waiting %d seconds after step %d", step.delay_after_sec, step.step_order)
            await asyncio.sleep(step.delay_after_sec)

    return executed
