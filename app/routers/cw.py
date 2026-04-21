from fastapi import APIRouter
from services.cw_decoder_service import get_status

router = APIRouter(prefix="/cw", tags=["cw"])


@router.get("/status")
async def cw_status():
    return get_status()
