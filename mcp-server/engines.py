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
mcp_scheduling_engine = FastMCP("scheduling_engine", streamable_http_path="/")

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
async def planning_engine(payload: Dict[str, Any]):
    """
    Planning engine tool. Fetches the impact assessment for a contingent plan run
    and returns the rating, explanation, and impacted demand details.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - "payload" must be an object (dictionary).
    - Example tool call:

    {
      "payload": {
        "business_id": 42,
        "case_id": 19,
        "plan_run_id": 35,
        "contingent_plan_run_id": 47,
        "supply_id": "310-0591_2000_7/3/2024",
        "delivery_delay_days": 0,
        "quantity_decrease_pct": 100,
        "source": 1,
        "recipients": [2]
      }
    }
    """
    import os
    import httpx

    data = dict(payload)
    print(f"planning_engine() input payload: {data}", flush=True)

    business_id = data.get("business_id")
    message_id = data.get("message_id")
    source = data.get("source")
    recipients = data.get("recipients", [])
    case_id = data.get("case_id")
    plan_run_id = data.get("plan_run_id")
    contingent_plan_run_id = data.get("contingent_plan_run_id")
    supply_id = data.get("supply_id", "")
    delivery_delay_days = int(data.get("delivery_delay_days", 0))
    quantity_decrease_pct = float(
        data.get("quantity_decrease_pct", data.get("quantity_decrease_percentage", 0))
    )

    allocator_url = os.environ.get("ALLOCATOR_BACKEND_URL", "http://allocator-backend:8000")

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
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(
                    f"{allocator_url}/material-impact-assessment",
                    json=req_body,
                )
                if resp.status_code == 200:
                    assessment = resp.json()
                    print(
                        f"planning_engine() assessment: rating={assessment.get('rating')} "
                        f"impacted={assessment.get('impactedDemandCount')}",
                        flush=True,
                    )
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
    impacted_demands = assessment.get("impacts", [])

    return {
        "status": "processed",
        "rating": rating,
        "explanation": explanation,
        "assessment": assessment,
        "business_id": business_id,
        "message_id": message_id,
        "source": source,
        "recipients": recipients,
        "case_id": case_id,
        "plan_run_id": plan_run_id,
        "contingent_plan_run_id": contingent_plan_run_id,
        "supply_id": supply_id,
        "delivery_delay_days": delivery_delay_days,
        "quantity_decrease_pct": quantity_decrease_pct,
        "impacted_demand_count": len(impacted_demands),
        "impacted_demands": impacted_demands,
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


async def _fetch_material_impact(
    supply_id: str,
    delivery_delay_days: int,
    quantity_decrease_pct: float,
    plan_run_id: Any,
    allocator_url: str,
) -> Dict[str, Any]:
    """Run an async re-plan and return the MaterialImpactResult dict, or {} on failure."""
    import httpx, asyncio
    post_body: Dict[str, Any] = {
        "supplyId": supply_id,
        "deliveryDelayDays": delivery_delay_days,
        "quantityDecreasePct": quantity_decrease_pct,
        "persist": False,  # bulk/diagnostic call — don't create a contingent plan run
    }
    if plan_run_id is not None:
        post_body["planRunId"] = int(plan_run_id)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{allocator_url}/material-impact", json=post_body)
            if r.status_code not in (200, 202):
                print(f"[_fetch_material_impact] submit failed: HTTP {r.status_code}", flush=True)
                return {}
            job_id = r.json().get("jobId")
            if not job_id:
                return {}
            print(f"[_fetch_material_impact] submitted job {job_id}, polling...", flush=True)
            # Poll for result
            loop = asyncio.get_running_loop()
            delay, max_delay, deadline = 1.0, 8.0, loop.time() + 90
            while loop.time() < deadline:
                await asyncio.sleep(delay)
                delay = min(delay * 2, max_delay)
                poll = await client.get(f"{allocator_url}/material-impact/status/{job_id}")
                if poll.status_code != 200:
                    continue
                body = poll.json()
                if body.get("status") == "completed":
                    result = body.get("result", {})
                    print(f"[_fetch_material_impact] job {job_id} complete — {len(result.get('impacts', []))} impacts", flush=True)
                    return result
                if body.get("status") == "failed":
                    print(f"[_fetch_material_impact] job {job_id} failed", flush=True)
                    return {}
    except Exception as exc:
        print(f"[_fetch_material_impact] error: {exc!r}", flush=True)
    return {}


async def _order_engine_body(data: Dict[str, Any]) -> Dict[str, Any]:
    """Runs the order analysis: resolves material impact then calls the assessment endpoint."""
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

    # Resolve material impact:
    # 1. Use pre-computed result if already passed in (e.g. forwarded from material_engine).
    # 2. Otherwise compute it now via the async re-plan endpoint so assessment uses
    #    accurate baseline-committed quantities instead of the pegging-tree approximation.
    material_impact: Dict[str, Any] = data.get("material_impact") or {}
    if not (material_impact and isinstance(material_impact, dict) and "impacts" in material_impact):
        if supply_id:
            print(
                f"[order_engine] material_impact not pre-computed — running fresh re-plan "
                f"(supply={supply_id} delay={delivery_delay_days} qty_pct={quantity_decrease_pct} plan_run_id={plan_run_id})",
                flush=True,
            )
            material_impact = await _fetch_material_impact(
                supply_id, delivery_delay_days, quantity_decrease_pct, plan_run_id, allocator_url
            )
        else:
            print("[order_engine] no supply_id — skipping material impact fetch", flush=True)
    else:
        print(f"[order_engine] using pre-computed material_impact ({len(material_impact.get('impacts', []))} impacts)", flush=True)

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
        if material_impact and "impacts" in material_impact:
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
    # Optional negotiation-chain fields. When supplied, the allocator dedups on
    # (caseId, supply_id, delay, qty, baseline, round) and marks the parent as superseded.
    negotiation_round = data.get("negotiation_round")
    parent_plan_run_id = data.get("parent_plan_run_id")

    allocator_url = os.environ.get("ALLOCATOR_BACKEND_URL", "http://allocator-backend:8000")

    # Submit async re-plan job and poll for result
    material_impact: Dict[str, Any] = {}
    if supply_id:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                submit_body: Dict[str, Any] = {
                    "supplyId": supply_id,
                    "deliveryDelayDays": delivery_delay_days,
                    "quantityDecreasePct": quantity_decrease_pct,
                }
                if negotiation_round is not None:
                    submit_body["negotiationRound"] = int(negotiation_round)
                if parent_plan_run_id is not None:
                    submit_body["parentPlanRunId"] = int(parent_plan_run_id)
                # 1. Submit
                submit_resp = await client.post(
                    f"{allocator_url}/material-impact",
                    json=submit_body,
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
# Scheduling engine — WO shutdown / maintenance window
# ---------------------------
# Wraps the allocator's WO-schedule HTTP routes for the scheduling agent.
# Allocator routes use camelCase; tool payloads use snake_case (matching the
# convention used by the rest of this file). Translation happens at the httpx
# boundary inside each tool.

_ALLOCATOR_ENV_KEY = "ALLOCATOR_BACKEND_URL"
_ALLOCATOR_DEFAULT = "http://allocator-backend:8000"


def _allocator_url() -> str:
    import os
    return os.environ.get(_ALLOCATOR_ENV_KEY, _ALLOCATOR_DEFAULT)


async def _resolve_ids(case_id: Any, plan_run_id: Any) -> Dict[str, Any]:
    """
    Call allocator's GET /resolve to fill in (case_id, plan_run_id) when either
    is missing. Always returns a dict with one of these shapes:
        {"caseId": int, "planRunId": int, "caseSource": str, "runSource": str}
        {"error": str, "reason": str, "detail": str?}
    Resolution rules (allocator side):
      - case_id given: validates it exists.
      - case_id missing: picks latest active=true case; falls back to latest by id.
      - plan_run_id given: validates it exists in the resolved case.
      - plan_run_id missing: picks latest active=true run in the case; falls back to latest by id.
    """
    import httpx

    params: Dict[str, Any] = {}
    if case_id is not None:
        try:
            params["caseId"] = int(case_id)
        except (TypeError, ValueError):
            return {"error": "invalid_input", "reason": f"case_id={case_id!r} is not an int"}
    if plan_run_id is not None:
        try:
            params["planRunId"] = int(plan_run_id)
        except (TypeError, ValueError):
            return {"error": "invalid_input", "reason": f"plan_run_id={plan_run_id!r} is not an int"}

    url = f"{_allocator_url()}/resolve"
    print(f"[scheduling_engine._resolve_ids] GET {url} params={params}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(url, params=params)
            if r.status_code == 200:
                body = r.json()
                print(
                    f"[scheduling_engine._resolve_ids] resolved "
                    f"case={body.get('caseId')}({body.get('caseSource')}) "
                    f"run={body.get('planRunId')}({body.get('runSource')})",
                    flush=True,
                )
                return body
            try:
                err = r.json()
            except Exception:
                err = {"error": "resolve_failed", "reason": r.text}
            err.setdefault("detail", f"HTTP {r.status_code}")
            return err
    except Exception as exc:
        return {"error": "allocator_unreachable", "reason": str(exc)}


@mcp_scheduling_engine.tool()
async def resolve(payload: Dict[str, Any]):
    """
    Resolve the active (case_id, plan_run_id) pair via the allocator. Pass
    either id explicitly to lock that side; pass nothing to discover both.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Example tool call:

    {"payload": {}}                                        # discover both
    {"payload": {"case_id": 19}}                           # discover run only
    {"payload": {"case_id": 19, "plan_run_id": 35}}        # validate both

    Returns on success: {caseId, planRunId, caseSource, runSource}
      where source is "explicit" | "active" | "fallback-latest".
    Returns on failure: {error, reason} — common reasons: no_cases, case_not_found,
      no_runs, run_not_found.

    The other scheduling-engine tools auto-call this internally; you only need
    to call resolve directly when you want to surface the active context to
    the user (e.g. "I'll work with case 19 and plan run 35 — proceed?").
    """
    data = dict(payload) if payload else {}
    return await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))


@mcp_scheduling_engine.tool()
async def list_prod_areas(payload: Dict[str, Any]):
    """
    List production areas (prod_area) present in the baseline plan.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Example tool call:

    {
      "payload": {
        "case_id": 19,
        "plan_run_id": 35,
        "locale": "en"
      }
    }

    Returns: { count, prod_areas: [{ prod_area, wo_count, sample_products }, ...] }
    Use this when the user mentions a prod area but it's ambiguous — pick the
    closest match by name and feed the canonical id into find_wos.

    case_id and plan_run_id are auto-resolved against the active case/run if
    omitted; pass them explicitly to override.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]
    locale = data.get("locale", "en")

    params: Dict[str, Any] = {"locale": locale, "planRunId": int(plan_run_id)}

    url = f"{_allocator_url()}/cases/{int(case_id)}/wo-prod-areas"
    print(f"[scheduling_engine.list_prod_areas] GET {url} params={params}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, params=params)
            if r.status_code != 200:
                return {"error": f"HTTP {r.status_code}", "detail": r.text}
            return r.json()
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


@mcp_scheduling_engine.tool()
async def list_locations(payload: Dict[str, Any]):
    """
    List locations (location_id) present in the baseline plan.

    Same contract as list_prod_areas — wrap inputs in "payload".

    {
      "payload": {
        "case_id": 19,
        "plan_run_id": 35
      }
    }

    Returns: { count, locations: [{ location_id, wo_count }, ...] }

    case_id and plan_run_id are auto-resolved against the active case/run if
    omitted.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]
    locale = data.get("locale", "en")

    params: Dict[str, Any] = {"locale": locale, "planRunId": int(plan_run_id)}

    url = f"{_allocator_url()}/cases/{int(case_id)}/wo-locations"
    print(f"[scheduling_engine.list_locations] GET {url} params={params}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(url, params=params)
            if r.status_code != 200:
                return {"error": f"HTTP {r.status_code}", "detail": r.text}
            return r.json()
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


@mcp_scheduling_engine.tool()
async def find_wos(payload: Dict[str, Any]):
    """
    Find work orders matching the given filters. Returns one row per
    wo_group_id with min(start), max(end), summed quantity, lot count.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Filters are optional except case_id; use them to narrow to the WO set
      you intend to displace. Note: do NOT pass start_before when sizing the
      WO set for a maintenance window — coverage mismatch with the allocator's
      internal computeShifts (see allocator commit d46ef42).
    - Example tool call:

    {
      "payload": {
        "case_id": 19,
        "prod_area": "OE",
        "start_after": "2024-07-15",
        "limit": 200
      }
    }

    Returns: { count, total_unique_gids, total_lots, truncated, wos: [...] }

    case_id and plan_run_id are auto-resolved against the active case/run if
    omitted.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]

    body: Dict[str, Any] = {"plan_run_id": int(plan_run_id)}
    for key in (
        "prod_area", "location_id", "product_id", "method",
        "start_after", "start_before", "limit", "locale",
    ):
        if data.get(key) is not None:
            body[key] = data[key]

    url = f"{_allocator_url()}/cases/{int(case_id)}/wo-find"
    print(f"[scheduling_engine.find_wos] POST {url} body={body}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json=body)
            if r.status_code != 200:
                return {"error": f"HTTP {r.status_code}", "detail": r.text}
            return r.json()
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


def _selectors_to_camel(selectors: Any) -> list:
    """Translate the snake_case selectors list (if any) to the camelCase shape
    the allocator route expects. Selectors typically already use camelCase
    (bucketStart / woGroupIds) since they're echoed back from find_wos rows
    grouped by date — but accept either spelling defensively."""
    if not selectors or not isinstance(selectors, list):
        return []
    out = []
    for s in selectors:
        if not isinstance(s, dict):
            continue
        bucket_start = s.get("bucketStart") or s.get("bucket_start")
        wo_group_ids = s.get("woGroupIds") or s.get("wo_group_ids") or []
        if not bucket_start or not wo_group_ids:
            continue
        out.append({"bucketStart": bucket_start, "woGroupIds": list(wo_group_ids)})
    return out


@mcp_scheduling_engine.tool()
async def analyze_wo_availability(payload: Dict[str, Any]):
    """
    Synchronous safety-envelope probe. Closed-form: returns the largest
    delayDays N such that displacing the front of the bucket by N days leaves
    every demand commit_time unchanged. Use this BEFORE analyze_wo_schedule_impact
    to detect "no-impact" maintenance windows up front.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Example tool call:

    {
      "payload": {
        "case_id": 19,
        "selectors": [
          { "bucketStart": "2024-07-15", "woGroupIds": ["g1", "g2"] }
        ],
        "plan_run_id": 35
      }
    }

    Returns: { caseId, planRunId, matchedWoCount, maxFeasibleDays,
               bottlenecks: [...], bottleneckDemands: [...] }

    case_id and plan_run_id are auto-resolved against the active case/run if
    omitted.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]
    selectors = _selectors_to_camel(data.get("selectors"))
    if not selectors:
        return {"error": "selectors list is required (each with bucketStart and woGroupIds)"}

    body: Dict[str, Any] = {
        "caseId": int(case_id),
        "selectors": selectors,
        "planRunId": int(plan_run_id),
    }

    url = f"{_allocator_url()}/wo-schedule-impact/availability"
    print(f"[scheduling_engine.analyze_wo_availability] POST {url}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json=body)
            if r.status_code != 200:
                return {"error": f"HTTP {r.status_code}", "detail": r.text}
            return r.json()
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


@mcp_scheduling_engine.tool()
async def analyze_wo_schedule_impact(payload: Dict[str, Any]):
    """
    Re-sequence the plan with the given WO shift and return the diff of which
    demands' commit_times move. Submits an async allocator job and polls until
    complete (typically under 30 s; max ~90 s).

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Either delay_days OR delay_to_date is required (not both).
    - persist=true creates a contingent plan run (status="contingent") and
      returns its id as contingentPlanRunId — that is the id you must pass to
      promote_plan_run to commit. Call persist=true at MOST ONCE per session
      and only after the user has confirmed the option.
    - Example tool call:

    {
      "payload": {
        "case_id": 19,
        "selectors": [
          { "bucketStart": "2024-07-15", "woGroupIds": ["g1", "g2"] }
        ],
        "delay_days": 7,
        "persist": true,
        "note": "OE shutdown 2024-07-15 +7d"
      }
    }

    Returns the full WoImpactResult: matchedWoCount, impactedDemandCount,
    impacts[], baselinePlanRunId, contingentPlanRunId (when persist=true), etc.

    case_id and plan_run_id are auto-resolved against the active case/run if
    omitted.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]
    selectors = _selectors_to_camel(data.get("selectors"))
    if not selectors:
        return {"error": "selectors list is required (each with bucketStart and woGroupIds)"}
    delay_days = data.get("delay_days")
    delay_to_date = data.get("delay_to_date")
    if delay_days is None and not delay_to_date:
        return {"error": "either delay_days or delay_to_date is required"}
    if delay_days is not None and delay_to_date:
        return {"error": "delay_days and delay_to_date are mutually exclusive"}

    persist = bool(data.get("persist", False))
    if not persist:
        # Guard: scheduling agent has no legitimate use case for persist=false.
        # Branch A and Branch C both call this tool exactly once with persist=true
        # AFTER user confirmation. Calling with persist=false is the "preview without
        # committing" improvisation that prevents any contingent plan run from being
        # created. The bundled assess_maintenance_options is the right tool for
        # any preview-shaped need.
        return {
            "error": "persist_false_disallowed",
            "hint": (
                "analyze_wo_schedule_impact may only be called with persist=true, "
                "and only after the user has confirmed an option. For Branch B "
                "(delay_days > maxFeasibleDays without prior user accept_impact), "
                "call assess_maintenance_options instead — it atomically generates "
                "all three contingent plan runs (Options A, B, C) and returns their "
                "ids so the user can pick one to promote on the next turn."
            ),
            "redirect_tool": "assess_maintenance_options",
        }

    body: Dict[str, Any] = {
        "caseId": int(case_id),
        "selectors": selectors,
        "persist": persist,
        "planRunId": int(plan_run_id),
    }
    if delay_days is not None:
        body["delayDays"] = int(delay_days)
    if delay_to_date:
        body["delayToDate"] = str(delay_to_date)
    if data.get("note"):
        body["note"] = str(data["note"])

    url = f"{_allocator_url()}/wo-schedule-impact"
    print(f"[scheduling_engine.analyze_wo_schedule_impact] POST {url} persist={body['persist']}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url, json=body)
            if r.status_code not in (200, 202):
                return {"error": f"HTTP {r.status_code}", "detail": r.text}
            job_id = r.json().get("jobId")
            if not job_id:
                return {"error": "allocator did not return a jobId"}
            print(f"[scheduling_engine.analyze_wo_schedule_impact] submitted job {job_id}, polling…", flush=True)

            delay = 1.0
            max_delay = 8.0
            max_wait = 90.0
            elapsed = 0.0
            while elapsed < max_wait:
                await asyncio.sleep(delay)
                elapsed += delay
                delay = min(delay * 2, max_delay)
                poll = await client.get(f"{_allocator_url()}/wo-schedule-impact/status/{job_id}")
                if poll.status_code != 200:
                    return {"error": f"poll HTTP {poll.status_code}", "detail": poll.text}
                pj = poll.json()
                status = pj.get("status", "unknown")
                if status == "completed":
                    return pj.get("result", {})
                if status == "failed":
                    return {"error": "wo-schedule-impact job failed", "detail": pj.get("error", "")}
            return {"error": f"wo-schedule-impact timed out after {max_wait}s"}
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


@mcp_scheduling_engine.tool()
async def execute_safe_plan(payload: Dict[str, Any]):
    """
    Bundles availability check + impact analysis (persist=true) + promote in
    ONE allocator call. Use this for Branch A (the safe path) when the user's
    delay_days is known to fit within the safety envelope. Returns 409 unsafe
    if the window exceeds maxFeasibleDays — caller should fall back to the
    options branch.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Example tool call:

    {
      "payload": {
        "prod_area": "OE",
        "bucket_start": "2024-08-04",
        "delay_days": 7,
        "note": "Scheduling agent — OE shutdown 2024-08-04 +7d (safe)"
      }
    }

    Returns on success: {
      caseId, baselinePlanRunId, contingentPlanRunId, bucketStart, delayDays,
      prodArea, matchedWoCount, maxFeasibleDays, impactedDemandCount (always 0),
      promoted: true, status: "success"
    }
    Returns 409 → {"error": "unsafe", "maxFeasibleDays": N, ...} when the
    window exceeds the safety envelope (use options branch instead).

    case_id and plan_run_id are auto-resolved if omitted.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]
    prod_area = data.get("prod_area")
    bucket_start = data.get("bucket_start")
    delay_days = data.get("delay_days")
    if not prod_area:
        return {"error": "prod_area is required"}
    if not bucket_start:
        return {"error": "bucket_start is required (ISO yyyy-MM-dd)"}
    if delay_days is None:
        return {"error": "delay_days is required"}

    body: Dict[str, Any] = {
        "caseId": int(case_id),
        "planRunId": int(plan_run_id),
        "prodArea": str(prod_area),
        "bucketStart": str(bucket_start),
        "delayDays": int(delay_days),
    }
    if data.get("note"):
        body["note"] = str(data["note"])

    url = f"{_allocator_url()}/wo-schedule-impact/execute-safe"
    print(f"[scheduling_engine.execute_safe_plan] POST {url} body={body}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(url, json=body)
            if r.status_code in (200, 201):
                return r.json()
            if r.status_code == 409:
                # Unsafe — caller fell down Branch A by mistake. Augment with an
                # explicit redirect so the agent doesn't loop on manual analysis.
                body_json = r.json() if r.text else {}
                body_json["hint"] = (
                    "execute_safe_plan refused because delay_days exceeds the safety "
                    "envelope. Do NOT chain analyze_wo_schedule_impact + "
                    "find_earliest_safe_start manually. Call assess_maintenance_options "
                    "with the same prod_area/bucket_start/delay_days — it generates "
                    "Option A (shortened), Option B (deferred safe start), and "
                    "Option C (accept impact) as three persisted contingents and "
                    "returns their CPR ids."
                )
                body_json["redirect_tool"] = "assess_maintenance_options"
                return body_json
            if r.status_code == 404:
                return r.json()  # structured error (no_wos_match / etc.)
            return {"error": f"HTTP {r.status_code}", "detail": r.text}
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


@mcp_scheduling_engine.tool()
async def assess_maintenance_options(payload: Dict[str, Any]):
    """
    Bundled assessment of a maintenance window's three options in a single
    deterministic server call. Calls the allocator endpoints in sequence:
      (1) wo-find → collect WO gids in prod_area starting on/after bucket_start
      (2) wo-schedule-impact (persist=true, delay=N) → Option C contingent
      (3) earliest-safe-start → alternate_start_date
      (4) wo-schedule-impact (persist=true, delay=max_feasible_days) → Option A
      (5) wo-schedule-impact (persist=true, bucketStart=alternate, delay=N) → Option B
          (skipped if no_safe_start_within_horizon)

    PREFER THIS over chaining find_wos / analyze_wo_availability /
    analyze_wo_schedule_impact x3 / find_earliest_safe_start by hand — the
    bundled tool is atomic and guarantees every option has a contingent.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Example tool call:

    {
      "payload": {
        "prod_area": "OE",
        "bucket_start": "2024-07-15",
        "delay_days": 7
      }
    }

    Optional `locale` payload field selects the language of `optionBParagraph`
    ("en" default, "zh" supported).

    Returns on success: {
      caseId, planRunId, prodArea, bucketStart, delayDays, maxFeasibleDays,
      matchedWoCount, woGroupIds, alternateStartDate, bottleneckGid, bottleneckEnd,
      optionACprId, optionBCprId, optionCCprId,
      optionBStatus: "ok" | "no_safe_start_within_horizon" | "no_op_at_alt_start",
      optionBParagraph: localized Option-2 markdown paragraph (heading + body
        + call-to-action) ready to paste verbatim under the Option 2 slot,
        OR null when optionBStatus is "no_safe_start_within_horizon" (Option 2
        should be omitted entirely),
      impactedDemandCount, impacts[]
    }

    optionBStatus disambiguates Option B's outcome:
      - "ok": real CPR generated; the paragraph shows the deferred date + CPR.
      - "no_safe_start_within_horizon": ESS exhausted; paragraph is null →
        omit Option 2 from the user-facing reply.
      - "no_op_at_alt_start": ESS found a date and the existing plan already
        accommodates the maintenance there. NO CPR was generated because the
        baseline plan is already valid for that window. The paragraph frames
        this positively ("current plan already accommodates"); the user can
        still pick Option 2 — on pick, the agent just deletes the unchosen
        contingents (A and C) and confirms. Do NOT describe this internally
        ("no work orders shift", "scheduling no-op") to the user.

    case_id and plan_run_id are auto-resolved if omitted.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]
    prod_area = data.get("prod_area")
    bucket_start = data.get("bucket_start")
    delay_days = data.get("delay_days")
    if not prod_area:
        return {"error": "prod_area is required"}
    if not bucket_start:
        return {"error": "bucket_start is required (ISO yyyy-MM-dd)"}
    if delay_days is None:
        return {"error": "delay_days is required"}
    delay_days = int(delay_days)

    base = _allocator_url()

    async def post_impact(client: "httpx.AsyncClient", selectors: list, dd: int, note: str):
        body = {
            "caseId": int(case_id),
            "selectors": selectors,
            "delayDays": dd,
            "persist": True,
            "planRunId": int(plan_run_id),
            "note": note,
        }
        r = await client.post(f"{base}/wo-schedule-impact", json=body)
        if r.status_code not in (200, 202):
            return None, f"HTTP {r.status_code}: {r.text}"
        job_id = r.json().get("jobId")
        if not job_id:
            return None, "no jobId"
        delay = 1.0
        max_delay = 8.0
        max_wait = 120.0
        elapsed = 0.0
        while elapsed < max_wait:
            await asyncio.sleep(delay)
            elapsed += delay
            delay = min(delay * 2, max_delay)
            poll = await client.get(f"{base}/wo-schedule-impact/status/{job_id}")
            if poll.status_code != 200:
                return None, f"poll HTTP {poll.status_code}"
            pj = poll.json()
            status = pj.get("status", "unknown")
            if status == "completed":
                return pj.get("result", {}), None
            if status == "failed":
                return None, f"job failed: {pj.get('error', '')}"
        return None, f"timed out after {max_wait}s"

    try:
        async with httpx.AsyncClient(timeout=180) as client:
            # 1. Collect gids
            find_body = {
                "plan_run_id": int(plan_run_id),
                "prod_area": str(prod_area),
                "start_after": str(bucket_start),
                "limit": 500,
            }
            fr = await client.post(f"{base}/cases/{int(case_id)}/wo-find", json=find_body)
            if fr.status_code != 200:
                return {"error": f"wo-find HTTP {fr.status_code}", "detail": fr.text}
            wos_resp = fr.json()
            gids = sorted({w.get("wo_group_id") for w in wos_resp.get("wos", [])
                           if w.get("wo_group_id")})
            if not gids:
                return {"error": "no_matching_wos",
                        "prod_area": prod_area, "bucket_start": bucket_start}

            selectors = [{"bucketStart": str(bucket_start), "woGroupIds": list(gids)}]
            note_prefix = f"assess_maintenance_options {prod_area} {bucket_start}"

            # 2. availability — sub-millisecond DAG walk, gives us
            # max_feasible_days WITHOUT waiting on a full planner run.
            avail_body = {
                "caseId": int(case_id),
                "planRunId": int(plan_run_id),
                "selectors": selectors,
            }
            avail_r = await client.post(f"{base}/wo-schedule-impact/availability",
                                         json=avail_body)
            if avail_r.status_code != 200:
                return {"error": f"availability HTTP {avail_r.status_code}",
                        "detail": avail_r.text}
            avail = avail_r.json()
            max_feasible_days = int(avail.get("maxFeasibleDays") or 0)

            # 3. Parallelise the slow calls: each planner run is ~30 s and
            # we have three of them plus an iterative earliest-safe-start
            # search. Sequentialising blew past nginx's gateway timeout.
            # Each task is independent until Option B, which needs the
            # safe-start date — we await earliest_safe_start before
            # launching Option B.
            async def run_option_a():
                if max_feasible_days <= 0:
                    return None, "max_feasible_days=0"
                return await post_impact(
                    client, selectors, max_feasible_days,
                    f"{note_prefix} +{max_feasible_days}d option A (shortened)")

            async def run_option_c():
                return await post_impact(
                    client, selectors, delay_days,
                    f"{note_prefix} +{delay_days}d option C")

            async def run_ess_then_option_b():
                ess_body = {
                    "caseId": int(case_id),
                    "planRunId": int(plan_run_id),
                    "prodArea": str(prod_area),
                    "delayDays": delay_days,
                    "afterDate": str(bucket_start),
                }
                ess_r = await client.post(f"{base}/wo-schedule-impact/earliest-safe-start",
                                           json=ess_body)
                alt_start_inner = None
                bg = None
                be = None
                if ess_r.status_code == 200:
                    ess_j = ess_r.json()
                    alt_start_inner = ess_j.get("earliestSafeStart")
                    bg = ess_j.get("bottleneckGid")
                    be = ess_j.get("bottleneckEnd")
                if not alt_start_inner:
                    return alt_start_inner, bg, be, None, "no_safe_start_within_horizon"
                option_b_selectors = [{"bucketStart": str(alt_start_inner),
                                        "woGroupIds": list(gids)}]
                ob, ob_err = await post_impact(
                    client, option_b_selectors, delay_days,
                    f"{note_prefix} +{delay_days}d option B (deferred {alt_start_inner})")
                return alt_start_inner, bg, be, ob, ob_err

            results = await asyncio.gather(
                run_option_a(),
                run_option_c(),
                run_ess_then_option_b(),
                return_exceptions=False,
            )
            (option_a, errA) = results[0]
            (option_c, errC) = results[1]
            (alt_start, bottleneck_gid, bottleneck_end, option_b, errB) = results[2]

            if option_c is None:
                return {"error": "option_c_failed", "detail": errC}
            if option_a is None and max_feasible_days > 0:
                print(f"[assess_maintenance_options] option A failed: {errA}", flush=True)
            if option_b is None and alt_start:
                print(f"[assess_maintenance_options] option B failed: {errB}", flush=True)

            # Disambiguate Option B's outcome for the agent's prompt logic:
            #   "ok"                          → real CPR generated; present Option 2 normally.
            #   "no_safe_start_within_horizon" → ESS couldn't find any later safe date;
            #                                    OMIT Option 2 from the reply.
            #   "no_op_at_alt_start"          → ESS found a date but at that date no WO
            #                                    actually shifts (shift==0); the deferral
            #                                    is a planning no-op. OMIT Option 2 from
            #                                    the reply — there is no CPR to promote
            #                                    and nothing to record in a new plan.
            if alt_start is None:
                option_b_status = "no_safe_start_within_horizon"
            elif option_b is None:
                option_b_status = "no_op_at_alt_start"
            else:
                option_b_status = "ok"

            # Spell out Option 2's intent server-side so the agent doesn't
            # have to interpret optionBStatus through the prompt. The text is
            # already in the user's locale and uses the canonical "Option 2
            # (B)" heading form. Agent's job is to paste it under the Option 2
            # slot in its response (or omit Option 2 if null).
            option_b_cpr_id = option_b.get("contingentPlanRunId") if option_b else None
            zh = (data.get("locale") or "en").lower().startswith("zh")
            if option_b_status == "ok" and alt_start:
                if zh:
                    option_b_paragraph = (
                        f"### 选项 B — 推迟开始时间至 {alt_start}（原 {delay_days} 天）\n"
                        f"需求承诺时间不变，WO 排程相应调整。生成的计划运行：#{option_b_cpr_id}。"
                    )
                else:
                    option_b_paragraph = (
                        f"### Option B — Defer start to {alt_start} (original {delay_days} days)\n"
                        f"Demand commits unchanged; WO schedule adjusts accordingly. "
                        f"Contingent plan run: #{option_b_cpr_id}."
                    )
            elif option_b_status == "no_op_at_alt_start" and alt_start:
                if zh:
                    option_b_paragraph = (
                        f"### 选项 B — 推迟开始时间至 {alt_start}（原 {delay_days} 天，现行计划已可容纳）\n"
                        f"此时段 {prod_area} 区已无计划生产，维护事件可直接在此窗口进行，无需调整计划。\n"
                        f"> 如选此项：回复 *\"在 {alt_start} 停 {prod_area} {delay_days} 天\"*"
                    )
                else:
                    option_b_paragraph = (
                        f"### Option B — Defer start to {alt_start} ({delay_days} days, current plan already accommodates)\n"
                        f"{prod_area} has no scheduled production in this window, so the maintenance "
                        f"can run as-is. The existing plan supports it; no adjustment needed.\n"
                        f"> To pick this: reply *\"Shut down {prod_area} for {delay_days} days from {alt_start}\"*"
                    )
            else:
                option_b_paragraph = None

            return {
                "caseId": case_id,
                "planRunId": plan_run_id,
                "prodArea": prod_area,
                "bucketStart": bucket_start,
                "delayDays": delay_days,
                "maxFeasibleDays": max_feasible_days,
                "matchedWoCount": option_c.get("matchedWoCount", 0),
                "woGroupIds": gids,
                "alternateStartDate": alt_start,
                "bottleneckGid": bottleneck_gid,
                "bottleneckEnd": bottleneck_end,
                "optionACprId": option_a.get("contingentPlanRunId") if option_a else None,
                "optionBCprId": option_b_cpr_id,
                "optionCCprId": option_c.get("contingentPlanRunId"),
                "optionBStatus": option_b_status,
                "optionBParagraph": option_b_paragraph,
                "impactedDemandCount": option_c.get("impactedDemandCount", 0),
                "impacts": option_c.get("impacts", []),
            }
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


@mcp_scheduling_engine.tool()
async def find_earliest_safe_start(payload: Dict[str, Any]):
    """
    Find the earliest bucketStart date at which a `delay_days`-day maintenance
    window on the given `prod_area` has zero demand impact. Used to refine
    Option B in the scheduling negotiation: instead of computing a conservative
    shifted date client-side, this endpoint iterates server-side via the
    allocator's computeAvailability + bottleneck info to find the tightest
    safe start.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Example tool call:

    {
      "payload": {
        "prod_area": "OE",
        "delay_days": 7,
        "after_date": "2024-07-15"
      }
    }

    Returns on success: {
      caseId, planRunId, earliestSafeStart, bottleneckGid, bottleneckEnd,
      maxFeasibleDaysAtStart, iterations
    }
    Returns 404 → {"error": "no_safe_start_within_horizon", ...} when the
    horizon (max_iterations rounds of advance-past-bottleneck) is exhausted
    without finding a safe start.

    case_id and plan_run_id are auto-resolved if omitted.
    """
    # Guard: scheduling agent must use assess_maintenance_options for Branch B
    # discovery — that tool runs earliest-safe-start internally AND persists the
    # Option B contingent atomically. Calling find_earliest_safe_start standalone
    # produces a date with no associated CPR, which the agent then mis-reports as
    # "no plan change required". Refuse and redirect.
    return {
        "error": "use_assess_maintenance_options_instead",
        "hint": (
            "find_earliest_safe_start is not available as a standalone tool to "
            "the scheduling agent. Call assess_maintenance_options with prod_area, "
            "bucket_start (= your after_date), and delay_days — it computes "
            "alternateStartDate internally, persists Option B's contingent at that "
            "date, and returns the CPR ids for all three options atomically. The "
            "earliest-safe-start info alone is not actionable without the "
            "corresponding contingent plan run."
        ),
        "redirect_tool": "assess_maintenance_options",
    }

    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]
    prod_area = data.get("prod_area")
    delay_days = data.get("delay_days")
    after_date = data.get("after_date")
    if not prod_area:
        return {"error": "prod_area is required"}
    if delay_days is None:
        return {"error": "delay_days is required"}
    if not after_date:
        return {"error": "after_date is required (ISO yyyy-MM-dd)"}

    body: Dict[str, Any] = {
        "caseId": int(case_id),
        "planRunId": int(plan_run_id),
        "prodArea": str(prod_area),
        "delayDays": int(delay_days),
        "afterDate": str(after_date),
    }
    if data.get("max_iterations") is not None:
        body["maxIterations"] = int(data["max_iterations"])

    url = f"{_allocator_url()}/wo-schedule-impact/earliest-safe-start"
    print(f"[scheduling_engine.find_earliest_safe_start] POST {url} body={body}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(url, json=body)
            if r.status_code == 200:
                return r.json()
            if r.status_code == 404:
                return r.json()  # propagates structured no_safe_start_within_horizon
            return {"error": f"HTTP {r.status_code}", "detail": r.text}
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


@mcp_scheduling_engine.tool()
async def promote_plan_run(payload: Dict[str, Any]):
    """
    Promote a contingent plan run to status="success" — the production-of-truth
    state. Call this only with the contingent_plan_run_id returned from
    analyze_wo_schedule_impact(persist=true), NEVER with the baseline plan_run_id.

    IMPORTANT:
    - All inputs MUST be wrapped inside a top-level key named "payload".
    - Example tool call:

    {
      "payload": {
        "case_id": 19,
        "plan_run_id": 47
      }
    }

    Returns: { status, planRunId, previousStatus, ... }

    case_id and plan_run_id are auto-resolved if omitted, but for safety the
    agent should ALWAYS pass plan_run_id explicitly to promote — never trust
    the active-run fallback for a destructive operation.
    """
    import httpx

    data = dict(payload)
    resolved = await _resolve_ids(data.get("case_id"), data.get("plan_run_id"))
    if "error" in resolved:
        return resolved
    case_id = resolved["caseId"]
    plan_run_id = resolved["planRunId"]

    url = f"{_allocator_url()}/cases/{int(case_id)}/plan-runs/{int(plan_run_id)}/promote"
    print(f"[scheduling_engine.promote_plan_run] POST {url}", flush=True)
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(url)
            if r.status_code not in (200, 201):
                return {"error": f"HTTP {r.status_code}", "detail": r.text}
            return r.json()
    except Exception as exc:
        return {"error": f"allocator unavailable: {exc}"}


# ---------------------------
# Registry: name → engine
# ---------------------------
ENGINES: Dict[str, FastMCP] = {
    "mytools": mcp,
    "supply_chain_engine": mcp_supply_chain_engine,
    "mes_engine": mcp_mes_engine,
    "order_engine": mcp_order_engine,
    "material_engine": mcp_material_engine,
    "scheduling_engine": mcp_scheduling_engine,
}
