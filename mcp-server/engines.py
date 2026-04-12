# engines.py
# Centralizes all FastMCP engine instances and tool registrations.
# Imported by main.py (HTTP + SSE mounts) and stdio_server.py (stdio transport).

import ast
import asyncio
import operator
import time
import uuid
from typing import Any, Dict

from mcp.server.fastmcp import FastMCP
from pydantic import BaseModel

# ---------------------------
# Safe math evaluator
# ---------------------------
_operators = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.Pow: operator.pow,
    ast.Mod: operator.mod,
    ast.USub: operator.neg,
}


def safe_eval(expr: str) -> float:
    """Safely evaluate a mathematical expression using AST."""
    def _eval(node):
        if isinstance(node, ast.Num):
            return node.n
        elif isinstance(node, ast.BinOp):
            return _operators[type(node.op)](_eval(node.left), _eval(node.right))
        elif isinstance(node, ast.UnaryOp):
            return _operators[type(node.op)](_eval(node.operand))
        else:
            raise ValueError(f"Unsupported expression: {expr}")

    node = ast.parse(expr, mode="eval").body
    return _eval(node)


# ---------------------------
# Engine instances
# ---------------------------
mcp = FastMCP("MyTools", streamable_http_path="/")
mcp_supply_chain_engine = FastMCP("supply_chain_engine", streamable_http_path="/")
mcp_mes_engine = FastMCP("mes_engine", streamable_http_path="/")
mcp_order_engine = FastMCP("order_engine", streamable_http_path="/")
mcp_material_engine = FastMCP("material_engine", streamable_http_path="/")

# ---------------------------
# Tool definitions
# ---------------------------
class CalculatorInput(BaseModel):
    expression: str


class CalculatorOutput(BaseModel):
    result: float


@mcp.tool()
async def calculate_expression(input: CalculatorInput):
    """Calculates a mathematical expression safely."""
    result = safe_eval(input.expression)
    return CalculatorOutput(result=result)


@mcp_supply_chain_engine.tool()
async def supply_chain_engine(payload: Dict[str, Any]):
    """
    Supply Chain engine tool.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - "payload" must be an object (dictionary).
    - Example tool call:

    {
      "payload": {
        "business_id": 42,
        "message_id": 100,
        "type": "Planning",
        "source": 1,
        "recipients": [2, 500],
        "quantity_decrease_percentage": 10,
        "delivery_delay_days": 3
      }
    }
    """
    data = payload
    print(f"supply_chain_engine() input payload: {data}")

    business_id = data.get("business_id")
    message_id = data.get("message_id")
    event_type = data.get("type")
    source = data.get("source")
    recipients = data.get("recipients", [])
    quantity_decrease_percentage = data.get("quantity_decrease_percentage", 0)
    delivery_delay_days = data.get("delivery_delay_days", 0)

    time.sleep(5)

    return {
        "status": "processed",
        "impact": "high" if quantity_decrease_percentage > 5 or delivery_delay_days > 5 else "low",
        "received_payload": data,
        "business_id": business_id,
        "message_id": message_id,
        "type": event_type,
        "source": source,
        "recipients": recipients,
    }


@mcp_mes_engine.tool()
async def mes_engine(payload: Dict[str, Any]):
    """
    MES engine tool.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - "payload" must be an object (dictionary).
    - Example tool call:

    {
      "payload": {
        "business_id": 42,
        "message_id": 100,
        "type": "WIP",
        "source": 1,
        "recipients": [2, 500],
        "quantity_decrease_percentage": 10,
        "delivery_delay_days": 3
      }
    }
    """
    data = payload
    print(f"mes_engine() input payload: {data}")

    business_id = data.get("business_id")
    message_id = data.get("message_id")
    event_type = data.get("type")
    source = data.get("source")
    recipients = data.get("recipients", [])
    quantity_decrease_percentage = data.get("quantity_decrease_percentage", 0)
    delivery_delay_days = data.get("delivery_delay_days", 0)

    time.sleep(5)

    return {
        "status": "processed",
        "impact": "high" if quantity_decrease_percentage > 5 or delivery_delay_days > 5 else "low",
        "received_payload": data,
        "business_id": business_id,
        "message_id": message_id,
        "type": event_type,
        "source": source,
        "recipients": recipients,
    }


