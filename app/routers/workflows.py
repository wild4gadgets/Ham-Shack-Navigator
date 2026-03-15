import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from dependencies import get_db, get_current_user
from models import User, Workflow, WorkflowStep, KasaPort, ShellyChannel, ShellyDevice
from schemas import WorkflowCreate, WorkflowResponse, WorkflowStepsRequest, WorkflowStepResponse
from services import kasa_service, shelly_service

router = APIRouter(prefix="/workflows", tags=["workflows"])


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
    await db.execute(delete(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id))
    await db.delete(wf)
    await db.commit()


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
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Workflow not found")

    for step in body.steps:
        if step.action == "pause":
            if step.delay_after_sec <= 0:
                raise HTTPException(status_code=400, detail="Pause step must have delay_after_sec > 0")
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
            raise HTTPException(status_code=400, detail="Action must be 'on', 'off', or 'pause'")

    await db.execute(delete(WorkflowStep).where(WorkflowStep.workflow_id == workflow_id))
    for i, step_req in enumerate(body.steps, start=1):
        step = WorkflowStep(
            workflow_id=workflow_id,
            step_order=i,
            kasa_port_id=step_req.kasa_port_id if step_req.action != "pause" else None,
            shelly_channel_id=step_req.shelly_channel_id if step_req.action != "pause" else None,
            action=step_req.action,
            delay_after_sec=step_req.delay_after_sec,
            description=step_req.description,
        )
        db.add(step)
    await db.commit()

    result = await db.execute(
        select(WorkflowStep)
        .where(WorkflowStep.workflow_id == workflow_id)
        .order_by(WorkflowStep.step_order)
    )
    return result.scalars().all()


@router.post("/{workflow_id}/run")
async def run_workflow(
    workflow_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Workflow).where(Workflow.id == workflow_id))
    if not result.scalar_one_or_none():
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

    for step in steps:
        if step.action == "pause":
            await asyncio.sleep(step.delay_after_sec)
        elif step.kasa_port_id:
            try:
                await kasa_service.control_port(
                    step.kasa_port.device.ip_address,
                    step.kasa_port.device.device_type,
                    step.kasa_port.port_index,
                    step.action,
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Step {step.step_order} failed: {e}")
            if step.delay_after_sec > 0:
                await asyncio.sleep(step.delay_after_sec)
        elif step.shelly_channel_id:
            try:
                await shelly_service.control_channel(
                    step.shelly_channel.device.ip_address,
                    step.shelly_channel.channel_index,
                    step.action,
                )
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Step {step.step_order} failed: {e}")
            if step.delay_after_sec > 0:
                await asyncio.sleep(step.delay_after_sec)

    return {"success": True}
