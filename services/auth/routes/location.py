from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from utils.database import get_session
from data.models import Location


router = APIRouter()

@router.get("/")
def get_locations(db: Session = Depends(get_session)):
    return db.query(Location).all()


