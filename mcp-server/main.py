# main.py
import contextlib
import json
import os

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

import job_store

SWITCH_URL = os.getenv("SWITCH_URL", "http://switch-service:6000/publish")
BACKEND_URL = os.getenv("BACKEND_URL", "http://auth-service:4000")
EMAIL_NODE  = int(os.getenv("EMAIL_NODE", "-2"))

from engines import (
    mcp,
    mcp_supply_chain_engine,
    mcp_mes_engine,
    mcp_order_engine,
    mcp_material_engine,
)

# ---------------------------
# API key middleware
# ---------------------------
_TRUSTED_NETS = ("127.", "172.16.", "172.17.", "172.18.", "172.19.", "172.20.",
                  "172.21.", "172.22.", "172.23.", "172.24.", "172.25.", "172.26.",
                  "172.27.", "172.28.", "172.29.", "172.30.", "172.31.", "10.", "192.168.")


class APIKeyMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # CORS preflight and health check are exempt — OPTIONS carries no credentials
        # by design, and the follow-up POST will still be key-checked.
        if request.method == "OPTIONS" or request.url.path == "/health":
            return await call_next(request)

        expected = os.environ.get("MCP_API_KEY")
        if not expected:
            return await call_next(request)

        # Requests from localhost / internal Docker / RFC-1918 ranges skip the key check.
        # This allows MCP Inspector (or any dev tool) running on the same host to
        # connect without a header, while external traffic still requires the key.
        client_ip = request.client.host if request.client else ""
        if any(client_ip.startswith(prefix) for prefix in _TRUSTED_NETS):
            return await call_next(request)

        if request.headers.get("X-MCP-API-Key") != expected:
            return JSONResponse({"detail": "Forbidden"}, status_code=403)
        return await call_next(request)


# ---------------------------
# Build transport apps
# ---------------------------

# Streamable HTTP (existing)
mcp_http          = mcp.streamable_http_app()
mcp_http_sc       = mcp_supply_chain_engine.streamable_http_app()
mcp_http_mes      = mcp_mes_engine.streamable_http_app()
mcp_http_order    = mcp_order_engine.streamable_http_app()
mcp_http_material = mcp_material_engine.streamable_http_app()

# SSE (new)
mcp_sse          = mcp.sse_app()
mcp_sse_sc       = mcp_supply_chain_engine.sse_app()
mcp_sse_mes      = mcp_mes_engine.sse_app()
mcp_sse_order    = mcp_order_engine.sse_app()
mcp_sse_material = mcp_material_engine.sse_app()

_all_sub_apps = [
    mcp_http, mcp_http_sc, mcp_http_mes, mcp_http_order, mcp_http_material,
    mcp_sse,  mcp_sse_sc,  mcp_sse_mes,  mcp_sse_order,  mcp_sse_material,
]

# ---------------------------
# Lifespan: start all session managers
# ---------------------------
async def _notify_complete(job_id: str, update: dict) -> None:
    """Publish async_tool_complete to switch-service after a job finishes."""
    async with httpx.AsyncClient(timeout=5) as c:
        resp = await c.get(f"{BACKEND_URL}/async-jobs/{job_id}")
        job = resp.json() if resp.is_success else {}
    payload = {
        "type": "async_tool_complete",
        "thread_id": job.get("thread_id", ""),
        "job_id": job_id,
        "job_result": update.get("result"),
        "error": update.get("error"),
        "idempotency_key": f"job:{job_id}",
    }
    async with httpx.AsyncClient(timeout=5) as c:
        await c.post(SWITCH_URL, json={
            "sender": str(EMAIL_NODE),
            "content": json.dumps(payload),
            "recipients": [str(EMAIL_NODE)],
        })


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    job_store.set_notify_callback(_notify_complete)
    async with contextlib.AsyncExitStack() as stack:
        for sub in _all_sub_apps:
            await stack.enter_async_context(sub.router.lifespan_context(app))
        yield


# ---------------------------
# FastAPI app
# ---------------------------
app = FastAPI(
    title="enterprise applications",
    description="A service that serves enterprise applications",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(APIKeyMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["mcp-session-id"],
)

# --- Streamable HTTP mounts (existing paths) ---
app.mount("/mcp/supply_chain_engine", mcp_http_sc)
app.mount("/mcp/mes_engine",          mcp_http_mes)
app.mount("/mcp/order_engine",        mcp_http_order)
app.mount("/mcp/material_engine",     mcp_http_material)
app.mount("/mcp",                     mcp_http)

# --- SSE mounts (new paths) ---
app.mount("/sse/supply_chain_engine", mcp_sse_sc)
app.mount("/sse/mes_engine",          mcp_sse_mes)
app.mount("/sse/order_engine",        mcp_sse_order)
app.mount("/sse/material_engine",     mcp_sse_material)
app.mount("/sse",                     mcp_sse)

# ---------------------------
# Async job debug endpoints
# ---------------------------
@app.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Proxy to auth-service — useful for smoke testing."""
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.get(f"{BACKEND_URL}/async-jobs/{job_id}")
    if r.status_code == 404:
        raise HTTPException(404, "Job not found")
    return r.json()


@app.post("/jobs/{job_id}/complete")
async def force_complete_job(job_id: str, body: dict):
    """Force-complete a job with a given result — for smoke testing only."""
    async with httpx.AsyncClient(timeout=5) as c:
        r = await c.put(f"{BACKEND_URL}/async-jobs/{job_id}", json={
            "status": "completed",
            "result": body,
        })
    if r.status_code == 404:
        raise HTTPException(404, "Job not found")
    return r.json()


# ---------------------------
# Health check
# ---------------------------
@app.get("/health")
async def health_check():
    return {"status": "ok"}


# ---------------------------
# Run standalone
# ---------------------------
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=9500)
