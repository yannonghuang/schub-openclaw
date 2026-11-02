from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Request, Header, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from data.schemas import Message
from utils.redis import publish_message, get_redis_client, get_events_since
from datetime import datetime, timezone
import hashlib
import json
import asyncio
import time
import contextlib
import os
import re
import uuid
import httpx
from pathlib import Path

EMAIL_NODE     = os.getenv("EMAIL_NODE", "-2")
AGUI_EVENT_TTL = int(os.getenv("AGUI_EVENT_TTL", "3600"))  # 1 hour
OPENCLAW_URL   = os.getenv("OPENCLAW_URL", "http://openclaw:18789")
OPENCLAW_TOKEN = os.getenv("OPENCLAW_TOKEN", "")
AUDIT_URL      = os.getenv("AUDIT_URL", "http://audit-service:9000")

# Cleanup: where the OpenClaw agent workspaces are reachable from this container
# (mounted via docker-compose) and which agents' sessions the UI "Cleanup" button
# may wipe. Conversation agents only — scheduling/wip are left untouched.
OPENCLAW_AGENTS_DIR = os.getenv("OPENCLAW_AGENTS_DIR", "/openclaw/agents")
CLEANUP_AGENTS      = [a for a in os.getenv("CLEANUP_AGENTS", "main,order,material,planning").split(",") if a]
ALLOCATOR_URL       = os.getenv("ALLOCATOR_URL", "http://allocator-backend:8000")

# Auto session GC. After a run completes *successfully* (a terminal-success
# trace, or the main turn's RunFinished), the involved agents' OpenClaw sessions
# are disposable — the durable record lives in Postgres history. We flag the
# completed session and delete it once it has gone idle (errored/hung sessions
# are never flagged, so they remain as footprints). SESSION_GC_DELAY is the
# settle window before a GC pass; SESSION_GC_GRACE is how long a flagged session
# must be untouched before deletion (covers async-job resumes / subagent
# announce-backs). Set SESSION_GC_GRACE<0 to disable auto-GC entirely.
SESSION_GC_GRACE = int(os.getenv("SESSION_GC_GRACE_SECONDS", "60"))
SESSION_GC_DELAY = int(os.getenv("SESSION_GC_DELAY_SECONDS", "75"))
SESSION_GC_MAX_AGE = int(os.getenv("SESSION_GC_MAX_AGE_SECONDS", "7200"))  # drop stale flags
GC_PENDING_KEY = "session_gc:pending"  # Redis hash: "{agent}::{uuid}" -> flaggedAtMs

# Order→material callback safety-net. An order subagent, after resolving (human
# approved/rejected), MUST dispatch an `order_complete` callback to its spawning
# material session so the workflow continues. If the agent drops that step (LLM
# truncation), material hangs forever. This reconciler detects a resolved-but-
# idle order session that never fired the callback and fires it automatically.
RECONCILE_DELAY = int(os.getenv("ORDER_RECONCILE_DELAY_SECONDS", "120"))
RECONCILE_DONE_KEY = "order_reconcile:done"  # Redis set of order session uuids already reconciled

# A trace step means "this agent's workflow finished successfully" when it ends
# in a deliberate terminal token: <sep>complete / <sep>rejected / abandoned.
# The leading separator ([._]) is required so mid-workflow milestones like
# "engineComplete" / "assessmentComplete" (camelCase, no separator) do NOT match
# — only end-of-run steps do. Matching by suffix (not exact string) tolerates
# the LLM paraphrasing the "trace.<agent>." prefix. Error/failure traces never
# match, so their sessions survive for inspection.
_TERMINAL_SUCCESS_RE = re.compile(r"[._](complete|rejected)$|negotiationabandoned$")


def _is_success_terminal(step: str) -> bool:
    return bool(_TERMINAL_SUCCESS_RE.search((step or "").lower()))

PING_TIMEOUT = 30  # seconds
REDIS_POLL_INTERVAL = 1.0

LOCALE_TTL = 30 * 24 * 3600  # 30 days

router = APIRouter()


# Hold strong refs to background tasks. asyncio.create_task only keeps weak
# refs — without this, a mid-flight task can be GC'd and silently cancelled
# (CancelledError is a BaseException and won't be caught by `except Exception`),
# which leaves the AG-UI stream stuck without ever emitting RunFinished.
_background_tasks: set[asyncio.Task] = set()


