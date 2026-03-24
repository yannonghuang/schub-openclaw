# main.py
import os
import asyncio
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, desc, func, MetaData, Table
from sqlalchemy.ext.asyncio import AsyncEngine
from utils.redis_client import get_redis, publish_and_stream
from worker import redis_pubsub_worker, register_ws, unregister_ws, websocket_registry
from datetime import datetime, datetime, timedelta, timezone
from typing import Optional, Literal, List, Dict
from sqlalchemy import text

from utils.database import init_db, AsyncSessionLocal, engine
from data.models import Message as MessageModel, Channel as ChannelModel

from routes import event, analytics, material, span as span_routes

import logging
logger = logging.getLogger(__name__)

app = FastAPI(title="Messages backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(event.router, prefix="/event", tags=["event"])
app.include_router(analytics.router, prefix="/analytics", tags=["analytics"])
app.include_router(material.router, prefix="/material", tags=["material"])
app.include_router(span_routes.router, tags=["spans"])

# lifecycle: start worker
worker_task = None
worker_stop = None

@app.on_event("startup")
async def startup():
    # create tables
    await init_db()
    # ensure redis connected
    get_redis()
    # start redis worker as background task
    global worker_task, worker_stop
    worker_stop = asyncio.Event()
    worker_task = asyncio.create_task(redis_pubsub_worker(worker_stop))
    logger.info("Started redis pubsub worker")
    print("Started redis pubsub worker", flush=True)

@app.on_event("shutdown")
async def shutdown():
    global worker_task, worker_stop
    if worker_stop:
        worker_stop.set()
    if worker_task:
        worker_task.cancel()
    # close redis
    r = get_redis()
    await r.close()

# -----------------------
# REST endpoints
# -----------------------
@app.get("/channels")
async def list_channels():
    async with AsyncSessionLocal() as session:
        q = await session.execute(select(ChannelModel).order_by(ChannelModel.created_at.desc()))
        rows = q.scalars().all()
        return [ {"name": r.name, "business_id": r.business_id, "created_at": r.created_at.isoformat() if r.created_at else None} for r in rows ]

@app.get("/messages")
async def list_messages(channel: str | None = Query(None), limit: int = 50, since: str | None = None):
    async with AsyncSessionLocal() as session:
        q = select(MessageModel)
        if channel:
            q = q.where(MessageModel.channel == channel)
        q = q.order_by(desc(MessageModel.created_at)).limit(limit)
        r = await session.execute(q)
        rows = r.scalars().all()
        return [ {"id": m.id, "channel": m.channel, "payload": m.payload, "text": m.text_content, "created_at": m.created_at.isoformat() if m.created_at else None} for m in rows ]


@app.get("/messages/distribution")
async def channel_distribution():
    async with AsyncSessionLocal() as session:
        q = select(MessageModel.channel, func.count().label("count")).group_by(MessageModel.channel)
        r = await session.execute(q)
        rows = r.all()
        return [{"channel": row[0], "count": row[1]} for row in rows]


@app.get("/messages/temporal")
async def temporal_distribution(
    granularity: Literal["hour", "day", "week"] = "week",
    start: Optional[str] = None,
    end: Optional[str] = None,
):
    start_dt = (
        datetime.fromisoformat(start.replace("Z", "+00:00"))
        if start else datetime.now(timezone.utc) - timedelta(days=28)
    )
    end_dt = (
        datetime.fromisoformat(end.replace("Z", "+00:00"))
        if end else datetime.now(timezone.utc)
    )

    # Define proper ISO timestamps for each granularity
    if granularity == "hour":
        group_expr = "to_char(date_trunc('hour', created_at), 'YYYY-MM-DD\"T\"HH24:00:00\"Z\"')"
    elif granularity == "day":
        group_expr = "to_char(date_trunc('day', created_at), 'YYYY-MM-DD\"T\"00:00:00\"Z\"')"
    else:  # week
        # ISO week (doesn't map to a single timestamp cleanly)
        group_expr = "to_char(date_trunc('week', created_at), 'IYYY-\"W\"IW')"

    query = text(f"""
        SELECT {group_expr} AS time, COUNT(*) AS count
        FROM messages
        WHERE created_at BETWEEN :start AND :end
        GROUP BY time
        ORDER BY time
    """)

    async with AsyncSessionLocal() as session:
        result = await session.execute(query, {"start": start_dt, "end": end_dt})
        rows = result.fetchall()

    return [{"time": r.time, "count": r.count} for r in rows]


metadata = MetaData()

async def get_businesses(async_engine: AsyncEngine) -> Table:
    """Reflect the 'businesses' table using an async connection."""
    def reflect(sync_conn):
        # Reflect synchronously inside async context
        return Table("businesses", metadata, autoload_with=sync_conn)

    async with async_engine.connect() as conn:
        table = await conn.run_sync(reflect)
        return table


@app.get("/messages/by_time")
async def messages_by_time(
    start: datetime = Query(..., description="Start of the time range (ISO format, UTC)"),
    end: datetime = Query(..., description="End of the time range (ISO format, UTC)"),
) -> List[Dict]:
    """
    Return all messages created between start and end timestamps,
    with the sender replaced by the business name (joined from businesses table).
    """
    if start >= end:
        raise HTTPException(status_code=400, detail="start must be before end")

    # Ensure timestamps are UTC-aware
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    #end = start + timedelta(hours=1)

    # Reflect the businesses table
    businesses = await get_businesses(engine)

    async with AsyncSessionLocal() as session:
        q = (
            select(
                MessageModel.id,
                MessageModel.text_content.label("content"),
                MessageModel.created_at,
                businesses.c.name.label("sender"),
            )
            .join(businesses, businesses.c.id == MessageModel.business_id)
            #.where(func.date_trunc('hour', MessageModel.created_at) == start)
            .where(MessageModel.created_at >= start)
            .where(MessageModel.created_at < end)
            .order_by(MessageModel.created_at)
        )

        result = await session.execute(q)
        rows = result.fetchall()
        #print(f"start = {start}, len(rows) = {len(rows)}")

    return [
        {
            "id": row.id,
            "timestamp": row.created_at.astimezone(timezone.utc).isoformat(),
            "sender": row.sender,
            "content": row.content,
        }
        for row in rows
    ]

@app.post("/publish")
async def publish_endpoint(sender: int = Query(...), channel: str | None = Query(None), recipients: list[str] | None = None, body: dict | None = None):
    """
    Example: POST /publish?sender=1
    JSON body: { "content": "hello", "recipients": ["business:2:channel"] }
    """
    payload = body or {}
    payload.setdefault("from", sender)
    if recipients:
        for ch in recipients:
            await publish_and_stream(ch, payload)
        return {"status":"ok","published_to":recipients}
    # fallback to channel param
    if channel:
        await publish_and_stream(channel, payload)
        return {"status":"ok","published_to":[channel]}
    return JSONResponse(status_code=400, content={"error":"no recipients or channel"})

# -----------------------
# WebSocket: client subscribes to channel(s)
# -----------------------
r = get_redis()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
#async def websocket_endpoint(websocket: WebSocket, pattern: str = Query(...)):
    """
    Example: ws://localhost:8000/ws?pattern=business:*:channel
    """
    pattern = "business:*:channel"
    await websocket.accept()
    pubsub = r.pubsub()
    await pubsub.psubscribe(pattern)

    try:
        async for message in pubsub.listen():
            if message["type"] == "pmessage":
                await websocket.send_json({
                    "pattern": message["pattern"],
                    "channel": message["channel"],
                    "data": message["data"]
                })
    finally:
        await pubsub.close()