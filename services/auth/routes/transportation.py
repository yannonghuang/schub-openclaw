# routes/transportation_router.py
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session, joinedload, aliased
from typing import List, Optional
from sqlalchemy import asc, desc, or_, and_

from data import models, schemas
from utils.database import get_session

router = APIRouter()

# ✅ CREATE
@router.post("/", response_model=schemas.TransportationOut)
def create_transportation(payload: schemas.TransportationCreate, db: Session = Depends(get_session)):
    existing = db.query(models.Transportation).filter(
        models.Transportation.source_location_id == payload.source_location_id,
        models.Transportation.target_location_id == payload.target_location_id,
        models.Transportation.material_id == payload.material_id,
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Transportation already exists")

    transportation = models.Transportation(**payload.dict())
    db.add(transportation)
    db.commit()
    db.refresh(transportation)
    return transportation


@router.post("/search")
def search_transportations(
    filters: dict,
    db: Session = Depends(get_session),
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=100),
    sort_by: str = Query("id"),
    sort_order: str = Query("asc"),
):
    """Search transportations with filtering, pagination, and nested sorting."""

    SourceLocation = aliased(models.Location)
    TargetLocation = aliased(models.Location)

    query = (
        db.query(models.Transportation)
        .options(
            joinedload(models.Transportation.source_location),
            joinedload(models.Transportation.target_location),
            joinedload(models.Transportation.material),
        )
        .join(SourceLocation, models.Transportation.source_location_id == SourceLocation.id)
        .join(TargetLocation, models.Transportation.target_location_id == TargetLocation.id)
        .join(models.Material, models.Transportation.material_id == models.Material.id)
    )

    # --- Filters ---
    source_text = filters.get("source") or ""
    target_text = filters.get("target") or ""
    material_text = filters.get("material") or ""
    mode = filters.get("mode") or ""

    if source_text:
        query = query.filter(
            or_(
                SourceLocation.name.ilike(f"%{source_text}%"),
                SourceLocation.description.ilike(f"%{source_text}%"),
            )
        )
    if target_text:
        query = query.filter(
            or_(
                TargetLocation.name.ilike(f"%{target_text}%"),
                TargetLocation.description.ilike(f"%{target_text}%"),
            )
        )
    if material_text:
        query = query.filter(
            or_(
                models.Material.name.ilike(f"%{material_text}%"),
                models.Material.description.ilike(f"%{material_text}%"),
            )
        )
    if mode:
        query = query.filter(models.Transportation.mode.ilike(f"%{mode}%"))

    # --- Sorting ---
    sort_by = sort_by.lower()
    sort_order_func = asc if sort_order == "asc" else desc

    # Map sort_by → SQLAlchemy column
    if sort_by == "source_location":
        sort_col = SourceLocation.name
    elif sort_by == "target_location":
        sort_col = TargetLocation.name
    elif sort_by == "material":
        sort_col = models.Material.name
    elif hasattr(models.Transportation, sort_by):
        sort_col = getattr(models.Transportation, sort_by)
    else:
        sort_col = SourceLocation.name #models.Transportation.id  # fallback

    query = query.order_by(sort_order_func(sort_col))

    # --- Pagination ---
    total = query.count()
    results = query.offset((page - 1) * page_size).limit(page_size).all()

    return {
        "items": results,
        "total": total,
        "page": page,
        "page_size": page_size,
    }

# ✅ READ (Single)
@router.get("/{source_location_id}/{target_location_id}/{material_id}", response_model=schemas.TransportationOut)
def get_transportation(source_location_id: int, target_location_id: int, material_id: int, db: Session = Depends(get_session)):
    transportation = db.query(models.Transportation).filter_by(
        source_location_id=source_location_id,
        target_location_id=target_location_id,
        material_id=material_id,
    ).first()
    if not transportation:
        raise HTTPException(status_code=404, detail="Transportation not found")
    return transportation


# ✅ UPDATE
#@router.put("/{source_location_id}/{target_location_id}/{material_id}", response_model=schemas.TransportationOut)
@router.put("/", response_model=schemas.TransportationOut)
def update_transportation(payload: schemas.TransportationUpdate, db: Session = Depends(get_session)):
    transportation = db.query(models.Transportation).filter_by(
        source_location_id=payload.source_location_id,
        target_location_id=payload.target_location_id,
        material_id=payload.material_id,
    ).first()
    if not transportation:
        raise HTTPException(status_code=404, detail="Transportation not found")

    for key, value in payload.dict(exclude_unset=True).items():
        setattr(transportation, key, value)

    db.commit()
    db.refresh(transportation)
    return transportation


# ✅ DELETE
@router.delete("/{source_location_id}/{target_location_id}/{material_id}")
def delete_transportation(source_location_id: int, target_location_id: int, material_id: int, db: Session = Depends(get_session)):
#@router.delete("/")
#def delete_transportation(payload: schemas.TransportationUpdate, db: Session = Depends(get_session)):
    transportation = db.query(models.Transportation).filter_by(
        source_location_id=source_location_id,
        target_location_id=target_location_id,
        material_id=material_id,
    ).first()
    if not transportation:
        raise HTTPException(status_code=404, detail="Transportation not found")

    db.delete(transportation)
    db.commit()
    return {"message": "Transportation deleted"}
