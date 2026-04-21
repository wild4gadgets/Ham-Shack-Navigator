import json
import logging
import re as _re
import uuid as _uuid
from datetime import datetime, timezone
from urllib.parse import quote as _quote

import aiohttp as _aiohttp
from fastapi import APIRouter, Depends, HTTPException, Query

logger = logging.getLogger(__name__)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db, get_current_user, require_admin
from models import User, Setting
from schemas import (
    LocationSettings, LocationProfile, ApiKeySettings, ThresholdSettings, SmtpSettings,
    NotificationSettings, KasaSettings, IftttSettings, TelegramSettings, HomeAssistantSettings,
    DxclusterSettings, FlexRadioSettings,
)
import scheduler as sched

router = APIRouter(prefix="/settings", tags=["settings"])

MASKED = "****"


def _compute_maidenhead(lat: float, lon: float) -> str:
    """Compute 6-character Maidenhead grid locator from lat/lon."""
    letters = "ABCDEFGHIJKLMNOPQRSTUVWX"
    la = lat + 90.0
    lo = lon + 180.0
    grid = letters[int(lo / 20)]
    grid += letters[int(la / 10)]
    grid += str(int((lo % 20) / 2))
    grid += str(int(la % 10))
    grid += chr(ord('a') + int((lo % 2) * 12))
    grid += chr(ord('a') + int((la % 1) * 24))
    return grid


# Patterns for smart lookup input detection
_GPS_RE = _re.compile(r'^([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)$')
_MAIDEN_RE = _re.compile(r'^[A-Ra-r]{2}\d{2}(?:[A-Xa-x]{2})?$')


def _maiden_to_latlon(grid: str) -> tuple[float, float]:
    """Convert Maidenhead grid locator (4 or 6 chars) to lat/lon center."""
    g = grid.strip()
    lon = (ord(g[0].upper()) - ord('A')) * 20 - 180
    lat = (ord(g[1].upper()) - ord('A')) * 10 - 90
    lon += int(g[2]) * 2
    lat += int(g[3])
    if len(g) >= 6:
        lon += (ord(g[4].lower()) - ord('a')) * 2 / 24
        lat += (ord(g[5].lower()) - ord('a')) / 24
        lon += 1 / 24   # center of subsquare
        lat += 0.5 / 24
    else:
        lon += 1        # center of square
        lat += 0.5
    return round(lat, 4), round(lon, 4)


