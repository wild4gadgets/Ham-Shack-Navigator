"""
APScheduler: monitoring poll job + daily digest job + Blitzortung lightning listener.
"""
import asyncio
import json
import logging
import math
import time as _time
import urllib.request
import xml.etree.ElementTree as ET
from collections import deque
from datetime import datetime, timezone

import aiohttp
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import AsyncSessionLocal
from models import Setting, Workflow, ScheduledWorkflow
from services.weather_service import fetch_all, get_location
from services.monitoring_service import (
    check_conditions, is_in_cooldown, set_last_shutdown, log_event,
    is_notification_in_cooldown, set_last_notification,
)
from services.shutdown_service import execute_shutdown
from services.email_service import send_shutdown_notification, send_digest
from services.ifttt_service import send_ifttt_shutdown
from services.telegram_service import send_telegram_shutdown
from services.ha_service import push_state_to_ha, post_ha_event
from ws_manager import manager

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
_poll_job_id = "monitor_poll"
_digest_job_id = "daily_digest"

# ── Blitzortung WebSocket lightning listener ─────────────────────────────────
_blitzortung_strikes: deque[tuple[float, float]] = deque()  # (unix_ts, distance_km)
_blitzortung_lat: float | None = None
_blitzortung_lon: float | None = None
_blitzortung_task: asyncio.Task | None = None
_BLITZORTUNG_WINDOW_SEC = 900    # keep strikes within a 15-minute rolling window
_BLITZORTUNG_WRITE_SEC  = 60     # flush minimum distance to WeatherCache every 60 s
_BLITZORTUNG_SERVERS = [
    "ws1.blitzortung.org",
    "ws7.blitzortung.org",
    "ws8.blitzortung.org",
]


def _btz_haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def update_blitzortung_location(lat: float, lon: float):
    """Update the user location used by the Blitzortung listener."""
    global _blitzortung_lat, _blitzortung_lon
    _blitzortung_lat = lat
    _blitzortung_lon = lon


async def _write_blitzortung_cache():
    """Flush current rolling-window strike data to WeatherCache."""
    now = _time.time()
    window_start = now - _BLITZORTUNG_WINDOW_SEC
    recent = [d for t, d in _blitzortung_strikes if t >= window_start]
    payload = {
        "lightningDistance": min(recent) if recent else None,
        "strike_count": len(recent),
        "window_minutes": _BLITZORTUNG_WINDOW_SEC // 60,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        async with AsyncSessionLocal() as db:
            from services.weather_service import _save_cache
            await _save_cache(db, "blitzortung_lightning", payload)
    except Exception as e:
        logger.error("Blitzortung cache write error: %s", e)


async def _blitzortung_listener():
    """
    Persistent WebSocket task for Blitzortung lightning strike data.

    NOTE: Blitzortung's public WebSocket (ws*.blitzortung.org) currently does not
    stream data to non-browser clients.  This task will keep retrying with
    exponential back-off (up to 10 min) so that it activates automatically if
    the API ever becomes accessible again, without flooding logs.
    """
    server_idx = 0
    fail_count = 0
    last_write = 0.0

    while True:
        if _blitzortung_lat is None:
            await asyncio.sleep(30)
            continue

        server = _BLITZORTUNG_SERVERS[server_idx % len(_BLITZORTUNG_SERVERS)]
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(
                    f"wss://{server}/",
                    timeout=aiohttp.ClientTimeout(total=None, connect=10),
                    heartbeat=30,
                ) as ws:
                    logger.info("Blitzortung WebSocket connected to %s", server)
                    fail_count = 0  # reset on successful connection

                    await ws.send_json({
                        "west":  max(-180.0, _blitzortung_lon - 5.0),
                        "east":  min( 180.0, _blitzortung_lon + 5.0),
                        "north": min(  90.0, _blitzortung_lat + 5.0),
                        "south": max( -90.0, _blitzortung_lat - 5.0),
                    })

                    # Use a 5-minute data timeout so an idle connection
                    # (server accepts but never sends) doesn't block forever.
                    while True:
                        try:
                            msg = await asyncio.wait_for(ws.receive(), timeout=300)
                        except asyncio.TimeoutError:
                            logger.debug("Blitzortung: no data in 5 min from %s", server)
                            break

                        if msg.type == aiohttp.WSMsgType.TEXT:
                            now = _time.time()
                            try:
                                data = json.loads(msg.data)
                                s_lat = data.get("lat")
                                s_lon = data.get("lon")
                                if (s_lat is not None and s_lon is not None
                                        and _blitzortung_lat is not None):
                                    s_lat, s_lon = float(s_lat), float(s_lon)
                                    if -90 <= s_lat <= 90 and -180 <= s_lon <= 180:
                                        dist_km = _btz_haversine_km(
                                            _blitzortung_lat, _blitzortung_lon,
                                            s_lat, s_lon,
                                        )
                                        _blitzortung_strikes.append((now, dist_km))
                            except Exception:
                                pass

                            cutoff = now - _BLITZORTUNG_WINDOW_SEC
                            while _blitzortung_strikes and _blitzortung_strikes[0][0] < cutoff:
                                _blitzortung_strikes.popleft()

                            if now - last_write >= _BLITZORTUNG_WRITE_SEC:
                                await _write_blitzortung_cache()
                                last_write = now

                        elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSED):
                            logger.debug("Blitzortung WS closed (%s)", server)
                            break

        except Exception as e:
            fail_count += 1
            # Log at DEBUG after the first few failures to avoid log spam
            log = logger.warning if fail_count <= 3 else logger.debug
            log("Blitzortung WS error (%s, attempt %d): %s", server, fail_count, e)
            server_idx += 1

        # Exponential back-off: 10s, 30s, 90s, … capped at 10 min
        delay = min(10 * (3 ** (fail_count - 1)), 600)
        await asyncio.sleep(delay)