def _spawn_background(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


# --- Business locale preference ---

class LocaleRequest(BaseModel):
    business_id: int
    locale: str = "en"


@router.post("/locale")
async def set_locale(req: LocaleRequest):
    redis = await get_redis_client()
    await redis.set(f"locale:biz:{req.business_id}", req.locale, ex=LOCALE_TTL)
    return {"ok": True}


@router.get("/run-thread/{business_id}")  # browser: /agui/run-thread/{id} (nginx strips /agui)
async def get_run_thread(business_id: str, session_key: str | None = None):
    """Chat thread that owns `session_key`'s run (or, without one / when it can't be
    resolved, the thread that last started a run for the business). The panel uses it
    to show business-wide state, like the open negotiation card, only in the tab that
    owns the run."""
    thread = await _thread_for_session(session_key)
    if not thread:
        redis = await get_redis_client()
        thread = await redis.get(f"audit:trace:{business_id}")
    return {"thread_id": thread or None}


@router.get("/locale/{business_id}")
async def get_locale(business_id: str):
    redis = await get_redis_client()
    val = await redis.get(f"locale:biz:{business_id}")
    locale = val.decode() if isinstance(val, bytes) else (val or "en")
    return {"locale": locale or "en"}


@router.post("/publish")
async def publish(msg: Message):
    print("publish received a request ...")
    for recipient in msg.recipients:
        channel = f"business:{recipient}:channel"
        await publish_message(channel, {"from": msg.sender, "text": msg.content})
    # Auto session GC: flag a session for removal when its agent reports a
    # terminal-success trace.
    await _maybe_flag_completion(msg.content)
    # Safety-net: on an order approved/rejected trace, schedule a check that the
    # order→material callback actually fired (and fire it if not).
    await _maybe_schedule_reconcile(msg.content)
    await _watch_trace(msg.content)
    await _watch_job_end(msg.content)
    return {"status": "ok"}

# --- AG-UI SSE subscribe ---
@router.get("/sse/{business_id}")
async def agui_sse(
    business_id: str,
    request: Request,
    last_event_id: str | None = Header(None, alias="last-event-id"),
    since: str | None = None,
):
    """AG-UI SSE endpoint. Streams events as text/event-stream with monotonic IDs.
    Supports Last-Event-ID header for replay on reconnect (up to 200 missed events, 1h TTL).
    `?since=<seq>` does the same for a client-side reconnect: the browser only sends
    the header on its own automatic retry, which it abandons after an HTTP error
    (e.g. nginx 502 while this service restarts), so the client reopens the stream.
    """
    last_event_id = last_event_id or since
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
                        # Agents publish traces without a thread; stamp the chat thread
                        # of the run they belong to so each panel tab only shows its own
                        # run's progress.
                        if "threadId" not in payload:
                            run_thread = await _trace_thread(business_id, payload.get("value") or {})
                            if run_thread:
                                payload["threadId"] = run_thread
                        _spawn_background(_persist_trace_span(business_id, payload))

                    # Re-plan progress (from mcp-server): same thread stamping, no span.
                    if payload.get("type") == "CustomEvent" and payload.get("name") == "schub/progress":
                        if "threadId" not in payload:
                            run_thread = await _trace_thread(business_id, payload.get("value") or {})
                            if run_thread:
                                payload["threadId"] = run_thread

                    # Assign monotonic sequence ID
                    seq = await redis_client.incr(f"agui:seq:{business_id}")
                    encoded = json.dumps(payload)
                    await redis_client.setex(
                        f"agui:event:{business_id}:{seq}", AGUI_EVENT_TTL, encoded
                    )

                    etype = payload.get("type")
                    print(f"[SSE] → business_id={business_id} seq={seq} type={etype}", flush=True)
                    yield f"id: {seq}\ndata: {encoded}\n\n"
                    if etype in ("RunFinished", "RunError", "TextMessageEnd"):
                        print(f"[SSE] ← yielded seq={seq} type={etype}", flush=True)

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
    locale: str = "en"


async def _publish_agui(business_id: int, event: dict) -> None:
    """Publish an AG-UI event to the shared Redis stream (picked up by /sse/)."""
    event["businessId"] = business_id
    event.setdefault("timestamp", int(time.time() * 1000))
    channel = f"business:{EMAIL_NODE}:channel"
    await publish_message(channel, {"from": "-1", "text": json.dumps(event)})


async def _persist_trace_span(business_id: str, payload: dict) -> None:
    """Fire-and-forget: persist a schub/trace event as a span in the audit service.

    Each span's duration is measured as the time between consecutive trace events:
    - When a new event arrives, close the previous open span (PATCH ended_at = now)
    - Create a new span with started_at = now, ended_at = None (open)
    The last span is closed when RunFinished fires via _close_last_span().
    """
    try:
        redis = await get_redis_client()
        value = payload.get("value", {})
        # This runs once per open SSE connection for the same event; record it once.
        digest = hashlib.sha1(json.dumps(value, sort_keys=True, default=str).encode()).hexdigest()
        if not await redis.set(f"audit:span_seen:{business_id}:{digest}", 1, nx=True, ex=10):
            return
        # The run's own thread (stamped by _trace_thread), else the business's latest run.
        trace_id = payload.get("threadId") or await redis.get(f"audit:trace:{business_id}")
        if not trace_id:
            return
        if isinstance(trace_id, bytes):
            trace_id = trace_id.decode()

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
        span_id = str(uuid.uuid4())

        async with httpx.AsyncClient(timeout=5) as client:
            # Close the previous open span using this event's timestamp as its end time
            prev_span_id = await redis.get(f"audit:last_span:{business_id}")
            if prev_span_id:
                if isinstance(prev_span_id, bytes):
                    prev_span_id = prev_span_id.decode()
                await client.patch(f"{AUDIT_URL}/spans/{prev_span_id}", json={
                    "ended_at": started_at,
                    "status": "ok",
                })

            # Create new open span (no ended_at yet — closed by next event or RunFinished)
            await client.post(f"{AUDIT_URL}/spans", json={
                "id": span_id,
                "trace_id": trace_id,
                "parent_id": None,
                "name": name,
                "kind": kind,
                "business_id": biz_id_int,
                "started_at": started_at,
                "status": "ok",
                "thread_id": trace_id,
                # params: interpolation values (e.g. rating) so a restored step reads the same
                "attributes": {"step": step, "agent": agent, "level": level,
                               **({"params": value["params"]} if value.get("params") else {})},
            })

        # Track this span as the latest open one
        await redis.set(f"audit:last_span:{business_id}", span_id, ex=AGUI_EVENT_TTL)
    except Exception as e:
        print(f"[audit span] {e}")


async def _close_last_span(business_id: int) -> None:
    """Close the final open span when a run finishes."""
    try:
        redis = await get_redis_client()
        key = f"audit:last_span:{business_id}"
        span_id = await redis.get(key)
        if not span_id:
            return
        if isinstance(span_id, bytes):
            span_id = span_id.decode()
        ended_at = datetime.fromtimestamp(time.time(), tz=timezone.utc).isoformat()
        async with httpx.AsyncClient(timeout=5) as client:
            await client.patch(f"{AUDIT_URL}/spans/{span_id}", json={
                "ended_at": ended_at,
                "status": "ok",
            })
        await redis.delete(key)
    except Exception as e:
        print(f"[audit close_span] {e}")


async def _inject_context(req: AgUIChatRequest) -> list:
    """Prepend a system message with business context so the agent always knows who it's talking to."""
    # Redis locale is authoritative — overrides the request-level default
    redis = await get_redis_client()
    stored = await redis.get(f"locale:biz:{req.business_id}")
    locale = (stored.decode() if isinstance(stored, bytes) else stored) or req.locale or "en"

    system_msg = {
        "role": "system",
        "content": f"[Context: business_id={req.business_id}, thread_id={req.thread_id}, locale={locale}]",
    }
    # Only prepend if no system message already present
    if req.messages and req.messages[0].get("role") == "system":
        return req.messages
    return [system_msg] + req.messages


async def _run_agui_chat(req: AgUIChatRequest, run_id: str) -> None:
    """Background task: proxy to OpenClaw SSE and emit AG-UI events into Redis."""
    biz = req.business_id
    print(f"[agui_chat run={run_id}] enter, model={req.model}", flush=True)
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
            # read=180s is the max idle gap between SSE chunks. Long enough to
            # cover slow tool-use roundtrips on the openclaw side, short enough
            # to break out if the gateway sends [DONE] but never closes the
            # connection (and we somehow miss [DONE]) — the read timeout then
            # raises and the except clause emits RunError so the UI unblocks.
            timeout=httpx.Timeout(connect=10.0, read=180.0, write=10.0, pool=10.0)
        ) as client:
            async with client.stream(
                "POST",
                f"{OPENCLAW_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENCLAW_TOKEN}",
                    "x-openclaw-session-key": req.session_key,
                    "Content-Type": "application/json",
                },
                json={"model": req.model, "messages": await _inject_context(req), "stream": True},
            ) as resp:
                # aiter_lines() gives us one line at a time and respects `break`
                # immediately — so when we see [DONE] we exit without waiting
                # for another chunk. aiter_bytes() + a flag doesn't work: the
                # outer iterator blocks inside `await` until upstream yields the
                # next chunk, which may never come if the gateway sent [DONE]
                # and went silent without closing the connection.
                print(f"[agui_chat run={run_id}] stream opened status={resp.status_code}", flush=True)
                line_count = 0
                async for line in resp.aiter_lines():
                    line_count += 1
                    if not line or not line.startswith("data: "):
                        continue
                    data = line[6:].strip()
                    if data == "[DONE]":
                        print(f"[agui_chat run={run_id}] got [DONE] after {line_count} lines", flush=True)
                        break
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

        print(f"[agui_chat run={run_id}] exited loop, message_started={message_started}, line_count={line_count}", flush=True)
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
        print(f"[agui_chat run={run_id}] RunFinished published", flush=True)
        await _close_last_span(biz)
        # Auto session GC: the main turn finished successfully, so its session is
        # disposable. Flag it by its exact key (agent:main:<session_key>) and let
        # the GC reap it once idle. Errors take the except path and are NOT
        # flagged, so a failed run's session survives for inspection.
        try:
            main_uuid = _session_uuid_for_key("main", f"agent:main:{req.session_key}")
            if main_uuid:
                await _flag_session("main", main_uuid)
                await _schedule_session_gc()
        except Exception as e:
            print(f"[session_gc] flag main failed: {e}", flush=True)
        print(f"[agui_chat run={run_id}] cleanup done", flush=True)

    except BaseException as e:
        print(f"[agui_chat run={run_id}] EXCEPTION ({type(e).__name__}): {e}", flush=True)
        if isinstance(e, asyncio.CancelledError):
            raise
        await _publish_agui(biz, {
            "type": "RunError",
            "message": str(e),
            "runId": run_id,
            "threadId": req.thread_id,
        })
        await _close_last_span(biz)


