from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy.orm import Session
from data import models, schemas
from typing import List

#from shared.db.session import get_session
from utils.database import get_session
from .auth import get_current_user

import json
import logging
import httpx

logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

router = APIRouter()


# ---------------------------------------------------------------------------
# MCP Explorer — proxy the initialize + tools/list handshake for the UI
# ---------------------------------------------------------------------------

def _parse_mcp_body(response: httpx.Response) -> dict:
    """
    Return the first JSON-RPC payload from an MCP response.

    FastMCP's streamable-HTTP transport returns SSE, which may look like:

        : ping - 2026-03-15T00:49:54+00:00\r\n
        event: message\r\n
        data: {"jsonrpc":"2.0","id":1,"result":{...}}\r\n
        \r\n

    We scan every line for the first `data:` line and parse that.
    Fall back to plain JSON if no `data:` line is found.
    """
    for line in response.text.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            payload = line[5:].strip()
            if payload:
                return json.loads(payload)
    # Plain JSON fallback (e.g. non-SSE responses)
    return response.json()


@router.post("/explore", response_model=schemas.MCPExploreResult)
async def explore_mcp_server(req: schemas.MCPExploreRequest):
    """
    Probe any MCP (streamable-HTTP) server and return its tool list.
    Performs: initialize → tools/list → session cleanup.
    """
    url = req.url.rstrip("/") + "/"
    base_headers = {"Accept": "application/json, text/event-stream"}
    if req.api_key:
        base_headers["X-MCP-API-Key"] = req.api_key

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            # 1. Initialize
            init_r = await client.post(url, json={
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "schub-explorer", "version": "1"},
                },
            }, headers=base_headers)
            init_r.raise_for_status()

            session_id = init_r.headers.get("mcp-session-id")
            init_body = _parse_mcp_body(init_r)
            server_name = (
                init_body.get("result", {})
                         .get("serverInfo", {})
                         .get("name")
            )

            # 2. notifications/initialized  (required before any further requests)
            session_headers = {**base_headers}
            if session_id:
                session_headers["mcp-session-id"] = session_id
            await client.post(url, json={
                "jsonrpc": "2.0",
                "method": "notifications/initialized",
            }, headers=session_headers)

            # 3. tools/list
            list_r = await client.post(url, json={
                "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {},
            }, headers=session_headers)
            list_r.raise_for_status()
            list_body = _parse_mcp_body(list_r)
            if "error" in list_body:
                logger.warning("MCP tools/list error from %s: %s", req.url, list_body["error"])
            raw_tools = list_body.get("result", {}).get("tools", [])

            # 3. Cleanup session
            if session_id:
                try:
                    await client.delete(url, headers={"mcp-session-id": session_id})
                except Exception:
                    pass  # best-effort cleanup

        return schemas.MCPExploreResult(
            url=req.url,
            server_name=server_name,
            tools=[
                schemas.MCPToolSchema(
                    name=t["name"],
                    description=t.get("description"),
                    input_schema=t.get("inputSchema", {}),
                )
                for t in raw_tools
            ],
        )

    except httpx.TimeoutException:
        raise HTTPException(504, detail=f"MCP server timed out: {req.url}")
    except httpx.HTTPStatusError as e:
        raise HTTPException(502, detail=f"MCP server returned {e.response.status_code}: {req.url}")
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("MCP explore failed for %s: %s", req.url, e)
        raise HTTPException(502, detail=f"Could not reach MCP server: {str(e)}")

@router.post("/{business_id}", response_model=schemas.MCPServerOut)
def create(business_id: int, payload: schemas.MCPServerCreate, db: Session = Depends(get_session)):
    business = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not business:
        raise HTTPException(status_code=400, detail="Business does not exist")

    print(f"Creating server now ... ")
    server = models.MCP_Registry(
        url = payload.url,
        prompt = payload.prompt,
        description = payload.description,
        name = payload.name,
        business=business,   # ✅ just assign the relationship
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return server

@router.get("/{business_id}/registry", response_model=List[schemas.MCPServerOut])
def list_servers(business_id: int, db: Session = Depends(get_session)):
    servers = (
        db.query(models.MCP_Registry)
        .filter(models.MCP_Registry.business_id == business_id, models.MCP_Registry.subagent_id == None)
        .all()
    )
    return servers

@router.get("/", response_model=List[schemas.MCPServerOut])
def list_servers_all(db: Session = Depends(get_session)):
    servers = (
        db.query(models.MCP_Registry)
        .all()
    )
    return servers

@router.get("/{business_id}", response_model=schemas.MCPServerOut)
def get_server(business_id: int, db: Session = Depends(get_session)):
    server = db.query(models.MCP_Registry).filter(models.MCP_Registry.business_id == business_id).first()
    if not server:
        raise HTTPException(404, f"No MCP server configured for the business {business_id}")
    return server

@router.delete("/{business_id}/registry/{server_id}")
def delete_server(business_id: int, server_id: int, db: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    server_to_delete = db.query(models.MCP_Registry).filter(models.MCP_Registry.id == server_id, models.MCP_Registry.business_id == business_id).first()
    if not server_to_delete:
        raise HTTPException(status_code=404, detail="server not found")

    db.delete(server_to_delete)
    db.commit()
    return {"message": f"MCP Registry {server_id} deleted"}

@router.put("/{business_id}/registry/{server_id}")
def update_server(
    business_id: int,
    server_id: int,
    server_update: schemas.MCPServerUpdate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    db_server = db.query(models.MCP_Registry).filter(
        models.MCP_Registry.id == server_id,
        models.MCP_Registry.business_id == business_id
    ).first()

    if not db_server:
        raise HTTPException(status_code=404, detail="Server not found")

    for field, value in server_update.dict(exclude_unset=True).items():
        setattr(db_server, field, value)

    db.commit()
    db.refresh(db_server)
    return db_server