"""
Shutdown service: executes the system shutdown workflow with delays.
"""
import asyncio
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from models import Workflow, WorkflowStep, KasaPort, KasaDevice, ShellyChannel
from services.kasa_service import control_port, get_port_states
from services.shelly_service import control_channel, get_channel_states
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
        .options(
            selectinload(WorkflowStep.kasa_port).selectinload(KasaPort.device),
            selectinload(WorkflowStep.shelly_channel).selectinload(ShellyChannel.device),
        )
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

        if step.shelly_channel_id is not None:
            channel = step.shelly_channel
            device = channel.device
            label = channel.label or f"Channel {channel.channel_index}"
            action_desc = f"Step {step.step_order}: {step.action.upper()} {label} ({device.ip_address})"
            try:
                await control_channel(device.ip_address, channel.channel_index, step.action, device.generation)
                executed.append(action_desc + " \u2713")
                await log_event(db, "shelly_action", "info",
                                f"{step.action.upper()} {label}",
                                {"device": device.name, "channel": label, "action": step.action})
                logger.info("Shutdown step %d: %s %s", step.step_order, step.action, label)
            except Exception as e:
                executed.append(action_desc + f" FAILED: {e}")
                await log_event(db, "error", "critical",
                                f"Shelly action failed: {step.action} {label}: {e}",
                                {"device": device.name, "channel": label, "action": step.action, "error": str(e)})
                logger.error("Shutdown step %d failed: %s", step.step_order, e)
        elif step.kasa_port_id is not None:
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
                executed.append(action_desc + f" FAILED: {e}")
                await log_event(db, "error", "critical",
                                f"Kasa action failed: {step.action} {label}: {e}",
                                {"device": device.name, "port": label, "action": step.action, "error": str(e)})
                logger.error("Shutdown step %d failed: %s", step.step_order, e)
        else:
            logger.warning("Shutdown step %d has no device assigned, skipping", step.step_order)
            executed.append(f"Step {step.step_order}: SKIPPED (no device)")

        if step.delay_after_sec > 0:
            logger.info("Waiting %d seconds after step %d", step.delay_after_sec, step.step_order)
            await asyncio.sleep(step.delay_after_sec)

    return executed


async def any_shutdown_workflow_device_on(db: AsyncSession) -> tuple[bool, str]:
    """Return (True, description) if any device the shutdown workflow turns off is currently on."""
    wf_result = await db.execute(
        select(Workflow).where(Workflow.is_system == True, Workflow.name == "Shutdown")
    )
    workflow = wf_result.scalar_one_or_none()
    if not workflow:
        return False, ""

    result = await db.execute(
        select(WorkflowStep)
        .where(WorkflowStep.workflow_id == workflow.id, WorkflowStep.action == "off")
        .options(
            selectinload(WorkflowStep.kasa_port).selectinload(KasaPort.device),
            selectinload(WorkflowStep.shelly_channel).selectinload(ShellyChannel.device),
        )
    )
    steps = result.scalars().all()

    for step in steps:
        if step.shelly_channel_id is not None:
            channel = step.shelly_channel
            device = channel.device
            try:
                states = await get_channel_states(
                    device.ip_address, channel.channel_index + 1, device.generation
                )
                for state in states:
                    if state["channel_index"] == channel.channel_index and state["is_on"]:
                        label = channel.label or f"Channel {channel.channel_index}"
                        logger.info("Post-cooldown guard: Shelly %s — %s is on", device.name, label)
                        return True, f"{device.name} — {label}"
            except Exception as e:
                logger.warning("Post-cooldown Shelly check failed for %s: %s", device.ip_address, e)

        elif step.kasa_port_id is not None:
            port = step.kasa_port
            device = port.device
            try:
                states = await get_port_states(device.ip_address, device.device_type)
                for state in states:
                    if state["port_index"] == port.port_index and state["is_on"]:
                        label = port.label or f"Port {port.port_index}"
                        logger.info("Post-cooldown guard: Kasa %s — %s is on", device.name, label)
                        return True, f"{device.name} — {label}"
            except Exception as e:
                logger.warning("Post-cooldown Kasa check failed for %s: %s", device.ip_address, e)

    return False, ""
