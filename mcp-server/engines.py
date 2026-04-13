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
    """Calls the allocator material-impact-assessment endpoint (Mode A) and returns the rating."""
    import os
    import httpx

    business_id = data.get("business_id")
    message_id = data.get("message_id")
    event_type = data.get("type")
    source = data.get("source")
    recipients = data.get("recipients", [])
    supply_id = data.get("supply_id", "")
    delivery_delay_days = int(data.get("delivery_delay_days", 0))
    # accept both naming conventions
    quantity_decrease_pct = float(
        data.get("quantity_decrease_pct", data.get("quantity_decrease_percentage", 0))
    )
    case_id = data.get("case_id")
    plan_run_id = data.get("plan_run_id")

    allocator_url = os.environ.get("ALLOCATOR_BACKEND_URL", "http://allocator-backend:8000")

    # Pre-computed material impact from material_engine (Mode B); falls back to Mode A if absent.
    material_impact = data.get("material_impact")

    assessment: Dict[str, Any] = {}
    if supply_id and case_id is not None:
        req_body: Dict[str, Any] = {
            "supplyId": supply_id,
            "deliveryDelayDays": delivery_delay_days,
            "quantityDecreasePct": quantity_decrease_pct,
            "caseId": int(case_id),
        }
        if plan_run_id is not None:
            req_body["planRunId"] = int(plan_run_id)
        # Pass pre-computed impact as Mode B when available (more accurate than sync pegging walk)
        if material_impact and isinstance(material_impact, dict) and "impacts" in material_impact:
            req_body["impact"] = material_impact
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(
                    f"{allocator_url}/material-impact-assessment",
                    json=req_body,
                )
                if resp.status_code == 200:
                    assessment = resp.json()
                else:
                    assessment = {
                        "error": f"assessment returned HTTP {resp.status_code}",
                        "detail": resp.text,
                    }
        except Exception as exc:
            assessment = {"error": f"assessment unavailable: {exc}"}
    else:
        assessment = {"error": "supply_id and case_id are required for assessment"}

    rating = assessment.get("rating", "MEDIUM")
    explanation = assessment.get("explanation", "")

    return {
        "status": "processed",
        "rating": rating,
        "explanation": explanation,
        "assessment": assessment,
        "business_id": business_id,
        "message_id": message_id,
        "type": event_type,
        "source": source,
        "recipients": recipients,
        "supply_id": supply_id,
        "delivery_delay_days": delivery_delay_days,
        "quantity_decrease_pct": quantity_decrease_pct,
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
    Material engine tool. Submits a material impact re-plan job to the allocator,
    polls until complete, and returns the enriched result including a diff of
    which committed demands would degrade under the proposed supply change.

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

    The engine polls the allocator asynchronously and returns the full result directly
    (no job_id exposed to the caller). The result includes a `material_impact` field
    with `baselinePlanRunId`, `contingentPlanRunId`, and the list of impacted demands
    showing baselineCommittedQty vs contingentCommittedQty for each.
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

    # Submit async re-plan job and poll for result
    material_impact: Dict[str, Any] = {}
    if supply_id:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                # 1. Submit
                submit_resp = await client.post(
                    f"{allocator_url}/material-impact",
                    json={
                        "supplyId": supply_id,
                        "deliveryDelayDays": delivery_delay_days,
                        "quantityDecreasePct": quantity_decrease_pct,
                    },
                )
                if submit_resp.status_code != 202:
                    material_impact = {
                        "error": f"allocator returned HTTP {submit_resp.status_code}",
                        "detail": submit_resp.text,
                    }
                else:
                    job_id = submit_resp.json().get("jobId")
                    if not job_id:
                        material_impact = {"error": "allocator did not return a jobId"}
                    else:
                        # 2. Poll with exponential back-off (max ~120s total)
                        delay = 1.0
                        max_delay = 8.0
                        max_wait = 120.0
                        elapsed = 0.0
                        while elapsed < max_wait:
                            await asyncio.sleep(delay)
                            elapsed += delay
                            delay = min(delay * 2, max_delay)

                            poll_resp = await client.get(
                                f"{allocator_url}/material-impact/status/{job_id}"
                            )
                            if poll_resp.status_code != 200:
                                material_impact = {
                                    "error": f"poll returned HTTP {poll_resp.status_code}",
                                    "detail": poll_resp.text,
                                }
                                break
                            poll_body = poll_resp.json()
                            status = poll_body.get("status", "unknown")
                            if status == "completed":
                                material_impact = poll_body.get("result", {})
                                break
                            elif status == "failed":
                                material_impact = {
                                    "error": f"re-plan job failed: {poll_body.get('error', 'unknown')}",
                                }
                                break
                            # still running — keep polling
                        else:
                            material_impact = {"error": f"re-plan timed out after {max_wait}s"}
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
