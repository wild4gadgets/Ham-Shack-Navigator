"""
APScheduler: monitoring poll job + daily digest job.
"""
import asyncio
import json
import logging
import time as _time
import urllib.request
import xml.etree.ElementTree as ET
import datetime as _dt
from datetime import datetime, timezone

import aiohttp
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from database import AsyncSessionLocal
from models import Setting, Workflow, ScheduledWorkflow
from services.weather_service import fetch_all
from services.monitoring_service import (
    check_conditions, is_in_cooldown, set_last_shutdown, log_event,
    is_notification_in_cooldown, set_last_notification, log_weather_fetch_results,
)
from services.shutdown_service import execute_shutdown
from services.email_service import send_shutdown_notification, send_digest
from services.ifttt_service import send_ifttt_shutdown
from services.telegram_service import send_telegram_shutdown
from services.ntfy_service import send_ntfy_shutdown
from services.weather_service import get_cached
from services.ha_service import push_state_to_ha, post_ha_event
from ws_manager import manager

logger = logging.getLogger(__name__)

_scheduler: AsyncIOScheduler | None = None
_poll_job_id = "monitor_poll"
_digest_job_id = "daily_digest"


def _nws_alert_matches_level(event: str, level: str) -> bool:
    """Return True if the NWS event type meets or exceeds the configured notification level."""
    event_lower = event.lower()
    if level == "warning":
        return event_lower.endswith("warning")
    if level == "watch":
        return event_lower.endswith("warning") or event_lower.endswith("watch")
    return False


