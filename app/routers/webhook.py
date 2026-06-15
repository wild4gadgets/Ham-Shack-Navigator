"""
Remote workflow invocation — for Stream Deck, mobile apps, IFTTT, and other external callers.
Authenticated via a single global API key stored in settings (key: "webhook_api").

Two auth styles share the same stored key:
  - Header-based: Authorization: Bearer or X-API-Key header (Stream Deck, curl, mobile)
  - Token-in-URL: POST /webhooks/run/{token}/{workflow_name} (IFTTT, Alexa, voice assistants)
"""
import json
import secrets

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from dependencies import get_db
from limiter import limiter
from models import KasaPort, Setting, ShellyChannel, Workflow, WorkflowStep
from routers.workflows import _execute_workflow
from services.monitoring_service import log_event

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
}


async def _get_stored_key(db: AsyncSession) -> str | None:
    row = (await db.execute(select(Setting).where(Setting.key == "webhook_api"))).scalar_one_or_none()
    if not row:
        return None
    return json.loads(row.value).get("api_key") or None


async def _build_steps_data(db: AsyncSession, wf: Workflow) -> list[dict]:
    steps_result = await db.execute(
        select(WorkflowStep)
        .options(
            selectinload(WorkflowStep.kasa_port).selectinload(KasaPort.device),
            selectinload(WorkflowStep.shelly_channel).selectinload(ShellyChannel.device),
        )
        .where(WorkflowStep.workflow_id == wf.id)
        .order_by(WorkflowStep.step_order)
    )
    steps_data = []
    for step in steps_result.scalars().all():
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
    return steps_data


async def _verify_webhook_key(request: Request, db: AsyncSession = Depends(get_db)):
    provided = None
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        provided = auth[7:]
    if not provided:
        provided = request.headers.get("X-API-Key", "")
    if not provided:
        raise HTTPException(status_code=401, detail="API key required (Authorization: Bearer or X-API-Key header)")

    stored = await _get_stored_key(db)
    if not stored:
        raise HTTPException(status_code=503, detail="Webhook API key not configured — set it in Settings → Remote Webhook")
    if not secrets.compare_digest(provided.encode(), stored.encode()):
        raise HTTPException(status_code=401, detail="Invalid API key")


@router.options("/workflows/{workflow_name}")
async def invoke_workflow_preflight(workflow_name: str):
    return Response(status_code=204, headers=_CORS_HEADERS)


@router.post("/workflows/{workflow_name}", status_code=202)
@limiter.limit("30/minute")
async def invoke_workflow_by_name(
    workflow_name: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: None = Depends(_verify_webhook_key),
):
    """Header-authenticated endpoint — for Stream Deck, curl, mobile shortcuts."""
    wf = (await db.execute(select(Workflow).where(Workflow.name == workflow_name))).scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found", headers=_CORS_HEADERS)

    steps_data = await _build_steps_data(db, wf)
    await log_event(db, "workflow_started", "info",
        f"Workflow '{wf.name}' started via webhook ({len(steps_data)} steps)",
        {"workflow_id": wf.id, "workflow_name": wf.name, "step_count": len(steps_data), "source": "webhook"})
    background_tasks.add_task(_execute_workflow, wf.id, wf.name, wf.is_system, steps_data)
    return Response(
        content=json.dumps({"running": True, "workflow_id": wf.id, "workflow_name": wf.name}),
        status_code=202,
        media_type="application/json",
        headers=_CORS_HEADERS,
    )


@router.options("/run/{token}/{workflow_name}")
async def invoke_by_url_preflight(token: str, workflow_name: str):
    return Response(status_code=204, headers=_CORS_HEADERS)


@router.post("/run/{token}/{workflow_name}", status_code=202)
@limiter.limit("30/minute")
async def invoke_workflow_by_url_token(
    token: str,
    workflow_name: str,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Token-in-URL endpoint — for IFTTT, Alexa, and voice assistant automations."""
    stored = await _get_stored_key(db)
    if not stored:
        raise HTTPException(status_code=503, detail="Webhook API key not configured — set it in Settings → Remote Webhook", headers=_CORS_HEADERS)
    if not secrets.compare_digest(token.encode(), stored.encode()):
        raise HTTPException(status_code=401, detail="Invalid token", headers=_CORS_HEADERS)

    wf = (await db.execute(select(Workflow).where(Workflow.name == workflow_name))).scalar_one_or_none()
    if not wf:
        raise HTTPException(status_code=404, detail=f"Workflow '{workflow_name}' not found", headers=_CORS_HEADERS)

    steps_data = await _build_steps_data(db, wf)
    await log_event(db, "workflow_started", "info",
        f"Workflow '{wf.name}' started via IFTTT webhook ({len(steps_data)} steps)",
        {"workflow_id": wf.id, "workflow_name": wf.name, "step_count": len(steps_data), "source": "ifttt"})
    background_tasks.add_task(_execute_workflow, wf.id, wf.name, wf.is_system, steps_data)
    return Response(
        content=json.dumps({"running": True, "workflow_id": wf.id, "workflow_name": wf.name}),
        status_code=202,
        media_type="application/json",
        headers=_CORS_HEADERS,
    )
