import math
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_

from dependencies import get_db, get_current_user
from models import User, Event
from schemas import EventsPage, EventResponse

router = APIRouter(prefix="/events", tags=["events"])


@router.get("", response_model=EventsPage)
async def list_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    event_type: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    filters = []
    if event_type:
        filters.append(Event.event_type == event_type)
    if severity:
        filters.append(Event.severity == severity)
    if date_from:
        from datetime import datetime
        filters.append(Event.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        from datetime import datetime
        filters.append(Event.created_at <= datetime.fromisoformat(date_to))

    where = and_(*filters) if filters else None

    # Count
    count_q = select(func.count()).select_from(Event)
    if where is not None:
        count_q = count_q.where(where)
    total_result = await db.execute(count_q)
    total = total_result.scalar()

    # Fetch
    offset = (page - 1) * page_size
    q = select(Event).order_by(Event.created_at.desc()).offset(offset).limit(page_size)
    if where is not None:
        q = q.where(where)
    result = await db.execute(q)
    items = result.scalars().all()

    return EventsPage(
        items=[
            EventResponse(
                id=e.id,
                event_type=e.event_type,
                severity=e.severity,
                message=e.message,
                meta=e.meta,
                created_at=e.created_at.isoformat(),
            )
            for e in items
        ],
        total=total,
        page=page,
        page_size=page_size,
        pages=max(1, math.ceil(total / page_size)),
    )
