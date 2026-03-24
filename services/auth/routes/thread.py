# routes/thread.py
from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
#from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from typing import Optional
from datetime import datetime
import requests
import httpx
import json
from typing import Dict, Set

from sqlalchemy.orm import Session
#from app.db import AsyncSessionLocal
from utils.database import get_session

from data.models import Thread, ThreadMessage
from data.schemas import ThreadResponse, ThreadDetailResponse, ResolveRequest, IncomingMessage, SaveMessagesResponse, SaveMessagesRequest, AdaptorEvent

router = APIRouter()

LANGGRAPH_API = "http://langgraph-api:8000" #"https://localhost/langgraph-api" #"https://api.langgraph.cloud"
LANGGRAPH_API_KEY = "YOUR_API_KEY"

def create_langgraph_thread(assistant_id: str) -> str:
    resp = requests.post(
        f"{LANGGRAPH_API}/threads",
        #headers={"x-api-key": LANGGRAPH_API_KEY},
        json={"assistant_id": assistant_id}
    )
    if resp.status_code >= 300:
        raise HTTPException(500, f"LangGraph error: {resp.text}")
    return resp.json()["thread_id"]

@router.get("/messages/{thread_id}")
def retrieve_messages(thread_id: str, db: Session = Depends(get_session)):

    existing = (
        db.query(Thread)
        .filter(
            Thread.thread_id == thread_id
        )
        .first()
    )

    if existing:
        return {
            "messages": [m.to_dict() for m in existing.messages],
        }

    return {
        "messages": [],
    }

@router.post("/resolve")
def resolve_thread(req: ResolveRequest, db: Session = Depends(get_session)):
    """
    💯 Strong race-proof version of thread resolver.
    Guarantees:
      - no two rows will be created for (external_thread_id, business_id)
      - safe across multiple workers
      - safe under rapid concurrent calls
    """

    # --- FIRST TRY: Lock existing row ------------------------------------
    try:
        existing = (
            db.query(Thread)
            .filter(
                Thread.external_thread_id == req.external_thread_id,
                Thread.business_id == req.business_id,
            )
            .with_for_update(read=True)  # shared lock
            .first()
        )
    except Exception:
        db.rollback()
        raise

    if existing:
        return {
            "external_thread_id": req.external_thread_id,
            "langgraph_thread_id": existing.thread_id,
            "messages": [m.to_dict() for m in existing.messages],
        }

    # --- NO EXISTING ROW -> CREATE NEW ONE UNDER FULL LOCK --------------
    new_uuid = create_langgraph_thread(req.assistant_id)

    new_thread = Thread(
        graph_id=req.assistant_id,
        thread_id=new_uuid,
        external_thread_id=req.external_thread_id,
        business_id=req.business_id,
    )

    try:
        db.add(new_thread)
        db.commit()
    except IntegrityError:
        # Another process inserted it first — fetch instead
        db.rollback()
        existing = (
            db.query(Thread)
            .filter(
                Thread.external_thread_id == req.external_thread_id,
                Thread.business_id == req.business_id,
            )
            .first()
        )
        if not existing:
            raise HTTPException(500, "Race condition: Failed to create or load thread")

        return {
            "external_thread_id": req.external_thread_id,
            "langgraph_thread_id": existing.thread_id,
            "messages": [m.to_dict() for m in existing.messages],
        }

    # --- SUCCESS: return new thread --------------------------------------
    return {
        "external_thread_id": req.external_thread_id,
        "langgraph_thread_id": new_uuid,
        "messages": [],
    }