async def _monitoring_poll():
    """Main monitoring poll — runs on interval."""
    async with AsyncSessionLocal() as db:
        # Re-read enabled state from DB each invocation
        result = await db.execute(select(Setting).where(Setting.key == "monitoring"))
        row = result.scalar_one_or_none()
        if not row:
            return
        monitoring = json.loads(row.value)
        if not monitoring.get("enabled", False):
            return

        # Refresh Blitzortung location in case the user changed their settings
        try:
            lat, lon, _ = await get_location(db)
            if lat is not None:
                update_blitzortung_location(lat, lon)
        except Exception:
            pass

        # Fetch fresh weather data
        try:
            await fetch_all(db)
        except Exception as e:
            logger.error("Weather fetch failed: %s", e)
            await log_event(db, "error", "warning", f"Weather fetch failed: {e}")

        # Broadcast weather update immediately after fetch so dashboard refreshes
        # regardless of cooldown state or threshold outcome
        await manager.broadcast({"type": "weather_update", "source": "poll"})

        # Check cooldown
        if await is_in_cooldown(db):
            logger.debug("In cooldown, skipping threshold check")
            await manager.broadcast({"type": "monitoring_status", "in_cooldown": True})
            return

        # Check thresholds
        should_trigger, reason, meta = await check_conditions(db)

        await manager.broadcast({"type": "monitoring_status", "triggered": should_trigger, "reason": reason})

        # Push state to HA after every poll (keeps HA sensors fresh)
        try:
            await push_state_to_ha(db)
        except Exception as e:
            logger.error("HA state push failed: %s", e)

        if should_trigger:
            # Set last_shutdown_at BEFORE launching task (prevents re-trigger)
            await set_last_shutdown(db)

            # Fire shutdown as a background task, passing meta for enriched notifications
            asyncio.create_task(_run_shutdown(reason, meta))
            await manager.broadcast({"type": "shutdown_alert", "reason": reason, "metadata": meta})


async def _run_shutdown(reason: str, meta: dict | None = None):
    """Background task for the full shutdown sequence."""
    async with AsyncSessionLocal() as db:
        try:
            steps = await execute_shutdown(db, reason)

            # Check notification settings
            result = await db.execute(select(Setting).where(Setting.key == "notifications"))
            row = result.scalar_one_or_none()
            notifications = json.loads(row.value) if row else {}

            # Respect 30-minute notification cooldown to prevent recipient spam
            if await is_notification_in_cooldown(db):
                logger.info("Notification cooldown active — skipping alerts for this shutdown")
            else:
                if notifications.get("shutdown_email", True):
                    await send_shutdown_notification(db, reason, steps, meta)
                    await log_event(db, "email_sent", "info", "Shutdown notification email sent")
                await send_ifttt_shutdown(db, reason, steps, meta)
                await send_telegram_shutdown(db, reason, steps, meta)
                await set_last_notification(db)

            await push_state_to_ha(db)
            await post_ha_event(db, "shutdown", reason)
        except Exception as e:
            logger.error("Shutdown sequence error: %s", e)
            await log_event(db, "error", "critical", f"Shutdown sequence error: {e}")


