"""
flrig XML-RPC rig control integration.

Polls flrig's XML-RPC server (default localhost:12345) for frequency, mode,
PTT state, and meter readings. Broadcasts `flrig_update` WebSocket messages
when state changes. Exposes set_frequency / set_mode / set_ptt commands.

flrig XML-RPC is a blocking HTTP protocol, so all calls use asyncio.to_thread.
"""
import asyncio
import json
import logging
import xmlrpc.client
from datetime import datetime, timezone

from sqlalchemy import select

from database import AsyncSessionLocal
from models import Setting
from ws_manager import manager

logger = logging.getLogger(__name__)

_flrig_task: asyncio.Task | None = None

_flrig_state: dict = {
    "connected": False,
    "freq_hz": None,
    "mode": None,
    "ptt": False,
    "smeter": None,
    "swr": None,
    "power_out": None,
    "updated_at": None,
}

_available_modes: list[str] = []


def get_state() -> dict:
    return dict(_flrig_state)


def get_available_modes() -> list[str]:
    return list(_available_modes)


async def _get_settings() -> dict:
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Setting).where(Setting.key == "flrig"))
            row = result.scalar_one_or_none()
            return json.loads(row.value) if row else {}
    except Exception as exc:
        logger.debug("flrig settings read error: %s", exc)
        return {}


def _make_proxy(host: str, port: int) -> xmlrpc.client.ServerProxy:
    return xmlrpc.client.ServerProxy(
        f"http://{host}:{port}", allow_none=True, use_builtin_types=True
    )


