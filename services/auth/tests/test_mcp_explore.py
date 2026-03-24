"""
Tests for POST /mcp/explore — the MCP server probe endpoint.

Uses httpx.AsyncClient as the test client and respx to mock upstream HTTP.
Run with:  pytest services/auth/tests/test_mcp_explore.py -v
"""

import json
import pytest
import pytest_asyncio
import respx
import httpx
from httpx import AsyncClient, ASGITransport

# ---------------------------------------------------------------------------
# Shared MCP response fixtures
# ---------------------------------------------------------------------------

INIT_RESPONSE = {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "serverInfo": {"name": "TestServer", "version": "1.0"},
    },
}

TOOLS_RESPONSE = {
    "jsonrpc": "2.0",
    "id": 2,
    "result": {
        "tools": [
            {
                "name": "calculate_expression",
                "description": "Calculates a math expression.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "expression": {"type": "string", "description": "Math expression"}
                    },
                    "required": ["expression"],
                },
            }
        ]
    },
}

TOOLS_RESPONSE_SSE = f"data: {json.dumps(TOOLS_RESPONSE)}\n\n"


@pytest.fixture
def app():
    """Import app here so the DB / settings env is set before import."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from main import app
    return app


@pytest_asyncio.fixture
async def client(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_explore_returns_tools(client):
    """Happy path: initialize → notifications/initialized → tools/list."""
    respx.post("http://test-mcp/").mock(side_effect=[
        httpx.Response(200, json=INIT_RESPONSE, headers={"mcp-session-id": "sess-1"}),
        httpx.Response(202),           # notifications/initialized
        httpx.Response(200, json=TOOLS_RESPONSE),
    ])
    respx.delete("http://test-mcp/").mock(return_value=httpx.Response(200))

    r = await client.post("/mcp/explore", json={"url": "http://test-mcp"})
    assert r.status_code == 200
    body = r.json()
    assert body["server_name"] == "TestServer"
    assert len(body["tools"]) == 1
    assert body["tools"][0]["name"] == "calculate_expression"
    assert body["tools"][0]["input_schema"]["properties"]["expression"]["type"] == "string"


@pytest.mark.asyncio
@respx.mock
async def test_explore_sse_encoded_response(client):
    """tools/list response arrives as SSE-encoded data."""
    respx.post("http://sse-mcp/").mock(side_effect=[
        httpx.Response(200, json=INIT_RESPONSE, headers={"mcp-session-id": "sess-2"}),
        httpx.Response(202),           # notifications/initialized
        httpx.Response(200, text=TOOLS_RESPONSE_SSE,
                       headers={"content-type": "text/event-stream"}),
    ])
    respx.delete("http://sse-mcp/").mock(return_value=httpx.Response(200))

    r = await client.post("/mcp/explore", json={"url": "http://sse-mcp"})
    assert r.status_code == 200
    assert len(r.json()["tools"]) == 1


@pytest.mark.asyncio
@respx.mock
async def test_explore_no_tools(client):
    """Server is reachable but has no tools."""
    empty_tools = {"jsonrpc": "2.0", "id": 2, "result": {"tools": []}}
    respx.post("http://empty-mcp/").mock(side_effect=[
        httpx.Response(200, json=INIT_RESPONSE, headers={"mcp-session-id": "sess-3"}),
        httpx.Response(202),
        httpx.Response(200, json=empty_tools),
    ])
    respx.delete("http://empty-mcp/").mock(return_value=httpx.Response(200))

    r = await client.post("/mcp/explore", json={"url": "http://empty-mcp"})
    assert r.status_code == 200
    assert r.json()["tools"] == []


@pytest.mark.asyncio
@respx.mock
async def test_explore_forwards_api_key(client):
    """X-MCP-API-Key header is forwarded to the upstream MCP server."""
    captured = {}

    def capture_and_respond(request: httpx.Request):
        captured["key"] = request.headers.get("X-MCP-API-Key")
        if b'"initialize"' in request.content:
            return httpx.Response(200, json=INIT_RESPONSE,
                                  headers={"mcp-session-id": "sess-4"})
        return httpx.Response(200, json=TOOLS_RESPONSE)

    call_count = 0
    def capture_and_respond_with_notif(request: httpx.Request):
        nonlocal call_count
        call_count += 1
        captured["key"] = request.headers.get("X-MCP-API-Key")
        if b'"initialize"' in request.content:
            return httpx.Response(200, json=INIT_RESPONSE, headers={"mcp-session-id": "sess-4"})
        if b'"notifications/initialized"' in request.content:
            return httpx.Response(202)
        return httpx.Response(200, json=TOOLS_RESPONSE)

    respx.post("http://auth-mcp/").mock(side_effect=capture_and_respond_with_notif)
    respx.delete("http://auth-mcp/").mock(return_value=httpx.Response(200))

    r = await client.post("/mcp/explore", json={"url": "http://auth-mcp", "api_key": "secret-key"})
    assert r.status_code == 200
    assert captured["key"] == "secret-key"


@pytest.mark.asyncio
@respx.mock
async def test_explore_upstream_403(client):
    """Upstream returns 403 → proxy returns 502."""
    respx.post("http://forbidden-mcp/").mock(
        return_value=httpx.Response(403, json={"detail": "Forbidden"})
    )

    r = await client.post("/mcp/explore", json={"url": "http://forbidden-mcp"})
    assert r.status_code == 502
    assert "403" in r.json()["detail"]


@pytest.mark.asyncio
@respx.mock
async def test_explore_upstream_404(client):
    """Upstream returns 404 → proxy returns 502."""
    respx.post("http://missing-mcp/").mock(return_value=httpx.Response(404))

    r = await client.post("/mcp/explore", json={"url": "http://missing-mcp"})
    assert r.status_code == 502


@pytest.mark.asyncio
@respx.mock
async def test_explore_timeout(client):
    """Upstream times out → proxy returns 504."""
    respx.post("http://slow-mcp/").mock(side_effect=httpx.TimeoutException("timeout"))

    r = await client.post("/mcp/explore", json={"url": "http://slow-mcp"})
    assert r.status_code == 504
    assert "timed out" in r.json()["detail"]


@pytest.mark.asyncio
@respx.mock
async def test_explore_connection_error(client):
    """Upstream is unreachable → proxy returns 502."""
    respx.post("http://unreachable-mcp/").mock(
        side_effect=httpx.ConnectError("connection refused")
    )

    r = await client.post("/mcp/explore", json={"url": "http://unreachable-mcp"})
    assert r.status_code == 502


@pytest.mark.asyncio
@respx.mock
async def test_explore_session_cleanup_on_success(client):
    """DELETE is called to clean up the session after tools/list."""
    delete_called = {}

    respx.post("http://cleanup-mcp/").mock(side_effect=[
        httpx.Response(200, json=INIT_RESPONSE, headers={"mcp-session-id": "sess-99"}),
        httpx.Response(202),
        httpx.Response(200, json=TOOLS_RESPONSE),
    ])
    respx.delete("http://cleanup-mcp/").mock(
        side_effect=lambda req: (delete_called.update({"id": req.headers.get("mcp-session-id")})
                                 or httpx.Response(200))
    )

    r = await client.post("/mcp/explore", json={"url": "http://cleanup-mcp"})
    assert r.status_code == 200
    assert delete_called.get("id") == "sess-99"
