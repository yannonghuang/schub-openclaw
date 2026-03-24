from fastapi import APIRouter, Query, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from utils.database import init_db, AsyncSessionLocal, engine, get_session

router = APIRouter()

@router.get("/")
async def material_autocomplete(
    q: str | None = Query(None, min_length=1),
    limit: int = Query(20, le=50),
    session: AsyncSession = Depends(get_session),
):
    sql = """
        SELECT DISTINCT material
        FROM update_events,
             unnest(materials) AS material
    """

    params = {}
    if q:
        sql += " WHERE material ILIKE :q"
        params["q"] = f"%{q}%"

    sql += " ORDER BY material LIMIT :limit"
    params["limit"] = limit

    rows = (await session.execute(text(sql), params)).all()
    return [r.material for r in rows]
