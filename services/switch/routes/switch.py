from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, Header
from fastapi.responses import StreamingResponse
from data.schemas import Message
from utils.redis import publish_message, get_redis_client, get_events_since
import json
import asyncio
import time
import contextlib
import os

EMAIL_NODE = os.getenv("EMAIL_NODE", "-2")
AGUI_EVENT_TTL = int(os.getenv("AGUI_EVENT_TTL", "3600"))  # 1 hour

PING_TIMEOUT = 30  # seconds
REDIS_POLL_INTERVAL = 1.0

router = APIRouter()

@router.post("/publish")
async def publish(msg: Message):
    print("publish received a request ...")
    for recipient in msg.recipients:
        channel = f"business:{recipient}:channel"
        await publish_message(channel, {"from": msg.sender, "text": msg.content})
    return {"status": "ok"}

# --- AG-UI SSE subscribe ---
@router.get("/sse/{business_id}")
async def agui_sse(
    business_id: str,
    request: Request,
    last_event_id: str | None = Header(None, alias="last-event-id"),
):
    """AG-UI SSE endpoint. Streams events as text/event-stream with monotonic IDs.
    Supports Last-Event-ID header for replay on reconnect (up to 200 missed events, 1h TTL).
    """
    redis_client = await get_redis_client()

    async def event_generator():
        # 1. Replay missed events if Last-Event-ID provided
        if last_event_id and last_event_id.isdigit():
            missed = await get_events_since(business_id, int(last_event_id))
            for seq, payload in missed:
                yield f"id: {seq}\ndata: {payload}\n\n"

        # 2. Send a keepalive comment so nginx/browsers don't time out immediately
        yield ": keepalive\n\n"

        # 3. Live delivery from the shared EMAIL_NODE Redis stream
        stream_key = f"stream:business:{EMAIL_NODE}:channel"
        last_id = "$"  # start from tail (live events only)

        while True:
            if await request.is_disconnected():
                break

            try:
                results = await redis_client.xread(
                    {stream_key: last_id}, block=5000, count=10
                )
            except Exception as e:
                print(f"[SSE] Redis xread error: {e}")
                break

            if not results:
                # Send keepalive comment to prevent proxy timeout
                yield ": keepalive\n\n"
                continue

            for _, messages in results:
                for msg_id, msg_data in messages:
                    last_id = msg_id
                    try:
                        raw = json.loads(msg_data["message"])
                    except (KeyError, json.JSONDecodeError):
                        continue

                    # Unwrap switch-service envelope: {"from": ..., "text": "<json>"}
                    payload = raw.get("text", raw)
                    if isinstance(payload, str):
                        try:
                            payload = json.loads(payload)
                        except json.JSONDecodeError:
                            continue

                    # Filter to this business_id
                    biz = (
                        payload.get("business_id")
                        or payload.get("value", {}).get("businessId")
                    )
                    if biz is not None and str(biz) != business_id:
                        continue

                    # Assign monotonic sequence ID
                    seq = await redis_client.incr(f"agui:seq:{business_id}")
                    encoded = json.dumps(payload)
                    await redis_client.setex(
                        f"agui:event:{business_id}:{seq}", AGUI_EVENT_TTL, encoded
                    )

                    print(f"[SSE] → business_id={business_id} seq={seq} type={payload.get('type')}")
                    yield f"id: {seq}\ndata: {encoded}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# --- WebSocket subscribe (Redis Stream version) ---
@router.websocket("/ws/{business_id}")
async def websocket_stream_endpoint(websocket: WebSocket, business_id: str):
    subscriber_id = websocket.query_params.get("subscriber_id") or ""
    print(f"stream subscribe received a request ... subscriber_id = {subscriber_id}")
    await websocket.accept()

    last_ping = time.time()

    async def heartbeat_receiver():
        nonlocal last_ping
        try:
            while True:
                msg = await websocket.receive_text()
                try:
                    data = json.loads(msg)
                except Exception:
                    continue

                if data.get("type") == "ping":
                    last_ping = time.time()
                    await websocket.send_text(json.dumps({"type": "pong"}))
                    print(f"Ping received, Pong sent")
        except Exception:
            pass

    heartbeat_task = asyncio.create_task(heartbeat_receiver())

    channel = f"business:{business_id}:channel"
    stream_key = f"stream:{channel}" # to be consistent with publisher    
    redis_client = await get_redis_client()

    pos_key = f"subpos:{stream_key}:{subscriber_id}"

    # 1. Load last position if exists
    last_id = await redis_client.get(pos_key)

    if last_id is None:
        # 2. First-time subscriber → start from stream tail
        try:
            info = await redis_client.xinfo_stream(stream_key)
            last_id = info["last-generated-id"]
        except Exception:
            last_id = "0-0"  # stream does not exist yet
    else:
        if isinstance(last_id, bytes):
            last_id = last_id.decode()

    #last_id = "$"  # "$" = new messages only; use "0" to replay from start
    
    try:
        while True:
            resp = await redis_client.xread(
                {stream_key: last_id}, 
                #block=0,
                #count=None
                block=int(REDIS_POLL_INTERVAL * 5000),
                count=10
            )

            if not resp:
                continue

            last_msg_id = None

            # xread returns a list of (stream_key, [(id, {field: value})]) tuples
            #print(f"resp = await redis_client.xread(): resp = {resp}")
            for stream_name, messages in resp:
                for msg_id, msg_data in messages:
                    # send message over websocket
                    await websocket.send_text(msg_data["message"])
                    print(f"sent message over websocket: stream_name = {stream_name}, msg_id ={msg_id}")
                    last_msg_id = msg_id
            
            # advance cursor only if we received messages
            if last_msg_id:
                last_id = last_msg_id
                await redis_client.set(pos_key, last_id)

            print("ready for next batch ...")            
    except WebSocketDisconnect:
        print(f"WebSocket disconnected: {business_id}")
    except Exception:
        pass
    finally:
        heartbeat_task.cancel()

        with contextlib.suppress(asyncio.CancelledError):
            await heartbeat_task