@router.post("/chat", status_code=202)
async def agui_chat(req: AgUIChatRequest):
    """Fire-and-forget: start an OpenClaw session and stream AG-UI events to /sse/."""
    run_id = req.run_id or str(uuid.uuid4())
    _spawn_background(_run_agui_chat(req, run_id))
    return {"status": "accepted", "run_id": run_id}


# --- Session cleanup ---

class CleanupRequest(BaseModel):
    business_id: int
    # Bypass the open-negotiation safety guard. Off by default — the UI sets it
    # only after the user explicitly confirms the override.
    force: bool = False


def _wipe_agent_sessions() -> int:
    """Delete every session file under each conversation agent's sessions/ dir.

    Removes the per-session JSONL event logs (`*.jsonl`, `*.trajectory.jsonl`,
    `*.trajectory-path.json`) but keeps the sessions/ directory itself so the
    gateway can write fresh sessions afterward. Returns the file count removed.

    Intended as an idle-time maintenance action: deleting a session file the
    gateway is actively streaming is best avoided (it may recreate the file or
    error on that one session — non-fatal, and the rest still get cleaned).
    """
    deleted = 0
    for agent in CLEANUP_AGENTS:
        sessions_dir = Path(OPENCLAW_AGENTS_DIR) / agent / "sessions"
        if not sessions_dir.is_dir():
            continue
        for f in sessions_dir.iterdir():
            if not f.is_file():
                continue
            try:
                f.unlink()
                deleted += 1
            except OSError as e:
                print(f"[cleanup] could not delete {f}: {e}", flush=True)
    return deleted


async def _clear_agui_state(business_id: int) -> None:
    """Drop this business's in-flight AG-UI / audit Redis keys so a stale stream
    doesn't linger after sessions are wiped."""
    redis = await get_redis_client()
    keys = [
        f"agui:seq:{business_id}",
        f"audit:trace:{business_id}",
        f"audit:last_span:{business_id}",
    ]
    # agui:event:{biz}:{seq} are written per event — scan-delete the whole set
    async for key in redis.scan_iter(match=f"agui:event:{business_id}:*", count=100):
        keys.append(key)
    if keys:
        await redis.delete(*keys)


async def _open_negotiation(client: httpx.AsyncClient) -> dict | None:
    """Return the most recent unresolved negotiation-wait (or None).

    A wiped session for a paused material subagent breaks the negotiation it was
    serving — the dispatched reply lands in a fresh, context-less agent and the
    workflow stalls. So before wiping we check the allocator for any open wait.
    Raises on transport error so the caller can fail closed.
    """
    resp = await client.get(f"{ALLOCATOR_URL}/negotiation-waits/latest-unresolved")
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, dict) else None


