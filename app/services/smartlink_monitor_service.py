"""
SmartLink remote radio monitor.

Polls the FlexRadio SmartLink cloud to check which registered radios are
online. Sends notifications via all enabled channels when a radio goes
offline (or comes back online, if configured).

Authentication uses the FlexRadio account credentials (same login as the
FlexRadio community forum / SmartSDR remote).

NOTE: FlexRadio's SmartLink API is not publicly documented. The endpoints
below are derived from community reverse-engineering.  If authentication
fails, check the FlexRadio community forums for updated endpoint details.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any

import aiohttp

from database import AsyncSessionLocal
from models import Setting
from sqlalchemy import select

logger = logging.getLogger(__name__)

# FlexRadio SmartLink API endpoints
_SSO_TOKEN_URL = "https://sso.flexradio.com/connect/token"
_SMARTLINK_RADIOS_URL = "https://smartlink.flexradio.com/api/v1/registered-radios"
_SSO_CLIENT_ID = "flexradio-smartlink"

# In-memory state shared with the router
_state: dict[str, Any] = {
    "enabled": False,
    "last_check_at": None,
    "status": "unchecked",   # "ok" | "offline" | "partial" | "auth_error" | "error" | "unchecked"
    "radios": [],            # list of {serial, nickname, is_online, last_seen}
    "error": None,
}

_monitor_task: asyncio.Task | None = None


def get_state() -> dict:
    return dict(_state)


async def _get_settings() -> dict:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Setting).where(Setting.key == "smartlink_monitor")
            )
            row = result.scalar_one_or_none()
            return json.loads(row.value) if row else {}
    except Exception as exc:
        logger.debug("SmartLink settings read error: %s", exc)
        return {}


async def _authenticate(email: str, password: str) -> str:
    """
    Authenticate with FlexRadio SSO and return an access token.
    Raises RuntimeError on auth failure.
    """
    data = {
        "grant_type": "password",
        "username": email,
        "password": password,
        "client_id": _SSO_CLIENT_ID,
        "scope": "openid profile offline_access",
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(
            _SSO_TOKEN_URL,
            data=data,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            body = await resp.json(content_type=None)
            if resp.status != 200:
                err = body.get("error_description") or body.get("error") or str(resp.status)
                raise RuntimeError(f"SmartLink auth failed: {err}")
            token = body.get("access_token")
            if not token:
                raise RuntimeError("SmartLink auth: no access_token in response")
            return token


async def _fetch_radios(token: str) -> list[dict]:
    """
    Return the list of registered radios and their online status.
    Each item: {serial, nickname, is_online, last_seen}
    """
    headers = {"Authorization": f"Bearer {token}"}
    async with aiohttp.ClientSession() as session:
        async with session.get(
            _SMARTLINK_RADIOS_URL,
            headers=headers,
            timeout=aiohttp.ClientTimeout(total=15),
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(
                    f"SmartLink radio list failed ({resp.status}): {body[:200]}"
                )
            data = await resp.json(content_type=None)

    # Normalise — the API may return a list directly or wrap it
    items = data if isinstance(data, list) else data.get("radios", data.get("data", []))

    radios = []
    for r in items:
        # Field names vary across API versions; try common variants
        serial = (
            r.get("serial_number") or r.get("serialNumber") or
            r.get("serial") or r.get("model_name") or "unknown"
        )
        nickname = (
            r.get("nickname") or r.get("name") or
            r.get("station") or serial
        )
        is_online = bool(
            r.get("is_online") or r.get("isOnline") or
            r.get("connected") or r.get("status") == "online"
        )
        last_seen = (
            r.get("last_seen") or r.get("lastSeen") or
            r.get("last_contact") or None
        )
        radios.append({
            "serial": serial,
            "nickname": nickname,
            "is_online": is_online,
            "last_seen": last_seen,
        })
    return radios


async def _send_notifications(db, subject: str, body: str, tags: str = "radio,warning"):
    """Send an alert through all configured and enabled notification channels."""
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    full_body = f"{body}\nTime: {timestamp}"

    # Email
    try:
        from services.email_service import _get_smtp_config, _send_email
        smtp = await _get_smtp_config(db)
        if smtp and smtp.get("host") and smtp.get("to_addr"):
            await _send_email(smtp, f"[Ham Shack Navigator] {subject}", full_body)
            logger.info("SmartLink monitor: email sent")
    except Exception as exc:
        logger.error("SmartLink monitor: email failed: %s", exc)

    # Telegram
    try:
        from services.telegram_service import _get_telegram_config, _send_message
        cfg = await _get_telegram_config(db)
        if cfg and cfg.get("enabled") and cfg.get("bot_token") and cfg.get("chat_id"):
            text = f"<b>Ham Shack Navigator — {subject}</b>\n{full_body}"
            await _send_message(cfg["bot_token"], cfg["chat_id"], text)
            logger.info("SmartLink monitor: Telegram sent")
    except Exception as exc:
        logger.error("SmartLink monitor: Telegram failed: %s", exc)

    # ntfy
    try:
        from services.ntfy_service import _get_ntfy_config, _publish
        cfg = await _get_ntfy_config(db)
        if cfg and cfg.get("enabled") and cfg.get("topic"):
            await _publish(cfg, f"Ham Shack Navigator — {subject}", full_body,
                           priority="high", tags=tags)
            logger.info("SmartLink monitor: ntfy sent")
    except Exception as exc:
        logger.error("SmartLink monitor: ntfy failed: %s", exc)

    # IFTTT
    try:
        from services.ifttt_service import _get_ifttt_config, _post_event
        cfg = await _get_ifttt_config(db)
        if cfg and cfg.get("enabled") and cfg.get("webhook_key"):
            event = cfg.get("event_name_threshold", "ham_shack_alert")
            await _post_event(cfg["webhook_key"], event, subject, timestamp, body[:100])
            logger.info("SmartLink monitor: IFTTT sent")
    except Exception as exc:
        logger.error("SmartLink monitor: IFTTT failed: %s", exc)


async def _save_last_notified(db, fingerprint: str) -> None:
    result = await db.execute(
        select(Setting).where(Setting.key == "smartlink_monitor_last_notified")
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = fingerprint
    else:
        db.add(Setting(key="smartlink_monitor_last_notified", value=fingerprint))
    await db.commit()


async def _get_last_notified(db) -> str | None:
    result = await db.execute(
        select(Setting).where(Setting.key == "smartlink_monitor_last_notified")
    )
    row = result.scalar_one_or_none()
    return row.value if row else None


async def check_now() -> None:
    """
    Authenticate to SmartLink, compare radio online status against previous
    check, and send notifications for any status changes.
    """
    settings = await _get_settings()
    if not settings.get("enabled"):
        _state["enabled"] = False
        return

    _state["enabled"] = True
    email = settings.get("email", "").strip()
    password = settings.get("password", "").strip()
    notify_offline = settings.get("notify_on_offline", True)
    notify_restore = settings.get("notify_on_restore", False)
    # Optional list of serials to watch; empty means watch all
    watch_serials: list[str] = [s.strip() for s in settings.get("watch_serials", []) if s.strip()]

    if not email or not password:
        _state["status"] = "error"
        _state["error"] = "SmartLink credentials not configured"
        _state["last_check_at"] = datetime.now(timezone.utc).isoformat()
        return

    try:
        token = await _authenticate(email, password)
    except Exception as exc:
        _state["status"] = "auth_error"
        _state["error"] = str(exc)
        _state["last_check_at"] = datetime.now(timezone.utc).isoformat()
        logger.warning("SmartLink auth error: %s", exc)
        return

    try:
        radios = await _fetch_radios(token)
    except Exception as exc:
        _state["status"] = "error"
        _state["error"] = str(exc)
        _state["last_check_at"] = datetime.now(timezone.utc).isoformat()
        logger.warning("SmartLink radio fetch error: %s", exc)
        return

    # Filter to watched serials if configured
    if watch_serials:
        radios = [r for r in radios if r["serial"] in watch_serials]

    _state["radios"] = radios
    _state["error"] = None
    _state["last_check_at"] = datetime.now(timezone.utc).isoformat()

    online = [r for r in radios if r["is_online"]]
    offline = [r for r in radios if not r["is_online"]]

    if not radios:
        _state["status"] = "error"
        _state["error"] = "No radios found on this account"
        return

    if offline and not online:
        _state["status"] = "offline"
    elif offline:
        _state["status"] = "partial"
    else:
        _state["status"] = "ok"

    # Build notification fingerprint: sorted (serial, is_online) pairs
    fingerprint = json.dumps(sorted((r["serial"], r["is_online"]) for r in radios))

    async with AsyncSessionLocal() as db:
        last_fp = await _get_last_notified(db)

        if fingerprint == last_fp:
            return  # nothing changed

        await _save_last_notified(db, fingerprint)

        if offline and notify_offline:
            names = ", ".join(r["nickname"] or r["serial"] for r in offline)
            count = len(offline)
            subject = f"SmartLink Radio{'s' if count > 1 else ''} Offline"
            body = (
                f"{count} radio{'s' if count > 1 else ''} not available via SmartLink:\n"
                f"  {names}\n"
                f"Online: {len(online)}, Offline: {count}"
            )
            await _send_notifications(db, subject, body, tags="radio,warning,offline")

        elif online and not offline and last_fp is not None and notify_restore:
            names = ", ".join(r["nickname"] or r["serial"] for r in online)
            subject = "SmartLink Radios Restored"
            body = f"All {len(online)} radio(s) are now online via SmartLink:\n  {names}"
            await _send_notifications(db, subject, body, tags="radio,white_check_mark")


async def _monitor_loop() -> None:
    while True:
        settings = await _get_settings()
        interval = max(60, int(settings.get("check_interval_sec", 300)))
        enabled = settings.get("enabled", False)

        if enabled:
            try:
                await check_now()
            except Exception as exc:
                logger.error("SmartLink monitor loop error: %s", exc)
        else:
            _state["enabled"] = False

        await asyncio.sleep(interval)


def start_monitor() -> None:
    global _monitor_task
    if _monitor_task is None or _monitor_task.done():
        _monitor_task = asyncio.create_task(_monitor_loop())
        logger.info("SmartLink monitor task started")


def stop_monitor() -> None:
    global _monitor_task
    if _monitor_task and not _monitor_task.done():
        _monitor_task.cancel()
        _monitor_task = None
        logger.info("SmartLink monitor task stopped")
