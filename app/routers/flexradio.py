import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user
from models import User
from services.flexradio_service import get_state, send_command

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/flexradio", tags=["flexradio"])


VALID_MODES = {"AM", "CW", "DIGL", "DIGU", "LSB", "RTTY", "USB"}


class TuneRequest(BaseModel):
    freq_mhz: float


class ModeRequest(BaseModel):
    mode: str


class PowerRequest(BaseModel):
    rf_power: int  # 1–100


class MoxRequest(BaseModel):
    mox: bool


@router.post("/power")
async def set_rf_power(body: PowerRequest, _: User = Depends(get_current_user)):
    """Set the transmitter RF power level (1–100)."""
    if not 1 <= body.rf_power <= 100:
        raise HTTPException(status_code=400, detail="rf_power must be 1–100")
    state = get_state()
    if not state.get("connected"):
        raise HTTPException(status_code=503, detail="Radio not connected")
    ok = await send_command(f"transmit set rfpower={body.rf_power}")
    if not ok:
        raise HTTPException(status_code=503, detail="Radio not connected")
    return {"ok": True}


@router.post("/mox")
async def set_mox(body: MoxRequest, _: User = Depends(get_current_user)):
    """Toggle MOX (software PTT). mox=true → transmit on, false → transmit off."""
    state = get_state()
    if not state.get("connected"):
        raise HTTPException(status_code=503, detail="Radio not connected")
    ok = await send_command(f"xmit {1 if body.mox else 0}")
    if not ok:
        raise HTTPException(status_code=503, detail="Radio not connected")
    return {"ok": True}


@router.get("/status")
async def get_flexradio_status(_: User = Depends(get_current_user)):
    """Return current FlexRadio primary slice status (frequency, mode, connection state)."""
    state = get_state()
    connected = state.get("connected", False)
    rf_power_raw = state.get("transmit", {}).get("rfpower") if connected else None
    interlock_state = state.get("interlock", {}).get("state") if connected else None

    # Find the primary slice: prefer in_use=1, fall back to first available
    slices = state.get("slices", {})
    primary = {}
    for sdata in slices.values():
        if sdata.get("in_use") == "1":
            primary = sdata
            break
    if not primary and slices:
        primary = next(iter(slices.values()))

    return {
        "connected": connected,
        "freq_mhz": primary.get("RF_frequency") if connected else None,
        "mode": primary.get("mode") if connected else None,
        "in_use": primary.get("in_use") if connected else None,
        "rf_power": int(rf_power_raw) if rf_power_raw is not None else None,
        "tx_state": interlock_state,
        "swr": state.get("swr") if connected else None,
        "updated_at": state.get("updated_at"),
    }


@router.post("/tune")
async def tune_slice(body: TuneRequest, _: User = Depends(get_current_user)):
    """Tune the primary slice to a new frequency (MHz)."""
    state = get_state()
    if not state.get("connected"):
        raise HTTPException(status_code=503, detail="Radio not connected")
    slice_idx = 0
    for idx, sdata in state.get("slices", {}).items():
        if sdata.get("in_use") == "1":
            slice_idx = idx
            break
    ok = await send_command(f"slice t {slice_idx} {body.freq_mhz:.6f}")
    if not ok:
        raise HTTPException(status_code=503, detail="Radio not connected")
    return {"ok": True}


@router.post("/mode")
async def set_mode(body: ModeRequest, _: User = Depends(get_current_user)):
    """Set the mode of the active slice."""
    mode = body.mode.upper()
    if mode not in VALID_MODES:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Valid modes: {sorted(VALID_MODES)}")
    state = get_state()
    if not state.get("connected"):
        raise HTTPException(status_code=503, detail="Radio not connected")
    slice_idx = 0
    for idx, sdata in state.get("slices", {}).items():
        if sdata.get("in_use") == "1":
            slice_idx = idx
            break
    ok = await send_command(f"slice set {slice_idx} mode={mode}")
    if not ok:
        raise HTTPException(status_code=503, detail="Radio not connected")
    return {"ok": True}
