"""
APScheduler: monitoring poll job + daily digest job.
"""
import asyncio
import json
import logging
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from database import AsyncSessionLocal
from models import Setting
from services.weather_service import fetch_all
from services.monitoring_service import check_conditions, is_in_cooldown, set_last_shutdown, log_event
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

            # Fire shutdown as a background task
            asyncio.create_task(_run_shutdown(reason))
            await manager.broadcast({"type": "shutdown_alert", "reason": reason, "metadata": meta})


async def _run_shutdown(reason: str):
    """Background task for the full shutdown sequence."""
    async with AsyncSessionLocal() as db:
        try:
            steps = await execute_shutdown(db, reason)

            # Check notification settings
            result = await db.execute(select(Setting).where(Setting.key == "notifications"))
            row = result.scalar_one_or_none()
            notifications = json.loads(row.value) if row else {}
            if notifications.get("shutdown_email", True):
                await send_shutdown_notification(db, reason, steps)
                await log_event(db, "email_sent", "info", "Shutdown notification email sent")
            await send_ifttt_shutdown(db, reason, steps)
            await send_telegram_shutdown(db, reason, steps)
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


async def start_scheduler():
    global _scheduler
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
    logger.info("Scheduler started")


async def shutdown_scheduler():
    global _scheduler
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
