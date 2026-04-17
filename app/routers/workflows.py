import asyncio
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from database import AsyncSessionLocal
from dependencies import get_db, get_current_user, require_admin
from models import User, Workflow, WorkflowStep, KasaPort, ShellyChannel, ShellyDevice, Setting, ScheduledWorkflow
from schemas import (
    WorkflowCreate, WorkflowResponse, WorkflowStepsRequest, WorkflowStepResponse,
    ScheduledWorkflowCreate, ScheduledWorkflowUpdate, ScheduledWorkflowResponse,
)
from services import kasa_service, shelly_service, ifttt_service
from services.monitoring_service import log_event
from ws_manager import manager

router = APIRouter(prefix="/workflows", tags=["workflows"])


async def _execute_workflow(workflow_id: int, workflow_name: str, is_system: bool, steps: list[dict]):
    """Run workflow steps in the background and broadcast completion via WebSocket."""
    error = None
    for i, step in enumerate(steps, start=1):
        try:
            if step["type"] == "pause":
                await asyncio.sleep(step["delay_after_sec"])
            elif step["type"] == "kasa":
                await kasa_service.control_port(
                    step["ip_address"], step["device_type"], step["port_index"], step["action"]
                )
                if step["delay_after_sec"] > 0:
                    await asyncio.sleep(step["delay_after_sec"])
            elif step["type"] == "shelly":
                await shelly_service.control_channel(
                    step["ip_address"], step["channel_index"], step["action"], step["generation"]
                )
                if step["delay_after_sec"] > 0:
                    await asyncio.sleep(step["delay_after_sec"])
            elif step["type"] == "ifttt":
                async with AsyncSessionLocal() as db:
                    cfg = await ifttt_service._get_ifttt_config(db)
                    await log_event(db, "ifttt_step_started", "info",
                        f"IFTTT event '{step['event_name']}' firing (workflow '{workflow_name}' step {i})",
                        {"workflow_id": workflow_id, "workflow_name": workflow_name, "event_name": step["event_name"]})
                if not cfg or not cfg.get("webhook_key"):
                    raise RuntimeError("IFTTT not configured (no webhook key)")
                await ifttt_service._post_event(
                    cfg["webhook_key"],
                    step["event_name"],
                    step.get("value1", ""),
                    step.get("value2", ""),
                    step.get("value3", ""),
                )
                async with AsyncSessionLocal() as db:
                    await log_event(db, "ifttt_step_completed", "info",
                        f"IFTTT event '{step['event_name']}' sent successfully (workflow '{workflow_name}')",
                        {"workflow_id": workflow_id, "workflow_name": workflow_name, "event_name": step["event_name"]})
                if step["delay_after_sec"] > 0:
                    await asyncio.sleep(step["delay_after_sec"])
        except Exception as e:
            error = f"Step {i} failed: {e}"
            if step["type"] == "ifttt":
                async with AsyncSessionLocal() as db:
                    await log_event(db, "ifttt_step_failed", "warning",
                        f"IFTTT event '{step.get('event_name', '?')}' failed in workflow '{workflow_name}': {e}",
                        {"workflow_id": workflow_id, "workflow_name": workflow_name,
                         "event_name": step.get("event_name"), "error": str(e)})
            break

    async with AsyncSessionLocal() as db:
        if error:
            await log_event(db, "workflow_failed", "warning",
                f"Workflow '{workflow_name}' failed: {error}",
                {"workflow_id": workflow_id, "workflow_name": workflow_name})
        else:
            await log_event(db, "workflow_completed", "info",
                f"Workflow '{workflow_name}' completed successfully",
                {"workflow_id": workflow_id, "workflow_name": workflow_name})

        if not error and is_system and workflow_name in ("Startup", "Shutdown"):
            row = (await db.execute(select(Setting).where(Setting.key == "last_system_workflow"))).scalar_one_or_none()
            if row:
                row.value = json.dumps(workflow_name)
            else:
                db.add(Setting(key="last_system_workflow", value=json.dumps(workflow_name)))
            await db.commit()

    await manager.broadcast({"type": "workflow_complete", "workflow_id": workflow_id, "success": error is None, "error": error})


