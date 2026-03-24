"""
Tests for the SSE MCP transport.
Covers /sse (mytools) and engine sub-paths.

SSE transport protocol:
  GET  /{path}/sse      → opens event stream; first event is "endpoint" with POST URL
  POST /{path}/messages → client sends JSON-RPC; server pushes response on SSE stream
"""

import asyncio
import json
import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.asyncio

INIT_PARAMS = {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "pytest-sse", "version": "0"},
}


# ------------------------------------------------------------------
# /sse  (MyTools)
# ------------------------------------------------------------------
async def test_sse_endpoint_opens(client: AsyncClient):
    """GET /sse/ should respond with text/event-stream."""
    async with client.stream("GET", "/sse/sse") as r:
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/event-stream" in ct

        # First event must be "endpoint" carrying the POST URL
        async for raw_line in r.aiter_lines():
            line = raw_line.strip()
            if line.startswith("data:"):
                data = line[len("data:"):].strip()
                assert "/messages" in data
                await r.aclose()  # explicitly close — do NOT let httpx drain an infinite stream
                break


async def test_sse_initialize_roundtrip(client: AsyncClient):
    """
    Full SSE round-trip:
      1. Open SSE stream to get the messages URL
      2. POST initialize to that URL
      3. Read the response event from the SSE stream
    """
    sse_events: asyncio.Queue = asyncio.Queue()

    async def consume_sse():
        async with client.stream("GET", "/sse/sse") as r:
            async for line in r.aiter_lines():
                line = line.strip()
                if line.startswith("data:"):
                    await sse_events.put(line[len("data:"):].strip())

    sse_task = asyncio.create_task(consume_sse())

    try:
        # Wait for the endpoint event
        messages_path = await asyncio.wait_for(sse_events.get(), timeout=5)
        assert "/messages" in messages_path

        # POST initialize
        r = await client.post(
            messages_path,
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INIT_PARAMS},
        )
        assert r.status_code in (200, 202)

        # Read the response pushed onto the SSE stream
        response_data = await asyncio.wait_for(sse_events.get(), timeout=5)
        payload = json.loads(response_data)
        assert payload["result"]["protocolVersion"] == "2024-11-05"
    finally:
        sse_task.cancel()
        await asyncio.gather(sse_task, return_exceptions=True)


# ------------------------------------------------------------------
# Engine SSE sub-paths — connectivity check only
# ------------------------------------------------------------------
@pytest.mark.parametrize("sse_path", [
    "/sse/supply_chain_engine/sse",
    "/sse/mes_engine/sse",
    "/sse/order_engine/sse",
    "/sse/material_engine/sse",
])
async def test_engine_sse_opens(client: AsyncClient, sse_path: str):
    async with client.stream("GET", sse_path) as r:
        assert r.status_code == 200
        ct = r.headers.get("content-type", "")
        assert "text/event-stream" in ct

        async for raw_line in r.aiter_lines():
            line = raw_line.strip()
            if line.startswith("data:"):
                data = line[len("data:"):].strip()
                assert "/messages" in data
                await r.aclose()  # explicitly close — do NOT let httpx drain an infinite stream
                break
