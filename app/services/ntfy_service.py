"""
ntfy push notification service: sends alerts to an ntfy topic.
"""
import json
import logging
from datetime import datetime, timezone

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import Setting

logger = logging.getLogger(__name__)


async def _get_ntfy_configs(db: AsyncSession) -> list[dict]:
    """Return all enabled ntfy profiles with topics set."""
    result = await db.execute(select(Setting).where(Setting.key == "ntfy"))
    row = result.scalar_one_or_none()
    if not row:
        return []
    data = json.loads(row.value)
    if "profiles" not in data:
        # Legacy single-profile format
        return [data] if data.get("enabled") and data.get("topic") else []
    return [p for p in data["profiles"] if p.get("enabled") and p.get("topic")]


async def _get_ntfy_config_by_index(db: AsyncSession, index: int) -> dict | None:
    """Return the ntfy profile at the given index (raw, unmasked)."""
    result = await db.execute(select(Setting).where(Setting.key == "ntfy"))
    row = result.scalar_one_or_none()
    if not row:
        return None
    data = json.loads(row.value)
    if "profiles" not in data:
        return data if index == 0 else None
    profiles = data["profiles"]
    return profiles[index] if index < len(profiles) else None


async def _get_ntfy_config(db: AsyncSession) -> dict | None:
    """Return the first enabled ntfy profile (backward-compat helper)."""
    configs = await _get_ntfy_configs(db)
    return configs[0] if configs else None


async def _publish(cfg: dict, title: str, message: str, priority: str = "default", tags: str = ""):
    server = cfg.get("server_url", "https://ntfy.sh").rstrip("/")
    topic = cfg["topic"]
    url = f"{server}/{topic}"
    headers = {
        "Title": title,
        "Priority": priority,
        "Content-Type": "text/plain",
    }
    if tags:
        headers["Tags"] = tags
    token = cfg.get("token", "")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with aiohttp.ClientSession() as session:
        async with session.post(url, data=message.encode(), headers=headers,
                                timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status not in (200, 204):
                body = await resp.text()
                raise RuntimeError(f"ntfy responded {resp.status}: {body}")


def _build_alert_line(meta: dict | None) -> str:
    if not meta:
        return ""
    lightning_miles = meta.get("lightning_miles")
    source = meta.get("source", "")
    if lightning_miles is not None:
        if lightning_miles == 0.0 and source.upper().startswith("NWS"):
            warnings = source.replace("NWS ", "").strip() or "Severe Thunderstorm Warning"
            return f"NWS {warnings} — lightning at your location\n"
        return f"Lightning: {lightning_miles:.1f} mi away ({source})\n"
    wind_gust = meta.get("wind_gust_mph")
    if wind_gust is not None:
        return f"Wind gust: {wind_gust:.1f} mph\n"
    return ""


async def send_ntfy_shutdown(
    db: AsyncSession, reason: str, steps_executed: list[str], meta: dict | None = None
):
    configs = await _get_ntfy_configs(db)
    if not configs:
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    alert_line = _build_alert_line(meta)
    steps_text = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(steps_executed)) or "  (none)"
    message = (
        f"{alert_line}"
        f"Reason: {reason}\n"
        f"Time: {timestamp}\n\n"
        f"Steps:\n{steps_text}"
    )
    for cfg in configs:
        if not cfg.get("notify_shutdown", True):
            continue
        try:
            await _publish(cfg, "Ham Shack Navigator — Shutdown", message, priority="high", tags="warning,radio")
            logger.info("ntfy shutdown notification sent to %s", cfg.get("name", cfg.get("topic")))
        except Exception as e:
            logger.error("Failed to send ntfy shutdown notification to %s: %s", cfg.get("name", cfg.get("topic")), e)


async def send_ntfy_threshold_alert(db: AsyncSession, reason: str, meta: dict):
    configs = await _get_ntfy_configs(db)
    if not configs:
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    message = f"Alert: {reason}\nTime: {timestamp}"
    for cfg in configs:
        if not cfg.get("notify_threshold", True):
            continue
        try:
            await _publish(cfg, "Ham Shack Navigator — Alert", message, priority="default", tags="bell,radio")
            logger.info("ntfy threshold alert sent to %s", cfg.get("name", cfg.get("topic")))
        except Exception as e:
            logger.error("Failed to send ntfy threshold alert to %s: %s", cfg.get("name", cfg.get("topic")), e)


async def send_ntfy_test(db: AsyncSession):
    configs = await _get_ntfy_configs(db)
    if not configs:
        raise ValueError("No enabled ntfy profiles configured")
    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    for cfg in configs:
        await _publish(cfg, "Ham Shack Navigator", f"Test notification sent at {timestamp}", tags="white_check_mark")
