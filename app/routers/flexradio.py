from fastapi import APIRouter, Depends

from dependencies import get_current_user
from models import User
from services.flexradio_service import get_state

router = APIRouter(prefix="/flexradio", tags=["flexradio"])


@router.get("/status")
async def get_flexradio_status(_: User = Depends(get_current_user)):
    """Return current FlexRadio slice 0 status (frequency, mode, connection state)."""
    state = get_state()
    primary = state.get("slices", {}).get(0, {})
    connected = state.get("connected", False)
    rf_power_raw = state.get("transmit", {}).get("rfpower") if connected else None
    interlock_state = state.get("interlock", {}).get("state") if connected else None
    return {
        "connected": connected,
        "freq_mhz": primary.get("RF_frequency") if connected else None,
        "mode": primary.get("mode") if connected else None,
        "in_use": primary.get("in_use") if connected else None,
        "rf_power": int(rf_power_raw) if rf_power_raw is not None else None,
        "tx_state": interlock_state,
        "updated_at": state.get("updated_at"),
    }
