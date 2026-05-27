"""
Background MQTT service for Blitzortung live lightning detection.

Thread model:
  paho client runs loop_forever() in a dedicated daemon thread.
  on_message() is called on that thread and uses asyncio.run_coroutine_threadsafe
  to schedule manager.broadcast() on the main FastAPI event loop.
  The recent_strikes deque is protected by a Lock because the HTTP endpoint
  reads it from the asyncio thread while on_message writes from the paho thread.
"""

import asyncio
import json
import logging
import math
import socket
import threading
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Optional

import pygeohash as gh
import paho.mqtt.client as mqtt

from ws_manager import manager

logger = logging.getLogger(__name__)

MQTT_BROKER = "blitzortung.ha.sed.pl"
MQTT_PORT = 1883
MQTT_KEEPALIVE = 60
GEOHASH_PRECISION = 4
BUFFER_SIZE = 10

# --- Module-level state ---

_thread: Optional[threading.Thread] = None
_client: Optional[mqtt.Client] = None
_stop_event: threading.Event = threading.Event()
_recent_strikes: deque = deque(maxlen=BUFFER_SIZE)
_strikes_lock: threading.Lock = threading.Lock()
_loop: Optional[asyncio.AbstractEventLoop] = None

_lat: float = 0.0
_lon: float = 0.0
_range_km: float = 40.0

# --- Notification state ---
_notify_enabled: bool = False
_notify_ntfy: bool = False
_notify_telegram: bool = False
_notify_ifttt: bool = False
_notify_email: bool = False
_notify_interval_min: int = 15
_last_notified_at: Optional[datetime] = None
_notify_lock: threading.Lock = threading.Lock()


# --- Geohash / distance helpers ---

def _get_cells(lat: float, lon: float) -> list[str]:
    home = gh.encode(lat, lon, GEOHASH_PRECISION)
    n  = gh.get_adjacent(home, "top")
    s  = gh.get_adjacent(home, "bottom")
    e  = gh.get_adjacent(home, "right")
    w  = gh.get_adjacent(home, "left")
    ne = gh.get_adjacent(n, "right")
    nw = gh.get_adjacent(n, "left")
    se = gh.get_adjacent(s, "right")
    sw = gh.get_adjacent(s, "left")
    return [home, n, ne, e, se, s, sw, w, nw]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(math.radians(lat2))
    y = (math.cos(math.radians(lat1)) * math.sin(math.radians(lat2))
         - math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(dlon))
    return (math.degrees(math.atan2(x, y)) + 360) % 360


_CARDINALS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"]

def _cardinal(deg: float) -> str:
    return _CARDINALS[round(deg / 22.5) % 16]


async def _send_lightning_notification(record: dict) -> None:
    from database import AsyncSessionLocal
    km = record["distance_km"]
    mi = km * 0.621371
    brng = record["bearing_deg"]
    card = _cardinal(brng)
    ts = datetime.fromisoformat(record["timestamp"]).strftime("%Y-%m-%d %H:%M:%S UTC")
    lat, lon = record["lat"], record["lon"]

    plain = (
        f"Lightning strike detected {km:.1f} km ({mi:.1f} mi) away\n"
        f"Bearing: {brng:.0f}° ({card})\n"
        f"Location: {lat:.4f}, {lon:.4f}\n"
        f"Time: {ts}"
    )
    html = (
        f"<b>&#9889; Lightning Strike Detected</b>\n"
        f"Distance: {km:.1f} km ({mi:.1f} mi)\n"
        f"Bearing: {brng:.0f}° ({card})\n"
        f"Location: {lat:.4f}, {lon:.4f}\n"
        f"Time: {ts}"
    )

    async with AsyncSessionLocal() as db:
        if _notify_ntfy:
            try:
                from services.ntfy_service import _get_ntfy_config, _publish
                cfg = await _get_ntfy_config(db)
                if cfg and cfg.get("enabled") and cfg.get("topic"):
                    await _publish(cfg, "Ham Shack Navigator — Lightning Alert", plain,
                                   priority="high", tags="zap,warning")
                    logger.info("Blitzortung ntfy notification sent")
            except Exception as exc:
                logger.error("Blitzortung ntfy notification failed: %s", exc)

        if _notify_telegram:
            try:
                from services.telegram_service import _get_telegram_config, _send_message
                cfg = await _get_telegram_config(db)
                if cfg and cfg.get("enabled") and cfg.get("bot_token") and cfg.get("chat_id"):
                    await _send_message(cfg["bot_token"], cfg["chat_id"], html)
                    logger.info("Blitzortung Telegram notification sent")
            except Exception as exc:
                logger.error("Blitzortung Telegram notification failed: %s", exc)

        if _notify_ifttt:
            try:
                from services.ifttt_service import _get_ifttt_config, _post_event
                cfg = await _get_ifttt_config(db)
                if cfg and cfg.get("enabled") and cfg.get("webhook_key"):
                    event = cfg.get("event_name_threshold", "ham_shack_alert")
                    v1 = f"{km:.1f} km ({mi:.1f} mi)"
                    v2 = f"{brng:.0f}° ({card})"
                    v3 = f"{lat:.4f}, {lon:.4f} at {ts}"
                    await _post_event(cfg["webhook_key"], event, v1, v2, v3)
                    logger.info("Blitzortung IFTTT notification sent")
            except Exception as exc:
                logger.error("Blitzortung IFTTT notification failed: %s", exc)

        if _notify_email:
            try:
                from services.email_service import send_lightning_alert
                await send_lightning_alert(db, plain)
                logger.info("Blitzortung email notification sent")
            except Exception as exc:
                logger.error("Blitzortung email notification failed: %s", exc)