async def _daily_digest():
    """Daily digest email job."""
    async with AsyncSessionLocal() as db:
        try:
            # Check if digest is enabled
            result = await db.execute(select(Setting).where(Setting.key == "smtp"))
            row = result.scalar_one_or_none()
            if not row:
                return
            smtp = json.loads(row.value)
            if not smtp.get("digest_enabled", True):
                return

            # Check notification settings
            result2 = await db.execute(select(Setting).where(Setting.key == "notifications"))
            row2 = result2.scalar_one_or_none()
            if row2:
                notif = json.loads(row2.value)
                if not notif.get("digest_email", True):
                    return

            # Build simple forecast summary from cached data
            from models import WeatherCache
            result3 = await db.execute(select(WeatherCache).where(WeatherCache.source == "owm_forecast"))
            cache = result3.scalar_one_or_none()
            if cache:
                forecast_data = json.loads(cache.data)
                items = forecast_data.get("list", [])
                lines = []
                for item in items[:8]:
                    dt = datetime.fromtimestamp(item.get("dt", 0), tz=timezone.utc)
                    desc = item.get("weather", [{}])[0].get("description", "N/A")
                    wind = item.get("wind", {}).get("speed", 0)
                    temp = item.get("main", {}).get("temp", 0)
                    lines.append(f"  {dt.strftime('%H:%M UTC')}: {desc}, {temp:.0f}°F, wind {wind:.0f} mph")
                summary = "24-Hour Forecast:\n" + "\n".join(lines)
            else:
                summary = "No forecast data available."

            # Fetch solar/propagation data
            solar_summary = ""
            try:
                def _fetch_solar():
                    with urllib.request.urlopen("https://www.hamqsl.com/solarxml.php", timeout=10) as resp:
                        return resp.read()

                solar_xml = await asyncio.to_thread(_fetch_solar)
                root = ET.fromstring(solar_xml)
                sd = root.find('.//solardata')
                if sd is not None:
                    def g(tag):
                        el = sd.find(tag)
                        return el.text.strip() if el is not None and el.text else '--'

                    sfi = g('solarflux')
                    sunspots = g('sunspots')
                    k_index = g('kindex')
                    a_index = g('aindex')
                    xray = g('xray')
                    geomag = g('geomagfield')
                    solar_wind = g('solarwind')
                    updated = g('updated')

                    bands = {}
                    for band_el in sd.findall('.//calculatedconditions/band'):
                        name = band_el.get('name', '')
                        time = band_el.get('time', '')
                        if name and time:
                            if name not in bands:
                                bands[name] = {}
                            bands[name][time] = band_el.text.strip() if band_el.text else '--'

                    band_lines = []
                    for band in ['80m-40m', '30m-20m', '17m-15m', '12m-10m']:
                        day = bands.get(band, {}).get('day', '--')
                        night = bands.get(band, {}).get('night', '--')
                        band_lines.append(f"  {band:<10}  Day: {day:<8}  Night: {night}")

                    solar_summary = (
                        f"\nSolar & Propagation (as of {updated}):\n"
                        f"  SFI: {sfi}  Sunspots: {sunspots}  K-index: {k_index}"
                        f"  A-index: {a_index}  X-ray: {xray}\n"
                        f"  Geomag: {geomag}  Solar Wind: {solar_wind} km/s\n\n"
                        f"HF Band Conditions:\n" + "\n".join(band_lines)
                    )
            except Exception as e:
                logger.warning("Solar data fetch failed for digest: %s", e)
                solar_summary = "\nSolar/propagation data unavailable."

            await send_digest(db, summary, solar_summary)
            await log_event(db, "email_sent", "info", "Daily digest email sent")
        except Exception as e:
            logger.error("Daily digest error: %s", e)


def _to_aps_days(user_days: list[int]) -> str:
    """Convert user day-of-week (0=Sun) to APScheduler format (0=Mon, 6=Sun)."""
    return ",".join(str((d - 1) % 7) for d in user_days)


def add_scheduled_workflow_job(sw_id: int, run_time: str, days_of_week: list[int]):
    """Add or replace an APScheduler job for a scheduled workflow."""
    if not _scheduler or not _scheduler.running or not days_of_week:
        return
    hour, minute = map(int, run_time.split(":"))
    aps_days = _to_aps_days(days_of_week)
    _scheduler.add_job(
        _run_scheduled_workflow,
        args=[sw_id],
        trigger=CronTrigger(day_of_week=aps_days, hour=hour, minute=minute),
        id=f"scheduled_wf_{sw_id}",
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )
    logger.info("Scheduled workflow job %d: %s UTC on aps_days=%s", sw_id, run_time, aps_days)


