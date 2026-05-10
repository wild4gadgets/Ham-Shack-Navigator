"""
QRZ.com XML API integration.
Looks up callsign data using QRZ subscriber credentials.
Session key is cached in-memory and re-authenticated on expiry.
"""
import json
import logging
import xml.etree.ElementTree as ET

import aiohttp
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from dependencies import get_db, get_current_user
from models import Setting, User
from schemas import QrzSettings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/qrz", tags=["qrz"])

QRZ_XML_URL = "https://xmldata.qrz.com/xml/current/"
NS = "http://xmldata.qrz.com"

# In-memory session key cache — shared across requests
_qrz_session_key: str | None = None


def _ns(tag: str) -> str:
    return f"{{{NS}}}{tag}"


async def _get_setting(db: AsyncSession, key: str) -> dict:
    result = await db.execute(select(Setting).where(Setting.key == key))
    row = result.scalar_one_or_none()
    return json.loads(row.value) if row else {}


async def _authenticate(username: str, password: str) -> str:
    """Obtain a QRZ session key. Raises HTTPException on failure."""
    params = {"username": username, "password": password, "agent": "ham-shack-navigator"}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                QRZ_XML_URL, params=params, timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                text = await resp.text()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"QRZ unreachable: {exc}")

    root = ET.fromstring(text)
    key_el = root.find(f".//{_ns('Key')}")
    if key_el is not None and key_el.text:
        return key_el.text

    err_el = root.find(f".//{_ns('Error')}")
    msg = err_el.text if err_el is not None else "Unknown QRZ error"
    raise HTTPException(status_code=401, detail=f"QRZ login failed: {msg}")


async def _fetch_callsign(session_key: str, callsign: str) -> dict | None:
    """
    Fetch callsign data. Returns None if not found.
    Raises HTTPException if the session is expired (caller should re-auth).
    """
    params = {"s": session_key, "callsign": callsign.upper()}
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                QRZ_XML_URL, params=params, timeout=aiohttp.ClientTimeout(total=15)
            ) as resp:
                text = await resp.text()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"QRZ unreachable: {exc}")

    root = ET.fromstring(text)

    # Check for session/error message
    err_el = root.find(f".//{_ns('Error')}")
    if err_el is not None and err_el.text:
        msg = err_el.text
        if "Session" in msg or "expired" in msg.lower() or "invalid" in msg.lower():
            raise HTTPException(status_code=440, detail=msg)  # 440 = session expired sentinel
        raise HTTPException(status_code=400, detail=msg)

    call_el = root.find(f".//{_ns('Callsign')}")
    if call_el is None:
        return None

    def get(tag: str) -> str | None:
        el = call_el.find(_ns(tag))
        return el.text if el is not None else None

    return {
        "call":    get("call"),
        "fname":   get("fname"),
        "name":    get("name"),
        "addr1":   get("addr1"),
        "addr2":   get("addr2"),
        "state":   get("state"),
        "zip":     get("zip"),
        "country": get("country"),
        "lat":     get("lat"),
        "lon":     get("lon"),
        "grid":    get("grid"),
        "class":   get("class"),
        "email":   get("email"),
        "image":   get("image"),
        "bio":     get("bio"),
        "qslmgr":  get("qslmgr"),
        "url":     get("url"),
        "p_call":  get("p_call"),
        "aliases": get("aliases"),
        "eqsl":    get("eqsl"),
        "lotw":    get("lotw"),
        "cqzone":  get("cqzone"),
        "ituzone": get("ituzone"),
        "dxcc":    get("dxcc"),
        "county":  get("county"),
        "born":    get("born"),
    }


@router.get("/settings")
async def get_qrz_settings(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    data = await _get_setting(db, "qrz")
    return {
        "username": data.get("username", ""),
        "password": "••••••••" if data.get("password") else "",
    }


@router.put("/settings")
async def put_qrz_settings(
    body: QrzSettings,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    global _qrz_session_key
    existing = await _get_setting(db, "qrz")

    username = body.username.strip()
    password = body.password.strip()

    # Keep existing password if masked value submitted
    if password == "••••••••" or not password:
        password = existing.get("password", "")

    result = await db.execute(select(Setting).where(Setting.key == "qrz"))
    row = result.scalar_one_or_none()
    value = json.dumps({"username": username, "password": password})
    if row:
        row.value = value
    else:
        row = Setting(key="qrz", value=value)
        db.add(row)
    await db.commit()

    # Invalidate cached session key so next lookup re-authenticates
    _qrz_session_key = None
    return {"detail": "QRZ settings saved"}


@router.get("/lookup")
async def lookup_callsign(
    callsign: str = Query(...),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    global _qrz_session_key

    cfg = await _get_setting(db, "qrz")
    username = cfg.get("username", "").strip()
    password = cfg.get("password", "").strip()

    if not username or not password:
        raise HTTPException(
            status_code=422,
            detail="QRZ credentials not configured. Go to Settings → API Keys to add them.",
        )

    # Authenticate if we don't have a session key yet
    if not _qrz_session_key:
        _qrz_session_key = await _authenticate(username, password)

    # Try lookup; if session expired, re-authenticate once and retry
    try:
        data = await _fetch_callsign(_qrz_session_key, callsign)
    except HTTPException as exc:
        if exc.status_code == 440:
            _qrz_session_key = await _authenticate(username, password)
            data = await _fetch_callsign(_qrz_session_key, callsign)
        else:
            raise

    if data is None:
        raise HTTPException(status_code=404, detail=f"{callsign.upper()} not found on QRZ.")

    return data
