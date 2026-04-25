import asyncio
from fastapi import APIRouter, Depends
from services.cw_decoder_service import get_status, clear_decoder_text, update_params, _goertzel_power, SAMPLE_RATE, BLOCK_SIZE
from services.flexradio_service import get_dax_audio_queue
from dependencies import get_current_user
from models import User

router = APIRouter(prefix="/cw", tags=["cw"])


@router.get("/status")
async def cw_status(_: User = Depends(get_current_user)):
    return get_status()


@router.post("/clear")
async def cw_clear(_: User = Depends(get_current_user)):
    """Clear the decoded text buffer in the running CW decoder."""
    clear_decoder_text()
    return {"ok": True}


@router.put("/params")
async def cw_set_params(body: dict, _: User = Depends(get_current_user)):
    """Update tone frequency and/or detection threshold live."""
    update_params(
        tone_freq=body.get("tone_freq"),
        threshold=body.get("threshold"),
    )
    return get_status()


@router.get("/freq-sweep")
async def cw_freq_sweep(_: User = Depends(get_current_user)):
    """Capture one block of live audio and return Goertzel power at 50 Hz steps."""
    queue = get_dax_audio_queue()
    try:
        pcm_bytes = await asyncio.wait_for(queue.get(), timeout=2.0)
    except asyncio.TimeoutError:
        return {"error": "no audio"}
    import struct
    n = len(pcm_bytes) // 2
    samples = [struct.unpack_from(">h", pcm_bytes, i * 2)[0] / 32768.0 for i in range(n)]
    block = samples[:BLOCK_SIZE]
    sweep = {f: round(_goertzel_power(block, f, SAMPLE_RATE), 3) for f in range(200, 1201, 50)}
    peak = max(sweep, key=sweep.get)
    return {"peak_hz": peak, "peak_power": sweep[peak], "sweep": sweep}
