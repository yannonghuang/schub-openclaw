# worker.py
import asyncio
import json
from datetime import datetime
from typing import Dict, Set
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from utils.redis_client import get_redis
from utils.database import AsyncSessionLocal
from data.models import Message as MessageModel, Channel as ChannelModel, UpdateEvent, Span

import logging
logger = logging.getLogger(__name__)

# Simple in-memory mapping of channel -> set of websocket send coroutines
# Main app will register/unregister websocket connections into this registry.
websocket_registry: Dict[str, Set] = {}  # channel -> set of websocket objects

async def register_ws(channel: str, ws):
    websocket_registry.setdefault(channel, set()).add(ws)

async def unregister_ws(channel: str, ws):
    if channel in websocket_registry:
        websocket_registry[channel].discard(ws)
        if not websocket_registry[channel]:
            del websocket_registry[channel]

async def broadcast_to_channel(channel: str, payload: str):
    if channel not in websocket_registry:
        return
    dead = []
    for ws in list(websocket_registry[channel]):
        try:
            await ws.send_text(payload)
        except Exception:
            # mark dead
            dead.append((channel, ws))
    # cleanup dead
    for ch, ws in dead:
        await unregister_ws(ch, ws)

# Core worker - pattern subscribe to business:*:channel
async def redis_pubsub_worker(stop_event: asyncio.Event):
    logger.info("entering redis_pubsub_worker ...")
    r = get_redis()
    # ensure client exists
    p = r.pubsub()
    await p.psubscribe("business*channel")
    print("Worker: subscribed to pattern business*channel", flush=True)
    try:
        async for msg in p.listen():
            print("Got something ...", flush=True)
            if stop_event.is_set():
                break
            # msg can be: {'type': 'pmessage', 'pattern': 'business:*:channel', 'channel': 'business:123:channel', 'data': '...'}
            try:
                if msg is None:
                    continue
                typ = msg.get("type")
                if typ not in ("message", "pmessage"):
                    continue
                channel = msg.get("channel") or msg.get("pattern")
                data = msg.get("data")
                if not channel or not data:
                    continue
                # data may be already str
                payload = json.loads(data) if isinstance(data, str) else data
                payload = json.loads(payload.get("text")) if "text" in payload else payload
                # persist to db
                await persist_message(channel, payload)
                # broadcast to websockets
                await broadcast_to_channel(channel, json.dumps(payload))
            except Exception as e:
                print("worker loop error:", e, flush=True)
    finally:
        try:
            await p.punsubscribe("business:*channel")
            await p.close()
        except Exception:
            pass

def is_update_message(payload: dict) -> bool:
    print(f"is_update_message(), json.dumps(payload) = {json.dumps(payload)}", flush=True)
    return (
        payload.get("type") in ["WIP", "Planning", "Order", "Material"]
        and "materials" in payload
    )

async def persist_message(channel: str, payload: dict):
    async with AsyncSessionLocal() as session:
        print("in persist_message(), ready to persist Message...", flush=True)

        # retain only the intended recipient
        tokens = channel.split(":")
        if (len(tokens) > 4 and "recipients" in payload):
            payload["recipients"] = [int(tokens[-2])]
            print(f"in persist_message(), separate recipients {tokens[-2]}", flush=True)

        msg = MessageModel(
            channel=channel,
            business_id=payload.get("source"),
            payload=payload,
            #text_content=payload.get("text"),
        )
        session.add(msg)
        await session.flush()  # get msg.id

        if is_update_message(payload):
            await persist_update_event(session, msg, payload)

        await session.commit()


async def persist_update_event(
    session: AsyncSession,
    message: MessageModel,
    payload: dict,
):
    print("in persist_update_event(), ready to persist update_event...", flush=True)
    update_event = UpdateEvent(
        msg_id=message.id, # linked to messages table
        business_id=payload["source"],
        event_type=payload["type"],
        target=payload["target"],
        materials=payload.get("materials", []),
        quantity_decrease_percentage=payload.get(
            "quantity_decrease_percentage"
        ),
        delivery_delay_days=payload.get("delivery_delay_days"),
        source_business_id=payload.get("source"),
        created_at=message.created_at,

        recipient_business_id=payload.get("recipients")[0],
        message_id=payload["message_id"]
    )

    session.add(update_event)
    await session.flush()  # assigns update_event.id

    try:
        root_span = Span(
            id=f"root-{update_event.message_id}",
            trace_id=str(update_event.message_id),
            parent_id=None,
            name=f"event:{update_event.event_type}",
            kind="event",
            business_id=update_event.recipient_business_id,
            started_at=update_event.created_at or datetime.utcnow(),
            ended_at=update_event.created_at or datetime.utcnow(),
            status="ok",
            update_event_id=update_event.id,
            attributes={
                "source_business_id": update_event.source_business_id,
                "recipient_business_id": update_event.recipient_business_id,
                "materials": update_event.materials,
                "delivery_delay_days": update_event.delivery_delay_days,
                "quantity_decrease_percentage": update_event.quantity_decrease_percentage,
            },
        )
        session.add(root_span)
    except Exception as e:
        print(f"[worker] root span emission failed (non-fatal): {e}", flush=True)