async def _order_engine_body(data: Dict[str, Any]) -> Dict[str, Any]:
    """Long-running order analysis. Runs as a background job."""
    business_id = data.get("business_id")
    message_id = data.get("message_id")
    event_type = data.get("type")
    source = data.get("source")
    recipients = data.get("recipients", [])
    quantity_decrease_percentage = data.get("quantity_decrease_percentage", 0)
    delivery_delay_days = data.get("delivery_delay_days", 0)

    # Simulate long-running work (replace with real order analysis logic)
    await asyncio.sleep(10)

    return {
        "status": "processed",
        "impact": "high" if quantity_decrease_percentage > 5 or delivery_delay_days > 5 else "low",
        "business_id": business_id,
        "message_id": message_id,
        "type": event_type,
        "source": source,
        "recipients": recipients,
    }


@mcp_order_engine.tool()
async def order_engine(payload: Dict[str, Any]):
    """
    Order engine tool. Runs asynchronously — returns immediately with a job token.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - "payload" must be an object (dictionary).
    - Include "_thread_id" (injected by LangGraph) so the graph can be resumed.
    - Example tool call:

    {
      "payload": {
        "business_id": 42,
        "message_id": 100,
        "type": "Order",
        "source": 1,
        "recipients": [2, 500],
        "quantity_decrease_percentage": 10,
        "delivery_delay_days": 3
      }
    }
    """
    import job_store as _js

    data = dict(payload)
    thread_id = data.pop("_thread_id", None)
    session_key = data.pop("_session_key", None)
    agent_id = data.pop("_agent_id", None)
    business_id = data.get("business_id", 0)
    job_id = str(uuid.uuid4())

    print(f"order_engine() submitting async job {job_id} for session {session_key or thread_id!r}")

    await _js.submit_job(
        job_id=job_id,
        thread_id=thread_id,
        business_id=business_id,
        engine_name="order_engine",
        payload=data,
        engine_fn=_order_engine_body,
        session_key=session_key,
        agent_id=agent_id,
    )

    return {
        "status": "pending",
        "job_id": job_id,
        "message": "Order analysis job submitted. You will be notified when complete.",
    }


@mcp_material_engine.tool()
async def material_engine(payload: Dict[str, Any]):
    """
    Material engine tool. Fetches supply details and computes demand impacts
    via the allocator app, then returns the enriched result.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - "payload" must be an object (dictionary).
    - Example tool call:

    {
      "payload": {
        "business_id": 42,
        "message_id": 100,
        "type": "Material",
        "source": 1,
        "recipients": [1],
        "supply_id": "100-0018_1000_11/21/2024",
        "delivery_delay_days": 30,
        "quantity_decrease_pct": 0
      }
    }
    """
    import os
    import httpx

    data = dict(payload)
    print(f"material_engine() input payload: {data}")

    business_id = data.get("business_id")
    message_id = data.get("message_id")
    original_event_type = data.get("type")
    source = data.get("source")
    recipients = data.get("recipients", [])
    supply_id = data.get("supply_id", "")
    delivery_delay_days = int(data.get("delivery_delay_days", 0))
    quantity_decrease_pct = float(data.get("quantity_decrease_pct", 0.0))

    allocator_url = os.environ.get("ALLOCATOR_BACKEND_URL", "http://allocator-backend:8000")

    # Call the allocator material-impact endpoint
    material_impact: Dict[str, Any] = {}
    if supply_id:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{allocator_url}/material-impact",
                    json={
                        "supplyId": supply_id,
                        "deliveryDelayDays": delivery_delay_days,
                        "quantityDecreasePct": quantity_decrease_pct,
                    },
                )
                if resp.status_code == 200:
                    material_impact = resp.json()
                else:
                    material_impact = {
                        "error": f"allocator returned HTTP {resp.status_code}",
                        "detail": resp.text,
                    }
        except Exception as exc:
            material_impact = {"error": f"allocator unavailable: {exc}"}
    else:
        material_impact = {"error": "supply_id not provided in payload"}

    return {
        "business_id": business_id,
        "message_id": message_id,
        "type": original_event_type,
        "source": source,
        "recipients": recipients,
        "supply_id": supply_id,
        "delivery_delay_days": delivery_delay_days,
        "quantity_decrease_pct": quantity_decrease_pct,
        "material_impact": material_impact,
    }


# ---------------------------
# Registry: name → engine
# ---------------------------
ENGINES: Dict[str, FastMCP] = {
    "mytools": mcp,
    "supply_chain_engine": mcp_supply_chain_engine,
    "mes_engine": mcp_mes_engine,
    "order_engine": mcp_order_engine,
    "material_engine": mcp_material_engine,
}
