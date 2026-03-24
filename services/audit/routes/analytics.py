from fastapi import APIRouter, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import desc
from datetime import datetime, datetime, timedelta, timezone
from sqlalchemy import select, func, text

from .query import base_update_event_query, apply_update_event_filters
from utils.database import init_db, AsyncSessionLocal, engine, get_session
from data.models import UpdateEvent, Message

router = APIRouter()

@router.get("/events/count")
async def event_counts(
    business_id: int | None = None,
    recipient_business_id: int | None = None,
    days: int = 30,
    session: AsyncSession = Depends(get_session),
):
    q = (
        select(
            func.date_trunc("day", UpdateEvent.created_at).label("day"),
            func.count().label("count"),
        )
        .where(UpdateEvent.created_at >= func.now() - text(f"interval '{days} days'"))
        .group_by("day")
        .order_by("day")
    )

    if business_id:
        q = q.where(UpdateEvent.business_id == business_id)

    if recipient_business_id:
        q = q.where(UpdateEvent.recipient_business_id == recipient_business_id)

    rows = (await session.execute(q)).all()
    return [{"day": r.day, "count": r.count} for r in rows]


@router.get("/materials")
async def material_impact(
    days: int = 30,
    session: AsyncSession = Depends(AsyncSessionLocal),
):
    q = text("""
        SELECT
          material,
          count(*) AS events,
          avg(delivery_delay_days) AS avg_delay
        FROM update_events,
             unnest(materials) AS material
        WHERE created_at >= now() - interval :days
        GROUP BY material
        ORDER BY events DESC
    """)

    rows = (await session.execute(q, {"days": f"{days} days"})).all()
    return [
        {
            "material": r.material,
            "events": r.events,
            "avg_delay": r.avg_delay,
        }
        for r in rows
    ]


@router.get("/risk")
async def risk_by_business(
    days: int = 30,
    session: AsyncSession = Depends(AsyncSessionLocal),
):
    q = (
        select(
            UpdateEvent.business_id,
            (
                func.coalesce(func.avg(UpdateEvent.delivery_delay_days), 0)
                * func.count()
            ).label("risk_score"),
            func.count().label("events"),
        )
        .where(UpdateEvent.created_at >= func.now() - text(f"interval '{days} days'"))
        .group_by(UpdateEvent.business_id)
        .order_by(desc("risk_score"))
    )

    rows = (await session.execute(q)).all()
    return [
        {
            "business_id": r.business_id,
            "risk_score": float(r.risk_score),
            "events": r.events,
        }
        for r in rows
    ]

######## agent summary
@router.get("/agent/summary")
async def agent_summary(session: AsyncSession = Depends(get_session)):
    sql = text("""
        WITH thread_times AS (
        SELECT
            ue.id AS event_id,
            ue.event_type,
            ue.created_at AS event_time,
            MIN(tm.created_at) FILTER (WHERE tm.role = 'ai') AS first_ai_time,
            MIN(tm.created_at) FILTER (WHERE tm.role = 'human') AS first_human_time,
            MAX(
            CASE
                WHEN tm.role = 'human' AND tm.content ILIKE '%confirm%' THEN 'confirmed'
                WHEN tm.role = 'human' AND tm.content ILIKE '%reject%' THEN 'rejected'
            END
            ) AS response_type
        FROM update_events ue
        LEFT JOIN threads t
            ON t.external_thread_id = ue.event_type || ':' || ue.message_id
        LEFT JOIN thread_messages tm
            ON tm.thread_id = t.id
        GROUP BY ue.id
        )
        SELECT
        event_type,
        COUNT(*) AS total_events,
        COUNT(first_ai_time) AS triggered_events,
        COUNT(*) FILTER (WHERE response_type = 'confirmed') AS confirmed,
        COUNT(*) FILTER (WHERE response_type = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE first_human_time IS NULL) AS ignored,
        AVG(
            EXTRACT(EPOCH FROM (first_ai_time - event_time)) * 1000
        ) AS avg_event_to_agent_ms
        FROM thread_times
        GROUP BY event_type
        ORDER BY event_type;
    """)

    rows = (await session.execute(sql)).mappings().all()

    return [
        {
            "event_type": r["event_type"],
            "total_events": r["total_events"],
            "triggered_events": r["triggered_events"],
            "trigger_rate": round(
                r["triggered_events"] / r["total_events"], 2
            ) if r["total_events"] else 0,
            "confirmed": r["confirmed"],
            "rejected": r["rejected"],
            "ignored": r["ignored"],
            "avg_event_to_agent_ms": int(r["avg_event_to_agent_ms"] or 0),
        }
        for r in rows
    ]