async def _abandon_open_negotiations(client: httpx.AsyncClient) -> list[int]:
    """Resolve every open negotiation-wait with action=abandon, returning the
    case ids closed.

    `negotiation-reply` marks the wait resolved in the DB immediately (before its
    fire-and-forget dispatch), so this leaves no wait pointing at a session we're
    about to delete — making a forced cleanup land in a deterministic clean state
    regardless of how many negotiations were mid-flight. The dispatch to the
    soon-deleted subagent is harmless. Bounded loop so a re-spawning wait can't
    spin forever.
    """
    closed: list[int] = []
    for _ in range(20):
        wait = await _open_negotiation(client)
        if wait is None:
            break
        case_id = wait.get("caseId")
        resp = await client.post(
            f"{ALLOCATOR_URL}/cases/{case_id}/negotiation-reply",
            json={
                "sessionKey": wait.get("sessionKey"),
                "action": "abandon",
                "round": wait.get("round"),
            },
        )
        resp.raise_for_status()
        if case_id is not None:
            closed.append(case_id)
    return closed


@router.post("/cleanup")
async def cleanup(req: CleanupRequest):
    """Wipe OpenClaw sessions for the conversation agents and clear this
    business's in-flight AG-UI Redis state. Triggered by the slide-in's
    Cleanup button.

    Guard: refuse if any negotiation-wait is still open (deleting its paused
    material subagent session would strand the negotiation). Override with
    force=true to make cleanup an idempotent reset: it first abandons every open
    negotiation-wait (resolving them in the allocator DB) so no wait is left
    pointing at a deleted session, then wipes — landing in a deterministic clean
    state regardless of what was mid-flight.
    """
    abandoned: list[int] = []
    async with httpx.AsyncClient(timeout=10) as client:
        if req.force:
            try:
                abandoned = await _abandon_open_negotiations(client)
            except Exception as e:
                raise HTTPException(status_code=502, detail={
                    "reason": "abandon_failed",
                    "message": f"Could not resolve open negotiations before cleanup ({e}).",
                })
        else:
            try:
                wait = await _open_negotiation(client)
            except Exception as e:
                raise HTTPException(status_code=409, detail={
                    "reason": "verify_failed",
                    "message": f"Could not verify open negotiations ({e}). "
                               f"Retry with force=true to clean up anyway.",
                })
            if wait is not None:
                raise HTTPException(status_code=409, detail={
                    "reason": "open_negotiation",
                    "case_id": wait.get("caseId"),
                    "session_key": wait.get("sessionKey"),
                    "message": f"Negotiation case {wait.get('caseId')} is still open "
                               f"(round {wait.get('round')}, {wait.get('rating')}). "
                               f"Cleaning up now would strand it. Resolve it first, "
                               f"or force the cleanup.",
                })

    deleted = _wipe_agent_sessions()
    await _clear_agui_state(req.business_id)
    print(f"[cleanup] business={req.business_id} removed {deleted} session files "
          f"across {CLEANUP_AGENTS} (force={req.force}, abandoned={abandoned})", flush=True)
    return {"ok": True, "deleted_sessions": deleted, "agents": CLEANUP_AGENTS,
            "abandoned_negotiations": abandoned}


# --- Auto session GC (delete sessions of successfully completed runs) --------

def _sessions_index(agent: str) -> dict:
    """Read an agent's sessions.json (sessionKey -> {sessionId, updatedAt, ...})."""
    p = Path(OPENCLAW_AGENTS_DIR) / agent / "sessions" / "sessions.json"
    try:
        return json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return {}


# --- Run ownership: which chat thread a session (and its traces) belongs to ------

RUN_THREAD_TTL = 86400
RECENT_SESSION_SECS = 3600


async def _thread_for_session(session_key: str | None) -> str | None:
    """Chat thread that owns a session: walk `spawnedBy` up the subagent tree to the
    main session, whose key is `agent:main:<thread>`. Cached, because finished
    sessions are reaped from sessions.json."""
    if not session_key:
        return None
    redis = await get_redis_client()
    cached = await redis.get(f"runthread:{session_key}")
    if cached:
        return cached
    key = session_key
    for _ in range(6):
        if key.startswith("agent:main:"):
            thread = key[len("agent:main:"):]
            await redis.set(f"runthread:{session_key}", thread, ex=RUN_THREAD_TTL)
            return thread
        parts = key.split(":")
        entry = _sessions_index(parts[1]).get(key) if len(parts) > 2 else None
        if not entry or not entry.get("spawnedBy"):
            return None
        key = entry["spawnedBy"]
    return None


def _recent_subagent_session(agent: str | None) -> str | None:
    """The agent's only recently-active subagent session, if exactly one — for traces
    published without a sessionKey. Ambiguous (concurrent runs) → None."""
    if not agent or agent == "main":
        return None
    cutoff = (time.time() - RECENT_SESSION_SECS) * 1000
    live = [k for k, v in _sessions_index(agent).items()
            if ":subagent:" in k and v.get("updatedAt", 0) >= cutoff]
    return live[0] if len(live) == 1 else None


async def _trace_thread(business_id: str, value: dict) -> str | None:
    """Thread a trace belongs to: its own sessionKey's run, else the agent's only
    active session's run, else the thread that last started a run for the business."""
    session_key = value.get("sessionKey") or _recent_subagent_session(value.get("agent"))
    thread = await _thread_for_session(session_key)
    if thread:
        return thread
    redis = await get_redis_client()
    return await redis.get(f"audit:trace:{business_id}")


def _latest_session_uuid(agent: str) -> str | None:
    """The agent's most-recently-updated session file uuid — i.e. the one that
    just emitted a terminal trace."""
    best, best_ts = None, -1.0
    for meta in _sessions_index(agent).values():
        ts = meta.get("updatedAt", 0)
        if ts > best_ts:
            best_ts, best = ts, meta.get("sessionId")
    return best


