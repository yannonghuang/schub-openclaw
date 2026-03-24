"""
Async job management endpoints.
Called by mcp-server to create and update long-running tool job records.
"""
import os
import json
import requests as _requests
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session
from datetime import datetime

from data import schemas
from data.models import AsyncJob
from utils.database import get_session

router = APIRouter()

SWITCH_URL = os.getenv("SWITCH_URL", "http://switch-service:6000/publish")
EMAIL_NODE = int(os.getenv("EMAIL_NODE", "-2"))


def _notify_switch(job: AsyncJob) -> None:
    """Publish async_tool_complete event to switch-service so frontend can resume the thread."""
    payload = {
        "type": "async_tool_complete",
        "thread_id": job.thread_id,
        "job_id": job.job_id,
        "job_result": job.result,
        "error": job.error,
        "idempotency_key": f"job:{job.job_id}",
    }
    try:
        _requests.post(
            SWITCH_URL,
            json={
                "sender": str(EMAIL_NODE),
                "content": json.dumps(payload),
                "recipients": [str(EMAIL_NODE)],
            },
            timeout=5,
        )
    except Exception as e:
        print(f"[async_jobs] Failed to notify switch-service: {e}")


@router.post("", response_model=schemas.AsyncJobOut, status_code=201)
def create_job(body: schemas.AsyncJobCreate, db: Session = Depends(get_session)):
    """Called by mcp-server when a long-running tool job is submitted."""
    job = AsyncJob(
        job_id=body.job_id,
        thread_id=body.thread_id,
        business_id=body.business_id,
        engine_name=body.engine_name,
        status="pending",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@router.get("/{job_id}", response_model=schemas.AsyncJobOut)
def get_job(job_id: str, db: Session = Depends(get_session)):
    job = db.query(AsyncJob).filter(AsyncJob.job_id == job_id).one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    return job


@router.put("/{job_id}", response_model=schemas.AsyncJobOut)
def update_job(job_id: str, body: schemas.AsyncJobUpdate, db: Session = Depends(get_session)):
    """Called by mcp-server when a job completes or errors."""
    job = db.query(AsyncJob).filter(AsyncJob.job_id == job_id).one_or_none()
    if not job:
        raise HTTPException(404, "Job not found")
    job.status = body.status
    job.result = body.result
    job.error = body.error
    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    # Notification is published by mcp-server's _notify_complete after this PUT returns.
    # Do NOT also notify here — that would cause the frontend to receive the event twice
    # and submit two resumes, resulting in duplicate emails.
    return job
