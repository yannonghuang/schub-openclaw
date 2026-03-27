"""
Async job lifecycle manager for long-running MCP tools.

Flow:
  1. submit_job()       — persists job record via auth-service, spawns background task
  2. _run()             — executes engine_fn; updates job status via auth-service on finish
  3. _resume_session()  — if a session_key was registered, POSTs to OpenClaw gateway
                          so the waiting agent turn resumes with the job result
  4. _notify_complete() — set by main.py at startup; publishes completion event to
                          switch-service (retained for frontend / legacy consumers)

The notify callback is injected by main.py to avoid a circular import.
"""
import asyncio
import json
import os
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


async def _resume_session(job_id: str, update: dict) -> None:
    """POST to the OpenClaw gateway to resume the agent session that submitted this job.
    Fire-and-forget: we only need the message delivered, not the LLM response."""
    entry = _SESSION_KEYS.pop(job_id, None)
    if not entry:
        return
    session_key, agent_id = entry

    status = update.get("status", "unknown")
    result = update.get("result") or update.get("error")
    content = f"Job {job_id} {status}. Result: {json.dumps(result)}"

    try:
        # Use stream=True and immediately close — delivers the message without
        # waiting for the LLM to finish generating its response.
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(connect=10.0, read=None, write=10.0, pool=10.0)
        ) as c:
            async with c.stream(
                "POST",
                f"{OPENCLAW_URL}/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENCLAW_TOKEN}",
                    "x-openclaw-session-key": session_key,
                    "Content-Type": "application/json",
                },
                json={
                    "model": f"openclaw:{agent_id}" if agent_id else "openclaw",
                    "messages": [{"role": "user", "content": content}],
                    "stream": True,
                },
            ) as resp:
                print(f"[job_store] resume delivered to session {session_key}: HTTP {resp.status_code}")
                # Don't read the body — we just needed delivery
    except Exception as e:
        print(f"[job_store] failed to resume session {session_key} for job {job_id}: {e!r}")


async def _run(job_id: str, payload: dict) -> None:
    """Execute the engine and persist the outcome."""
    engine_fn = _ENGINE_FNS.pop(job_id, None)
    if engine_fn is None:
        return

    started_at = datetime.now(timezone.utc)
    print(f"[job_store] job {job_id} started at {started_at.isoformat()}")

    try:
        result = await engine_fn(payload)
        update = {"status": "completed", "result": result}
    except Exception as e:
        update = {"status": "error", "error": str(e)}

    ended_at = datetime.now(timezone.utc)
    elapsed = (ended_at - started_at).total_seconds()
    print(f"[job_store] job {job_id} ended at {ended_at.isoformat()} (elapsed {elapsed:.1f}s, status={update['status']})")

    try:
        async with httpx.AsyncClient(timeout=10) as c:
            await c.put(f"{BACKEND_URL}/async-jobs/{job_id}", json=update)
    except Exception as e:
        print(f"[job_store] failed to update job {job_id}: {e}")

    # Resume the waiting OpenClaw agent session (fire and forget)
    await _resume_session(job_id, update)

    # Also notify switch-service for frontend / legacy consumers
    if _notify_complete:
        try:
            await _notify_complete(job_id, update)
        except Exception as e:
            print(f"[job_store] notify_complete failed for {job_id}: {e}")