def _session_uuid_for_key(agent: str, key: str) -> str | None:
    return (_sessions_index(agent).get(key) or {}).get("sessionId")


def _session_file(agent: str, uuid: str) -> Path:
    return Path(OPENCLAW_AGENTS_DIR) / agent / "sessions" / f"{uuid}.jsonl"


def _resolve_completed_uuid(agent: str, value: dict) -> str | None:
    """Exact attribution for the session that just completed.

    Agents emit the id they hold: order/planning a `sessionId` (their session
    file basename, used directly); material a `sessionKey` (routing key resolved
    via the index). Either must name a real session file. If neither is present
    or valid, fall back to the most-recently-active session for the agent."""
    sid = str(value.get("sessionId") or "").strip()
    if sid and _session_file(agent, sid).exists():
        return sid
    skey = str(value.get("sessionKey") or "").strip()
    if skey:
        u = _session_uuid_for_key(agent, skey)
        if u and _session_file(agent, u).exists():
            return u
    return _latest_session_uuid(agent)


def _delete_session_files(agent: str, uuid: str) -> None:
    d = Path(OPENCLAW_AGENTS_DIR) / agent / "sessions"
    for name in (f"{uuid}.jsonl", f"{uuid}.trajectory.jsonl", f"{uuid}.trajectory-path.json"):
        try:
            (d / name).unlink()
        except OSError:
            pass


def _remove_index_entry(agent: str, key: str) -> None:
    """Drop one entry from sessions.json via atomic write. Only called for
    idle sessions, so OpenClaw isn't concurrently rewriting this entry."""
    p = Path(OPENCLAW_AGENTS_DIR) / agent / "sessions" / "sessions.json"
    try:
        idx = json.loads(p.read_text())
    except (OSError, json.JSONDecodeError):
        return
    if key in idx:
        idx.pop(key, None)
        tmp = p.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(idx))
        tmp.replace(p)


async def _flag_session(agent: str, uuid: str) -> None:
    """Record a successfully-completed session as a GC candidate."""
    if SESSION_GC_GRACE < 0 or not uuid:
        return
    redis = await get_redis_client()
    await redis.hset(GC_PENDING_KEY, f"{agent}::{uuid}", int(time.time() * 1000))


_gc_scheduled = False


async def _schedule_session_gc() -> None:
    """Debounced: run one GC pass SESSION_GC_DELAY seconds from now."""
    global _gc_scheduled
    if SESSION_GC_GRACE < 0 or _gc_scheduled:
        return
    _gc_scheduled = True

    async def _run():
        global _gc_scheduled
        try:
            await asyncio.sleep(SESSION_GC_DELAY)
        finally:
            _gc_scheduled = False
        await _gc_pending()

    _spawn_background(_run())


async def _gc_pending() -> None:
    """Delete flagged sessions that have gone idle and hold no open obligation.
    Re-schedules itself while any flagged session is still active."""
    redis = await get_redis_client()
    pending = await redis.hgetall(GC_PENDING_KEY)
    if not pending:
        return

    # Protect sessions still tied to an open negotiation (belt-and-suspenders —
    # a negotiating subagent won't have emitted a terminal-success trace, so it
    # shouldn't be flagged in the first place). If the allocator can't be
    # reached, skip this pass and retry rather than risk an unsafe delete.
    protected: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            wait = await _open_negotiation(client)
            if wait and wait.get("sessionKey"):
                protected.add(wait["sessionKey"])
    except Exception as e:
        print(f"[session_gc] negotiation check failed, deferring: {e}", flush=True)
        await _schedule_session_gc()
        return

    now_ms = time.time() * 1000
    still_active = False
    for member, flagged_at in pending.items():
        agent, _, uuid = member.partition("::")
        # Locate this uuid's index entry to read its key + last-activity time.
        entry_key, meta = None, None
        for k, m in _sessions_index(agent).items():
            if m.get("sessionId") == uuid:
                entry_key, meta = k, m
                break
        if meta is None:
            await redis.hdel(GC_PENDING_KEY, member)  # already gone
            continue
        if now_ms - float(flagged_at or 0) > SESSION_GC_MAX_AGE * 1000:
            await redis.hdel(GC_PENDING_KEY, member)  # stale flag — give up
            continue
        if now_ms - meta.get("updatedAt", 0) < SESSION_GC_GRACE * 1000:
            still_active = True  # touched recently — retry next pass
            continue
        if entry_key in protected:
            still_active = True
            continue
        _delete_session_files(agent, uuid)
        if entry_key:
            _remove_index_entry(agent, entry_key)
        await redis.hdel(GC_PENDING_KEY, member)
        print(f"[session_gc] removed completed session {agent}/{uuid}", flush=True)

    if still_active:
        await _schedule_session_gc()


async def _maybe_flag_completion(content: str) -> None:
    """Flag an agent's session for GC when it publishes a terminal-success trace."""
    if SESSION_GC_GRACE < 0:
        return
    try:
        payload = json.loads(content) if isinstance(content, str) else content
        if not isinstance(payload, dict) or payload.get("name") != "schub/trace":
            return
        value = payload.get("value", {})
        step, agent = value.get("step", ""), value.get("agent", "")
    except (json.JSONDecodeError, AttributeError):
        return
    if not _is_success_terminal(step) or agent not in CLEANUP_AGENTS:
        return
    uuid = _resolve_completed_uuid(agent, value)
    if uuid:
        await _flag_session(agent, uuid)
        await _schedule_session_gc()


# Preferred display order; any other agent dirs are appended alphabetically.
_AGENT_ORDER = ["main", "order", "material", "planning", "scheduling", "wip"]


