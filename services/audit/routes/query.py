from sqlalchemy import select, and_
from data.models import UpdateEvent, Message

def base_update_event_query():
    return (
        select(UpdateEvent)
        .join(Message, UpdateEvent.msg_id == Message.id)
    )

def apply_update_event_filters(
    q,
    *,
    business_id: int | None = None,
    recipient_business_id: int | None = None,
    event_type: str | None = None,
    message_id: str | None = None,
    target: str | None = None,
    material: str | None = None,
    source_business_id: int | None = None,
    start_time=None,
    end_time=None,
):
    if business_id:
        q = q.where(UpdateEvent.business_id == business_id)

    if recipient_business_id:
        q = q.where(UpdateEvent.recipient_business_id == recipient_business_id)

    if source_business_id:
        q = q.where(UpdateEvent.source_business_id == source_business_id)

    if event_type:
        q = q.where(UpdateEvent.event_type == event_type)

    if message_id:
        q = q.where(UpdateEvent.message_id == message_id)

    if target:
        q = q.where(UpdateEvent.target == target)

    if material:
        q = q.where(UpdateEvent.materials.contains([material]))

    if start_time:
        q = q.where(UpdateEvent.created_at >= start_time)

    if end_time:
        q = q.where(UpdateEvent.created_at <= end_time)

    return q
