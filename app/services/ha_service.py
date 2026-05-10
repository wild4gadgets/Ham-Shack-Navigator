"""
Home Assistant integration service: pushes state to HA and assembles state for pull endpoints.
"""
import json
import logging
from datetime import datetime, timezone

import aiohttp
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import Setting, WeatherCache

logger = logging.getLogger(__name__)

MILES_PER_KM = 0.621371


async def _get_ha_config(db: AsyncSession) -> dict | None:
    result = await db.execute(select(Setting).where(Setting.key == "home_assistant"))
    row = result.scalar_one_or_none()
    if not row:
        return None
    return json.loads(row.value)


async def get_current_state(db: AsyncSession) -> dict:
    """Assemble the current monitoring + weather state dict."""
    # Monitoring state
    result = await db.execute(select(Setting).where(Setting.key == "monitoring"))
    row = result.scalar_one_or_none()
    monitoring = json.loads(row.value) if row else {}

    enabled = monitoring.get("enabled", False)
    last_shutdown_at = monitoring.get("last_shutdown_at")

    # Cooldown check
    in_cooldown = False
    if last_shutdown_at:
        thresholds_result = await db.execute(select(Setting).where(Setting.key == "thresholds"))
        thresholds_row = thresholds_result.scalar_one_or_none()
        thresholds = json.loads(thresholds_row.value) if thresholds_row else {}
        cooldown_min = thresholds.get("cooldown_min", 30)
        last_dt = datetime.fromisoformat(last_shutdown_at)
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        elapsed = (datetime.now(timezone.utc) - last_dt).total_seconds() / 60
        in_cooldown = elapsed < cooldown_min

    # Wind speed from OWM current cache
    wind_mph = None
    owm_result = await db.execute(select(WeatherCache).where(WeatherCache.source == "owm_current"))
    owm_row = owm_result.scalar_one_or_none()
    if owm_row:
        owm_data = json.loads(owm_row.data)
        wind_mph = owm_data.get("wind", {}).get("speed")

    # Lightning distance from Tomorrow.io cache
    lightning_miles = None
    rt_result = await db.execute(select(WeatherCache).where(WeatherCache.source == "tomorrow_realtime"))
    rt_row = rt_result.scalar_one_or_none()
    if rt_row:
        rt_data = json.loads(rt_row.data)
        lightning_km = rt_data.get("data", {}).get("values", {}).get("lightningDistance")
        if lightning_km is not None:
            lightning_miles = round(lightning_km * MILES_PER_KM, 1)

    return {
        "monitoring_armed": enabled,
        "in_cooldown": in_cooldown,
        "last_shutdown_at": last_shutdown_at,
        "wind_mph": wind_mph,
        "lightning_miles": lightning_miles,
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }


async def push_state_to_ha(db: AsyncSession):
    """Push current state to HA REST API as sensor/binary_sensor entities."""
    cfg = await _get_ha_config(db)
    if not cfg or not cfg.get("enabled_push") or not cfg.get("ha_url") or not cfg.get("ha_token"):
        return

    state = await get_current_state(db)
    ha_url = cfg["ha_url"].rstrip("/")
    headers = {"Authorization": f"Bearer {cfg['ha_token']}", "Content-Type": "application/json"}

    entities = [
        ("sensor.hamshack_wind_mph", str(state["wind_mph"]) if state["wind_mph"] is not None else "unknown",
         {"friendly_name": "Ham Shack Wind Speed", "unit_of_measurement": "mph"}),
        ("sensor.hamshack_lightning_miles", str(state["lightning_miles"]) if state["lightning_miles"] is not None else "unknown",
         {"friendly_name": "Ham Shack Lightning Distance", "unit_of_measurement": "mi"}),
        ("binary_sensor.hamshack_monitoring_armed", "on" if state["monitoring_armed"] else "off",
         {"friendly_name": "Ham Shack Monitoring Armed"}),
        ("binary_sensor.hamshack_in_cooldown", "on" if state["in_cooldown"] else "off",
         {"friendly_name": "Ham Shack In Cooldown"}),
        ("sensor.hamshack_last_shutdown", state["last_shutdown_at"] or "never",
         {"friendly_name": "Ham Shack Last Shutdown"}),
    ]

    async with aiohttp.ClientSession() as session:
        for entity_id, entity_state, attributes in entities:
            try:
                url = f"{ha_url}/api/states/{entity_id}"
                payload = {"state": entity_state, "attributes": attributes}
                async with session.post(url, json=payload, headers=headers,
                                        timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status not in (200, 201):
                        body = await resp.text()
                        logger.warning("HA push %s responded %d: %s", entity_id, resp.status, body[:200])
            except Exception as e:
                logger.error("Failed to push HA entity %s: %s", entity_id, e)


async def post_ha_event(db: AsyncSession, event_type: str, reason: str):
    """Fire a HA event when a shutdown occurs."""
    cfg = await _get_ha_config(db)
    if not cfg or not cfg.get("enabled_push") or not cfg.get("ha_url") or not cfg.get("ha_token"):
        return

    ha_url = cfg["ha_url"].rstrip("/")
    headers = {"Authorization": f"Bearer {cfg['ha_token']}", "Content-Type": "application/json"}
    payload = {"reason": reason, "time": datetime.now(timezone.utc).isoformat()}
    try:
        async with aiohttp.ClientSession() as session:
            url = f"{ha_url}/api/events/hamshack_{event_type}"
            async with session.post(url, json=payload, headers=headers,
                                    timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status not in (200, 201):
                    body = await resp.text()
                    logger.warning("HA event post responded %d: %s", resp.status, body[:200])
        logger.info("HA event posted: hamshack_%s", event_type)
    except Exception as e:
        logger.error("Failed to post HA event: %s", e)


async def push_ha_test(db: AsyncSession):
    """Test the HA push connection by posting a test sensor state."""
    cfg = await _get_ha_config(db)
    if not cfg or not cfg.get("ha_url") or not cfg.get("ha_token"):
        raise ValueError("Home Assistant not configured")

    ha_url = cfg["ha_url"].rstrip("/")
    headers = {"Authorization": f"Bearer {cfg['ha_token']}", "Content-Type": "application/json"}
    payload = {
        "state": "test",
        "attributes": {"friendly_name": "Ham Shack Navigator Test", "last_test": datetime.now(timezone.utc).isoformat()},
    }
    async with aiohttp.ClientSession() as session:
        url = f"{ha_url}/api/states/sensor.hamshack_test"
        async with session.post(url, json=payload, headers=headers,
                                timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status not in (200, 201):
                body = await resp.text()
                raise RuntimeError(f"HA responded {resp.status}: {body[:200]}")