@router.get("/sessions/status")
async def sessions_status():
    """Per-agent OpenClaw session inventory for the slide-in's Sessions panel.

    Each session is classified into one lifecycle state:
      negotiating — key matches an open negotiation-wait (paused at HITL)
      pendingGc   — flagged for auto-removal (completed-successful, awaiting reap)
      active      — touched within the GC grace window (in-progress)
      idle        — leftover footprint (errored/hung/abandoned, no success terminal)
    """
    now_ms = time.time() * 1000
    redis = await get_redis_client()
    pending = set((await redis.hgetall(GC_PENDING_KEY)).keys())  # {"agent::uuid"}

    negotiating_keys: set[str] = set()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            wait = await _open_negotiation(client)
            if wait and wait.get("sessionKey"):
                negotiating_keys.add(wait["sessionKey"])
    except Exception:
        pass  # allocator down — just omit the negotiating classification

    base = Path(OPENCLAW_AGENTS_DIR)
    found = [d.name for d in base.iterdir() if d.is_dir() and (d / "sessions").is_dir()] if base.is_dir() else []
    agents = [a for a in _AGENT_ORDER if a in found] + sorted(a for a in found if a not in _AGENT_ORDER)

    out = []
    for agent in agents:
        counts = {"active": 0, "pendingGc": 0, "negotiating": 0, "idle": 0}
        sessions = []
        for key, meta in _sessions_index(agent).items():
            uuid = meta.get("sessionId", "")
            updated = meta.get("updatedAt", 0)
            if key in negotiating_keys:
                state = "negotiating"
            elif f"{agent}::{uuid}" in pending:
                state = "pendingGc"
            elif now_ms - updated < SESSION_GC_GRACE * 1000:
                state = "active"
            else:
                state = "idle"
            counts[state] += 1
            sessions.append({
                "key": key, "uuid": uuid,
                "ageSeconds": max(0, int((now_ms - updated) / 1000)),
                "state": state, "subagent": ":subagent:" in key,
            })
        sessions.sort(key=lambda s: s["ageSeconds"])
        out.append({"agent": agent, "total": len(sessions), "counts": counts, "sessions": sessions})

    return {"generatedAt": int(now_ms), "graceSeconds": SESSION_GC_GRACE, "agents": out}


# --- Order→material callback safety-net -------------------------------------

def _read_session_text(agent: str, uuid: str) -> str:
    try:
        return _session_file(agent, uuid).read_text()
    except OSError:
        return ""


def _grab(text: str, field: str, pat: str = r"[0-9]+") -> str | None:
    """Best-effort extract a field's value from an order session's (escaped
    JSON-in-JSONL) text. `.{0,12}?` skips the `":"` quoting/escaping."""
    m = re.search(rf"{field}.{{0,12}}?({pat})", text)
    return m.group(1) if m else None


def _order_needs_callback(uuid: str) -> dict | None:
    """If this order session resolved (approved/rejected) but never dispatched
    the order_complete callback to its material parent, return the callback to
    fire (material session key + payload); else None."""
    text = _read_session_text("order", uuid)
    if not text:
        return None
    approved = re.search(r"[._]approved", text) is not None
    rejected = re.search(r"[._]rejected", text) is not None
    if not (approved or rejected):
        return None  # not resolved yet — leave it
    # Already dispatched the callback / completed? Then nothing to do.
    if any(k in text for k in ("openclaw:material", "order_complete", "returningControl",
                               "callback_dispatched", "trace.order.complete")):
        return None
    m = re.search(r"_material_session_key.{0,20}?(agent:material:subagent:[0-9a-fA-F-]{8,})", text)
    if not m:
        return None  # no material parent to wake (top-level order) — nothing to reconcile
    payload = {"type": "order_complete", "outcome": "approved" if approved else "rejected"}
    biz = _grab(text, "business_id")
    payload["business_id"] = int(biz) if biz else 1
    # Material recovers anything missing from its own state; include what we can.
    for fld in ("case_id", "contingent_plan_run_id"):
        v = _grab(text, fld)
        if v:
            payload[fld] = int(v)
    pr = _grab(text, r"[^_]plan_run_id")  # avoid matching contingent_plan_run_id
    if pr:
        payload["plan_run_id"] = int(pr)
    sup = _grab(text, "supply_id", r"[0-9A-Za-z][0-9A-Za-z_./-]{2,}")
    if sup:
        payload["supply_id"] = sup
    rat = _grab(text, "rating", r"[A-Z]+")
    if rat:
        payload["rating"] = rat
    return {"mat_key": m.group(1), "payload": payload}


async def _fire_order_callback(mat_key: str, payload: dict | str) -> int:
    # sessions_send via /tools/invoke: the gateway rejects `x-openclaw-session-key`
    # overrides for subagent sessions on /v1/chat/completions (OpenClaw >= 2026.6.x).
    # Sent from material's own main session (tools.sessions.visibility="agent");
    # timeoutSeconds=0 queues the material turn and returns immediately.
    body = {"name": "sessions_send",
            "sessionKey": "agent:material:main",
            "args": {"sessionKey": mat_key,
                     "message": payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False),
                     "timeoutSeconds": 0}}
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{OPENCLAW_URL}/tools/invoke",
            headers={"Authorization": f"Bearer {OPENCLAW_TOKEN}"},
            json=body,
        )
        return resp.status_code


async def _reconcile_dropped_callbacks() -> None:
    """Scan idle order sessions; fire the order_complete callback for any that
    resolved but never called back their material parent. Idempotent: each order
    session is reconciled at most once, and material's own planning-spawn guard
    dedupes a redundant callback."""
    redis = await get_redis_client()
    done = set(await redis.smembers(RECONCILE_DONE_KEY))
    now_ms = time.time() * 1000
    for meta in _sessions_index("order").values():
        uuid = meta.get("sessionId")
        if not uuid or uuid in done:
            continue
        if now_ms - meta.get("updatedAt", 0) < SESSION_GC_GRACE * 1000:
            continue  # still active — give the agent a chance to do it itself
        info = _order_needs_callback(uuid)
        if not info:
            continue
        try:
            status = await _fire_order_callback(info["mat_key"], info["payload"])
            await redis.sadd(RECONCILE_DONE_KEY, uuid)
            print(f"[order_reconcile] fired {info['payload']['outcome']} callback "
                  f"order/{uuid[:8]} -> {info['mat_key'].split(':')[-1][:8]} (HTTP {status})", flush=True)
        except Exception as e:
            print(f"[order_reconcile] callback failed for order/{uuid[:8]}: {e}", flush=True)


