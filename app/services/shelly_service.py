"""
Shelly HTTP API client supporting Gen 1 and Gen 2/3 devices.

Gen 1 API (legacy REST):
  GET /shelly                        → device info
  GET /status                        → full status; relays[{ison}]
  GET /relay/{ch}?turn=on|off        → control relay

Gen 2/3 API (JSON-RPC):
  GET /shelly                        → device info (includes "gen" field)
  GET /rpc/Shelly.GetStatus          → full status; "switch:N".output
  POST /rpc/Switch.Set               → body: {"id": N, "on": true|false}
"""

import aiohttp

_TIMEOUT = aiohttp.ClientTimeout(total=5)


async def get_channel_states(ip_address: str, channel_count: int, generation: int = 1) -> list[dict]:
    """Return [{channel_index, is_on}, ...] for all relay channels."""
    async with aiohttp.ClientSession() as session:
        if generation >= 2:
            url = f"http://{ip_address}/rpc/Shelly.GetStatus"
            async with session.get(url, timeout=_TIMEOUT) as resp:
                resp.raise_for_status()
                data = await resp.json()
            return [
                {
                    "channel_index": i,
                    "is_on": data.get(f"switch:{i}", {}).get("output", False),
                }
                for i in range(channel_count)
            ]
        else:
            url = f"http://{ip_address}/status"
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


async def control_channel(ip_address: str, channel_index: int, action: str, generation: int = 1) -> None:
    """Turn a relay channel on or off. action must be 'on' or 'off'."""
    async with aiohttp.ClientSession() as session:
        if generation >= 2:
            url = f"http://{ip_address}/rpc/Switch.Set"
            payload = {"id": channel_index, "on": action == "on"}
            async with session.post(url, json=payload, timeout=_TIMEOUT) as resp:
                resp.raise_for_status()
        else:
            url = f"http://{ip_address}/relay/{channel_index}?turn={action}"
            async with session.get(url, timeout=_TIMEOUT) as resp:
                resp.raise_for_status()


async def test_device(ip_address: str, channel_count: int) -> dict:
    """Test connectivity; auto-detect generation, return device info and relay states."""
    async with aiohttp.ClientSession() as session:
        async with session.get(f"http://{ip_address}/shelly", timeout=_TIMEOUT) as resp:
            resp.raise_for_status()
            info = await resp.json()

        generation = info.get("gen", 1)

        if generation >= 2:
            async with session.get(f"http://{ip_address}/rpc/Shelly.GetStatus", timeout=_TIMEOUT) as resp:
                resp.raise_for_status()
                status = await resp.json()
            states = [
                {"channel_index": i, "is_on": status.get(f"switch:{i}", {}).get("output", False)}
                for i in range(channel_count)
            ]
            # Normalize firmware field for frontend compatibility
            info.setdefault("fw", info.get("ver", info.get("fw_id", "")))
        else:
            async with session.get(f"http://{ip_address}/status", timeout=_TIMEOUT) as resp:
                resp.raise_for_status()
                status = await resp.json()
            relays = status.get("relays", [])
            states = [
                {"channel_index": i, "is_on": relays[i].get("ison", False) if i < len(relays) else False}
                for i in range(channel_count)
            ]

    return {"info": info, "states": states, "detected_generation": generation}
