from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from dependencies import get_db, get_current_user
from models import User, ShellyDevice, ShellyChannel
from schemas import (
    ShellyDeviceCreate, ShellyDeviceUpdate, ShellyChannelUpdate,
    ShellyDeviceResponse, ShellyChannelResponse,
)
from services import shelly_service

router = APIRouter(prefix="/shelly", tags=["shelly"])


# ── Devices ──────────────────────────────────────────────────────────────────

@router.get("/devices", response_model=list[ShellyDeviceResponse])
async def list_devices(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(ShellyDevice)
        .options(selectinload(ShellyDevice.channels))
        .order_by(ShellyDevice.name)
    )
    return result.scalars().all()


@router.post("/devices", response_model=ShellyDeviceResponse, status_code=201)
async def create_device(
    body: ShellyDeviceCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if body.channel_count < 1 or body.channel_count > 8:
        raise HTTPException(status_code=400, detail="channel_count must be between 1 and 8")
    device = ShellyDevice(name=body.name, ip_address=body.ip_address, channel_count=body.channel_count)
    db.add(device)
    await db.flush()
    for i in range(body.channel_count):
        db.add(ShellyChannel(device_id=device.id, channel_index=i))
    await db.commit()
    result = await db.execute(
        select(ShellyDevice).options(selectinload(ShellyDevice.channels)).where(ShellyDevice.id == device.id)
    )
    return result.scalar_one()


@router.put("/devices/{device_id}", response_model=ShellyDeviceResponse)
async def update_device(
    device_id: int,
    body: ShellyDeviceUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ShellyDevice).where(ShellyDevice.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    if body.name is not None:
        device.name = body.name
    if body.ip_address is not None:
        device.ip_address = body.ip_address
    await db.commit()
    result = await db.execute(
        select(ShellyDevice).options(selectinload(ShellyDevice.channels)).where(ShellyDevice.id == device_id)
    )
    return result.scalar_one()


@router.delete("/devices/{device_id}", status_code=204)
async def delete_device(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ShellyDevice).where(ShellyDevice.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.delete(device)
    await db.commit()


@router.get("/devices/{device_id}/states")
async def get_device_states(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ShellyDevice).where(ShellyDevice.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    try:
        return await shelly_service.get_channel_states(device.ip_address, device.channel_count)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/devices/{device_id}/test")
async def test_device(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ShellyDevice).where(ShellyDevice.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    try:
        return await shelly_service.test_device(device.ip_address, device.channel_count)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ── Channels ─────────────────────────────────────────────────────────────────

@router.get("/channels", response_model=list[ShellyChannelResponse])
async def list_channels(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(
        select(ShellyChannel)
        .join(ShellyDevice)
        .order_by(ShellyDevice.name, ShellyChannel.channel_index)
    )
    return result.scalars().all()


@router.put("/channels/{channel_id}", response_model=ShellyChannelResponse)
async def update_channel(
    channel_id: int,
    body: ShellyChannelUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ShellyChannel).where(ShellyChannel.id == channel_id))
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    if body.label is not None:
        channel.label = body.label
    if body.show_on_dashboard is not None:
        channel.show_on_dashboard = body.show_on_dashboard
    await db.commit()
    await db.refresh(channel)
    return channel


@router.post("/channels/{channel_id}/control")
async def control_channel(
    channel_id: int,
    body: dict,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    action = body.get("action", "")
    if action not in ("on", "off"):
        raise HTTPException(status_code=400, detail="Action must be 'on' or 'off'")
    result = await db.execute(
        select(ShellyChannel)
        .options(selectinload(ShellyChannel.device))
        .where(ShellyChannel.id == channel_id)
    )
    channel = result.scalar_one_or_none()
    if not channel:
        raise HTTPException(status_code=404, detail="Channel not found")
    try:
        await shelly_service.control_channel(channel.device.ip_address, channel.channel_index, action)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
