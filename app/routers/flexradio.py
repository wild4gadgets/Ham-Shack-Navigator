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
    return {
        "connected": connected,
        "freq_mhz": primary.get("RF_frequency") if connected else None,
        "mode": primary.get("mode") if connected else None,
        "in_use": primary.get("in_use") if connected else None,
        "updated_at": state.get("updated_at"),
    }
