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


async def send_shutdown_notification(db: AsyncSession, reason: str, steps_executed: list[str]):
    smtp = await _get_smtp_config(db)
    if not smtp or not smtp.get("host"):
        return

    subject = f"[Ham Shack Cockpit] Shutdown triggered - {reason}"
    steps_text = "\n".join(f"  {i+1}. {s}" for i, s in enumerate(steps_executed))
    body = f"""Ham Shack Cockpit Monitor has triggered an automatic shutdown.

Reason: {reason}
Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}

Steps Executed:
{steps_text}

This is an automated notification from your Ham Shack Cockpit Monitor.
"""
    try:
        await _send_email(smtp, subject, body)
        logger.info("Shutdown notification email sent")
    except Exception as e:
        logger.error("Failed to send shutdown notification: %s", e)


async def send_digest(db: AsyncSession, forecast_summary: str):
    smtp = await _get_smtp_config(db)
    if not smtp or not smtp.get("host"):
        return

    subject = f"[Ham Shack Cockpit] Daily Forecast Digest - {datetime.utcnow().strftime('%Y-%m-%d')}"
    body = f"""Good morning! Here is your daily weather digest for your ham radio station.

{forecast_summary}

Stay safe and 73!
- Ham Shack Cockpit Monitor
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

    subject = "[Ham Shack Cockpit] Test Email"
    body = f"This is a test email from Ham Shack Cockpit Monitor.\n\nSent at: {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}"
    try:
        await _send_email(smtp, subject, body)
        return True
    except Exception as e:
        logger.error("Test email failed: %s", e)
        raise