_reconcile_scheduled = False


async def _schedule_reconcile() -> None:
    """Debounced: run one reconcile pass RECONCILE_DELAY seconds from now (long
    enough for a healthy order agent to do the callback itself first)."""
    global _reconcile_scheduled
    if _reconcile_scheduled:
        return
    _reconcile_scheduled = True

    async def _run():
        global _reconcile_scheduled
        try:
            await asyncio.sleep(RECONCILE_DELAY)
        finally:
            _reconcile_scheduled = False
        await _reconcile_dropped_callbacks()

    _spawn_background(_run())


# --- Run watchdog ---------------------------------------------------------------
# Flags runs that are stuck in a way no legitimate wait explains, so a hang like
# 2026-11-01's (material said "Delegated to Order Agent" but never spawned it) shows
# up in the run's own panel tab instead of sitting silent. Detection only: it never
# re-drives a run — a wrong guess would duplicate side effects (emails, promotions).
#
# Every agent trace records its session's latest step; a terminal trace drops it. A
# pass every WATCHDOG_INTERVAL seconds then checks each live run:
#   - human waits (negotiation reply, approval email): never flagged;
#   - material orderSpawned: no order session spawned by it after WATCHDOG_SPAWN_GRACE;
#   - material engineSubmitted: the engine job finished WATCHDOG_RESUME_GRACE ago and
#     the run never moved on;
#   - any other non-waiting step: no trace and no session activity for WATCHDOG_STALL.
#
# Separately it re-delivers lost engine completions: mcp-server reports every job end
# with the session it resumed. If that run has emitted no trace since the job ended for
# WATCHDOG_REDELIVER_GRACE, the completion never landed (redacted session key in the
# engine call plus a skipped `mat.sh submitted`, or the target was mid-turn), so it is
# re-bound to the real key via mcp-server, which re-sends it. Once per job; a duplicate
# completion is harmless (`mat.sh rate` is a read + assessment).
WATCH_KEY = "watchdog:runs"             # Redis hash: sessionKey -> {agent, biz, step, level, ts, jobId}
WATCH_FLAGGED_KEY = "watchdog:flagged"  # Redis hash: sessionKey -> step it was flagged at
WATCH_JOBS_KEY = "watchdog:jobs"        # Redis hash: sessionKey -> {jobId, agent, ended}
WATCHDOG_REDELIVER_GRACE = int(os.getenv("WATCHDOG_REDELIVER_GRACE_SECONDS", "60"))
MCP_URL = os.getenv("MCP_URL", "http://mcp-server:9500")
WATCHDOG_INTERVAL = int(os.getenv("WATCHDOG_INTERVAL_SECONDS", "60"))
WATCHDOG_STALL = int(os.getenv("WATCHDOG_STALL_SECONDS", "600"))
WATCHDOG_SPAWN_GRACE = int(os.getenv("WATCHDOG_SPAWN_GRACE_SECONDS", "180"))
WATCHDOG_RESUME_GRACE = int(os.getenv("WATCHDOG_RESUME_GRACE_SECONDS", "300"))
WATCHDOG_MAX_AGE = 7 * 86400
AUTH_URL = os.getenv("AUTH_URL", "http://auth-service:4000")
_HUMAN_WAIT_RE = re.compile(r"[._](negotiationwaiting|awaitingapproval|resendingapproval)$")


async def _watch_trace(content: str) -> None:
    """Record a run session's latest trace step (or drop it on a terminal trace)."""
    try:
        payload = json.loads(content) if isinstance(content, str) else content
        if not isinstance(payload, dict) or payload.get("name") != "schub/trace":
            return
        value = payload.get("value", {})
        step, agent = value.get("step", ""), value.get("agent", "")
    except (json.JSONDecodeError, AttributeError):
        return
    if not step or agent in ("watchdog", "main"):
        return
    key = value.get("sessionKey") or _recent_subagent_session(agent)
    if not key or ":subagent:" not in key:
        return
    redis = await get_redis_client()
    if _is_success_terminal(step):
        await redis.hdel(WATCH_KEY, key)
        await redis.hdel(WATCH_FLAGGED_KEY, key)
        await redis.hdel(WATCH_JOBS_KEY, key)
        return
    await redis.hset(WATCH_KEY, key, json.dumps({
        "agent": agent, "biz": value.get("businessId"), "step": step,
        "level": value.get("level", "major"), "ts": time.time(), "jobId": value.get("jobId"),
    }))


def _unredact_session_key(key: str, agent: str | None) -> str | None:
    """OpenClaw redacts keys in transcripts (`agent:…d097`), and agents copy them into
    engine calls. Resolve one to the agent's unique live subagent key with that suffix."""
    if "…" not in key and "*" not in key:
        return key
    tail = key.rsplit("…", 1)[-1]
    if not agent or not tail or "*" in tail:
        return None
    hits = [k for k in _sessions_index(agent) if ":subagent:" in k and k.endswith(tail)]
    return hits[0] if len(hits) == 1 else None


async def _watch_job_end(content: str) -> None:
    """Remember the session each finished engine job was meant to resume."""
    try:
        payload = json.loads(content) if isinstance(content, str) else content
    except json.JSONDecodeError:
        return
    if not isinstance(payload, dict) or payload.get("type") != "ToolCallEnd":
        return
    raw, agent = payload.get("sessionKey"), payload.get("agentId")
    if not raw:
        return
    if not agent and raw.startswith("agent:") and raw.count(":") >= 2:
        agent = raw.split(":")[1]
    key = _unredact_session_key(raw, agent)
    if not key or ":subagent:" not in key:
        return
    redis = await get_redis_client()
    await redis.hset(WATCH_JOBS_KEY, key, json.dumps({
        "jobId": payload.get("toolCallId"), "agent": agent, "ended": time.time()}))


