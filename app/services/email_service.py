"""
Email service: sends notifications and digests via aiosmtplib.
"""
import json
import logging
from datetime import datetime

import aiosmtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from models import Setting

logger = logging.getLogger(__name__)


async def _get_smtp_config(db: AsyncSession) -> dict | None:
    result = await db.execute(select(Setting).where(Setting.key == "smtp"))
    row = result.scalar_one_or_none()
    if not row:
        return None
    return json.loads(row.value)


async def _send_email(smtp: dict, subject: str, body: str, html: bool = False):
    msg = MIMEMultipart("alternative") if html else MIMEText(body, "plain")
    if html:
        msg.attach(MIMEText(body, "html"))
    msg["Subject"] = subject
    msg["From"] = smtp["from_addr"]
    msg["To"] = smtp["to_addr"]

    use_tls = smtp.get("port", 587) == 465
    await aiosmtplib.send(
        msg,
        hostname=smtp["host"],
        port=smtp.get("port", 587),
        username=smtp.get("user") or None,
        password=smtp.get("password") or None,
        use_tls=use_tls,
        start_tls=not use_tls and smtp.get("port", 587) != 25,
    )


def _build_alert_section(meta: dict | None) -> str:
    """Return a formatted alert block to embed in shutdown notifications."""
    if not meta:
        return ""
    lightning_miles = meta.get("lightning_miles")
    source = meta.get("source", "")
    threshold = meta.get("threshold_miles")
    wind_gust = meta.get("wind_gust_mph")

    if lightning_miles is not None:
        if lightning_miles == 0.0 and source.upper().startswith("NWS"):
            warnings = source.replace("NWS ", "").strip() or "Severe Thunderstorm Warning"
            return (
                f"SEVERE WEATHER WARNING\n"
                f"  NWS Alert : {warnings}\n"
                f"  Status    : Lightning actively occurring at or near your location\n"
                f"  Threshold : {threshold} miles\n"
            )
        return (
            f"LIGHTNING ALERT\n"
            f"  Detected  : {lightning_miles:.1f} miles away\n"
            f"  Source    : {source}\n"
            f"  Threshold : {threshold} miles\n"
        )
    if wind_gust is not None:
        return (
            f"HIGH WIND ALERT\n"
            f"  Wind gust : {wind_gust:.1f} mph\n"
            f"  Threshold : {meta.get('threshold_mph')} mph\n"
        )
    return ""


async def send_shutdown_notification(
    db: AsyncSession, reason: str, steps_executed: list[str], meta: dict | None = None
):
    smtp = await _get_smtp_config(db)
    if not smtp or not smtp.get("host"):
        return

    alert_section = _build_alert_section(meta)
    alert_block = f"\n{alert_section}\n" if alert_section else "\n"

    subject = f"[Ham Shack Navigator] Shutdown triggered - {reason}"
    steps_text = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(steps_executed))
    body = (
        f"Ham Shack Navigator Monitor has triggered an automatic shutdown.\n"
        f"{alert_block}"
        f"Reason: {reason}\n"
        f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}\n"
        f"\nSteps Executed:\n{steps_text}\n"
        f"\nThis is an automated notification from your Ham Shack Navigator Monitor.\n"
    )
    try:
        await _send_email(smtp, subject, body)
        logger.info("Shutdown notification email sent")
    except Exception as e:
        logger.error("Failed to send shutdown notification: %s", e)


async def send_digest(db: AsyncSession, forecast_summary: str, solar_summary: str = ""):
    smtp = await _get_smtp_config(db)
    if not smtp or not smtp.get("host"):
        return

    subject = f"[Ham Shack Navigator] Daily Forecast Digest - {datetime.utcnow().strftime('%Y-%m-%d')}"
    solar_section = f"\n{solar_summary}" if solar_summary else ""
    body = f"""Good morning! Here is your daily weather digest for your ham radio station.

{forecast_summary}{solar_section}

Stay safe and 73!
- Ham Shack Navigator Monitor
"""
    try:
        await _send_email(smtp, subject, body)
        logger.info("Daily digest email sent")
    except Exception as e:
        logger.error("Failed to send digest: %s", e)


async def send_test_email(db: AsyncSession) -> bool:
    smtp = await _get_smtp_config(db)
    if not smtp or not smtp.get("host"):
        raise ValueError("SMTP not configured")

    subject = "[Ham Shack Navigator] Test Email"
    body = f"This is a test email from Ham Shack Navigator Monitor.\n\nSent at: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}"
    try:
        await _send_email(smtp, subject, body)
        return True
    except Exception as e:
        logger.error("Test email failed: %s", e)
        raise
