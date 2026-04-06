import os
import smtplib
import logging
from email.message import EmailMessage
from email.utils import make_msgid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from data.models import User, EmailHitl
from utils.database import get_session

logger = logging.getLogger(__name__)
router = APIRouter()

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_FROM = os.getenv("SMTP_FROM", SMTP_USER)


class SendEmailRequest(BaseModel):
    recipients: List[int]   # business_ids
    subject: str
    body: str
    business_id: int
    thread_id: str = ""
    session_key: str = ""   # OpenClaw session key — set to enable HITL resume
    agent_id: str = ""


@router.post("/send-email")
def send_email(req: SendEmailRequest, db: Session = Depends(get_session)):
    """
    Look up all users belonging to each business_id in `recipients`,
    then send them a plain-text notification email.
    If session_key is provided, store the Message-ID → session_key mapping
    so the IMAP adapter can resume the session when a reply arrives.
    """
    if not req.recipients:
        return {"sent": 0, "skipped": []}

    # Gather email addresses
    to_addrs: list[str] = []
    for biz_id in req.recipients:
        users = db.query(User).filter(User.business_id == biz_id).all()
        to_addrs.extend(u.email for u in users if u.email)

    if not to_addrs:
        logger.warning("send-email: no email addresses found for recipients %s", req.recipients)
        return {"sent": 0, "skipped": req.recipients}

    msg_id = make_msgid()
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(to_addrs)
    msg["Subject"] = req.subject
    msg["Message-ID"] = msg_id
    if req.thread_id:
        msg["References"] = req.thread_id
    msg.set_content(req.body)

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as client:
            client.starttls()
            client.login(SMTP_USER, SMTP_PASS)
            client.send_message(msg)
        logger.info("send-email: sent to %s (message-id %s)", to_addrs, msg_id)
    except Exception as exc:
        logger.error("send-email: SMTP error: %s", exc)
        raise HTTPException(status_code=502, detail=f"SMTP error: {exc}")

    # Store HITL mapping if a session key was provided
    if req.session_key:
        hitl = EmailHitl(
            message_id=msg_id,
            session_key=req.session_key,
            agent_id=req.agent_id,
            business_id=req.business_id,
        )
        db.add(hitl)
        db.commit()
        logger.info("send-email: stored HITL mapping %s → %s", msg_id, req.session_key)

    return {"sent": len(to_addrs), "to": to_addrs, "message_id": msg_id}


@router.get("/email-hitl/{message_id}")
def get_email_hitl(message_id: str, db: Session = Depends(get_session)):
    """Look up the OpenClaw session key for a given SMTP Message-ID."""
    hitl = db.query(EmailHitl).filter(EmailHitl.message_id == message_id).one_or_none()
    if not hitl:
        raise HTTPException(404, "No HITL session found for this message_id")
    return {
        "message_id": hitl.message_id,
        "session_key": hitl.session_key,
        "agent_id": hitl.agent_id,
        "business_id": hitl.business_id,
        "status": hitl.status,
    }


@router.get("/email-hitl/session/{session_key}/pending")
def get_pending_hitl_for_session(session_key: str, db: Session = Depends(get_session)):
    """Return the most recent pending HITL for a session key, or 404 if none."""
    hitl = (
        db.query(EmailHitl)
        .filter(EmailHitl.session_key == session_key, EmailHitl.status == "pending")
        .order_by(EmailHitl.created_at.desc())
        .first()
    )
    if not hitl:
        raise HTTPException(404, "No pending HITL found for this session")
    return {
        "message_id": hitl.message_id,
        "session_key": hitl.session_key,
        "agent_id": hitl.agent_id,
        "business_id": hitl.business_id,
        "status": hitl.status,
    }


@router.put("/email-hitl/{message_id}/resume")
def mark_hitl_resumed(message_id: str, db: Session = Depends(get_session)):
    """Mark a HITL email session as resumed (called by the IMAP adapter after posting to OpenClaw)."""
    hitl = db.query(EmailHitl).filter(EmailHitl.message_id == message_id).one_or_none()
    if not hitl:
        raise HTTPException(404, "No HITL session found for this message_id")
    hitl.status = "resumed"
    db.commit()
    return {"ok": True}