@router.get("", response_model=list[WorkflowResponse])
async def list_workflows(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(Workflow).order_by(Workflow.is_system.desc(), Workflow.name)
    )
    return result.scalars().all()


@router.post("", response_model=WorkflowResponse, status_code=201)
async def create_workflow(
    body: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workflow name cannot be empty")
    existing = await db.execute(select(Workflow).where(Workflow.name == name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A workflow with that name already exists")
    wf = Workflow(name=name, is_system=False)
    db.add(wf)
    await db.commit()
    await db.refresh(wf)
    await log_event(db, "workflow_created", "info", f"Workflow '{name}' created", {"workflow_id": wf.id})
    return wf


@router.patch("/{workflow_id}", response_model=WorkflowResponse)
async def rename_workflow(
    workflow_id: int,
    body: WorkflowCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Workflow name cannot be empty")
    clash = await db.execute(select(Workflow).where(Workflow.name == name, Workflow.id != workflow_id))
    if clash.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="A workflow with that name already exists")
    wf.name = name
    await db.commit()
    await db.refresh(wf)
    return wf


@router.delete("/{workflow_id}", status_code=204)
async def delete_workflow(
    workflow_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    if wf.is_system:
        raise HTTPException(status_code=403, detail="Cannot delete system workflow")
    # Remove any scheduled workflow APScheduler jobs for this workflow
    from scheduler import remove_scheduled_workflow_job
    sw_result = await db.execute(select(ScheduledWorkflow).where(ScheduledWorkflow.workflow_id == workflow_id))
    for sw in sw_result.scalars().all():
        remove_scheduled_workflow_job(sw.id)
    await db.execute(delete(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id))
    await db.delete(wf)
    await db.commit()
    await log_event(db, "workflow_deleted", "info", f"Workflow '{wf.name}' deleted", {"workflow_id": workflow_id})


@router.get("/{workflow_id}/steps", response_model=list[WorkflowStepResponse])
async def get_steps(
    workflow_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workflow not found")
    result = await db.execute(
        select(WorkflowStep)
        .where(WorkflowStep.workflow_id == workflow_id)
        .order_by(WorkflowStep.step_order)
    )
    return result.scalars().all()


@router.put("/{workflow_id}/steps", response_model=list[WorkflowStepResponse])
async def put_steps(
    workflow_id: int,
    body: WorkflowStepsRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    wf_row = result.scalar_one_or_none()
    if not wf_row:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Snapshot existing IFTTT step event names before replacing
    existing_steps = (await db.execute(
        select(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id)
    )).scalars().all()
    existing_ifttt = {s.ifttt_event_name for s in existing_steps if s.action == "ifttt" and s.ifttt_event_name}
    incoming_ifttt = {s.ifttt_event_name for s in body.steps if s.action == "ifttt" and s.ifttt_event_name}

    for step in body.steps:
        if step.action == "pause":
            if step.delay_after_sec <= 0:
                raise HTTPException(status_code=400, detail="Pause step must have delay_after_sec > 0")
        elif step.action == "ifttt":
            if not step.ifttt_event_name:
                raise HTTPException(status_code=400, detail="IFTTT step must specify an event name")
        elif step.action in ("on", "off"):
            if step.kasa_port_id:
                r = await db.execute(select(KasaPort).where(KasaPort.id == step.kasa_port_id))
                if not r.scalar_one_or_none():
                    raise HTTPException(status_code=400, detail=f"Kasa port ID {step.kasa_port_id} not found")
            elif step.shelly_channel_id:
                r = await db.execute(select(ShellyChannel).where(ShellyChannel.id == step.shelly_channel_id))
                if not r.scalar_one_or_none():
                    raise HTTPException(status_code=400, detail=f"Shelly channel ID {step.shelly_channel_id} not found")
            else:
                raise HTTPException(status_code=400, detail="Action step must specify kasa_port_id or shelly_channel_id")
        else:
            raise HTTPException(status_code=400, detail="Action must be 'on', 'off', 'pause', or 'ifttt'")

    await db.execute(delete(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id))
    for i, step_req in enumerate(body.steps, start=1):
        is_device_action = step_req.action in ("on", "off")
        step = WorkflowStep(
            workflow_id=workflow_id,
            step_order=i,
            kasa_port_id=step_req.kasa_port_id if is_device_action else None,
            shelly_channel_id=step_req.shelly_channel_id if is_device_action else None,
            action=step_req.action,
            delay_after_sec=step_req.delay_after_sec,
            description=step_req.description,
            ifttt_event_name=step_req.ifttt_event_name if step_req.action == "ifttt" else None,
            ifttt_value1=step_req.ifttt_value1 if step_req.action == "ifttt" else None,
            ifttt_value2=step_req.ifttt_value2 if step_req.action == "ifttt" else None,
            ifttt_value3=step_req.ifttt_value3 if step_req.action == "ifttt" else None,
        )
        db.add(step)
    await db.commit()

    # Log IFTTT step additions and removals
    for event_name in incoming_ifttt - existing_ifttt:
        await log_event(db, "ifttt_step_added", "info",
            f"IFTTT step '{event_name}' added to workflow '{wf_row.name}'",
            {"workflow_id": workflow_id, "workflow_name": wf_row.name, "event_name": event_name})
    for event_name in existing_ifttt - incoming_ifttt:
        await log_event(db, "ifttt_step_removed", "info",
            f"IFTTT step '{event_name}' removed from workflow '{wf_row.name}'",
            {"workflow_id": workflow_id, "workflow_name": wf_row.name, "event_name": event_name})

    result = await db.execute(
        select(WorkflowStep)
        .where(WorkflowStep.workflow_id == workflow_id)
        .order_by(WorkflowStep.step_order)
    )
    return result.scalars().all()


@router.get("/system-state")
async def get_system_state(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Return the last system workflow that ran, the IDs of Startup/Shutdown workflows,
    and a live device_status ('up' | 'down' | 'partial' | 'unknown') derived from the
    actual current state of every device the Startup workflow turns on."""
    startup = (await db.execute(select(Workflow).where(Workflow.name == "Startup", Workflow.is_system == True))).scalar_one_or_none()
    shutdown = (await db.execute(select(Workflow).where(Workflow.name == "Shutdown", Workflow.is_system == True))).scalar_one_or_none()
    row = (await db.execute(select(Setting).where(Setting.key == "last_system_workflow"))).scalar_one_or_none()
    last = json.loads(row.value) if row else None

    device_status = "unknown"

    if startup:
        steps_result = await db.execute(
            select(WorkflowStep)
            .options(
                selectinload(WorkflowStep.kasa_port).selectinload(KasaPort.device),
                selectinload(WorkflowStep.shelly_channel).selectinload(ShellyChannel.device),
            )
            .where(WorkflowStep.workflow_id == startup.id, WorkflowStep.action == "on")
        )
        on_steps = steps_result.scalars().all()

        if on_steps:
            # Collect unique devices and which port/channel indices matter
            kasa_checks: dict[int, dict] = {}   # device_id → {ip, type, ports: set}
            shelly_checks: dict[int, dict] = {}  # device_id → {ip, count, gen, channels: set}

            for step in on_steps:
                if step.kasa_port_id and step.kasa_port:
                    dev = step.kasa_port.device
                    if dev.id not in kasa_checks:
                        kasa_checks[dev.id] = {"ip": dev.ip_address, "type": dev.device_type, "ports": set()}
                    kasa_checks[dev.id]["ports"].add(step.kasa_port.port_index)
                elif step.shelly_channel_id and step.shelly_channel:
                    dev = step.shelly_channel.device
                    if dev.id not in shelly_checks:
                        shelly_checks[dev.id] = {"ip": dev.ip_address, "count": dev.channel_count, "gen": dev.generation, "channels": set()}
                    shelly_checks[dev.id]["channels"].add(step.shelly_channel.channel_index)

            # Query all devices concurrently; treat unreachable devices as all-off
            kasa_ids = list(kasa_checks)
            shelly_ids = list(shelly_checks)

            kasa_results = await asyncio.gather(
                *[kasa_service.get_port_states(kasa_checks[did]["ip"], kasa_checks[did]["type"]) for did in kasa_ids],
                return_exceptions=True,
            )
            shelly_results = await asyncio.gather(
                *[shelly_service.get_channel_states(shelly_checks[did]["ip"], shelly_checks[did]["count"], shelly_checks[did]["gen"]) for did in shelly_ids],
                return_exceptions=True,
            )

            on_count = 0
            off_count = 0

            for did, result in zip(kasa_ids, kasa_results):
                if isinstance(result, Exception):
                    off_count += len(kasa_checks[did]["ports"])
                else:
                    state_map = {s["port_index"]: s["is_on"] for s in result}
                    for pi in kasa_checks[did]["ports"]:
                        if state_map.get(pi, False):
                            on_count += 1
                        else:
                            off_count += 1

            for did, result in zip(shelly_ids, shelly_results):
                if isinstance(result, Exception):
                    off_count += len(shelly_checks[did]["channels"])
                else:
                    state_map = {s["channel_index"]: s["is_on"] for s in result}
                    for ci in shelly_checks[did]["channels"]:
                        if state_map.get(ci, False):
                            on_count += 1
                        else:
                            off_count += 1

            total = on_count + off_count
            if total > 0:
                if on_count == total:
                    device_status = "up"
                elif off_count == total:
                    device_status = "down"
                else:
                    device_status = "partial"

    return {
        "last": last,
        "startup_id": startup.id if startup else None,
        "shutdown_id": shutdown.id if shutdown else None,
        "device_status": device_status,
    }


@router.post("/{workflow_id}/run", status_code=202)
async def run_workflow(
    workflow_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    wf = result.scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")

    steps_result = await db.execute(
        select(WorkflowStep)
        .options(
            selectinload(WorkflowStep.kasa_port).selectinload(KasaPort.device),
            selectinload(WorkflowStep.shelly_channel).selectinload(ShellyChannel.device),
        )
        .where(WorkflowStep.workflow_id == workflow_id)
        .order_by(WorkflowStep.step_order)
    )
    steps = steps_result.scalars().all()

    # Serialize step data before ORM session closes
    steps_data = []
    for step in steps:
        if step.action == "pause":
            steps_data.append({"type": "pause", "delay_after_sec": step.delay_after_sec})
        elif step.action == "ifttt":
            steps_data.append({
                "type": "ifttt",
                "event_name": step.ifttt_event_name,
                "value1": step.ifttt_value1 or "",
                "value2": step.ifttt_value2 or "",
                "value3": step.ifttt_value3 or "",
                "delay_after_sec": step.delay_after_sec,
            })
        elif step.kasa_port_id:
            steps_data.append({
                "type": "kasa",
                "action": step.action,
                "delay_after_sec": step.delay_after_sec,
                "ip_address": step.kasa_port.device.ip_address,
                "device_type": step.kasa_port.device.device_type,
                "port_index": step.kasa_port.port_index,
            })
        elif step.shelly_channel_id:
            steps_data.append({
                "type": "shelly",
                "action": step.action,
                "delay_after_sec": step.delay_after_sec,
                "ip_address": step.shelly_channel.device.ip_address,
                "channel_index": step.shelly_channel.channel_index,
                "generation": step.shelly_channel.device.generation,
            })

    await log_event(db, "workflow_started", "info",
        f"Workflow '{wf.name}' started ({len(steps_data)} steps)",
        {"workflow_id": workflow_id, "workflow_name": wf.name, "step_count": len(steps_data)})
    background_tasks.add_task(_execute_workflow, workflow_id, wf.name, wf.is_system, steps_data)
    return {"running": True}


# ── Scheduled Workflows ────────────────────────────────────────────────────────

def _validate_run_time(run_time: str):
    try:
        h, m = map(int, run_time.split(":"))
        if not (0 <= h <= 23 and 0 <= m <= 59):
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="run_time must be HH:MM (00:00–23:59)")


def _validate_days(days: list[int]):
    if not days or not all(0 <= d <= 6 for d in days):
        raise HTTPException(status_code=400, detail="days_of_week must be a non-empty list of values 0–6 (0=Sun)")


async def _fetch_sw(db: AsyncSession, sw_id: int) -> ScheduledWorkflow:
    result = await db.execute(
        select(ScheduledWorkflow)
        .options(selectinload(ScheduledWorkflow.workflow))
        .where(ScheduledWorkflow.id == sw_id)
    )
    sw = result.scalar_one_or_none()
    if not sw:
        raise HTTPException(status_code=404, detail="Scheduled workflow not found")
    return sw


@router.get("/scheduled", response_model=list[ScheduledWorkflowResponse])
async def list_scheduled_workflows(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(ScheduledWorkflow)
        .options(selectinload(ScheduledWorkflow.workflow))
        .order_by(ScheduledWorkflow.id)
    )
    return result.scalars().all()


@router.post("/scheduled", response_model=ScheduledWorkflowResponse, status_code=201)
async def create_scheduled_workflow(
    body: ScheduledWorkflowCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    wf = (await db.execute(select(Workflow).where(Workflow.id == body.workflow_id))).scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail="Workflow not found")
    _validate_run_time(body.run_time)
    _validate_days(body.days_of_week)

    sw = ScheduledWorkflow(
        workflow_id=body.workflow_id,
        enabled=body.enabled,
        run_time=body.run_time,
        days_of_week=",".join(str(d) for d in sorted(set(body.days_of_week))),
    )
    db.add(sw)
    await db.commit()

    sw = await _fetch_sw(db, sw.id)

    if sw.enabled:
        from scheduler import add_scheduled_workflow_job
        days = [int(d) for d in sw.days_of_week.split(",") if d.strip()]
        add_scheduled_workflow_job(sw.id, sw.run_time, days)

    return sw


@router.patch("/scheduled/{sw_id}", response_model=ScheduledWorkflowResponse)
async def update_scheduled_workflow(
    sw_id: int,
    body: ScheduledWorkflowUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    sw = await _fetch_sw(db, sw_id)

    if body.workflow_id is not None:
        wf = (await db.execute(select(Workflow).where(Workflow.id == body.workflow_id))).scalar_one_or_none()
        if not wf:
            raise HTTPException(status_code=404, detail="Workflow not found")
        sw.workflow_id = body.workflow_id
    if body.run_time is not None:
        _validate_run_time(body.run_time)
        sw.run_time = body.run_time
    if body.days_of_week is not None:
        _validate_days(body.days_of_week)
        sw.days_of_week = ",".join(str(d) for d in sorted(set(body.days_of_week)))
    if body.enabled is not None:
        sw.enabled = body.enabled

    await db.commit()
    sw = await _fetch_sw(db, sw_id)

    from scheduler import add_scheduled_workflow_job, remove_scheduled_workflow_job
    days = [int(d) for d in sw.days_of_week.split(",") if d.strip()]
    if sw.enabled and days:
        add_scheduled_workflow_job(sw.id, sw.run_time, days)
    else:
        remove_scheduled_workflow_job(sw.id)

    return sw


@router.delete("/scheduled/{sw_id}", status_code=204)
async def delete_scheduled_workflow(
    sw_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ScheduledWorkflow).where(ScheduledWorkflow.id == sw_id))
    sw = result.scalar_one_or_none()
    if not sw:
        raise HTTPException(status_code=404, detail="Scheduled workflow not found")
    from scheduler import remove_scheduled_workflow_job
    remove_scheduled_workflow_job(sw_id)
    await db.delete(sw)
    await db.commit()
