from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from dependencies import get_db, get_current_user
from models import User, KasaDevice, KasaPort
from schemas import (
    KasaDeviceCreate, KasaDeviceUpdate, KasaPortUpdate, KasaPortControl,
    KasaDeviceResponse, KasaPortResponse
)
from services import kasa_service

router = APIRouter(prefix="/kasa", tags=["kasa"])


async def _load_devices(db: AsyncSession) -> list[KasaDevice]:
    result = await db.execute(
        select(KasaDevice).options(selectinload(KasaDevice.ports)).order_by(KasaDevice.id)
    )
    return result.scalars().all()


@router.get("/devices", response_model=list[KasaDeviceResponse])
async def list_devices(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    return await _load_devices(db)


@router.post("/devices", response_model=KasaDeviceResponse, status_code=201)
async def add_device(body: KasaDeviceCreate, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    device = KasaDevice(
        name=body.name,
        device_type=body.device_type,
        ip_address=body.ip_address,
        port_count=body.port_count,
    )
    db.add(device)
    await db.flush()

    # Create port records
    port_count = body.port_count if body.device_type == "strip" and body.port_count else 1
    for i in range(port_count):
        port = KasaPort(device_id=device.id, port_index=i)
        db.add(port)

    await db.commit()
    await db.refresh(device)

    result = await db.execute(
        select(KasaDevice).options(selectinload(KasaDevice.ports)).where(KasaDevice.id == device.id)
    )
    return result.scalar_one()


@router.put("/devices/{device_id}", response_model=KasaDeviceResponse)
async def update_device(
    device_id: int, body: KasaDeviceUpdate,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(
        select(KasaDevice).options(selectinload(KasaDevice.ports)).where(KasaDevice.id == device_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if body.name is not None:
        device.name = body.name
    if body.ip_address is not None:
        device.ip_address = body.ip_address
    await db.commit()
    return device


@router.delete("/devices/{device_id}", status_code=204)
async def delete_device(device_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(KasaDevice).where(KasaDevice.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()


@router.get("/devices/{device_id}/states")
async def get_device_states(device_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(KasaDevice).where(KasaDevice.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    try:
        states = await kasa_service.get_port_states(device.ip_address, device.device_type)
        return {"success": True, "port_states": states}
    except Exception as e:
        return {"success": False, "error": str(e), "port_states": []}


@router.post("/devices/{device_id}/test")
async def test_device(device_id: int, db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(KasaDevice).where(KasaDevice.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    try:
        states = await kasa_service.get_port_states(device.ip_address, device.device_type)
        return {"success": True, "port_states": states}
    except Exception as e:
        return {"success": False, "error": str(e)}


@router.get("/ports", response_model=list[KasaPortResponse])
async def list_ports(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(KasaPort).order_by(KasaPort.device_id, KasaPort.port_index))
    return result.scalars().all()


@router.put("/ports/{port_id}", response_model=KasaPortResponse)
async def update_port(
    port_id: int, body: KasaPortUpdate,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(select(KasaPort).where(KasaPort.id == port_id))
    port = result.scalar_one_or_none()
    if not port:
        raise HTTPException(status_code=404, detail="Port not found")
    if body.label is not None:
        port.label = body.label
    if body.show_on_dashboard is not None:
        port.show_on_dashboard = body.show_on_dashboard
    await db.commit()
    return port


@router.post("/ports/{port_id}/control")
async def control_port(
    port_id: int, body: KasaPortControl,
    db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)
):
    result = await db.execute(
        select(KasaPort).options(selectinload(KasaPort.device)).where(KasaPort.id == port_id)
    )
    port = result.scalar_one_or_none()
    if not port:
        raise HTTPException(status_code=404, detail="Port not found")
    if body.action not in ("on", "off"):
        raise HTTPException(status_code=400, detail="Action must be 'on' or 'off'")
    try:
        await kasa_service.control_port(port.device.ip_address, port.device.device_type, port.port_index, body.action)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
