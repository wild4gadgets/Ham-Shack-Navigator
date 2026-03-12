"""
Kasa service: wraps python-kasa for device control.
"""
import logging
from kasa import SmartStrip, SmartPlug

logger = logging.getLogger(__name__)


async def get_device(ip_address: str, device_type: str):
    """Return an updated Kasa device object."""
    if device_type == "strip":
        device = SmartStrip(ip_address)
    else:
        device = SmartPlug(ip_address)
    await device.update()
    return device


async def get_port_states(ip_address: str, device_type: str) -> list[dict]:
    """Return list of {port_index, alias, is_on} for all ports."""
    try:
        device = await get_device(ip_address, device_type)
        if device_type == "strip":
            return [
                {
                    "port_index": i,
                    "alias": child.alias,
                    "is_on": child.is_on,
                }
                for i, child in enumerate(device.children)
            ]
        else:
            return [{"port_index": 0, "alias": device.alias, "is_on": device.is_on}]
    except Exception as e:
        logger.error("Kasa get_port_states error for %s: %s", ip_address, e)
        raise


async def control_port(ip_address: str, device_type: str, port_index: int, action: str) -> bool:
    """Turn a port on or off. Returns True on success."""
    try:
        device = await get_device(ip_address, device_type)
        if device_type == "strip":
            child = device.children[port_index]
            if action == "on":
                await child.turn_on()
            else:
                await child.turn_off()
        else:
            if action == "on":
                await device.turn_on()
            else:
                await device.turn_off()
        return True
    except Exception as e:
        logger.error("Kasa control_port error for %s port %d: %s", ip_address, port_index, e)
        raise
