import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db, get_current_user
from models import User, Setting
from schemas import (
    LocationSettings, ApiKeySettings, ThresholdSettings, SmtpSettings, NotificationSettings, KasaSettings,
    IftttSettings, TelegramSettings, HomeAssistantSettings,
)
import scheduler as sched

router = APIRouter(prefix="/settings", tags=["settings"])

MASKED = "****"


def _mask_key(key: str | None) -> str | None:
    if not key or len(key) < 4:
        return None
    return MASKED + key[-4:]


async def _get_setting(db: AsyncSession, key: str) -> dict:
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return json.loads(row.value) if row else {}


async def _save_setting(db: AsyncSession, key: str, value: dict):
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    if row:
        row.value = json.dumps(value)
        row.updated_at = datetime.now(timezone.utc)
    else:
        row = Setting(key=key, value=json.dumps(value))
        db.add(row)
    await db.commit()


# --- Location ---
@router.get("/location")
async def get_location(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await _get_setting(db, "location") or {"lat": 0.0, "lon": 0.0, "city": "", "units": "imperial"}


@router.put("/location")
async def put_location(body: LocationSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    await _save_setting(db, "location", body.model_dump())
    return {"detail": "Saved"}


# --- API Keys ---
@router.get("/api-keys")
async def get_api_keys(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "api_keys")
    return {
        "owm_key": _mask_key(data.get("owm_key")),
        "tomorrow_key": _mask_key(data.get("tomorrow_key")),
    }


@router.put("/api-keys")
async def put_api_keys(body: ApiKeySettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    existing = await _get_setting(db, "api_keys")
    # Only update if not still masked
    if body.owm_key and not body.owm_key.startswith(MASKED):
        existing["owm_key"] = body.owm_key
    if body.tomorrow_key and not body.tomorrow_key.startswith(MASKED):
        existing["tomorrow_key"] = body.tomorrow_key
    await _save_setting(db, "api_keys", existing)
    return {"detail": "Saved"}


# --- Thresholds ---
@router.get("/thresholds")
async def get_thresholds(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "thresholds")
    return data or {"wind_mph": 35.0, "lightning_miles": 10.0, "poll_interval_sec": 300, "cooldown_min": 30}


@router.put("/thresholds")
async def put_thresholds(body: ThresholdSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    await _save_setting(db, "thresholds", body.model_dump())
    sched.update_poll_interval(body.poll_interval_sec)
    return {"detail": "Saved"}


# --- SMTP ---
@router.get("/smtp")
async def get_smtp(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "smtp")
    # Mask password
    if data.get("password"):
        data["password"] = MASKED
    return data or {"host": "", "port": 587, "user": "", "password": "", "from_addr": "", "to_addr": "", "digest_time": "06:00", "digest_enabled": True}


@router.put("/smtp")
async def put_smtp(body: SmtpSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    existing = await _get_setting(db, "smtp")
    update = body.model_dump()
    # Don't overwrite password if masked
    if update.get("password") == MASKED or not update.get("password"):
        update["password"] = existing.get("password", "")
    await _save_setting(db, "smtp", update)
    sched.update_digest_time(body.digest_time)
    return {"detail": "Saved"}


@router.post("/smtp/test")
async def test_smtp(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    from services.email_service import send_test_email
    try:
        await send_test_email(db)
        return {"detail": "Test email sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Notifications ---
@router.get("/notifications")
async def get_notifications(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "notifications")
    return data or {
        "shutdown_email": True, "digest_email": True,
        "shutdown_ifttt": True, "threshold_ifttt": True,
        "shutdown_telegram": True, "threshold_telegram": True,
    }


@router.put("/notifications")
async def put_notifications(body: NotificationSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    await _save_setting(db, "notifications", body.model_dump())
    return {"detail": "Saved"}


# --- IFTTT ---
@router.get("/ifttt")
async def get_ifttt(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "ifttt")
    if not data:
        return {"webhook_key": None, "event_name_shutdown": "ham_shack_shutdown",
                "event_name_threshold": "ham_shack_alert", "enabled": False, "incoming_secret": None}
    if data.get("webhook_key"):
        data["webhook_key"] = _mask_key(data["webhook_key"])
    if data.get("incoming_secret"):
        data["incoming_secret"] = MASKED
    return data


@router.put("/ifttt")
async def put_ifttt(body: IftttSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    existing = await _get_setting(db, "ifttt")
    update = body.model_dump()
    if update.get("webhook_key") and update["webhook_key"].startswith(MASKED):
        update["webhook_key"] = existing.get("webhook_key", "")
    if update.get("incoming_secret") == MASKED:
        update["incoming_secret"] = existing.get("incoming_secret", "")
    await _save_setting(db, "ifttt", update)
    return {"detail": "Saved"}


@router.post("/ifttt/test")
async def test_ifttt(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    from services.ifttt_service import send_ifttt_test
    try:
        await send_ifttt_test(db)
        return {"detail": "Test event sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Telegram ---
@router.get("/telegram")
async def get_telegram(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "telegram")
    if not data:
        return {"bot_token": None, "chat_id": None, "enabled": False}
    if data.get("bot_token"):
        data["bot_token"] = _mask_key(data["bot_token"])
    return data


@router.put("/telegram")
async def put_telegram(body: TelegramSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    existing = await _get_setting(db, "telegram")
    update = body.model_dump()
    if update.get("bot_token") and update["bot_token"].startswith(MASKED):
        update["bot_token"] = existing.get("bot_token", "")
    await _save_setting(db, "telegram", update)
    return {"detail": "Saved"}


@router.post("/telegram/test")
async def test_telegram(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    from services.telegram_service import send_telegram_test
    try:
        await send_telegram_test(db)
        return {"detail": "Test message sent"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Home Assistant ---
@router.get("/home-assistant")
async def get_home_assistant(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "home_assistant")
    if not data:
        return {"ha_url": "", "ha_token": None, "enabled_push": False, "enabled_pull": True, "ha_poll_token": None}
    if data.get("ha_token"):
        data["ha_token"] = MASKED
    # ha_poll_token is shown to user (they need it for HA config), never masked
    return data


@router.put("/home-assistant")
async def put_home_assistant(body: HomeAssistantSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    import secrets as _secrets
    existing = await _get_setting(db, "home_assistant")
    update = body.model_dump()
    if update.get("ha_token") == MASKED or not update.get("ha_token"):
        update["ha_token"] = existing.get("ha_token", "")
    # Auto-generate poll token if not already set
    if not existing.get("ha_poll_token"):
        update["ha_poll_token"] = _secrets.token_hex(32)
    else:
        update["ha_poll_token"] = existing["ha_poll_token"]
    await _save_setting(db, "home_assistant", update)
    return {"detail": "Saved"}


@router.post("/home-assistant/regenerate-token")
async def regenerate_ha_token(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    import secrets as _secrets
    existing = await _get_setting(db, "home_assistant")
    existing["ha_poll_token"] = _secrets.token_hex(32)
    await _save_setting(db, "home_assistant", existing)
    return {"ha_poll_token": existing["ha_poll_token"]}


@router.post("/home-assistant/test")
async def test_home_assistant(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    from services.ha_service import push_ha_test
    try:
        await push_ha_test(db)
        return {"detail": "Test state pushed to Home Assistant"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# --- Kasa Settings ---
@router.get("/kasa")
async def get_kasa_settings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "kasa_settings")
    return data or {"poll_interval_sec": 30}


@router.put("/kasa")
async def put_kasa_settings(body: KasaSettings, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    await _save_setting(db, "kasa_settings", body.model_dump())
    return {"detail": "Saved"}
