from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from utils.database import get_session
from data.models import Material, BusinessRelationship
from data.schemas import MaterialCandidatesRequest, MaterialResponse, MaterialCandidatesResponse

router = APIRouter()

@router.get("/")
def get_materials(db: Session = Depends(get_session)):
    return db.query(Material).all()



@router.post("/material-candidates", response_model=MaterialCandidatesResponse)
def get_material_candidates(payload: MaterialCandidatesRequest, db: Session = Depends(get_session)):
    materials_set = {}

    for recipient in payload.recipients:
        relationships = (
            db.query(BusinessRelationship)
            .filter(
                BusinessRelationship.customer_id == (payload.sender if payload.target == "supplier" else recipient),
                BusinessRelationship.supplier_id == (recipient if payload.target == "supplier" else payload.sender)
            )
            .all()
        )
        for rel in relationships:
            if rel.material:
                materials_set[rel.material.id] = rel.material

    return {"materials": [ {"id": m.id, "name": m.name} for m in materials_set.values() ]}
