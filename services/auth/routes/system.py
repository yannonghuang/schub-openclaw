from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from data import models, schemas
from utils.database import get_session
from datetime import datetime

router = APIRouter()

_EMAIL_PROTOCOL_SUFFIX = """
---
## Tool Discipline
- When a tool returns data, analyse it and move immediately to the next action. Do not call the same tool again with the same or equivalent arguments.
- Each tool call must advance the workflow. Repeating a tool call without a concrete new reason is always wrong.

## Email Confirmation Protocol
Calling `send_email` is correct and expected behaviour whenever you need human approval or must notify someone. The workflow will automatically pause, deliver the email, and resume when the user replies — you do not need to do anything else after calling `send_email`.

## Handling an Ambiguous Reply
If the conversation includes a system note saying the user's reply was ambiguous:
- Compose a short clarification email using `send_email` — two sentences maximum.
- Reference the specific pending action clearly (e.g. "Shall I proceed with order #123?").
- Ask the user to reply with a plain YES to approve or NO to reject.
- Do NOT execute any other business action before sending this clarification.

## Handling a Conditional Approval
If a system note lists conditions the user attached to their approval:
- Only proceed if those conditions can be fully satisfied.
- If a condition cannot be met, inform the user via `send_email` before taking any action.

## Handling a Request for Information
If a system note indicates the user asked a question instead of approving or rejecting:
- Answer their question clearly and concisely via `send_email`.
- Re-state what action is awaiting their decision at the end of the email.
- Do NOT proceed until they explicitly approve.
---"""


def seed_system_prompts(db: Session):
    existing = db.query(models.SystemPrompt).filter(
        models.SystemPrompt.key == "email_protocol"
    ).first()
    if not existing:
        db.add(models.SystemPrompt(
            key="email_protocol",
            content=_EMAIL_PROTOCOL_SUFFIX,
            description="Infrastructure prompt: tool discipline and email confirmation protocol",
        ))
        db.commit()


@router.get("/prompt/{key}", response_model=schemas.SystemPromptOut)
def get_system_prompt(key: str, db: Session = Depends(get_session)):
    row = db.query(models.SystemPrompt).filter(models.SystemPrompt.key == key).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"System prompt '{key}' not found")
    return row


@router.put("/prompt/{key}", response_model=schemas.SystemPromptOut)
def upsert_system_prompt(
    key: str,
    body: schemas.SystemPromptUpdate,
    db: Session = Depends(get_session),
):
    row = db.query(models.SystemPrompt).filter(models.SystemPrompt.key == key).first()
    if row:
        row.content = body.content
        if body.description is not None:
            row.description = body.description
        row.updated_at = datetime.utcnow()
    else:
        row = models.SystemPrompt(
            key=key,
            content=body.content,
            description=body.description,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row
