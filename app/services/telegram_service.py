"""
Telegram Bot service: sends alert messages via a Telegram bot.
"""
import json
import logging
from datetime import datetime, timezone

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import Setting

logger = logging.getLogger(__name__)

TELEGRAM_API_URL = "https://api.telegram.org/bot{token}/sendMessage"


async def _get_telegram_config(db: AsyncSession) -> dict | None:
    result = await db.execute(select(Setting).where(Setting.key == "telegram"))
    row = result.scalar_one_or_none()
    if not row:
        return None
    return json.loads(row.value)


async def _send_message(bot_token: str, chat_id: str, text: str):
    url = TELEGRAM_API_URL.format(token=bot_token)
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            data = await resp.json()
            if not data.get("ok"):
                raise RuntimeError(f"Telegram error: {data.get('description', 'unknown')}")


def _build_alert_line(meta: dict | None) -> str:
    """Return a one-line HTML alert summary for the Telegram message."""
    if not meta:
        return ""
    lightning_miles = meta.get("lightning_miles")
    source = meta.get("source", "")
    if lightning_miles is not None:
        if lightning_miles == 0.0 and source.upper().startswith("NWS"):
            warnings = source.replace("NWS ", "").strip() or "Severe Thunderstorm Warning"
            return f"&#9889; <b>NWS {warnings}</b> — lightning at your location\n"
        return f"&#9889; <b>Lightning</b>: {lightning_miles:.1f} mi away ({source})\n"
    wind_gust = meta.get("wind_gust_mph")
    if wind_gust is not None:
        return f"&#128168; <b>Wind gust</b>: {wind_gust:.1f} mph\n"
    return ""


async def send_telegram_shutdown(
    db: AsyncSession, reason: str, steps_executed: list[str], meta: dict | None = None
):
    cfg = await _get_telegram_config(db)
    if not cfg or not cfg.get("enabled") or not cfg.get("bot_token") or not cfg.get("chat_id"):
        return
    notif_result = await db.execute(select(Setting).where(Setting.key == "notifications"))
    notif_row = notif_result.scalar_one_or_none()
    notifications = json.loads(notif_row.value) if notif_row else {}
    if not notifications.get("shutdown_telegram", True):
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    steps_lines = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(steps_executed)) or "  (none)"
    alert_line = _build_alert_line(meta)
    text = (
        f"<b>Ham Shack Cockpit — Shutdown Triggered</b>\n"
        f"{alert_line}"
        f"Reason: {reason}\n"
        f"Time: {timestamp}\n\n"
        f"Steps:\n{steps_lines}"
    )
    try:
        await _send_message(cfg["bot_token"], cfg["chat_id"], text)
        logger.info("Telegram shutdown message sent")
    except Exception as e:
        logger.error("Failed to send Telegram shutdown message: %s", e)


async def send_telegram_threshold_alert(db: AsyncSession, reason: str, meta: dict):
    cfg = await _get_telegram_config(db)
    if not cfg or not cfg.get("enabled") or not cfg.get("bot_token") or not cfg.get("chat_id"):
        return
    notif_result = await db.execute(select(Setting).where(Setting.key == "notifications"))
    notif_row = notif_result.scalar_one_or_none()
    notifications = json.loads(notif_row.value) if notif_row else {}
    if not notifications.get("threshold_telegram", True):
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    text = (
        f"<b>Ham Shack Cockpit - Threshold Alert</b>\n"
        f"Alert: {reason}\n"
        f"Time: {timestamp}"
    )
    try:
        await _send_message(cfg["bot_token"], cfg["chat_id"], text)
        logger.info("Telegram threshold alert sent")
    except Exception as e:
        logger.error("Failed to send Telegram threshold alert: %s", e)


async def send_telegram_test(db: AsyncSession):
    cfg = await _get_telegram_config(db)
    if not cfg or not cfg.get("bot_token") or not cfg.get("chat_id"):
        raise ValueError("Telegram not configured")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    text = f"<b>Ham Shack Cockpit</b>\nTest message sent at {timestamp}"
    await _send_message(cfg["bot_token"], cfg["chat_id"], text)