async def _check_nws_alert_notifications(db, nws_data: dict | None):
    """Send notifications for new NWS alerts that meet the configured level threshold."""
    if not nws_data:
        return

    thr_result = await db.execute(select(Setting).where(Setting.key == "thresholds"))
    thr_row = thr_result.scalar_one_or_none()
    thr = json.loads(thr_row.value) if thr_row else {}
    level = thr.get("nws_alert_notify", "none")
    if level == "none":
        return

    all_alerts = nws_data.get("alerts", [])
    matching = [a for a in all_alerts if _nws_alert_matches_level(a.get("event", ""), level)]
    if not matching:
        return

    # Fingerprint = sorted list of (event, effective) so we only notify when the active set changes
    fingerprint = json.dumps(
        sorted((a.get("event", ""), a.get("effective", "")) for a in matching)
    )
    notif_result = await db.execute(select(Setting).where(Setting.key == "nws_alert_last_notified"))
    notif_row = notif_result.scalar_one_or_none()
    last_fp = json.loads(notif_row.value) if notif_row else None
    if fingerprint == last_fp:
        return

    # New alert set — save fingerprint first, then send
    from models import Setting as SettingModel
    if notif_row:
        notif_row.value = json.dumps(fingerprint)
    else:
        db.add(SettingModel(key="nws_alert_last_notified", value=json.dumps(fingerprint)))
    await db.commit()

    notif_cfg_result = await db.execute(select(Setting).where(Setting.key == "notifications"))
    notif_cfg_row = notif_cfg_result.scalar_one_or_none()
    notifications = json.loads(notif_cfg_row.value) if notif_cfg_row else {}

    event_names = ", ".join(sorted({a["event"] for a in matching}))
    area = matching[0].get("areaDesc", "") if matching else ""
    reason = f"NWS {event_names}"
    body = f"{reason}\n{area}".strip()

    if notifications.get("shutdown_email", True):
        try:
            from services.email_service import _get_smtp_config, _send_email
            smtp = await _get_smtp_config(db)
            if smtp and smtp.get("host"):
                subject = f"[Ham Shack Navigator] NWS Alert — {event_names}"
                await _send_email(smtp, subject, body)
                logger.info("NWS alert email sent: %s", event_names)
        except Exception as e:
            logger.error("NWS alert email failed: %s", e)

    try:
        from services.telegram_service import _get_telegram_config, _send_message as _tg_send
        cfg = await _get_telegram_config(db)
        if cfg and cfg.get("enabled") and cfg.get("bot_token") and cfg.get("chat_id"):
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            text = f"<b>Ham Shack Navigator — NWS Alert</b>\n&#9888; {event_names}\n{area}\n{ts}"
            await _tg_send(cfg["bot_token"], cfg["chat_id"], text)
            logger.info("NWS alert Telegram sent: %s", event_names)
    except Exception as e:
        logger.error("NWS alert Telegram failed: %s", e)

    try:
        from services.ifttt_service import _get_ifttt_config, _post_event
        cfg = await _get_ifttt_config(db)
        if cfg and cfg.get("enabled") and cfg.get("webhook_key"):
            event_name = cfg.get("event_name_threshold", "ham_shack_alert")
            ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            await _post_event(cfg["webhook_key"], event_name, reason, ts, area[:100])
            logger.info("NWS alert IFTTT sent: %s", event_names)
    except Exception as e:
        logger.error("NWS alert IFTTT failed: %s", e)

    try:
        from services.ntfy_service import _get_ntfy_config, _publish
        cfg = await _get_ntfy_config(db)
        if cfg and cfg.get("enabled") and cfg.get("topic"):
            await _publish(cfg, f"NWS Alert — {event_names}", body, priority="high", tags="warning,radio")
            logger.info("NWS alert ntfy sent: %s", event_names)
    except Exception as e:
        logger.error("NWS alert ntfy failed: %s", e)


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

        # Fetch fresh weather data
        fetch_results = {}
        try:
            fetch_results = await fetch_all(db)
        except Exception as e:
            logger.error("Weather fetch failed: %s", e)
            await log_event(db, "error", "warning", f"Weather fetch failed: {e}")

        # Log weather API results if enabled in thresholds settings
        try:
            thr_result = await db.execute(select(Setting).where(Setting.key == "thresholds"))
            thr_row = thr_result.scalar_one_or_none()
            thr = json.loads(thr_row.value) if thr_row else {}
            if thr.get("log_weather_data"):
                await log_weather_fetch_results(db, fetch_results)
        except Exception as e:
            logger.error("Weather data logging failed: %s", e)

        # Broadcast weather update immediately after fetch so dashboard refreshes
        # regardless of cooldown state or threshold outcome
        await manager.broadcast({"type": "weather_update", "source": "poll"})

        # Check for new NWS alerts and send notifications if threshold is met
        try:
            await _check_nws_alert_notifications(db, fetch_results.get("nws_alerts"))
        except Exception as e:
            logger.error("NWS alert notification check failed: %s", e)

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
                await send_ntfy_shutdown(db, reason, steps, meta)
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
    logger.info("Scheduled workflow job %d: %s local on aps_days=%s", sw_id, run_time, aps_days)


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
                steps_data.append({
                    "type": "pause",
                    "delay_after_sec": step.delay_after_sec,
                    "description": step.description or "",
                })
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
                    "device_name": step.kasa_port.device.name,
                    "port_label": step.kasa_port.label or "",
                })
            elif step.shelly_channel_id:
                steps_data.append({
                    "type": "shelly",
                    "action": step.action,
                    "delay_after_sec": step.delay_after_sec,
                    "ip_address": step.shelly_channel.device.ip_address,
                    "channel_index": step.shelly_channel.channel_index,
                    "generation": step.shelly_channel.device.generation,
                    "device_name": step.shelly_channel.device.name,
                    "channel_label": step.shelly_channel.label or "",
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
    global _scheduler
    _scheduler = AsyncIOScheduler(timezone=_dt.datetime.now().astimezone().tzinfo)

    # Add poll job with default interval (will be updated when settings change)
    _scheduler.add_job(
        _monitoring_poll,
        trigger=IntervalTrigger(seconds=300),
        id=_poll_job_id,
        max_instances=1,
        coalesce=True,
        replace_existing=True,
    )

    # Add digest job (default 06:00 local time)
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

    from services.flexradio_service import start_listener as _start_flex, get_dax_audio_queue
    _start_flex()

    from services.flrig_service import start_poller as _start_flrig
    _start_flrig()

    from services.cw_decoder_service import start_decoder as _start_cw, DEFAULT_TONE_FREQ, DEFAULT_THRESHOLD
    _cw_settings: dict = {}
    try:
        async with AsyncSessionLocal() as _db:
            _row = (await _db.execute(select(Setting).where(Setting.key == "flexradio"))).scalar_one_or_none()
            _cw_settings = json.loads(_row.value) if _row else {}
    except Exception:
        pass
    _start_cw(
        get_dax_audio_queue(),
        tone_freq=float(_cw_settings.get("cw_tone_freq", DEFAULT_TONE_FREQ)),
        threshold=float(_cw_settings.get("cw_threshold", DEFAULT_THRESHOLD)),
    )

    logger.info("Scheduler, FlexRadio listener, and CW decoder started")


async def shutdown_scheduler():
    global _scheduler

    from services.cw_decoder_service import stop_decoder as _stop_cw
    _stop_cw()

    from services.flrig_service import stop_poller as _stop_flrig
    _stop_flrig()

    from services.flexradio_service import stop_listener as _stop_flex
    _stop_flex()

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
            logger.info("Digest time updated to %s local", time_str)
        except Exception as e:
            logger.error("Failed to update digest time: %s", e)
