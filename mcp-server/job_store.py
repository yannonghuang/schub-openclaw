"""
Async job lifecycle manager for long-running MCP tools.

Flow:
  1. submit_job()       — persists job record via auth-service, spawns background task
  2. _run()             — executes engine_fn; updates job status via auth-service on finish
  3. _notify_complete() — set by main.py at startup; publishes completion event

The notify callback is injected by main.py to avoid a circular import.
"""
import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

import httpx

BACKEND_URL = os.getenv("BACKEND_URL", "http://auth-service:4000")

# Injected by main.py after startup
_notify_complete: Optional[Callable[[str, dict], Awaitable[None]]] = None

# In-process cache so the background task can resolve the engine_fn without
# a round-trip to auth-service.
_ENGINE_FNS: Dict[str, Callable] = {}


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
) -> None:
    """Create the job record in the DB and start the background task."""
    _ENGINE_FNS[job_id] = engine_fn

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
        print(f"[job_store] Failed to update job {job_id}: {e}")

    if _notify_complete:
        try:
            await _notify_complete(job_id, update)
        except Exception as e:
            print(f"[job_store] notify_complete failed for {job_id}: {e}")
