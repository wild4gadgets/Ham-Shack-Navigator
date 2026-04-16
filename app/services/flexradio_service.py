"""
Persistent TCP listener for FlexRadio SmartSDR API (port 4992).

Connects to the radio, subscribes to slice status updates, and maintains
in-memory state for slice 0 (the primary slice). Broadcasts a WebSocket
message to dashboard clients whenever the frequency changes.

SmartSDR TCP protocol:
  - Radio sends on connect: V<firmware_version>  then  H<hex_handle>
  - Client sends:  C1|client program Ham-Shack-Cockpit\n
  - Client sends:  C2|sub slice all\n
  - Radio pushes:  S<handle>|slice 0 in_use=1 freq=14.225000 mode=USB ...
"""
import asyncio
import json
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import select

from database import AsyncSessionLocal
from models import Setting
from ws_manager import manager

logger = logging.getLogger(__name__)

FLEX_PORT = 4992

_flex_task: asyncio.Task | None = None
_flex_state: dict = {
    "connected": False,
    "slices": {},       # {slice_index: {"RF_frequency": str, "mode": str, "in_use": str}}
    "transmit": {},     # {"rfpower": str, ...}
    "interlock": {},    # {"state": "READY" | "TRANSMITTING" | ...}
    "updated_at": None,
}


def get_state() -> dict:
    """Return a shallow copy of the current radio state."""
    return {
        "connected": _flex_state["connected"],
        "slices": {k: dict(v) for k, v in _flex_state["slices"].items()},
        "transmit": dict(_flex_state["transmit"]),
        "interlock": dict(_flex_state["interlock"]),
        "updated_at": _flex_state["updated_at"],
    }


async def _get_settings() -> dict:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Setting).where(Setting.key == "flexradio"))
            row = result.scalar_one_or_none()
            return json.loads(row.value) if row else {}
    except Exception as exc:
        logger.debug("FlexRadio settings read error: %s", exc)
        return {}


def _parse_kv(text: str) -> dict:
    """Parse key=value pairs from a SmartSDR status message body."""
    result = {}
    for m in re.finditer(r'(\w+)=([^\s]+)', text):
        result[m.group(1)] = m.group(2)
    return result


async def _flex_listener():
    global _flex_state
    fail_count = 0

    while True:
        settings = await _get_settings()
        ip = settings.get("ip", "").strip()
        enabled = settings.get("enabled", False)

        if not enabled or not ip:
            await asyncio.sleep(30)
            continue

        seq = 1
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, FLEX_PORT),
                timeout=10,
            )
            logger.info("FlexRadio connected to %s:%d", ip, FLEX_PORT)
            fail_count = 0
            _flex_state["connected"] = True

            # Identify client and subscribe to slice + transmit status updates
            writer.write(f"C{seq}|client program Ham-Shack-Cockpit\n".encode())
            seq += 1
            writer.write(f"C{seq}|sub slice all\n".encode())
            seq += 1
            writer.write(f"C{seq}|sub tx all\n".encode())
            seq += 1
            writer.write(f"C{seq}|sub interlock all\n".encode())
            seq += 1
            await writer.drain()

            while True:
                try:
                    line = await asyncio.wait_for(reader.readline(), timeout=60)
                except asyncio.TimeoutError:
                    # Keepalive ping
                    writer.write(f"C{seq}|ping\n".encode())
                    seq += 1
                    await writer.drain()
                    continue

                if not line:
                    logger.debug("FlexRadio: connection closed by radio")
                    break

                text = line.decode("utf-8", errors="ignore").strip()
                if not text:
                    continue

                # Status message format: S<handle>|<type> key=value ...
                if text.startswith("S"):
                    _, _, body = text.partition("|")

                    # Slice status
                    m = re.match(r"slice\s+(\d+)\s+(.*)", body)
                    if m:
                        slice_idx = int(m.group(1))
                        kv = _parse_kv(m.group(2))
                        old_freq = _flex_state["slices"].get(slice_idx, {}).get("RF_frequency")

                        if slice_idx not in _flex_state["slices"]:
                            _flex_state["slices"][slice_idx] = {}
                        _flex_state["slices"][slice_idx].update(kv)
                        _flex_state["updated_at"] = datetime.now(timezone.utc).isoformat()

                        # Broadcast when primary slice frequency changes
                        if slice_idx == 0:
                            new_freq = _flex_state["slices"][0].get("RF_frequency")
                            if new_freq and new_freq != old_freq:
                                await manager.broadcast({
                                    "type": "flexradio_update",
                                    "freq": new_freq,
                                    "mode": _flex_state["slices"][0].get("mode", ""),
                                })

                    # Transmit status
                    m = re.match(r"transmit\s+(.*)", body)
                    if m:
                        kv = _parse_kv(m.group(1))
                        if "rfpower" in kv:
                            old_power = _flex_state["transmit"].get("rfpower")
                            _flex_state["transmit"].update(kv)
                            _flex_state["updated_at"] = datetime.now(timezone.utc).isoformat()
                            if kv["rfpower"] != old_power:
                                await manager.broadcast({
                                    "type": "flexradio_update",
                                    "rfpower": kv["rfpower"],
                                })

                    # Interlock status (PTT / TX state)
                    m = re.match(r"interlock\s+(.*)", body)
                    if m:
                        kv = _parse_kv(m.group(1))
                        if "state" in kv:
                            old_ilock = _flex_state["interlock"].get("state")
                            _flex_state["interlock"].update(kv)
                            _flex_state["updated_at"] = datetime.now(timezone.utc).isoformat()
                            if kv["state"] != old_ilock:
                                await manager.broadcast({
                                    "type": "flexradio_update",
                                    "interlock_state": kv["state"],
                                })

        except Exception as exc:
            fail_count += 1
            log = logger.warning if fail_count <= 3 else logger.debug
            log("FlexRadio connection error (attempt %d, %s): %s", fail_count, ip, exc)

        finally:
            _flex_state["connected"] = False

        delay = min(10 * (3 ** max(0, fail_count - 1)), 300)
        await asyncio.sleep(delay)


def start_listener():
    """Start (or restart) the background FlexRadio listener task."""
    global _flex_task
    if _flex_task is None or _flex_task.done():
        _flex_task = asyncio.create_task(_flex_listener())
        logger.info("FlexRadio listener task created")


def stop_listener():
    """Cancel the background FlexRadio listener task."""
    global _flex_task
    if _flex_task and not _flex_task.done():
        _flex_task.cancel()
        _flex_task = None
