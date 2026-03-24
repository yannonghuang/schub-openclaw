from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from sqlalchemy.orm import Session
from data import models, schemas
from typing import List

#from shared.db.session import get_session
from utils.database import get_session
from .auth import get_current_user

import logging
logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

router = APIRouter()


# ---------------------------
# Helper: require admin of same business
# ---------------------------
def require_admin_for_business(current_user: models.User, business_id: int):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")


# ---------------------------
# SubAgent Endpoints (B)
# ---------------------------

@router.get("/business/{business_id}", response_model=List[schemas.SubAgentOut])
def list_subagents_for_business(business_id: int, db: Session = Depends(get_session)):
    """
    List all sub-agents for a business.
    GET /subagent/business/{business_id}
    """
    subs = db.query(models.SubAgent).filter(models.SubAgent.business_id == business_id).all()
    return subs


@router.post("/business/{business_id}", response_model=schemas.SubAgentOut, status_code=201)
def create_subagent_for_business(
    business_id: int,
    payload: schemas.SubAgentCreate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    """
    Create a sub-agent under a business.
    Requires admin belonging to the business.
    """
    require_admin_for_business(current_user, business_id)

    business = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not business:
        raise HTTPException(status_code=400, detail="Business not found")

    sa = models.SubAgent(
        business_id=business_id,
        name=payload.name,
        description=payload.description,
        prompt=payload.prompt,
        enabled=payload.enabled,
    )
    db.add(sa)
    db.commit()
    db.refresh(sa)
    return sa

@router.get("/{subagent_id}", response_model=schemas.SubAgentOut, status_code=200)
def get_subagent(
    subagent_id: int,
    db: Session = Depends(get_session),
    #current_user: models.User = Depends(get_current_user),
):
    """
    Get sub-agent. Requires admin of corresponding business.
    """
    sa = db.query(models.SubAgent).filter(models.SubAgent.id == subagent_id).first()
    if not sa:
        raise HTTPException(status_code=404, detail="Sub-agent not found")

    #require_admin_for_business(current_user, sa.business_id)
    print(f"get_subagent returns: {sa}")
    return sa

@router.get("/name/{subagent_name}/{business_id}", response_model=schemas.SubAgentOut, status_code=200)
def get_subagent_by_name(
    subagent_name: str,
    business_id: int,
    db: Session = Depends(get_session),
):
    """
    Get sub-agent. Requires admin of corresponding business.
    """
    sa = db.query(models.SubAgent).filter(models.SubAgent.name == subagent_name,
                                          models.SubAgent.business_id == business_id).first()
    if not sa:
        raise HTTPException(status_code=404, detail="Sub-agent not found")

    #require_admin_for_business(current_user, sa.business_id)
    print(f"get_subagent_by_name returns: {sa}")
    return sa

@router.put("/{subagent_id}", response_model=schemas.SubAgentOut)
def update_subagent(
    subagent_id: int,
    payload: schemas.SubAgentUpdate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    """
    Update a sub-agent. Requires admin of corresponding business.
    """
    sa = db.query(models.SubAgent).filter(models.SubAgent.id == subagent_id).first()
    if not sa:
        raise HTTPException(status_code=404, detail="Sub-agent not found")

    require_admin_for_business(current_user, sa.business_id)

    for k, v in payload.dict(exclude_unset=True).items():
        setattr(sa, k, v)

    db.commit()
    db.refresh(sa)
    return sa


@router.delete("/{subagent_id}", status_code=204)
def delete_subagent(
    subagent_id: int,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    """
    Delete a sub-agent. Requires admin of corresponding business.
    """
    sa = db.query(models.SubAgent).filter(models.SubAgent.id == subagent_id).first()
    if not sa:
        raise HTTPException(status_code=404, detail="Sub-agent not found")

    require_admin_for_business(current_user, sa.business_id)

    # Optionally: cascade-delete MCP_Registry and Tool entries if FK cascade not set
    db.query(models.MCP_Registry).filter(models.MCP_Registry.subagent_id == subagent_id).delete()
    db.query(models.Tool).filter(models.Tool.subagent_id == subagent_id).delete()

    db.delete(sa)
    db.commit()
    return None


# ---------------------------
# Sub-agent MCP Registry Endpoints (C: sub-agent level)
# ---------------------------

@router.get("/{subagent_id}/mcp_registry", response_model=List[schemas.MCPServerOut])
def list_subagent_mcp_registry(subagent_id: int, db: Session = Depends(get_session)):
    """
    List MCP registry entries for a sub-agent.
    GET /subagent/{subagent_id}/mcp_registry
    """
    regs = (
        db.query(models.MCP_Registry)
        .filter(models.MCP_Registry.subagent_id == subagent_id)
        .all()
    )
    return regs


@router.post("/{subagent_id}/mcp_registry", response_model=schemas.MCPServerOut, status_code=201)
def create_mcp_for_subagent(
    subagent_id: int,
    payload: schemas.MCPServerCreate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    """
    Create an MCP registry entry for a sub-agent.
    Must be business admin.
    """
    sa = db.query(models.SubAgent).filter(models.SubAgent.id == subagent_id).first()
    if not sa:
        raise HTTPException(status_code=404, detail="Sub-agent not found")

    require_admin_for_business(current_user, sa.business_id)

    server = models.MCP_Registry(
        url=payload.url,
        prompt=payload.prompt or "",
        description=payload.description,
        name=payload.name,
        subagent_id=subagent_id,
        business_id=sa.business_id,  # keep the business_id for compatibility
    )
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


@router.put("/{subagent_id}/mcp_registry/{server_id}", response_model=schemas.MCPServerOut)
def update_mcp_entry_for_subagent(
    subagent_id: int,
    server_id: int,
    payload: schemas.MCPServerUpdate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    server = (
        db.query(models.MCP_Registry)
        .filter(models.MCP_Registry.id == server_id, models.MCP_Registry.subagent_id == subagent_id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP registry not found")

    require_admin_for_business(current_user, server.business_id)

    for k, v in payload.dict(exclude_unset=True).items():
        setattr(server, k, v)

    db.commit()
    db.refresh(server)
    return server


@router.delete("/{subagent_id}/mcp_registry/{server_id}", status_code=204)
def delete_mcp_entry_for_subagent(
    subagent_id: int,
    server_id: int,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    server = (
        db.query(models.MCP_Registry)
        .filter(models.MCP_Registry.id == server_id, models.MCP_Registry.subagent_id == subagent_id)
        .first()
    )
    if not server:
        raise HTTPException(status_code=404, detail="MCP registry not found")

    require_admin_for_business(current_user, server.business_id)

    db.delete(server)
    db.commit()
    return None


# ---------------------------
# Sub-agent Tools Endpoints (D: sub-agent level)
# ---------------------------

@router.get("/{subagent_id}/tools", response_model=List[schemas.ToolOut])
def list_subagent_tools(subagent_id: int, db: Session = Depends(get_session)):
    rows = db.query(models.Tool).filter(models.Tool.subagent_id == subagent_id).all()
    return rows


@router.post("/{subagent_id}/tools", response_model=schemas.ToolOut, status_code=201)
def create_tool_for_subagent(
    subagent_id: int,
    payload: schemas.ToolCreate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    sa = db.query(models.SubAgent).filter(models.SubAgent.id == subagent_id).first()
    if not sa:
        raise HTTPException(status_code=404, detail="Sub-agent not found")

    require_admin_for_business(current_user, sa.business_id)

    tool = models.Tool(
        name=payload.name,
        description=payload.description,
        config=payload.config,
        subagent_id=subagent_id,
        business_id=sa.business_id,  # keep business_id for backward compat
    )
    db.add(tool)
    db.commit()
    db.refresh(tool)
    return tool


@router.put("/{subagent_id}/tools/{tool_id}", response_model=schemas.ToolOut)
def update_tool_for_subagent(
    subagent_id: int,
    tool_id: int,
    payload: schemas.ToolUpdate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    row = db.query(models.Tool).filter(models.Tool.id == tool_id, models.Tool.subagent_id == subagent_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")

    require_admin_for_business(current_user, row.business_id)

    for k, v in payload.dict(exclude_unset=True).items():
        setattr(row, k, v)

    db.commit()
    db.refresh(row)
    return row


@router.delete("/{subagent_id}/tools/{tool_id}", status_code=204)
def delete_tool_for_subagent(
    subagent_id: int,
    tool_id: int,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    row = db.query(models.Tool).filter(models.Tool.id == tool_id, models.Tool.subagent_id == subagent_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Tool not found")

    require_admin_for_business(current_user, row.business_id)

    db.delete(row)
    db.commit()
    return None
