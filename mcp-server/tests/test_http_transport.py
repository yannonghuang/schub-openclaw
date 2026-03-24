"""
Tests for the streamable HTTP MCP transport.
Covers /mcp (mytools) and engine sub-paths.
"""

import json
import pytest
from httpx import AsyncClient

from tests.conftest import mcp_initialize, mcp_tools_list, INIT_PARAMS

pytestmark = pytest.mark.asyncio


async def test_health(client: AsyncClient):
    """Health endpoint is exempt from API key check."""
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


async def test_missing_api_key_returns_403(client: AsyncClient):
    """Requests without the API key header must be rejected."""
    r = await client.post(
        "/mcp/",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={"X-MCP-API-Key": ""},  # override the default test key
    )
    assert r.status_code == 403


async def test_wrong_api_key_returns_403(client: AsyncClient):
    r = await client.post(
        "/mcp/",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        headers={"X-MCP-API-Key": "wrong-key"},
    )
    assert r.status_code == 403


# ------------------------------------------------------------------
# /mcp  (MyTools — calculate_expression)
# ------------------------------------------------------------------
async def test_mcp_initialize(client: AsyncClient):
    r = await mcp_initialize(client, "/mcp/")
    # Streamable HTTP returns either 200 JSON or 200 SSE
    assert r.status_code == 200


async def test_mcp_tools_list_contains_calculator(client: AsyncClient):
    # initialize first to get session
    init_r = await mcp_initialize(client, "/mcp/")
    session_id = init_r.headers.get("mcp-session-id")

    r = await mcp_tools_list(client, "/mcp/", session_id)
    assert r.status_code == 200

    body = r.text
    # Response may be JSON or SSE-encoded JSON
    if body.startswith("data:"):
        payload = json.loads(body.split("data:", 1)[1].strip())
    else:
        payload = r.json()

    tool_names = [t["name"] for t in payload["result"]["tools"]]
    assert "calculate_expression" in tool_names


# ------------------------------------------------------------------
# Engine sub-paths — just verify they're reachable and return tools
# ------------------------------------------------------------------
@pytest.mark.parametrize("path,expected_tool", [
    ("/mcp/supply_chain_engine/", "supply_chain_engine"),
    ("/mcp/mes_engine/",          "mes_engine"),
    ("/mcp/order_engine/",        "order_engine"),
    ("/mcp/material_engine/",     "material_engine"),
])
async def test_engine_http_tools_list(client: AsyncClient, path: str, expected_tool: str):
    init_r = await mcp_initialize(client, path)
    assert init_r.status_code == 200

    session_id = init_r.headers.get("mcp-session-id")
    r = await mcp_tools_list(client, path, session_id)
    assert r.status_code == 200

    body = r.text
    if body.startswith("data:"):
        payload = json.loads(body.split("data:", 1)[1].strip())
    else:
        payload = r.json()

    tool_names = [t["name"] for t in payload["result"]["tools"]]
    assert expected_tool in tool_names
