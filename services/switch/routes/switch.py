from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from data.schemas import Message
from utils.redis import publish_message, get_redis_client
import json
import asyncio
import time
import contextlib

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