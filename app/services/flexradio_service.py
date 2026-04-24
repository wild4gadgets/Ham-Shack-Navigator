"""
Persistent TCP listener for FlexRadio SmartSDR API (port 4992).

Connects to the radio, subscribes to slice status updates, and maintains
in-memory state for slice 0 (the primary slice). Broadcasts a WebSocket
message to dashboard clients whenever the frequency changes.

Also creates a DAX RX audio stream and receives the demodulated audio via
VITA-49/UDP for downstream processing (e.g. CW decoding).

SmartSDR TCP protocol:
  - Radio sends on connect: V<firmware_version>  then  H<hex_handle>
  - Client sends:  C1|client program Ham-Shack-Cockpit\n
  - Client sends:  C2|sub slice all\n
  - Radio pushes:  S<handle>|slice 0 in_use=1 freq=14.225000 mode=USB ...

DAX audio:
  - TCP: C<seq>|stream create type=dax_rx dax_channel=<N>
  - Radio responds: R<seq>|0|<stream_id_hex>
  - Radio then sends VITA-49 UDP frames to this host on DAX_UDP_PORT
  - PCM payload: 16-bit signed, big-endian, 48 kHz, mono
"""
import asyncio
import json
import logging
import re
import struct
from datetime import datetime, timezone

from sqlalchemy import select

from database import AsyncSessionLocal
from models import Setting
from ws_manager import manager

logger = logging.getLogger(__name__)

FLEX_PORT = 4992
DAX_UDP_PORT = 4991   # UDP port the radio sends VITA-49 audio frames to

_flex_task: asyncio.Task | None = None
_writer: asyncio.StreamWriter | None = None
_seq: int = 0
_flex_state: dict = {
    "connected": False,
    "slices": {},        # {slice_index: {"RF_frequency": str, "mode": str, "in_use": str}}
    "transmit": {},      # {"rfpower": str, ...}
    "interlock": {},     # {"state": "READY" | "TRANSMITTING" | ...}
    "meters": {},        # {meter_id: float}
    "meter_names": {},   # {meter_id: str}
    "dax_stream_id": None,
    "updated_at": None,
}

# Audio queue consumed by cw_decoder_service (and any future decoder).
# Each item is a bytes object containing raw PCM from one VITA-49 packet.
_dax_audio_queue: asyncio.Queue = asyncio.Queue(maxsize=200)
_dax_udp_transport: asyncio.BaseTransport | None = None


def get_dax_audio_queue() -> asyncio.Queue:
    """Return the queue that receives raw PCM bytes from the DAX RX stream."""
    return _dax_audio_queue


# ── VITA-49 / DAX audio ──────────────────────────────────────────────────────

def _parse_vita49_audio(data: bytes, expected_stream_id: int) -> bytes | None:
    """
    Extract PCM payload from a FlexRadio VITA-49.0 audio packet.

    Header layout (28 bytes / 7 words):
      [0]  Packet header word (type, class/trailer flags, TSI, TSF, seq, size)
      [4]  Stream ID
      [8]  OUI (0x00 0x1C 0x2D) + pad byte
      [12] Class code
      [16] Integer-seconds timestamp (UTC)
      [20] Fractional-seconds timestamp (8 bytes)
      [28+] PCM payload
    """
    if len(data) < 28:
        return None
    stream_id = struct.unpack_from(">I", data, 4)[0]
    if stream_id != expected_stream_id:
        return None
    payload = data[28:]
    return payload if payload else None


class _DaxAudioProtocol(asyncio.DatagramProtocol):
    """Asyncio UDP protocol that receives VITA-49 audio from the FlexRadio."""

    def __init__(self, stream_id: int) -> None:
        self._stream_id = stream_id
        self._packet_count = 0

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        self._packet_count += 1
        if self._packet_count == 1:
            logger.info(
                "DAX audio: first packet from %s — size=%d bytes stream=0x%08X",
                addr, len(data), self._stream_id,
            )
        elif self._packet_count == 100:
            logger.info("DAX audio: 100 packets received — stream is healthy")

        pcm = _parse_vita49_audio(data, self._stream_id)
        if pcm is None:
            return

        # Drop oldest item rather than block when the decoder falls behind
        if _dax_audio_queue.full():
            try:
                _dax_audio_queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
        try:
            _dax_audio_queue.put_nowait(pcm)
        except asyncio.QueueFull:
            pass

    def error_received(self, exc: Exception) -> None:
        logger.warning("DAX UDP error: %s", exc)

    def connection_lost(self, exc: Exception | None) -> None:
        logger.info("DAX UDP socket closed")


