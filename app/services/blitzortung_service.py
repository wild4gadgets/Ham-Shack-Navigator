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
from datetime import datetime, timezone
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
        client.subscribe(f"blitzortung/1.1/{cell}/#", qos=0)
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

def start(lat: float, lon: float, range_km: float) -> None:
    """Start the MQTT background thread. Must be called from a running asyncio context."""
    global _thread, _lat, _lon, _range_km, _loop

    if is_running():
        stop()

    _lat = lat
    _lon = lon
    _range_km = range_km
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


def get_recent_strikes() -> list[dict]:
    with _strikes_lock:
        return list(_recent_strikes)


def get_home_geohash(lat: float, lon: float) -> str:
    return gh.encode(lat, lon, GEOHASH_PRECISION)
