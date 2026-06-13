#!/usr/bin/env python3
"""
blitzortung_monitor.py
Standalone lightning proximity monitor using the Blitzortung MQTT relay.
Alerts when strikes occur within a configurable radius of a fixed location.

Dependencies:
    pip install paho-mqtt pygeohash

Usage:
    python blitzortung_monitor.py
"""

import json
import math
import logging
import socket
import time
import pygeohash as gh
import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MY_LAT = 0.0             # Set to your station latitude  (e.g. 39.583)
MY_LON = 0.0             # Set to your station longitude (e.g. -105.065)

ALERT_RADIUS_KM = 40     # Trigger alert if strike is within this distance
GEOHASH_PRECISION = 4    # Length-4 cells (~39km x 20km) — do not change

# Public MQTT relay maintained by the homeassistant-blitzortung project.
# If this host ever stops responding, check:
# https://github.com/mrk-its/homeassistant-blitzortung for the current broker.
MQTT_BROKER = "blitzortung.ha.sed.pl"
MQTT_PORT = 1883
MQTT_KEEPALIVE = 60

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Geohash helpers
# ---------------------------------------------------------------------------

def get_subscription_cells(lat: float, lon: float, precision: int = GEOHASH_PRECISION) -> list[str]:
    """Return the home geohash cell plus all 8 neighbors."""
    home = gh.encode(lat, lon, precision)
    # get_adjacent uses "top","bottom","left","right" — build all 8 neighbors
    n  = gh.get_adjacent(home, "top")
    s  = gh.get_adjacent(home, "bottom")
    e  = gh.get_adjacent(home, "right")
    w  = gh.get_adjacent(home, "left")
    ne = gh.get_adjacent(n, "right")
    nw = gh.get_adjacent(n, "left")
    se = gh.get_adjacent(s, "right")
    sw = gh.get_adjacent(s, "left")
    cells = [home, n, ne, e, se, s, sw, w, nw]
    log.info("Home geohash: %s  |  Subscribing to %d cells: %s", home, len(cells), cells)
    return cells

# ---------------------------------------------------------------------------
# Distance
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in kilometres between two lat/lon points."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1))
         * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

# ---------------------------------------------------------------------------
# Alert / action hook
# ---------------------------------------------------------------------------

def on_strike_nearby(distance_km: float, bearing_deg: float, lat: float, lon: float) -> None:
    """
    Called whenever a strike falls within ALERT_RADIUS_KM.
    Replace or extend this function with your shack automation logic,
    e.g. python-kasa commands, GPIO triggers, HTTP callbacks, etc.
    """
    log.warning(
        "⚡ STRIKE  %.1f km  bearing %.0f°  (%.4f, %.4f)",
        distance_km, bearing_deg, lat, lon,
    )
    # --- Example: python-kasa smart plug shutdown ---
    # import asyncio
    # from kasa import SmartPlug
    # async def _shutdown():
    #     plug = SmartPlug("192.168.1.xxx")
    #     await plug.update()
    #     await plug.turn_off()
    # asyncio.run(_shutdown())

# ---------------------------------------------------------------------------
# Bearing (informational)
# ---------------------------------------------------------------------------

def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Initial bearing from point 1 to point 2, in degrees (0–360)."""
    dlon = math.radians(lon2 - lon1)
    x = math.sin(dlon) * math.cos(math.radians(lat2))
    y = (math.cos(math.radians(lat1)) * math.sin(math.radians(lat2))
         - math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(dlon))
    return (math.degrees(math.atan2(x, y)) + 360) % 360

# ---------------------------------------------------------------------------
# MQTT callbacks
# ---------------------------------------------------------------------------

def on_connect(client: mqtt.Client, userdata: dict, flags, rc, properties=None) -> None:
    if rc != 0:
        log.error("MQTT connection failed, return code %d", rc)
        return
    log.info("Connected to MQTT broker %s:%d", MQTT_BROKER, MQTT_PORT)
    cells = get_subscription_cells(MY_LAT, MY_LON)
    for cell in cells:
        topic = f"blitzortung/1.1/{'/'.join(cell)}/#"
        client.subscribe(topic, qos=0)
        log.debug("Subscribed: %s", topic)
    userdata["cells"] = cells


def on_disconnect(client: mqtt.Client, userdata: dict, flags, rc, properties=None) -> None:
    if rc != 0:
        log.warning("Unexpected MQTT disconnect (rc=%d), will auto-reconnect…", rc)


def on_message(client: mqtt.Client, userdata: dict, msg: mqtt.MQTTMessage) -> None:
    try:
        strike = json.loads(msg.payload)
        strike_lat = strike["lat"]
        strike_lon = strike["lon"]
    except (json.JSONDecodeError, KeyError):
        return

    dist = haversine_km(MY_LAT, MY_LON, strike_lat, strike_lon)
    brng = bearing_deg(MY_LAT, MY_LON, strike_lat, strike_lon)

    log.debug("Strike  %.1f km  bearing %.0f°  (%.4f, %.4f)", dist, brng, strike_lat, strike_lon)

    if dist <= ALERT_RADIUS_KM:
        on_strike_nearby(dist, brng, strike_lat, strike_lon)

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def resolve_ipv4(hostname: str, port: int) -> str:
    """Resolve hostname to an IPv4 address, avoiding IPv6 on systems that don't support it."""
    results = socket.getaddrinfo(hostname, port, socket.AF_INET, socket.SOCK_STREAM)
    if not results:
        raise OSError(f"Could not resolve {hostname} to an IPv4 address")
    ipv4 = results[0][4][0]
    log.info("Resolved %s → %s (IPv4)", hostname, ipv4)
    return ipv4


def main() -> None:
    log.info("Blitzortung lightning monitor starting")
    log.info("Home: %.4f, %.4f  |  Alert radius: %d km", MY_LAT, MY_LON, ALERT_RADIUS_KM)

    # CallbackAPIVersion.VERSION2 silences the paho-mqtt 2.x deprecation warning
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, userdata={})
    client.on_connect = on_connect
    client.on_disconnect = on_disconnect
    client.on_message = on_message

    while True:
        try:
            ipv4_host = resolve_ipv4(MQTT_BROKER, MQTT_PORT)
            client.connect(ipv4_host, MQTT_PORT, keepalive=MQTT_KEEPALIVE)
            client.loop_forever()           # blocks; handles reconnects internally
        except OSError as exc:
            log.error("Network error: %s — retrying in 30 s", exc)
            time.sleep(30)


if __name__ == "__main__":
    main()
