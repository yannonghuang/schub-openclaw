from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from data.schemas import Message
from utils.redis import publish_message, get_redis_client, get_events_since
from datetime import datetime, timezone
import json
import asyncio
import time
import contextlib
import os
import uuid
import httpx

EMAIL_NODE     = os.getenv("EMAIL_NODE", "-2")
AGUI_EVENT_TTL = int(os.getenv("AGUI_EVENT_TTL", "3600"))  # 1 hour
OPENCLAW_URL   = os.getenv("OPENCLAW_URL", "http://openclaw:18789")
OPENCLAW_TOKEN = os.getenv("OPENCLAW_TOKEN", "")
AUDIT_URL      = os.getenv("AUDIT_URL", "http://audit-service:9000")

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

                    # Inject server-side timestamp into schub/trace events and persist as spans
                    if payload.get("type") == "CustomEvent" and payload.get("name") == "schub/trace":
                        payload.setdefault("timestamp", int(time.time() * 1000))
                        asyncio.create_task(_persist_trace_span(business_id, payload))

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


# --- AG-UI chat proxy ---

class AgUIChatRequest(BaseModel):
    session_key: str
    model: str = "openclaw:main"
    messages: list
    business_id: int
    thread_id: str
    run_id: str | None = None


async def _publish_agui(business_id: int, event: dict) -> None:
    """Publish an AG-UI event to the shared Redis stream (picked up by /sse/)."""
    event["businessId"] = business_id
    event.setdefault("timestamp", int(time.time() * 1000))
    channel = f"business:{EMAIL_NODE}:channel"
    await publish_message(channel, {"from": "-1", "text": json.dumps(event)})


async def _persist_trace_span(business_id: str, payload: dict) -> None:
    """Fire-and-forget: persist a schub/trace event as a span in the audit service."""
    try:
        redis = await get_redis_client()
        trace_id = await redis.get(f"audit:trace:{business_id}")
        if not trace_id:
            return
        if isinstance(trace_id, bytes):
            trace_id = trace_id.decode()

        value = payload.get("value", {})
        step = value.get("step", "")
        agent = value.get("agent", "")
        level = value.get("level", "major")
        ts_ms = payload.get("timestamp", int(time.time() * 1000))
        started_at = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).isoformat()

        try:
            biz_id_int = int(business_id)
        except (ValueError, TypeError):
            biz_id_int = value.get("businessId", 0)

        kind_map = {"major": "agent", "detail": "tool", "waiting": "email"}
        kind = kind_map.get(level, "agent")
        name = f"[{agent}] {step}" if agent else step

        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{AUDIT_URL}/spans", json={
                "id": str(uuid.uuid4()),
                "trace_id": trace_id,
                "parent_id": None,
                "name": name,
                "kind": kind,
                "business_id": biz_id_int,
                "started_at": started_at,
                "ended_at": started_at,
                "status": "ok",
                "thread_id": trace_id,
                "attributes": {"step": step, "agent": agent, "level": level},
            })
    except Exception as e:
        print(f"[audit span] {e}")


def _inject_context(req: AgUIChatRequest) -> list:
    """Prepend a system message with business context so the agent always knows who it's talking to."""
    system_msg = {
        "role": "system",
        "content": f"[Context: business_id={req.business_id}, thread_id={req.thread_id}]",
    }
    # Only prepend if no system message already present
    if req.messages and req.messages[0].get("role") == "system":
        return req.messages
    return [system_msg] + req.messages


async def _run_agui_chat(req: AgUIChatRequest, run_id: str) -> None:
    """Background task: proxy to OpenClaw SSE and emit AG-UI events into Redis."""
    biz = req.business_id
    await _publish_agui(biz, {
        "type": "RunStarted", "runId": run_id, "threadId": req.thread_id,
    })
    # Store current trace context so schub/trace events can be persisted as spans
    redis = await get_redis_client()
    await redis.set(f"audit:trace:{biz}", req.thread_id, ex=AGUI_EVENT_TTL)

    message_id = str(uuid.uuid4())
    message_started = False
    tool_call_ids: dict[int, str] = {}

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
        ) as client:
            async with client.stream(
                "POST",
                f"{OPENCLAW_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENCLAW_TOKEN}",
                    "x-openclaw-session-key": req.session_key,
                    "Content-Type": "application/json",
                },
                json={"model": req.model, "messages": _inject_context(req), "stream": True},
            ) as resp:
                buffer = ""
                async for chunk in resp.aiter_bytes():
                    buffer += chunk.decode("utf-8", errors="replace")
                    lines = buffer.split("\n")
                    buffer = lines.pop()
                    for line in lines:
                        if not line.startswith("data: "):
                            continue
                        data = line[6:].strip()
                        if data == "[DONE]":
                            continue
                        try:
                            parsed = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        choices = parsed.get("choices")
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})

                        if delta.get("content"):
                            if not message_started:
                                message_started = True
                                await _publish_agui(biz, {
                                    "type": "TextMessageStart",
                                    "messageId": message_id,
                                    "runId": run_id,
                                    "threadId": req.thread_id,
                                    "role": "assistant",
                                })
                            await _publish_agui(biz, {
                                "type": "TextMessageContent",
                                "messageId": message_id,
                                "delta": delta["content"],
                            })

                        for tc in delta.get("tool_calls") or []:
                            idx = tc.get("index", 0)
                            fn = tc.get("function") or {}
                            if fn.get("name"):
                                tc_id = tc.get("id") or str(uuid.uuid4())
                                tool_call_ids[idx] = tc_id
                                await _publish_agui(biz, {
                                    "type": "ToolCallStart",
                                    "toolCallId": tc_id,
                                    "toolCallName": fn["name"],
                                    "runId": run_id,
                                    "threadId": req.thread_id,
                                })
                            if fn.get("arguments") and idx in tool_call_ids:
                                await _publish_agui(biz, {
                                    "type": "ToolCallArgs",
                                    "toolCallId": tool_call_ids[idx],
                                    "delta": fn["arguments"],
                                })

        if message_started:
            await _publish_agui(biz, {
                "type": "TextMessageEnd",
                "messageId": message_id,
                "runId": run_id,
                "threadId": req.thread_id,
            })
        await _publish_agui(biz, {
            "type": "RunFinished", "runId": run_id, "threadId": req.thread_id,
        })

    except Exception as e:
        print(f"[/agui/chat] Error streaming from OpenClaw: {e}")
        await _publish_agui(biz, {
            "type": "RunError",
            "message": str(e),
            "runId": run_id,
            "threadId": req.thread_id,
        })


@router.post("/chat", status_code=202)
async def agui_chat(req: AgUIChatRequest):
    """Fire-and-forget: start an OpenClaw session and stream AG-UI events to /sse/."""
    run_id = req.run_id or str(uuid.uuid4())
    asyncio.create_task(_run_agui_chat(req, run_id))
    return {"status": "accepted", "run_id": run_id}


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