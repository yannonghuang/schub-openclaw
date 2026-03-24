from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from datetime import datetime, timezone
from typing import Optional
from pydantic import BaseModel

from utils.database import get_session
from data.models import Span

router = APIRouter()


class SpanCreate(BaseModel):
    id: str
    trace_id: str
    parent_id: Optional[str] = None
    name: str
    kind: str
    business_id: int
    started_at: datetime
    ended_at: Optional[datetime] = None
    status: Optional[str] = None
    update_event_id: Optional[int] = None
    thread_id: Optional[str] = None
    attributes: Optional[dict] = None


class SpanPatch(BaseModel):
    ended_at: Optional[datetime] = None
    status: Optional[str] = None
    attributes: Optional[dict] = None


@router.post("/spans", status_code=201)
async def create_span(body: SpanCreate, session: AsyncSession = Depends(get_session)):
    stmt = pg_insert(Span).values(**body.model_dump()).on_conflict_do_nothing(index_elements=["id"])
    await session.execute(stmt)
    await session.commit()
    return {"id": body.id}


@router.patch("/spans/{span_id}")
async def update_span(
    span_id: str, body: SpanPatch, session: AsyncSession = Depends(get_session)
):
    span = await session.get(Span, span_id)
    if not span:
        raise HTTPException(status_code=404, detail="Span not found")
    if body.ended_at is not None:
        span.ended_at = body.ended_at
    if body.status is not None:
        span.status = body.status
    if body.attributes is not None:
        span.attributes = {**(span.attributes or {}), **body.attributes}
    await session.commit()
    return {"id": span.id}


@router.get("/trace/{trace_id}")
async def get_trace(trace_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        select(Span).where(Span.trace_id == trace_id).order_by(Span.started_at)
    )
    spans = result.scalars().all()

    if not spans:
        return {"trace_id": trace_id, "spans": []}

    started = min(s.started_at for s in spans)
    ended = max((s.ended_at or s.started_at) for s in spans)

    return {
        "trace_id": trace_id,
        "started_at": started.isoformat(),
        "ended_at": ended.isoformat(),
        "spans": [
            {
                "id": s.id,
                "trace_id": s.trace_id,
                "parent_id": s.parent_id,
                "name": s.name,
                "kind": s.kind,
                "business_id": s.business_id,
                "started_at": s.started_at.isoformat(),
                "ended_at": s.ended_at.isoformat() if s.ended_at else None,
                "status": s.status,
                "update_event_id": s.update_event_id,
                "thread_id": s.thread_id,
                "attributes": s.attributes or {},
            }
            for s in spans
        ],
    }
