import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Use a fixed test key; middleware only enforces when MCP_API_KEY is set.
TEST_API_KEY = "pytest-test-key"
os.environ["MCP_API_KEY"] = TEST_API_KEY


# Import app inside fixture so lifespan runs under pytest-asyncio event loop
@pytest_asyncio.fixture
async def client():
    from main import app
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-MCP-API-Key": TEST_API_KEY},
    ) as c:
        yield c


# ---------------------------
# Shared MCP helpers
# ---------------------------
INIT_PARAMS = {
    "protocolVersion": "2024-11-05",
    "capabilities": {},
    "clientInfo": {"name": "pytest", "version": "0"},
}


async def mcp_initialize(client: AsyncClient, path: str) -> dict:
    """Send MCP initialize and return the result dict."""
    r = await client.post(
        path,
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INIT_PARAMS},
        headers={"Accept": "application/json, text/event-stream"},
    )
    r.raise_for_status()
    return r


async def mcp_tools_list(client: AsyncClient, path: str, session_id: str | None = None) -> list:
    """Send tools/list and return the tools array."""
    headers = {"Accept": "application/json, text/event-stream"}
    if session_id:
        headers["mcp-session-id"] = session_id
    r = await client.post(
        path,
        json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
        headers=headers,
    )
    r.raise_for_status()
    return r
