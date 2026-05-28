import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user
from models import User
from services.flrig_service import (
    get_state, get_available_modes,
    set_frequency, set_mode, set_ptt,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/flrig", tags=["flrig"])


class TuneRequest(BaseModel):
    frequency_hz: float


class ModeRequest(BaseModel):
    mode: str


class PttRequest(BaseModel):
    active: bool


@router.get("/status")
async def get_flrig_status(_: User = Depends(get_current_user)):
    state = get_state()
    freq_hz = state.get("freq_hz")
    return {
        **state,
        "freq_mhz": round(freq_hz / 1e6, 6) if freq_hz is not None else None,
        "available_modes": get_available_modes(),
    }


@router.get("/modes")
async def get_flrig_modes(_: User = Depends(get_current_user)):
    return {"modes": get_available_modes()}


@router.post("/tune")
async def tune_flrig(body: TuneRequest, _: User = Depends(get_current_user)):
    if body.frequency_hz <= 0:
        raise HTTPException(status_code=400, detail="frequency_hz must be > 0")
    if not get_state().get("connected"):
        raise HTTPException(status_code=503, detail="flrig not connected")
    ok = await set_frequency(body.frequency_hz)
    if not ok:
        raise HTTPException(status_code=503, detail="flrig not connected")
    return {"ok": True}


@router.post("/mode")
async def set_flrig_mode(body: ModeRequest, _: User = Depends(get_current_user)):
    modes = get_available_modes()
    if modes and body.mode not in modes:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Available: {modes}")
    if not get_state().get("connected"):
        raise HTTPException(status_code=503, detail="flrig not connected")
    ok = await set_mode(body.mode)
    if not ok:
        raise HTTPException(status_code=503, detail="flrig not connected")
    return {"ok": True}


@router.post("/ptt")
async def set_flrig_ptt(body: PttRequest, _: User = Depends(get_current_user)):
    if not get_state().get("connected"):
        raise HTTPException(status_code=503, detail="flrig not connected")
    ok = await set_ptt(body.active)
    if not ok:
        raise HTTPException(status_code=503, detail="flrig not connected")
    return {"ok": True}