def _resolve_ipv4(hostname: str, port: int) -> str:
    results = socket.getaddrinfo(hostname, port, socket.AF_INET, socket.SOCK_STREAM)
    if not results:
        raise OSError(f"Could not resolve {hostname} to IPv4")
    return results[0][4][0]


# --- paho callbacks ---

def _on_connect(client: mqtt.Client, userdata: dict, flags, rc, properties=None) -> None:
    if rc != 0:
        logger.error("Blitzortung MQTT connect failed: rc=%d", rc)
        return
    cells = _get_cells(_lat, _lon)
    for cell in cells:
        client.subscribe(f"blitzortung/1.1/{'/'.join(cell)}/#", qos=0)
    logger.info("Blitzortung MQTT connected; subscribed to %d cells centred on %s",
                len(cells), cells[0])
    userdata["cells"] = cells


def _on_disconnect(client: mqtt.Client, userdata: dict, flags, rc, properties=None) -> None:
    if rc != 0:
        logger.warning("Blitzortung MQTT unexpected disconnect (rc=%d)", rc)


def _on_message(client: mqtt.Client, userdata: dict, msg: mqtt.MQTTMessage) -> None:
    try:
        strike = json.loads(msg.payload)
        slat = float(strike["lat"])
        slon = float(strike["lon"])
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        return

    dist = _haversine_km(_lat, _lon, slat, slon)
    if dist > _range_km:
        return

    brng = _bearing_deg(_lat, _lon, slat, slon)
    ts = datetime.now(timezone.utc).isoformat()

    record = {
        "distance_km": round(dist, 2),
        "bearing_deg": round(brng, 1),
        "lat": slat,
        "lon": slon,
        "timestamp": ts,
    }

    with _strikes_lock:
        _recent_strikes.appendleft(record)

    if _loop is not None:
        payload = {"type": "lightning_strike", "data": record}
        asyncio.run_coroutine_threadsafe(manager.broadcast(payload), _loop)

    if _notify_enabled and _loop is not None:
        with _notify_lock:
            global _last_notified_at
            now = datetime.now(timezone.utc)
            elapsed_min = (now - _last_notified_at).total_seconds() / 60 if _last_notified_at else float("inf")
            if elapsed_min >= _notify_interval_min:
                _last_notified_at = now
                asyncio.run_coroutine_threadsafe(_send_lightning_notification(record), _loop)


# --- MQTT thread ---

def _run_mqtt() -> None:
    global _client
    _client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, userdata={})
    _client.on_connect = _on_connect
    _client.on_disconnect = _on_disconnect
    _client.on_message = _on_message

    while not _stop_event.is_set():
        try:
            ipv4 = _resolve_ipv4(MQTT_BROKER, MQTT_PORT)
            _client.connect(ipv4, MQTT_PORT, keepalive=MQTT_KEEPALIVE)
            _client.loop_forever()
        except OSError as exc:
            logger.error("Blitzortung network error: %s — retry in 30s", exc)
            if _stop_event.wait(timeout=30):
                break

    logger.info("Blitzortung MQTT thread exiting")


# --- Public API ---

def start(
    lat: float,
    lon: float,
    range_km: float,
    notify_enabled: bool = False,
    notify_ntfy: bool = False,
    notify_telegram: bool = False,
    notify_ifttt: bool = False,
    notify_email: bool = False,
    notify_interval_min: int = 15,
) -> None:
    """Start the MQTT background thread. Must be called from a running asyncio context."""
    global _thread, _lat, _lon, _range_km, _loop
    global _notify_enabled, _notify_ntfy, _notify_telegram, _notify_ifttt, _notify_email, _notify_interval_min, _last_notified_at

    if is_running():
        stop()

    _lat = lat
    _lon = lon
    _range_km = range_km
    _notify_enabled = notify_enabled
    _notify_ntfy = notify_ntfy
    _notify_telegram = notify_telegram
    _notify_ifttt = notify_ifttt
    _notify_email = notify_email
    _notify_interval_min = notify_interval_min
    _last_notified_at = None
    with _strikes_lock:
        _recent_strikes.clear()
    _stop_event.clear()

    try:
        _loop = asyncio.get_running_loop()
    except RuntimeError:
        _loop = None

    _thread = threading.Thread(target=_run_mqtt, name="blitzortung-mqtt", daemon=True)
    _thread.start()
    logger.info("Blitzortung service started: lat=%.4f lon=%.4f range=%.0f km", lat, lon, range_km)


def stop() -> None:
    global _thread, _client

    _stop_event.set()
    if _client is not None:
        try:
            _client.disconnect()
            _client.loop_stop()
        except Exception:
            pass
        _client = None

    if _thread is not None and _thread.is_alive():
        _thread.join(timeout=5)
    _thread = None
    logger.info("Blitzortung service stopped")


def is_running() -> bool:
    return _thread is not None and _thread.is_alive()


_STRIKE_MAX_AGE = timedelta(hours=1)

def get_recent_strikes() -> list[dict]:
    cutoff = datetime.now(timezone.utc) - _STRIKE_MAX_AGE
    with _strikes_lock:
        return [s for s in _recent_strikes if datetime.fromisoformat(s["timestamp"]) > cutoff]


def get_home_geohash(lat: float, lon: float) -> str:
    return gh.encode(lat, lon, GEOHASH_PRECISION)
