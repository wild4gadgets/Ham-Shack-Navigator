from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from dependencies import get_db, get_current_user
from models import User, KasaPort, ShellyChannel

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/pins")
async def get_pins(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    kasa_result = await db.execute(
        select(KasaPort)
        .options(selectinload(KasaPort.device))
        .where(KasaPort.show_on_dashboard == True)
        .order_by(KasaPort.device_id, KasaPort.port_index)
    )
    shelly_result = await db.execute(
        select(ShellyChannel)
        .options(selectinload(ShellyChannel.device))
        .where(ShellyChannel.show_on_dashboard == True)
        .order_by(ShellyChannel.device_id, ShellyChannel.channel_index)
    )
    kasa_ports = kasa_result.scalars().all()
    shelly_channels = shelly_result.scalars().all()
    return {
        "kasa": [
            {
                "id": p.id,
                "port_index": p.port_index,
                "label": p.label,
                "device_id": p.device.id,
                "device_ip": p.device.ip_address,
                "device_type": p.device.device_type,
                "device_name": p.device.name,
            }
            for p in kasa_ports
        ],
        "shelly": [
            {
                "id": c.id,
                "channel_index": c.channel_index,
                "label": c.label,
                "device_id": c.device.id,
                "device_ip": c.device.ip_address,
                "device_name": c.device.name,
            }
            for c in shelly_channels
        ],
    }