######################################
######## agent dashboard #############
######################################

kpi_sql = """
    WITH agent_threads AS (
    SELECT
        t.id AS thread_id,
        ue.event_type,
        ue.created_at AS event_time
    FROM update_events ue
    JOIN threads t
        ON t.external_thread_id = ue.event_type || ':' || ue.message_id
    )
    SELECT
    COUNT(*)                                AS agent_fired,
    COUNT(DISTINCT event_type)              AS event_types,
    COUNT(DISTINCT at.thread_id) FILTER (WHERE EXISTS (
        SELECT 1 FROM thread_messages tm
        WHERE tm.thread_id = at.thread_id
        AND tm.role = 'ai'
    ))                                      AS ai_replied
    FROM agent_threads at;
"""

trigger_trend_sql = """
    SELECT
    date_trunc('hour', ue.created_at) AS ts,
    ue.event_type,
    COUNT(*)                          AS count
    FROM update_events ue
    JOIN threads t
    ON t.external_thread_id = ue.event_type || ':' || ue.message_id
    GROUP BY 1, 2
    ORDER BY 1;
"""

acceptance_rate_sql = """
    WITH agent_replies AS (
    SELECT
        t.id,
        ue.event_type,
        BOOL_OR(tm.role = 'ai') AS agent_fired,
        BOOL_OR(tm.role = 'human')      AS user_replied
    FROM threads t
    JOIN update_events ue
        ON t.external_thread_id = ue.event_type || ':' || ue.message_id
    JOIN thread_messages tm
        ON tm.thread_id = t.id
    GROUP BY 1, 2
    )
    SELECT
    event_type,
    AVG(CASE WHEN user_replied THEN 1 ELSE 0 END)::float AS acceptance_rate
    FROM agent_replies
    WHERE agent_fired
    GROUP BY event_type;
"""

latency_sql = """
    WITH agent_latency AS (
    SELECT
        ue.event_type,
        EXTRACT(EPOCH FROM (
        MIN(tm.created_at) - ue.created_at
        )) * 1000 AS latency_ms
    FROM update_events ue
    JOIN threads t
        ON t.external_thread_id = ue.event_type || ':' || ue.message_id
    JOIN thread_messages tm
        ON tm.thread_id = t.id
    AND tm.role = 'ai'
    GROUP BY ue.id
    )
    SELECT
    event_type,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY latency_ms) AS p50,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95
    FROM agent_latency
    GROUP BY event_type;
"""

funnel_sql = """
SELECT label, value FROM (
  SELECT 'Agent Fired' AS label, COUNT(*) AS value
  FROM update_events

  UNION ALL

  SELECT 'AI Replied', COUNT(DISTINCT t.id)
  FROM threads t
  JOIN thread_messages tm ON tm.thread_id = t.id
  WHERE tm.role = 'ai'

  UNION ALL

  SELECT 'Human Replied', COUNT(DISTINCT t.id)
  FROM threads t
  JOIN thread_messages tm ON tm.thread_id = t.id
  WHERE tm.role = 'human'
) f;
"""

import json
async def fetch_rows(
    session: AsyncSession,
    sql_string: str,
    title: str
):
    result = await session.execute(text(sql_string))

    rows = result.mappings().all()

    # SAFE debug logging
    print(
        f"{title} rows = {json.dumps(rows, default=str)}",
        flush=True
    )

    return rows

@router.get("/agent/dashboard")
async def agent_analytics(
    session: AsyncSession = Depends(get_session),
):
    return {
        "kpis": await fetch_rows(session, kpi_sql, "kpis"),
        "triggerTrend": await fetch_rows(session, trigger_trend_sql, "triggerTrend"),
        "acceptanceByEvent": await fetch_rows(session, acceptance_rate_sql, "acceptanceByEvent"),
        "latencyByEvent": await fetch_rows(session, latency_sql, "latencyByEvent"),
        "funnel": await fetch_rows(session, funnel_sql, "funnel"),
    }