async def _flrig_poller():
    global _flrig_state, _available_modes
    fail_count = 0

    while True:
        settings = await _get_settings()
        enabled = settings.get("enabled", False)
        host = settings.get("host", "localhost")
        port = int(settings.get("port", 12345))
        poll_sec = max(0.25, int(settings.get("poll_interval_ms", 1000)) / 1000.0)

        if not enabled:
            if _flrig_state["connected"]:
                _flrig_state["connected"] = False
                await manager.broadcast({"type": "flrig_update", **_flrig_state})
            await asyncio.sleep(30)
            continue

        proxy = _make_proxy(host, port)

        # Connection check
        try:
            await asyncio.to_thread(proxy.main.get_version)
        except Exception as exc:
            if _flrig_state["connected"]:
                _flrig_state["connected"] = False
                await manager.broadcast({"type": "flrig_update", **_flrig_state})
            fail_count += 1
            delay = min(10 * (3 ** max(0, fail_count - 1)), 30)
            logger.debug("flrig not reachable (%s), retry in %ss", exc, delay)
            await asyncio.sleep(delay)
            continue

        # Fetch available modes once per connection
        try:
            modes_raw = await asyncio.to_thread(proxy.rig.get_modes)
            if isinstance(modes_raw, (list, tuple)):
                _available_modes = [str(m) for m in modes_raw]
            elif isinstance(modes_raw, str):
                _available_modes = [m.strip() for m in modes_raw.split(",") if m.strip()]
        except Exception:
            _available_modes = []

        if not _flrig_state["connected"]:
            _flrig_state["connected"] = True
            _flrig_state["updated_at"] = datetime.now(timezone.utc).isoformat()
            await manager.broadcast({"type": "flrig_update", **_flrig_state})
            logger.info("flrig connected at %s:%s", host, port)

        fail_count = 0

        # Poll loop
        while True:
            settings = await _get_settings()
            if not settings.get("enabled", False):
                break

            new_host = settings.get("host", "localhost")
            new_port = int(settings.get("port", 12345))
            poll_sec = max(0.25, int(settings.get("poll_interval_ms", 1000)) / 1000.0)

            if new_host != host or new_port != port:
                host, port = new_host, new_port
                proxy = _make_proxy(host, port)

            try:
                freq = await asyncio.to_thread(proxy.main.get_frequency)
                mode = await asyncio.to_thread(proxy.rig.get_mode)
                ptt = bool(await asyncio.to_thread(proxy.rig.get_ptt))
                smeter = await asyncio.to_thread(proxy.rig.get_smeter)
                power_out = await asyncio.to_thread(proxy.rig.get_pwrmeter)

                try:
                    swr = await asyncio.to_thread(proxy.rig.get_swrmeter)
                except Exception:
                    swr = None

                freq = float(freq) if freq is not None else None
                smeter = float(smeter) if smeter is not None else None
                power_out = float(power_out) if power_out is not None else None
                swr = float(swr) if swr is not None else None

                old_freq = _flrig_state["freq_hz"]
                freq_changed = (
                    freq is None and old_freq is not None
                ) or (
                    freq is not None and old_freq is None
                ) or (
                    freq is not None and old_freq is not None and abs(freq - old_freq) > 1.0
                )

                changed = (
                    freq_changed
                    or mode != _flrig_state["mode"]
                    or ptt != _flrig_state["ptt"]
                    or smeter != _flrig_state["smeter"]
                    or swr != _flrig_state["swr"]
                    or power_out != _flrig_state["power_out"]
                )

                if changed:
                    _flrig_state.update({
                        "connected": True,
                        "freq_hz": freq,
                        "mode": mode,
                        "ptt": ptt,
                        "smeter": smeter,
                        "swr": swr,
                        "power_out": power_out,
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
                    await manager.broadcast({"type": "flrig_update", **_flrig_state})

            except Exception as exc:
                logger.debug("flrig poll error: %s", exc)
                _flrig_state["connected"] = False
                await manager.broadcast({"type": "flrig_update", **_flrig_state})
                fail_count += 1
                break

            await asyncio.sleep(poll_sec)


async def set_frequency(hz: float) -> bool:
    """Set the rig frequency in Hz."""
    if not _flrig_state.get("connected"):
        return False
    settings = await _get_settings()
    host = settings.get("host", "localhost")
    port = int(settings.get("port", 12345))
    proxy = _make_proxy(host, port)
    try:
        await asyncio.to_thread(proxy.main.set_frequency, hz)
        _flrig_state["freq_hz"] = hz
        _flrig_state["updated_at"] = datetime.now(timezone.utc).isoformat()
        await manager.broadcast({"type": "flrig_update", **_flrig_state})
        return True
    except Exception as exc:
        logger.warning("flrig set_frequency failed: %s", exc)
        return False


async def set_mode(mode: str) -> bool:
    """Set the rig mode."""
    if not _flrig_state.get("connected"):
        return False
    settings = await _get_settings()
    host = settings.get("host", "localhost")
    port = int(settings.get("port", 12345))
    proxy = _make_proxy(host, port)
    try:
        await asyncio.to_thread(proxy.rig.set_mode, mode)
        _flrig_state["mode"] = mode
        _flrig_state["updated_at"] = datetime.now(timezone.utc).isoformat()
        await manager.broadcast({"type": "flrig_update", **_flrig_state})
        return True
    except Exception as exc:
        logger.warning("flrig set_mode failed: %s", exc)
        return False


async def set_ptt(active: bool) -> bool:
    """Set PTT state."""
    if not _flrig_state.get("connected"):
        return False
    settings = await _get_settings()
    host = settings.get("host", "localhost")
    port = int(settings.get("port", 12345))
    proxy = _make_proxy(host, port)
    try:
        await asyncio.to_thread(proxy.rig.set_ptt, int(active))
        _flrig_state["ptt"] = active
        _flrig_state["updated_at"] = datetime.now(timezone.utc).isoformat()
        await manager.broadcast({"type": "flrig_update", **_flrig_state})
        return True
    except Exception as exc:
        logger.warning("flrig set_ptt failed: %s", exc)
        return False


def start_poller():
    """Start (or restart) the background flrig polling task."""
    global _flrig_task
    if _flrig_task is None or _flrig_task.done():
        _flrig_task = asyncio.create_task(_flrig_poller())
        logger.info("flrig poller task created")


def stop_poller():
    """Cancel the background flrig polling task."""
    global _flrig_task
    if _flrig_task and not _flrig_task.done():
        _flrig_task.cancel()
        _flrig_task = None
