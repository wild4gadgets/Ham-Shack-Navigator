import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from dependencies import get_current_user
from models import User
from services.flexradio_service import get_state, send_command, start_tune, stop_tune, update_transmit_power

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


class AtuRequest(BaseModel):
    enabled: bool


class TuneCarrierRequest(BaseModel):
    active: bool


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
    await update_transmit_power(body.rf_power)
    return {"ok": True}


@router.post("/tune-carrier")
async def set_tune_carrier(body: TuneCarrierRequest, _: User = Depends(get_current_user)):
    """Start or stop a tune carrier (low-power TX for external ATU tuning)."""
    if not get_state().get("connected"):
        raise HTTPException(status_code=503, detail="Radio not connected")
    ok = await (start_tune() if body.active else stop_tune())
    if not ok:
        raise HTTPException(status_code=503, detail="Radio not connected")
    return {"ok": True}


@router.post("/atu")
async def set_atu(body: AtuRequest, _: User = Depends(get_current_user)):
    """Enable or bypass the ATU (antenna tuner)."""
    state = get_state()
    if not state.get("connected"):
        raise HTTPException(status_code=503, detail="Radio not connected")
    ok = await send_command(f"atu set atu_enabled={1 if body.enabled else 0}")
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
    tune_power_raw = state.get("transmit", {}).get("tunepower") if connected else None
    interlock_state = state.get("interlock", {}).get("state") if connected else None
    atu_enabled_raw = state.get("atu", {}).get("atu_enabled") if connected else None

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
        "ping_online": state.get("ping_online"),
        "ping_rtt_ms": state.get("ping_rtt_ms"),
        "freq_mhz": primary.get("RF_frequency") if connected else None,
        "mode": primary.get("mode") if connected else None,
        "in_use": primary.get("in_use") if connected else None,
        "rf_power": int(rf_power_raw) if rf_power_raw is not None else None,
        "tx_state": interlock_state,
        "atu_enabled": (atu_enabled_raw == "1") if atu_enabled_raw is not None else None,
        "tune_active": state.get("tune_active", False),
        "tune_power": int(tune_power_raw) if tune_power_raw is not None else None,
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
