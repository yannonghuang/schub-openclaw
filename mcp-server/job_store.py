"""
Async job lifecycle manager for long-running MCP tools.

Flow:
  1. submit_job()       — persists job record via auth-service, spawns background task
  2. _run()             — executes engine_fn; updates job status via auth-service on finish
  3. _resume_session()  — if a session_key was registered, sends the job result into
                          that session via the gateway's sessions_send tool
  4. _notify_complete() — set by main.py at startup; publishes completion event to
                          switch-service (retained for frontend / legacy consumers)

The notify callback is injected by main.py to avoid a circular import.
"""
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx

BACKEND_URL    = os.getenv("BACKEND_URL",    "http://auth-service:4000")
OPENCLAW_URL   = os.getenv("OPENCLAW_URL",   "http://openclaw:18789")
OPENCLAW_TOKEN = os.getenv("OPENCLAW_TOKEN", "c34d9510b42222e8ff613d22f2d3dfc80b4eeb818aee7acc")

# Injected by main.py after startup
_notify_complete: Optional[Callable[[str, dict], Awaitable[None]]] = None

# In-process cache so the background task can resolve the engine_fn without
# a round-trip to auth-service.
_ENGINE_FNS: Dict[str, Callable] = {}

# Maps job_id → (session_key, agent_id) for OpenClaw resume callbacks.
_SESSION_KEYS: Dict[str, tuple[str, str]] = {}


def set_notify_callback(fn: Callable[[str, dict], Awaitable[None]]) -> None:
    global _notify_complete
    _notify_complete = fn


async def submit_job(
    job_id: str,
    thread_id: Optional[str],
    business_id: int,
    engine_name: str,
    payload: dict,
    engine_fn: Callable,
    session_key: Optional[str] = None,
    agent_id: Optional[str] = None,
) -> None:
    """Create the job record in the DB and start the background task."""
    _ENGINE_FNS[job_id] = engine_fn
    if session_key:
        _SESSION_KEYS[job_id] = (session_key, agent_id or "")

    async with httpx.AsyncClient(timeout=10) as c:
        await c.post(
            f"{BACKEND_URL}/async-jobs",
            json={
                "job_id": job_id,
                "thread_id": thread_id or "",
                "business_id": business_id,
                "engine_name": engine_name,
            },
        )

    asyncio.create_task(_run(job_id, payload))


async def bind_session(job_id: str, session_key: str, agent_id: str) -> str:
    """(Re)bind the session a job resumes into, overriding the `session_key` the
    agent passed to the engine tool. OpenClaw redacts session keys in stored
    transcripts (`agent:…fda4`, `***`), so an agent calling an engine a second time
    can copy the redacted value from its own history and the completion would
    resume nowhere. The agent's helper script knows the real key and binds it here.

    If the job already finished (binding raced the completion), resume now.
    Returns the job status."""
    _SESSION_KEYS[job_id] = (session_key, agent_id)
    async with httpx.AsyncClient(timeout=10) as c:
        r = await c.get(f"{BACKEND_URL}/async-jobs/{job_id}")
    job = r.json() if r.status_code == 200 else {}
    status = job.get("status", "unknown")
    if status in ("completed", "error"):
        await _resume_session(job_id, {"status": status, "result": job.get("result"), "error": job.get("error")})
    return status


def _requester_session_key(session_key: str, agent_id: str) -> str:
    """The session the sessions_send call is made *from*: the target agent's own main
    session, so `tools.sessions.visibility: "agent"` lets it reach the agent's subagent
    sessions without needing cross-agent (agentToAgent) permissions."""
    if not agent_id:
        parts = session_key.split(":")
        agent_id = parts[1] if len(parts) > 2 and parts[0] == "agent" else "main"
    return f"agent:{agent_id}:main"


async def _resume_session(job_id: str, update: dict) -> None:
    """Resume the agent session that submitted this job by injecting the job result
    into it via the gateway's `sessions_send` tool (POST /tools/invoke).

    OpenClaw >= 2026.6.x rejects `x-openclaw-session-key` overrides in reserved
    namespaces (`agent:<id>:subagent:...`) on /v1/chat/completions, which is where
    every async-job caller lives — so that path can no longer resume them. Requires
    `gateway.tools.allow: ["sessions_send"]` in openclaw.json. timeoutSeconds=0 makes
    the gateway run the turn server-side and return immediately (no stream to hold)."""
    entry = _SESSION_KEYS.pop(job_id, None)
    if not entry:
        return
    session_key, agent_id = entry
    if "…" in session_key or "*" in session_key:
        # Redacted key copied from a transcript: it addresses no session. Wait for the
        # agent's helper to bind the real one (bind_session), or the switch watchdog.
        print(f"[job_store] job {job_id}: redacted session key {session_key!r}, awaiting bind", flush=True)
        return

    status = update.get("status", "unknown")
    result = update.get("result") or update.get("error")
    content = f"Job {job_id} {status}. Result: {json.dumps(result)}"

    print(f"[job_store] resuming session {session_key} for job {job_id} (status={status})", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            resp = await c.post(
                f"{OPENCLAW_URL}/tools/invoke",
                headers={"Authorization": f"Bearer {OPENCLAW_TOKEN}"},
                json={
                    "name": "sessions_send",
                    "sessionKey": _requester_session_key(session_key, agent_id),
                    "args": {"sessionKey": session_key, "message": content, "timeoutSeconds": 0},
                },
            )
        print(f"[job_store] resume: HTTP {resp.status_code} for session {session_key}", flush=True)
        if resp.status_code != 200 or not resp.json().get("ok"):
            print(f"[job_store] resume failed: {resp.text[:300]}", flush=True)
        else:
            print(f"[job_store] resume accepted for session {session_key}", flush=True)
    except Exception as e:
        print(f"[job_store] failed to resume session {session_key} for job {job_id}: {e!r}", flush=True)


async def _run(job_id: str, payload: dict) -> None:
    """Execute the engine and persist the outcome."""
    engine_fn = _ENGINE_FNS.pop(job_id, None)
    if engine_fn is None:
        return

    started_at = datetime.now(timezone.utc)
    print(f"[job_store] job {job_id} started at {started_at.isoformat()}", flush=True)

    try:
        result = await engine_fn(payload)
        update = {"status": "completed", "result": result}
    except Exception as e:
        update = {"status": "error", "error": str(e)}

    ended_at = datetime.now(timezone.utc)
    elapsed = (ended_at - started_at).total_seconds()
    print(f"[job_store] job {job_id} ended at {ended_at.isoformat()} (elapsed {elapsed:.1f}s, status={update['status']})", flush=True)

    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.put(f"{BACKEND_URL}/async-jobs/{job_id}", json=update)
    except Exception as e:
        print(f"[job_store] failed to update job {job_id}: {e}")

    # Resume the waiting OpenClaw agent session (fire and forget)
    session_key, agent_id = _SESSION_KEYS.get(job_id) or (None, None)
    await _resume_session(job_id, update)

    # Also notify switch-service for frontend / legacy consumers. The session key rides
    # along so the run watchdog can re-deliver a completion that never landed.
    if _notify_complete:
        try:
            await _notify_complete(job_id, {**update, "session_key": session_key, "agent_id": agent_id})
        except Exception as e:
            print(f"[job_store] notify_complete failed for {job_id}: {e}")