def remove_scheduled_workflow_job(sw_id: int):
    """Remove the APScheduler job for a scheduled workflow."""
    if _scheduler and _scheduler.running:
        try:
            _scheduler.remove_job(f"scheduled_wf_{sw_id}")
        except Exception:
            pass


async def _run_scheduled_workflow(sw_id: int):
    """Execute the steps of a scheduled workflow."""
    from routers.workflows import _execute_workflow  # lazy import — avoids circular at module load

    async with AsyncSessionLocal() as db:
        sw = (await db.execute(
            select(ScheduledWorkflow).where(ScheduledWorkflow.id == sw_id)
        )).scalar_one_or_none()
        if not sw or not sw.enabled:
            return

        from models import WorkflowStep, KasaPort, ShellyChannel
        wf = (await db.execute(
            select(Workflow).where(Workflow.id == sw.workflow_id)
        )).scalar_one_or_none()
        if not wf:
            return

        steps_result = await db.execute(
            select(WorkflowStep)
            .options(
                selectinload(WorkflowStep.kasa_port).selectinload(KasaPort.device),
                selectinload(WorkflowStep.shelly_channel).selectinload(ShellyChannel.device),
            )
            .where(WorkflowStep.workflow_id == sw.workflow_id)
            .order_by(WorkflowStep.step_order)
        )
        steps = steps_result.scalars().all()

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

        wf_id, wf_name, wf_system = wf.id, wf.name, wf.is_system

    asyncio.create_task(_execute_workflow(wf_id, wf_name, wf_system, steps_data))
    logger.info("Scheduled workflow %d (%s) triggered", sw_id, wf_name)


async def _load_scheduled_workflow_jobs():
    """On startup, register APScheduler jobs for all enabled scheduled workflows."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(ScheduledWorkflow).where(ScheduledWorkflow.enabled == True)
        )
        for sw in result.scalars().all():
            days = [int(d) for d in sw.days_of_week.split(",") if d.strip()]
            if days:
                add_scheduled_workflow_job(sw.id, sw.run_time, days)


async def start_scheduler():
    global _scheduler, _blitzortung_task
    _scheduler = AsyncIOScheduler(timezone="UTC")

    # Add poll job with default interval (will be updated when settings change)
    _scheduler.add_job(
        _monitoring_poll,
        trigger=IntervalTrigger(seconds=300),
        id=_poll_job_id,
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )

    # Add digest job (default 06:00 UTC)
    _scheduler.add_job(
        _daily_digest,
        trigger=CronTrigger(hour=6, minute=0),
        id=_digest_job_id,
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )

    _scheduler.start()
    await _load_scheduled_workflow_jobs()

    # Seed Blitzortung location from DB, then start the listener
    try:
        async with AsyncSessionLocal() as db:
            lat, lon, _ = await get_location(db)
            if lat is not None:
                update_blitzortung_location(lat, lon)
    except Exception as e:
        logger.warning("Could not seed Blitzortung location: %s", e)

    _blitzortung_task = asyncio.create_task(_blitzortung_listener())
    logger.info("Scheduler and Blitzortung listener started")


async def shutdown_scheduler():
    global _scheduler, _blitzortung_task
    if _blitzortung_task and not _blitzortung_task.done():
        _blitzortung_task.cancel()
        try:
            await _blitzortung_task
        except asyncio.CancelledError:
            pass
        _blitzortung_task = None
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def update_poll_interval(seconds: int):
    """Update the poll job interval. Called when thresholds settings change."""
    if _scheduler and _scheduler.running:
        _scheduler.reschedule_job(
            _poll_job_id,
            trigger=IntervalTrigger(seconds=max(60, seconds)),
        )
        logger.info("Poll interval updated to %d seconds", seconds)


def update_digest_time(time_str: str):
    """Update digest job schedule. time_str = 'HH:MM'."""
    if _scheduler and _scheduler.running:
        try:
            hour, minute = map(int, time_str.split(":"))
            _scheduler.reschedule_job(
                _digest_job_id,
                trigger=CronTrigger(hour=hour, minute=minute),
            )
            logger.info("Digest time updated to %s UTC", time_str)
        except Exception as e:
            logger.error("Failed to update digest time: %s", e)
