from fastapi import APIRouter, Query, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc, select, exists
from datetime import datetime, datetime, timedelta, timezone
from typing import List

from .query import base_update_event_query, apply_update_event_filters
from utils.database import init_db, AsyncSessionLocal, engine, get_session
from data.models import UpdateEvent, Message, Thread, ThreadMessage

router = APIRouter()

@router.get("/")
async def search_update_events(
    business_id: int | None = None,
    recipient_business_id: int | None = None,
    event_type: str | None = None,
    message_id: str | None = None,
    target: str | None = None,
    material: str | None = None,
    source_business_id: int | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = Query(20, le=200),
    cursor: datetime | None = None,
    session: AsyncSession = Depends(get_session),
):
    q = base_update_event_query()

    q = apply_update_event_filters(
        q,
        business_id=business_id,
        recipient_business_id=recipient_business_id,
        event_type=event_type,
        message_id=message_id,
        target=target,
        material=material,
        source_business_id=source_business_id,
        start_time=start,
        end_time=end,
    )

    # Cursor pagination (time-based)
    if cursor:
        q = q.where(UpdateEvent.created_at < cursor)

    q = q.order_by(desc(UpdateEvent.created_at)).limit(limit + 1)

    rows = (await session.execute(q)).scalars().all()

    next_cursor = None
    if len(rows) > limit:
        next_cursor = rows[-1].created_at
        rows = rows[:limit]

    return {
        "items": [
            {
                "id": e.id,
                "created_at": e.created_at,
                "event_type": e.event_type,
                "message_id": e.message_id,
                "target": e.target,
                "materials": e.materials,
                "quantity_decrease_percentage": e.quantity_decrease_percentage,
                "delivery_delay_days": e.delivery_delay_days,
                "source_business_id": e.source_business_id,
                "recipient_business_id": e.recipient_business_id,
                "color": event_color(e),  # ✅ ADD THIS
            }
            for e in rows
        ],
        "next_cursor": next_cursor,
    }

@router.get("/{event_id}/trace")
async def trace_update_event(
    event_id: int,
    session: AsyncSession = Depends(get_session),
):
    # 1️⃣ fetch update event
    result = await session.execute(
        select(UpdateEvent).where(UpdateEvent.id == event_id)
    )
    event: UpdateEvent | None = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="UpdateEvent not found")

    # 2️⃣ compute external_thread_id
    external_thread_id = f"{event.event_type}:{event.message_id}"

    print(f"in trace_update_event(), event_id={event_id}, fetched update event {external_thread_id}", flush=True)

    # 3️⃣ fetch the thread
    result = await session.execute(
        select(Thread)
        .where(Thread.business_id == event.recipient_business_id)
        .where(Thread.external_thread_id == external_thread_id)
    )
    thread: Thread | None = result.scalar_one_or_none()
    #if not thread:
    #    raise HTTPException(status_code=404, detail="Thread not found")
    if not thread:
        return {
            "thread": None,
            "messages": [],
            "warning": "No thread found for this event"
        }
    
    print(f"in trace_update_event(), event_id={event_id}, fetched thread {thread.thread_id}", flush=True)

    # 4️⃣ fetch thread messages (ordered by creation time)
    messages_result = await session.execute(
        select(ThreadMessage)
        .where(ThreadMessage.thread_id == thread.id)
        .order_by(ThreadMessage.created_at)
    )
    messages: List[ThreadMessage] = messages_result.scalars().all()

    print(f"in trace_update_event(), event_id={event_id}, fetched thread messages {len(messages)}", flush=True)

    return {
        "thread": {
            "id": thread.id,
            "external_thread_id": thread.external_thread_id,
            "title": thread.title,
            "fingerprint": thread.fingerprint,
            "initial_message": thread.initial_message,
            "created_at": thread.created_at.isoformat() if thread.created_at else None,
        },
        "messages": [m.to_dict() for m in messages],
    }



@router.get("/{event_id}/graph")
async def get_audit_event_graph(
    event_id: int,
    session: AsyncSession = Depends(get_session),
    #db: AsyncSession,
):
    # --- Load event ---
    event = await session.get(UpdateEvent, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Audit event not found")

    nodes = []
    edges = []

    # --- Event node ---
    event_node_id = f"event:{event.id}"
    nodes.append({
        "id": event_node_id,
        "type": "event",
        "label": f"agent@{event.event_type}",
        "data": {
            "id": event.id,
            "event_type": event.event_type,
            "created_at": event.created_at.isoformat() if event.created_at else None,
            "message_id": event.message_id,
            "recipient_business_id": event.recipient_business_id,
        },
        "color": event_color(event),
    })

    # --- Resolve corresponding thread ---
    external_thread_id = f"{event.event_type}:{event.message_id}"

    print(f"in get_audit_event_graph(), event_id={event_id}, fetched update event {external_thread_id}", flush=True)
    
    thread = await session.scalar(
        select(Thread).where(
            Thread.business_id == event.recipient_business_id,
            Thread.external_thread_id == external_thread_id,
        )
    )

    if not thread:
        # Valid state: event exists but no AI trace
        return {"nodes": nodes, "edges": edges}
    
    print(f"in get_audit_event_graph(), event_id={event_id}, fetched thread {thread.thread_id}", flush=True)
    
    # --- Thread node ---
    thread_node_id = f"thread:{thread.id}"
    has_agent = False

    edges.append({
        "from": event_node_id,
        "to": thread_node_id,
        "type": "triggers",
    })

    # --- Messages ---
    result = await session.scalars(
        select(ThreadMessage)
        .where(ThreadMessage.thread_id == thread.id)
        .order_by(ThreadMessage.created_at)
    )

    print(f"in get_audit_event_graph(), event_id={event_id}, fetched thread messages {result}", flush=True)

    for msg in result:
        msg_node_id = f"msg:{msg.id}"
        nodes.append({
            "id": msg_node_id,
            "type": "message",
            "label": f"{msg.role}@{msg.created_at.isoformat() if msg.created_at else None}",
            "data": msg.to_dict(),
            "color": ROLE_COLORS.get(msg.role, "#6b7280"),
        })

        if (msg.role == 'ai'):
            has_agent = True

        edges.append({
            "from": thread_node_id,
            "to": msg_node_id,
            "type": "contains",
        })

    nodes.append({
        "id": thread_node_id,
        "type": "thread",
        "label": f"thread@{thread.external_thread_id or thread.thread_id}",
        "data": {
            "id": thread.id,
            "thread_id": thread.thread_id,
            "external_thread_id": thread.external_thread_id,
            "title": thread.title,
            "created_at": thread.created_at.isoformat() if thread.created_at else None,
        },
        "color": thread_color_from_flag(has_agent),
    })

    return {
        "nodes": nodes,
        "edges": edges,
    }

############ color coding routines ################
def event_color(e: UpdateEvent) -> str:
    if e.delivery_delay_days and e.delivery_delay_days > 0:
        return "#cb0b0bff"  # red
    if e.quantity_decrease_percentage and e.quantity_decrease_percentage > 0:
        return "#f97316"  # orange
    return "#3b82f6"      # blue

def thread_color_from_flag(has_agent: bool) -> str:
    return "#22c55e" if has_agent else "#9ca3af"

ROLE_COLORS = {
    "ai": "#22c55e",
    "human": "#3b82f6",
    "tool": "#a855f7",
}
