from fastapi import APIRouter, Depends, HTTPException, Query, Response, Request
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

@router.post("/{business_id}", response_model=schemas.ToolOut)
def create(business_id: int, payload: schemas.ToolCreate, db: Session = Depends(get_session)):
    business = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not business:
        raise HTTPException(status_code=400, detail="Business does not exist")

    print(f"Creating tool now ... ")
    tool = models.Tool(
        description = payload.description,
        name = payload.name,
        config = payload.config,
        business=business,   # ✅ just assign the relationship
    )
    db.add(tool)
    db.commit()
    db.refresh(tool)
    return tool

@router.get("/{business_id}", response_model=List[schemas.ToolOut])
def list_tools(business_id: int, name: str | None = Query(None), db: Session = Depends(get_session)):
    query = db.query(models.Tool).filter(models.Tool.business_id == business_id, models.Tool.subagent_id == None)

    if name:
        query = query.filter(models.Tool.name == name)

    tools = query.all()
    return tools

@router.delete("/{business_id}/tool/{tool_id}")
def delete_tool(business_id: int, tool_id: int, db: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    tool_to_delete = db.query(models.Tool).filter(models.Tool.id == tool_id, models.Tool.business_id == business_id).first()
    if not tool_to_delete:
        raise HTTPException(status_code=404, detail="tool not found")

    db.delete(tool_to_delete)
    db.commit()
    return {"message": f"Tool {tool_id} deleted"}

@router.put("/{business_id}/tool/{tool_id}")
def update_tool(
    business_id: int,
    tool_id: int,
    tool_update: schemas.ToolUpdate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    db_tool = db.query(models.Tool).filter(
        models.Tool.id == tool_id,
        models.Tool.business_id == business_id
    ).first()

    if not db_tool:
        raise HTTPException(status_code=404, detail="Tool not found")

    for field, value in tool_update.dict(exclude_unset=True).items():
        setattr(db_tool, field, value)

    db.commit()
    db.refresh(db_tool)
    return db_tool