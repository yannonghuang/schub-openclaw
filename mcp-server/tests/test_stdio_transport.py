"""
Tests for the stdio MCP transport via stdio_server.py.

Each test spawns a subprocess and exchanges JSON-RPC messages over stdin/stdout.
The server reads newline-delimited JSON from stdin and writes responses to stdout.
"""

import asyncio
import json
import sys
from pathlib import Path
import pytest

pytestmark = pytest.mark.asyncio

STDIO_SERVER = str(Path(__file__).parent.parent / "stdio_server.py")

INIT_REQUEST = json.dumps({
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "pytest-stdio", "version": "0"},
    },
}) + "\n"

TOOLS_LIST_REQUEST = json.dumps({
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/list",
    "params": {},
}) + "\n"


async def _exchange(engine: str, *messages: str, timeout: float = 10.0) -> list[dict]:
    """
    Spawn stdio_server.py for the given engine, send messages, collect responses.
    Returns one parsed JSON-RPC response per message.
    """
    proc = await asyncio.create_subprocess_exec(
        sys.executable, STDIO_SERVER, "--engine", engine,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )

    stdin_data = "".join(messages).encode()
    try:
        stdout, _ = await asyncio.wait_for(
            proc.communicate(stdin_data), timeout=timeout
        )
    finally:
        if proc.returncode is None:
            proc.kill()

    responses = []
    for line in stdout.decode().splitlines():
        line = line.strip()
        if line:
            try:
                responses.append(json.loads(line))
            except json.JSONDecodeError:
                pass  # skip non-JSON lines (e.g. log output)
    return responses


# ------------------------------------------------------------------
# mytools — calculate_expression
# ------------------------------------------------------------------
async def test_stdio_initialize_mytools():
    responses = await _exchange("mytools", INIT_REQUEST)
    init_resp = next((r for r in responses if r.get("id") == 1), None)
    assert init_resp is not None, f"No init response; got: {responses}"
    assert init_resp["result"]["protocolVersion"] == "2024-11-05"


async def test_stdio_tools_list_mytools():
    responses = await _exchange("mytools", INIT_REQUEST, TOOLS_LIST_REQUEST)
    tools_resp = next((r for r in responses if r.get("id") == 2), None)
    assert tools_resp is not None, f"No tools/list response; got: {responses}"
    tool_names = [t["name"] for t in tools_resp["result"]["tools"]]
    assert "calculate_expression" in tool_names


async def test_stdio_calculate_expression():
    call_request = json.dumps({
        "jsonrpc": "2.0",
        "id": 3,
        "method": "tools/call",
        "params": {
            "name": "calculate_expression",
            "arguments": {"input": {"expression": "2 + 3 * 4"}},
        },
    }) + "\n"

    responses = await _exchange("mytools", INIT_REQUEST, TOOLS_LIST_REQUEST, call_request)
    call_resp = next((r for r in responses if r.get("id") == 3), None)
    assert call_resp is not None, f"No tools/call response; got: {responses}"

    content = call_resp["result"]["content"]
    # Content is a list of {type, text} items; parse the text as JSON
    result_text = next(c["text"] for c in content if c.get("type") == "text")
    result = json.loads(result_text)
    assert result["result"] == pytest.approx(14.0)


# ------------------------------------------------------------------
# Engine stdio — initialize + tools/list checks
# ------------------------------------------------------------------
@pytest.mark.parametrize("engine,expected_tool", [
    ("supply_chain_engine", "supply_chain_engine"),
    ("mes_engine",          "mes_engine"),
    ("order_engine",        "order_engine"),
    ("material_engine",     "material_engine"),
])
async def test_stdio_engine_tools_list(engine: str, expected_tool: str):
    responses = await _exchange(engine, INIT_REQUEST, TOOLS_LIST_REQUEST)
    tools_resp = next((r for r in responses if r.get("id") == 2), None)
    assert tools_resp is not None, f"No tools/list response for {engine}; got: {responses}"
    tool_names = [t["name"] for t in tools_resp["result"]["tools"]]
    assert expected_tool in tool_names