async def _reverse_geocode(session: _aiohttp.ClientSession, lat: float, lon: float) -> str:
    """Return a 'City, State' string for coordinates via Nominatim reverse geocoding."""
    url = f"https://nominatim.openstreetmap.org/reverse?lat={lat}&lon={lon}&format=json"
    try:
        async with session.get(url, timeout=_aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status != 200:
                return ""
            data = await resp.json()
            addr = data.get("address", {})
            city = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or ""
            state = addr.get("state", "")
            if city and state:
                return f"{city}, {state}"
            return city or state or data.get("display_name", "")
    except Exception as exc:
        logger.debug("Reverse geocode failed: %s", exc)
        return ""


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
async def put_location(body: LocationSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    await _save_setting(db, "location", body.model_dump())
    return {"detail": "Saved"}


# --- Location Lookup ---
@router.get("/location/lookup")
async def lookup_location(
    q: str = Query(..., min_length=1),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = q.strip()
    lat: float | None = None
    lon: float | None = None
    city_display = ""

    headers = {"User-Agent": "HamShackCockpit/1.0"}

    async with _aiohttp.ClientSession(headers=headers) as session:

        # ── 1. GPS coordinates: "lat, lon" ──────────────────────────────────
        gps_m = _GPS_RE.match(q)
        if gps_m:
            lat = float(gps_m.group(1))
            lon = float(gps_m.group(2))
            city_display = await _reverse_geocode(session, lat, lon)

        # ── 2. Maidenhead grid (4 or 6 chars) ───────────────────────────────
        elif _MAIDEN_RE.match(q):
            lat, lon = _maiden_to_latlon(q)
            city_display = await _reverse_geocode(session, lat, lon)

        # ── 3. Address / place name via Nominatim ───────────────────────────
        else:
            nom_url = (
                f"https://nominatim.openstreetmap.org/search"
                f"?q={_quote(q)}&format=json&limit=1&addressdetails=1"
            )
            async with session.get(nom_url, timeout=_aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    raise HTTPException(status_code=502, detail="Geocoding service unavailable")
                results = await resp.json()

            if not results:
                raise HTTPException(status_code=404, detail="Location not found")

            r = results[0]
            lat = float(r["lat"])
            lon = float(r["lon"])
            addr = r.get("address", {})
            city_part = addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county") or ""
            state_part = addr.get("state", "")
            city_display = f"{city_part}, {state_part}" if city_part and state_part else (city_part or state_part or r.get("display_name", ""))

        if lat is None or lon is None:
            raise HTTPException(status_code=404, detail="Location not found")

    return {
        "lat": round(lat, 4),
        "lon": round(lon, 4),
        "city": city_display,
        "gridsquare": _compute_maidenhead(lat, lon),
    }


# --- Location Profiles ---
@router.get("/location/profiles")
async def get_location_profiles(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await _get_setting(db, "location_profiles")
    return result if isinstance(result, list) else []


@router.post("/location/profiles")
async def create_location_profile(
    body: LocationProfile,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    profiles = await _get_setting(db, "location_profiles")
    if not isinstance(profiles, list):
        profiles = []
    new_profile = body.model_dump()
    new_profile["id"] = str(_uuid.uuid4())
    profiles.append(new_profile)
    await _save_setting(db, "location_profiles", profiles)
    return new_profile


@router.put("/location/profiles/{profile_id}")
async def update_location_profile(
    profile_id: str,
    body: LocationProfile,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    profiles = await _get_setting(db, "location_profiles")
    if not isinstance(profiles, list):
        profiles = []
    for i, p in enumerate(profiles):
        if p["id"] == profile_id:
            updated = body.model_dump()
            updated["id"] = profile_id
            profiles[i] = updated
            await _save_setting(db, "location_profiles", profiles)
            # Keep active location in sync if this profile is currently active
            location = await _get_setting(db, "location") or {}
            if location.get("active_profile_id") == profile_id:
                location.update({k: v for k, v in updated.items() if k != "id"})
                location["active_profile_id"] = profile_id
                await _save_setting(db, "location", location)
            return updated
    raise HTTPException(status_code=404, detail="Profile not found")


@router.delete("/location/profiles/{profile_id}")
async def delete_location_profile(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    profiles = await _get_setting(db, "location_profiles")
    if not isinstance(profiles, list):
        raise HTTPException(status_code=404, detail="Profile not found")
    new_profiles = [p for p in profiles if p["id"] != profile_id]
    if len(new_profiles) == len(profiles):
        raise HTTPException(status_code=404, detail="Profile not found")
    await _save_setting(db, "location_profiles", new_profiles)
    return {"detail": "Deleted"}


@router.post("/location/profiles/{profile_id}/activate")
async def activate_location_profile(
    profile_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
):
    profiles = await _get_setting(db, "location_profiles")
    if not isinstance(profiles, list):
        raise HTTPException(status_code=404, detail="Profile not found")
    for p in profiles:
        if p["id"] == profile_id:
            location = {k: v for k, v in p.items() if k != "id"}
            location["active_profile_id"] = profile_id
            await _save_setting(db, "location", location)
            return {"detail": "Activated"}
    raise HTTPException(status_code=404, detail="Profile not found")


# --- API Keys ---
@router.get("/api-keys")
async def get_api_keys(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "api_keys")
    return {
        "owm_key": _mask_key(data.get("owm_key")),
        "tomorrow_key": _mask_key(data.get("tomorrow_key")),
    }


@router.put("/api-keys")
async def put_api_keys(body: ApiKeySettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
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
async def put_thresholds(body: ThresholdSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
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
async def put_smtp(body: SmtpSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    existing = await _get_setting(db, "smtp")
    update = body.model_dump()
    # Don't overwrite password if masked
    if update.get("password") == MASKED or not update.get("password"):
        update["password"] = existing.get("password", "")
    await _save_setting(db, "smtp", update)
    sched.update_digest_time(body.digest_time)
    return {"detail": "Saved"}


@router.post("/smtp/test")
async def test_smtp(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from services.email_service import send_test_email
    try:
        await send_test_email(db)
        return {"detail": "Test email sent"}
    except Exception as e:
        logger.error("SMTP test failed: %s", e)
        raise HTTPException(status_code=500, detail="Test failed — check server logs")


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
async def put_ifttt(body: IftttSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    existing = await _get_setting(db, "ifttt")
    update = body.model_dump()
    if update.get("webhook_key") and update["webhook_key"].startswith(MASKED):
        update["webhook_key"] = existing.get("webhook_key", "")
    if update.get("incoming_secret") == MASKED:
        update["incoming_secret"] = existing.get("incoming_secret", "")
    await _save_setting(db, "ifttt", update)
    return {"detail": "Saved"}


@router.post("/ifttt/test")
async def test_ifttt(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from services.ifttt_service import send_ifttt_test
    try:
        await send_ifttt_test(db)
        return {"detail": "Test event sent"}
    except Exception as e:
        logger.error("IFTTT test failed: %s", e)
        raise HTTPException(status_code=500, detail="Test failed — check server logs")


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
async def put_telegram(body: TelegramSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    existing = await _get_setting(db, "telegram")
    update = body.model_dump()
    if update.get("bot_token") and update["bot_token"].startswith(MASKED):
        update["bot_token"] = existing.get("bot_token", "")
    await _save_setting(db, "telegram", update)
    return {"detail": "Saved"}


@router.post("/telegram/test")
async def test_telegram(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from services.telegram_service import send_telegram_test
    try:
        await send_telegram_test(db)
        return {"detail": "Test message sent"}
    except Exception as e:
        logger.error("Telegram test failed: %s", e)
        raise HTTPException(status_code=500, detail="Test failed — check server logs")


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
async def put_home_assistant(body: HomeAssistantSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
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
async def regenerate_ha_token(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    import secrets as _secrets
    existing = await _get_setting(db, "home_assistant")
    existing["ha_poll_token"] = _secrets.token_hex(32)
    await _save_setting(db, "home_assistant", existing)
    return {"ha_poll_token": existing["ha_poll_token"]}


@router.post("/home-assistant/test")
async def test_home_assistant(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    from services.ha_service import push_ha_test
    try:
        await push_ha_test(db)
        return {"detail": "Test state pushed to Home Assistant"}
    except Exception as e:
        logger.error("Home Assistant test failed: %s", e)
        raise HTTPException(status_code=500, detail="Test failed — check server logs")


# --- Kasa Settings ---
@router.get("/kasa")
async def get_kasa_settings(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "kasa_settings")
    return data or {"poll_interval_sec": 30}


@router.put("/kasa")
async def put_kasa_settings(body: KasaSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    await _save_setting(db, "kasa_settings", body.model_dump())
    return {"detail": "Saved"}


# --- DX Cluster ---
@router.get("/dxcluster")
async def get_dxcluster(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "dxcluster")
    return data or {"region": "NA"}


@router.put("/dxcluster")
async def put_dxcluster(body: DxclusterSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    await _save_setting(db, "dxcluster", body.model_dump())
    return {"detail": "Saved"}


# --- FlexRadio ---
@router.get("/flexradio")
async def get_flexradio(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "flexradio")
    return data or {"ip": "", "enabled": False}


@router.put("/flexradio")
async def put_flexradio(body: FlexRadioSettings, db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    await _save_setting(db, "flexradio", body.model_dump())
    from services.flexradio_service import start_listener, get_dax_audio_queue
    from services.cw_decoder_service import start_decoder, stop_decoder
    start_listener()
    if body.dax_enabled:
        stop_decoder()
        start_decoder(
            get_dax_audio_queue(),
            tone_freq=body.cw_tone_freq,
            threshold=body.cw_threshold,
        )
    return {"detail": "Saved"}


# --- Remote Webhook API ---
@router.get("/webhook")
async def get_webhook(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    data = await _get_setting(db, "webhook_api")
    if not data or not data.get("api_key"):
        return {"api_key": None}
    return {"api_key": _mask_key(data["api_key"])}


@router.post("/webhook/regenerate-key")
async def regenerate_webhook_key(db: AsyncSession = Depends(get_db), _: User = Depends(require_admin)):
    import secrets as _secrets
    api_key = _secrets.token_hex(32)
    await _save_setting(db, "webhook_api", {"api_key": api_key})
    return {"api_key": api_key}