# -------------------------------
# POST /api/thread/messages/save
# -------------------------------
@router.post("/save", response_model=SaveMessagesResponse)
def save_thread_messages(
    req: SaveMessagesRequest,
    db: Session = Depends(get_session)
):
    """
    Save messages for a LangGraph thread.
    - thread_id is the LangGraph UUID.
    - We map to Thread.id (PK) internally.
    - Messages are appended (no dedupe unless added).
    """

    # 1) Find thread by LangGraph UUID
    thread = (
        db.query(Thread)
        .filter(Thread.thread_id == req.thread_id)
        .first()
    )

    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    saved_count = 0
    try:
        # 2) Insert new messages
        for msg in req.messages:
            new_msg = ThreadMessage(
                thread_id=thread.id,                # FK (integer)
                role = msg.role,
                content = msg.content,
                message_id = msg.message_id,
                created_at = msg.created_at or datetime.utcnow()
            )
            db.add(new_msg)
            saved_count += 1

        db.commit()
    except IntegrityError:
        # Another process inserted it first
        db.rollback()
        return SaveMessagesResponse(
            thread_id=req.thread_id,
            saved_count=0,
            total_messages=0,
            messages=[]
        )
    
    # 3) Retrieve full message list (ordered)
    all_messages = (
        db.query(ThreadMessage)
        .filter(ThreadMessage.thread_id == thread.id)
        .order_by(ThreadMessage.created_at.asc(), ThreadMessage.id.asc())
        .all()
    )

    # Convert to plain dicts
    messages_out = [
        {
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
        }
        for m in all_messages
    ]

    return SaveMessagesResponse(
        thread_id=req.thread_id,
        saved_count=saved_count,
        total_messages=len(messages_out),
        messages=messages_out
    )

@router.get("/{business_id}")
def list_threads(business_id: int, db: Session = Depends(get_session)):
    threads = db.query(Thread).filter(Thread.business_id == business_id).order_by(Thread.created_at.desc()).all()
    return [
        {
            "id": t.id,
            "external_thread_id": t.external_thread_id,
            "langgraph_thread_id": t.thread_id,
            "title": t.title,
            "message_count": len(t.messages),
            "created_at": t.created_at,
            "updated_at": t.updated_at,
        }
        for t in threads
    ]

@router.delete("/{thread_id}")
async def delete_thread(thread_id: int, db: Session = Depends(get_session)):
    thread = db.query(Thread).filter(Thread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")

    thread_id = thread.thread_id

    db.delete(thread)
    db.commit()

    # 2. Delete in LangGraph API server
    lg_resp = await httpx.AsyncClient().delete(
        f"{LANGGRAPH_API}/threads/{thread_id}",
        timeout=10
    )

    return {
        "ok": True,
        "deleted_thread_id": thread_id,
        "lg_status": lg_resp.status_code
    }

@router.delete("/business/{business_id}")
def delete_all_threads(business_id: int, db: Session = Depends(get_session)):
    """
    Deletes ALL threads and messages for the given business_id.
    Also deletes threads from the LangGraph server.
    """

    # 1. Fetch all thread IDs
    threads = db.query(Thread).filter(Thread.business_id == business_id).all()
    if not threads:
        return {"status": "ok", "deleted": 0}

    thread_ids = [t.id for t in threads]
    lg_thread_ids = [t.business_id for t in threads]


    # 2. Delete all messages that belong to these threads
    '''
    (
        db.query(ThreadMessage)
        .filter(ThreadMessage.thread_id.in_(thread_ids))
        .delete(synchronize_session=False)
    )
    '''
    
    # 3. Delete the threads from DB
    (
        db.query(Thread)
        .filter(Thread.id.in_(thread_ids))
        .delete(synchronize_session=False)
    )

    db.commit()

    # 4. Delete threads from LangGraph server
    deleted_from_langgraph = []
    errors = []

    for tid in lg_thread_ids:
        try:
            r = requests.delete(f"{LANGGRAPH_API}/threads/{tid}", timeout=5)
            if r.status_code in (200, 204):
                deleted_from_langgraph.append(tid)
            else:
                errors.append({"thread_id": tid, "error": r.text})
        except Exception as e:
            errors.append({"thread_id": tid, "error": str(e)})

    return {
        "status": "ok",
        "deleted_threads": len(thread_ids),
        "deleted_in_langgraph": deleted_from_langgraph,
        "errors": errors,
    }

##################################################################################################################
####################### retrieve thread thru parameters in email: business_id, type, message_id  #################
##################################################################################################################
@router.post("/thread_for_resume")
async def thread_for_resume(payload: AdaptorEvent, db: Session = Depends(get_session)):
    thread = (
        db.query(Thread)
        .filter(
            Thread.business_id == payload.business_id,
            Thread.external_thread_id == f"{payload.event_type}:{payload.message_id}",
        )
        .one_or_none()
    )

    print(f"payload.business_id = {payload.business_id}, payload.event_type = {payload.event_type}, payload.message_id = {payload.message_id}")
    print(f"resume_agent(), query response thread.thread_id = {thread.thread_id}")
    if not thread:
        raise HTTPException(404, "Thread not found")
    
    return {
        "ok": True,
        "thread_id": thread.thread_id,        
    }