async def _start_dax_udp(stream_id: int) -> None:
    """Bind the UDP socket and start receiving VITA-49 audio frames.

    The radio sends VITA-49 to the port registered via "client udpport N" on the
    TCP connection.  This must be called after the DAX stream create response so
    the stream_id filter is known.
    """
    global _dax_udp_transport
    _stop_dax_udp()
    try:
        loop = asyncio.get_running_loop()
        transport, _ = await loop.create_datagram_endpoint(
            lambda: _DaxAudioProtocol(stream_id),
            local_addr=("0.0.0.0", DAX_UDP_PORT),
        )
        _dax_udp_transport = transport
        _flex_state["dax_stream_id"] = stream_id
        logger.info(
            "DAX audio UDP listener bound on port %d (stream 0x%08X)",
            DAX_UDP_PORT, stream_id,
        )

    except Exception as exc:
        logger.error("Failed to start DAX UDP listener on port %d: %s", DAX_UDP_PORT, exc)


def _stop_dax_udp() -> None:
    global _dax_udp_transport
    if _dax_udp_transport:
        _dax_udp_transport.close()
        _dax_udp_transport = None
    _flex_state["dax_stream_id"] = None


# ── FlexRadio helpers ────────────────────────────────────────────────────────

def _find_cw_slice() -> int | None:
    """Return the index of the best slice for CW DAX audio.

    Preference order:
      1. Any slice in CW / CWL / CWU mode
      2. Any slice marked in_use=1
      3. Slice 0 as last resort
    """
    cw_modes = {"CW", "CWL", "CWU"}
    cw_idx = None
    active_idx = None
    for idx, sdata in _flex_state["slices"].items():
        if sdata.get("mode", "").upper() in cw_modes and cw_idx is None:
            cw_idx = idx
        if sdata.get("in_use", "0") == "1" and active_idx is None:
            active_idx = idx
    result = cw_idx if cw_idx is not None else active_idx
    logger.info(
        "DAX target slice: %s (cw=%s active=%s slices=%s)",
        result, cw_idx, active_idx,
        {k: v.get("mode") for k, v in _flex_state["slices"].items()},
    )
    return result


def _get_swr() -> float | None:
    names = _flex_state["meter_names"]
    meters = _flex_state["meters"]
    for mid, name in names.items():
        if "swr" in name.lower():
            val = meters.get(mid)
            if val is not None:
                return round(val, 2)
    return None


async def send_command(cmd: str) -> bool:
    """Send a raw command to the radio. Returns False if not connected."""
    global _seq
    if _writer is None or _writer.is_closing():
        return False
    _seq += 1
    logger.debug("FlexRadio TX C%d|%s", _seq, cmd)
    _writer.write(f"C{_seq}|{cmd}\n".encode())
    await _writer.drain()
    return True


