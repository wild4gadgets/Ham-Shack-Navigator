"""
IFTTT Webhooks service: sends outgoing events to IFTTT and validates incoming webhook requests.
"""
import json
import logging
from datetime import datetime, timezone

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import Setting

logger = logging.getLogger(__name__)

IFTTT_MAKER_URL = "https://maker.ifttt.com/trigger/{event}/with/key/{key}"


async def _get_ifttt_config(db: AsyncSession) -> dict | None:
    result = await db.execute(select(Setting).where(Setting.key == "ifttt"))
    row = result.scalar_one_or_none()
    if not row:
        return None
    return json.loads(row.value)


async def _post_event(webhook_key: str, event_name: str, value1: str = "", value2: str = "", value3: str = ""):
    url = IFTTT_MAKER_URL.format(event=event_name, key=webhook_key)
    payload = {"value1": value1, "value2": value2, "value3": value3}
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status not in (200, 204):
                body = await resp.text()
                raise RuntimeError(f"IFTTT responded {resp.status}: {body}")


async def send_ifttt_shutdown(
    db: AsyncSession, reason: str, steps_executed: list[str], meta: dict | None = None
):
    cfg = await _get_ifttt_config(db)
    if not cfg or not cfg.get("enabled") or not cfg.get("webhook_key"):
        return
    notif_result = await db.execute(select(Setting).where(Setting.key == "notifications"))
    notif_row = notif_result.scalar_one_or_none()
    notifications = json.loads(notif_row.value) if notif_row else {}
    if not notifications.get("shutdown_ifttt", True):
        return

    event_name = cfg.get("event_name_shutdown", "ham_shack_shutdown")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    # value1=reason, value2=timestamp, value3=source or steps summary
    if meta and meta.get("source"):
        detail = f"Source: {meta['source']}"
    else:
        detail = ", ".join(steps_executed[:3]) if steps_executed else "none"
    try:
        await _post_event(cfg["webhook_key"], event_name, reason, timestamp, detail)
        logger.info("IFTTT shutdown event sent: %s", event_name)
    except Exception as e:
        logger.error("Failed to send IFTTT shutdown event: %s", e)


async def send_ifttt_threshold_alert(db: AsyncSession, reason: str, meta: dict):
    cfg = await _get_ifttt_config(db)
    if not cfg or not cfg.get("enabled") or not cfg.get("webhook_key"):
        return
    notif_result = await db.execute(select(Setting).where(Setting.key == "notifications"))
    notif_row = notif_result.scalar_one_or_none()
    notifications = json.loads(notif_row.value) if notif_row else {}
    if not notifications.get("threshold_ifttt", True):
        return

    event_name = cfg.get("event_name_threshold", "ham_shack_alert")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    meta_str = json.dumps(meta)[:100]
    try:
        await _post_event(cfg["webhook_key"], event_name, reason, timestamp, meta_str)
        logger.info("IFTTT threshold alert sent: %s", event_name)
    except Exception as e:
        logger.error("Failed to send IFTTT threshold alert: %s", e)


async def send_ifttt_test(db: AsyncSession):
    cfg = await _get_ifttt_config(db)
    if not cfg or not cfg.get("webhook_key"):
        raise ValueError("IFTTT not configured")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    await _post_event(cfg["webhook_key"], cfg.get("event_name_shutdown", "ham_shack_shutdown"),
                      "Test event", timestamp, "Ham Shack Cockpit test")
