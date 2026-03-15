"""
Shelly Gen 1 HTTP API client.

All Shelly Gen 1 devices expose a simple REST API on port 80:
  GET /shelly               → device info (type, mac, fw, auth)
  GET /status               → full status including relays[{ison, ...}]
  GET /relay/{ch}           → single relay status
  GET /relay/{ch}?turn=on   → turn relay on  (also accepts POST with body turn=on)
  GET /relay/{ch}?turn=off  → turn relay off
"""

import aiohttp

_TIMEOUT = aiohttp.ClientTimeout(total=5)


async def get_channel_states(ip_address: str, channel_count: int) -> list[dict]:
    """Return [{channel_index, is_on}, ...] for all relay channels."""
    url = f"http://{ip_address}/status"
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=_TIMEOUT) as resp:
            resp.raise_for_status()
            data = await resp.json()
    relays = data.get("relays", [])
    return [
        {
            "channel_index": i,
            "is_on": relays[i].get("ison", False) if i < len(relays) else False,
        }
        for i in range(channel_count)
    ]


async def control_channel(ip_address: str, channel_index: int, action: str) -> None:
    """Turn a relay channel on or off. action must be 'on' or 'off'."""
    url = f"http://{ip_address}/relay/{channel_index}?turn={action}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=_TIMEOUT) as resp:
            resp.raise_for_status()


async def test_device(ip_address: str, channel_count: int) -> dict:
    """Test connectivity; return device info and relay states."""
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://{ip_address}/shelly", timeout=_TIMEOUT) as resp:
            resp.raise_for_status()
            info = await resp.json()
        async with session.get(f"http://{ip_address}/status", timeout=_TIMEOUT) as resp:
            resp.raise_for_status()
            status = await resp.json()

    relays = status.get("relays", [])
    states = [
        {"channel_index": i, "is_on": relays[i].get("ison", False) if i < len(relays) else False}
        for i in range(channel_count)
    ]
    return {"info": info, "states": states}