def get_state() -> dict:
    """Return a shallow copy of the current radio state."""
    return {
        "connected": _flex_state["connected"],
        "slices": {k: dict(v) for k, v in _flex_state["slices"].items()},
        "transmit": dict(_flex_state["transmit"]),
        "interlock": dict(_flex_state["interlock"]),
        "swr": _get_swr(),
        "dax_stream_id": _flex_state.get("dax_stream_id"),
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

        # dax_enabled defaults to True when FlexRadio is enabled;
        # the CW settings UI will add an explicit toggle later.
        dax_enabled = settings.get("dax_enabled", True)
        dax_channel = int(settings.get("dax_channel", 1))

        global _writer, _seq
        _seq = 1
        dax_create_seq: int | None = None
        dax_stream_created = False
        connect_time: float | None = None

        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(ip, FLEX_PORT),
                timeout=10,
            )
            _writer = writer
            logger.info("FlexRadio connected to %s:%d", ip, FLEX_PORT)
            fail_count = 0
            _flex_state["connected"] = True
            connect_time = asyncio.get_event_loop().time()

            # Identify as program client only — do NOT send "client gui".
            # "client gui" causes the radio to create a Pi-owned slice which
            # then takes ownership of DAX channel 1, preventing our stream
            # from targeting the operator's CW slice.
            writer.write(f"C{_seq}|client program Ham-Shack-Cockpit\n".encode())
            _seq += 1
            # Register the UDP port so the radio knows where to send VITA-49 frames.
            # Without this command the radio sends no directed UDP at all.
            writer.write(f"C{_seq}|client udpport {DAX_UDP_PORT}\n".encode())
            _seq += 1
            writer.write(f"C{_seq}|sub slice all\n".encode())
            _seq += 1
            writer.write(f"C{_seq}|sub tx all\n".encode())
            _seq += 1
            writer.write(f"C{_seq}|sub interlock all\n".encode())
            _seq += 1
            writer.write(f"C{_seq}|sub meter all\n".encode())
            _seq += 1
            writer.write(f"C{_seq}|meter list\n".encode())
            _seq += 1
            await writer.drain()
            # DAX stream create is deferred 3 s to let slice status arrive first

            while True:
                # Use short readline timeout while waiting to create DAX stream
                read_timeout = 1.0 if (dax_enabled and not dax_stream_created) else 60.0
                try:
                    line = await asyncio.wait_for(reader.readline(), timeout=read_timeout)
                except asyncio.TimeoutError:
                    if dax_enabled and not dax_stream_created:
                        elapsed = asyncio.get_event_loop().time() - connect_time
                        if elapsed >= 3.0:
                            target_slice = _find_cw_slice()
                            cmd = f"C{_seq}|stream create type=dax_rx dax_channel={dax_channel}"
                            if target_slice is not None:
                                cmd += f" slice={target_slice}"
                            cmd += "\n"
                            dax_create_seq = _seq
                            writer.write(cmd.encode())
                            _seq += 1
                            await writer.drain()
                            dax_stream_created = True
                            logger.info(
                                "DAX audio: stream create sent for channel %d slice=%s (seq %d)",
                                dax_channel, target_slice, dax_create_seq,
                            )
                    else:
                        # Keepalive ping
                        writer.write(f"C{_seq}|ping\n".encode())
                        _seq += 1
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
                        old_mode = _flex_state["slices"].get(slice_idx, {}).get("mode", "")

                        if slice_idx not in _flex_state["slices"]:
                            _flex_state["slices"][slice_idx] = {}
                        _flex_state["slices"][slice_idx].update(kv)
                        _flex_state["updated_at"] = datetime.now(timezone.utc).isoformat()

                        # Broadcast when primary slice frequency or mode changes
                        if slice_idx == 0:
                            new_freq = _flex_state["slices"][0].get("RF_frequency")
                            new_mode = _flex_state["slices"][0].get("mode", "")
                            freq_changed = new_freq and new_freq != old_freq
                            mode_changed = new_mode != old_mode
                            if freq_changed or mode_changed:
                                await manager.broadcast({
                                    "type": "flexradio_update",
                                    "freq": new_freq,
                                    "mode": new_mode,
                                })
                            if mode_changed:
                                from services.cw_decoder_service import set_cw_mode
                                set_cw_mode(new_mode.upper() in {"CW", "CWL", "CWU"})

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

                    # Meter definition: S<h>|meter <id>.<key>=<val>#...
                    m = re.match(r"meter\s+(\d+)\.", body)
                    if m:
                        meter_id = int(m.group(1))
                        nam = re.search(r'\.nam=([^#\s]+)', body)
                        if nam:
                            _flex_state["meter_names"][meter_id] = nam.group(1)
                            logger.debug("FlexRadio meter %d = %s", meter_id, nam.group(1))

                # Meter update: M<handle>|<id>=<value> ...
                if text.startswith("M"):
                    _, _, body = text.partition("|")
                    old_swr = _get_swr()
                    for mv in re.finditer(r'(\d+)=(-?[\d.]+)', body):
                        _flex_state["meters"][int(mv.group(1))] = float(mv.group(2))
                    new_swr = _get_swr()
                    if new_swr is not None and new_swr != old_swr:
                        await manager.broadcast({
                            "type": "flexradio_update",
                            "swr": new_swr,
                        })

                # Command response: R<seq>|<code>|<data>
                if text.startswith("R"):
                    parts = text.split("|", 2)
                    if len(parts) == 3:
                        resp_seq_str = parts[0][1:]
                        resp_seq = int(resp_seq_str) if resp_seq_str.isdigit() else -1
                        code = parts[1]
                        data = parts[2]

                        if code != "0":
                            logger.warning("FlexRadio command R%s error %s: %s", resp_seq, code, data.strip())

                        # Meter list names
                        if code == "0" and data:
                            for nm in re.finditer(r'(\d+)\.name=([^,\s]+)', data):
                                _flex_state["meter_names"][int(nm.group(1))] = nm.group(2)

                        # DAX stream create response
                        if dax_create_seq is not None and resp_seq == dax_create_seq:
                            if code == "0" and data.strip():
                                try:
                                    stream_id = int(data.strip(), 16)
                                    logger.info(
                                        "DAX audio: stream created (0x%08X)", stream_id
                                    )
                                    asyncio.create_task(_start_dax_udp(stream_id))
                                except ValueError:
                                    logger.warning(
                                        "DAX stream create: unexpected response %r", data
                                    )
                            else:
                                logger.warning(
                                    "DAX stream create failed (code=%s): %s", code, data
                                )
                            dax_create_seq = None  # don't re-process

        except Exception as exc:
            fail_count += 1
            log = logger.warning if fail_count <= 3 else logger.debug
            log("FlexRadio connection error (attempt %d, %s): %s", fail_count, ip, exc)

        finally:
            _writer = None
            _flex_state["connected"] = False
            _stop_dax_udp()

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
    _stop_dax_udp()