async def _redeliver_lost_completion(key: str, e: dict, now: float) -> None:
    redis = await get_redis_client()
    raw = await redis.hget(WATCH_JOBS_KEY, key)
    if not raw:
        return
    j = json.loads(raw)
    if e["ts"] >= j["ended"]:
        await redis.hdel(WATCH_JOBS_KEY, key)  # run moved on after the job: delivered
        return
    if now - j["ended"] < WATCHDOG_REDELIVER_GRACE:
        return
    await redis.hdel(WATCH_JOBS_KEY, key)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(f"{MCP_URL}/jobs/{j['jobId']}/session",
                                  json={"session_key": key, "agent_id": j.get("agent") or ""})
        print(f"[watchdog] re-delivered job {j['jobId']} completion to {key}: HTTP {r.status_code}", flush=True)
    except Exception as ex:
        print(f"[watchdog] re-delivery of job {j['jobId']} to {key} failed: {ex}", flush=True)


async def _job_ended_at(job_id: str) -> float | None:
    """Epoch seconds an engine job finished, or None while it's still running."""
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            job = (await client.get(f"{AUTH_URL}/async-jobs/{job_id}")).json()
    except Exception:
        return None
    if job.get("status") not in ("completed", "failed") or not job.get("updated_at"):
        return None
    # updated_at is naive UTC
    return datetime.fromisoformat(job["updated_at"]).replace(tzinfo=timezone.utc).timestamp()


async def _stall_reason(key: str, e: dict, now: float) -> str | None:
    step = e["step"].lower()
    if _HUMAN_WAIT_RE.search(step):
        return None
    meta = _sessions_index(key.split(":")[1]).get(key) or {}
    last_activity = max(e["ts"], meta.get("updatedAt", 0) / 1000)
    for suffix, child in ((".orderspawned", "order"), (".planningspawning", "planning")):
        if step.endswith(suffix):
            spawned = any(v.get("spawnedBy") == key for v in _sessions_index(child).values())
            if not spawned and now - e["ts"] > WATCHDOG_SPAWN_GRACE:
                return f"{child} agent was never started"
            return None
    if step.endswith(".enginesubmitted") and e.get("jobId"):
        ended = await _job_ended_at(e["jobId"])
        if ended and now - max(ended, last_activity) > WATCHDOG_RESUME_GRACE:
            return "engine job finished but the run never resumed"
        return None
    if e.get("level") != "waiting" and now - last_activity > WATCHDOG_STALL:
        return f"no progress for {int((now - last_activity) // 60)} min"
    return None


async def _watchdog_pass() -> None:
    redis = await get_redis_client()
    flagged = await redis.hgetall(WATCH_FLAGGED_KEY)
    now = time.time()
    for key, raw in (await redis.hgetall(WATCH_KEY)).items():
        e = json.loads(raw)
        if now - e["ts"] > WATCHDOG_MAX_AGE:
            await redis.hdel(WATCH_KEY, key)
            await redis.hdel(WATCH_FLAGGED_KEY, key)
            continue
        await _redeliver_lost_completion(key, e, now)
        if flagged.get(key) == e["step"]:
            continue  # already flagged at this step; a new step re-arms it
        reason = await _stall_reason(key, e, now)
        if not reason:
            continue
        await redis.hset(WATCH_FLAGGED_KEY, key, e["step"])
        print(f"[watchdog] stalled run {key}: {reason} (last step {e['step']})", flush=True)
        # The one stall safe to fix automatically: a handoff whose child never started (the
        # spawn step was skipped or failed). No child exists, so nothing can duplicate, and
        # `mat.sh order|planning` spawns idempotently.
        m = re.match(r"(order|planning) agent was never started", reason)
        if m and key.startswith("agent:material:subagent:"):
            child = m.group(1)
            try:
                await _fire_order_callback(key, (
                    f"SYSTEM: the {child.capitalize()} Agent was never started. "
                    f"Run `exec sh /home/node/.openclaw/agents/material/bin/mat.sh {child}` now "
                    f"and continue from its output."))
                reason += " — re-driven"
                print(f"[watchdog] re-drove {key} to spawn the {child} agent", flush=True)
            except Exception as ex:
                print(f"[watchdog] re-drive failed for {key}: {ex}", flush=True)
        # sessionKey makes _trace_thread stamp the owning chat thread, so the flag lands
        # in that run's panel tab.
        value = {"step": "trace.watchdog.stalled", "agent": "watchdog", "level": "major",
                 "businessId": e.get("biz"), "sessionKey": key,
                 "params": {"agent": e["agent"], "reason": reason, "lastStep": e["step"]}}
        await publish_message(f"business:{EMAIL_NODE}:channel", {
            "from": "-1",
            "text": json.dumps({"type": "CustomEvent", "name": "schub/trace", "value": value}),
        })


async def _watchdog_loop() -> None:
    while True:
        await asyncio.sleep(WATCHDOG_INTERVAL)
        try:
            await _watchdog_pass()
        except Exception as e:
            print(f"[watchdog] pass failed: {e}", flush=True)


def start_watchdog() -> None:
    _spawn_background(_watchdog_loop())


async def _maybe_schedule_reconcile(content: str) -> None:
    """On an order approved/rejected trace, schedule a reconcile to catch a
    dropped material callback."""
    try:
        payload = json.loads(content) if isinstance(content, str) else content
        if not isinstance(payload, dict) or payload.get("name") != "schub/trace":
            return
        value = payload.get("value", {})
        step, agent = value.get("step", ""), value.get("agent", "")
    except (json.JSONDecodeError, AttributeError):
        return
    if agent == "order" and re.search(r"[._](approved|rejected)$", str(step)):
        await _schedule_reconcile()


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