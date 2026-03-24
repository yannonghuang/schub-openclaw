from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, joinedload, aliased
from sqlalchemy import delete, and_
from data import models, schemas
from utils.database import get_session
from typing import List

from .auth import get_current_user

from utils.auth import create_access_token, decode_access_token
from utils.email import send_mail

import logging
logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

router = APIRouter()


@router.post("/", response_model=schemas.BusinessOut)
def create_business(business: schemas.BusinessCreate, db: Session = Depends(get_session)):
    db_business = models.Business(name=business.name)
    db.add(db_business)
    db.commit()
    db.refresh(db_business)
    return db_business


@router.get("/", response_model=List[schemas.BusinessOut])
def get_businesses(db: Session = Depends(get_session)):
    businesses = db.query(models.Business).all()
    if not businesses:
        raise HTTPException(404, "Business not found")
    return businesses

@router.get("/{business_id}", response_model=schemas.BusinessOut)
def get_business(business_id: int, db: Session = Depends(get_session)):
    business = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not business:
        raise HTTPException(404, "Business not found")
    return business

@router.put("/{business_id}")
def update_business(
    business_id: int,
    business_update: schemas.BusinessUpdate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    
    db_business = db.query(models.Business).filter(
        models.Business.id == business_id
    ).first()

    if not db_business:
        raise HTTPException(status_code=404, detail="Business not found")

    for field, value in business_update.dict(exclude_unset=True).items():
        setattr(db_business, field, value)

    db.commit()
    db.refresh(db_business)
    return db_business

@router.post("/{business_id}/suppliers", response_model=schemas.SupplyOut)
def add_supplier(business_id: int, supply: schemas.SupplyLinkRequest, db: Session = Depends(get_session)):
    supplier = db.query(models.Business).filter(models.Business.id == supply.id).first()
    customer = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not supplier or not customer:
        raise HTTPException(404, "Supplier or customer business not found")

    # prevent duplicates
    if supplier in customer.suppliers:
        raise HTTPException(400, "Supplier already linked")

    # Create new relationship
    new_rel = models.BusinessRelationship(
        supplier_id=supplier.id,
        customer_id=customer.id,
        material_id=supply.material_id,  # may be None
    )

    db.add(new_rel)
    #customer.suppliers.append(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier

@router.get("/{business_id}/suppliers", response_model=List[schemas.BusinessOut])
def list_suppliers(business_id: int, db: Session = Depends(get_session)):
    current_business = db.query(models.Business).options(joinedload(models.Business.location)).get(business_id)

    # Get all relationships where current business is the customer
    rels = (
        db.query(models.BusinessRelationship)
        .options(
            joinedload(models.BusinessRelationship.supplier).joinedload(models.Business.location),
            joinedload(models.BusinessRelationship.material)
        )
        .filter(models.BusinessRelationship.customer_id == business_id)
        .all()
    )

    results = []
    for rel in rels:
        supplier = rel.supplier
        material = rel.material

        transportation = db.query(models.Transportation).filter(
            models.Transportation.source_location_id == supplier.location_id,
            models.Transportation.target_location_id == current_business.location_id,
            models.Transportation.material_id == material.id
        ).first()

        results.append(
            schemas.BusinessOut(
                id=supplier.id,
                name=supplier.name,
                material=material,
                location=supplier.location,
                transportation=schemas.Transportation(
                    mode=transportation.mode,
                    duration=transportation.duration,
                    price=transportation.price
                ) if transportation else None
            )
        )

    return results

def SAVE_list_suppliers(business_id: int, db: Session = Depends(get_session)):
    rels = (
        db.query(models.BusinessRelationship)
        .options(joinedload(models.BusinessRelationship.supplier).joinedload(models.Business.location), 
                 joinedload(models.BusinessRelationship.material))
        .filter(models.BusinessRelationship.customer_id == business_id)
        .all()
    )

    results = []
    for rel in rels:
        results.append({
            "id": rel.supplier.id,
            "name": rel.supplier.name,
            "material": rel.material,
            "location": rel.supplier.location,
        })
    return results

@router.post("/{business_id}/customers", response_model=schemas.BusinessOut)
def add_customer(
    business_id: int,
    customer_req: schemas.CustomerLinkRequest,
    db: Session = Depends(get_session),
):
    """Link a customer to a supplier, optionally with a material."""
    customer = db.query(models.Business).filter(models.Business.id == customer_req.id).first()
    supplier = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not supplier or not customer:
        raise HTTPException(404, "Supplier or customer business not found")

    if customer in supplier.customers:
        raise HTTPException(400, "Customer already linked")
    
    # Create new relationship
    new_rel = models.BusinessRelationship(
        supplier_id=supplier.id,
        customer_id=customer.id,
        material_id=customer_req.material_id,  # may be None
    )

    db.add(new_rel)
    db.commit()
    db.refresh(customer)
    return customer

@router.get("/{business_id}/customers", response_model=List[schemas.BusinessOut])
def list_customers(business_id: int, db: Session = Depends(get_session)):
    current_business = db.query(models.Business).options(joinedload(models.Business.location)).get(business_id)

    # Get all relationships where current business is the supplier
    rels = (
        db.query(models.BusinessRelationship)
        .options(
            joinedload(models.BusinessRelationship.customer).joinedload(models.Business.location),
            joinedload(models.BusinessRelationship.material)
        )
        .filter(models.BusinessRelationship.supplier_id == business_id)
        .all()
    )

    results = []
    for rel in rels:
        customer = rel.customer
        material = rel.material

        transportation = db.query(models.Transportation).filter(
            models.Transportation.source_location_id == current_business.location_id,
            models.Transportation.target_location_id == customer.location_id,
            models.Transportation.material_id == material.id
        ).first()

        results.append(
            schemas.BusinessOut(
                id=customer.id,
                name=customer.name,
                material=material,
                location=customer.location,
                transportation=schemas.Transportation(
                    mode=transportation.mode,
                    duration=transportation.duration,
                    price=transportation.price
                ) if transportation else None
            )
        )

    return results

def SAVE_list_customers_with_joinedload(business_id: int, db: Session = Depends(get_session)):
    rels = (
        db.query(models.BusinessRelationship)
        .options(joinedload(models.BusinessRelationship.customer).joinedload(models.Business.location), 
                 joinedload(models.BusinessRelationship.material))
        .filter(models.BusinessRelationship.supplier_id == business_id)
        .all()
    )

    results = []
    for rel in rels:
        results.append({
            "id": rel.customer.id,
            "name": rel.customer.name,
            "material": rel.material,
            "location": rel.customer.location,
        })
    return results

@router.delete("/{business_id}/suppliers/{supplier_id}", status_code=204)
def remove_supplier(business_id: int, supplier_id: int, db: Session = Depends(get_session)):
    stmt = (
        delete(models.BusinessRelationship)
        .where(models.BusinessRelationship.customer_id == business_id)
        .where(models.BusinessRelationship.supplier_id == supplier_id)
    )
    result = db.execute(stmt)
    if result.rowcount == 0:
        raise HTTPException(404, "Supplier relationship not found")
    db.commit()
    return


@router.delete("/{business_id}/customers/{customer_id}", status_code=204)
def remove_customer(business_id: int, customer_id: int, db: Session = Depends(get_session)):
    stmt = (
        delete(models.BusinessRelationship)
        .where(models.BusinessRelationship.supplier_id == business_id)
        .where(models.BusinessRelationship.customer_id == customer_id)
    )
    result = db.execute(stmt)
    if result.rowcount == 0:
        raise HTTPException(404, "Customer relationship not found")
    db.commit()
    return

@router.get("/{business_id}/available-suppliers", response_model=List[schemas.BusinessOut])
def list_available_suppliers(business_id: int, db: Session = Depends(get_session)):
    """Return businesses that can be added as suppliers without creating a cycle."""

    # --- current suppliers ---
    current_suppliers = (
        db.query(models.Business.id)
        .join(
            models.BusinessRelationship,
            models.BusinessRelationship.supplier_id == models.Business.id,
        )
        .filter(models.BusinessRelationship.customer_id == business_id)
        .all()
    )
    current_supplier_ids = {s.id for s in current_suppliers}

    # --- fetch all relationships ---
    all_relationships = db.query(
        models.BusinessRelationship.supplier_id,
        models.BusinessRelationship.customer_id,
    ).all()

    # build adjacency: supplier -> customers
    adjacency = {}
    for supplier_id, customer_id in all_relationships:
        adjacency.setdefault(supplier_id, set()).add(customer_id)

    # --- traverse downstream from business_id to find all reachable nodes ---
    visited = set()
    stack = [business_id]
    while stack:
        node = stack.pop()
        for child in adjacency.get(node, []):
            if child not in visited:
                visited.add(child)
                stack.append(child)

    # --- candidates are all businesses except self, current suppliers, and visited downstream nodes ---
    available = (
        db.query(models.Business)
        .filter(models.Business.id != business_id)
        .filter(~models.Business.id.in_(current_supplier_ids))
        .filter(~models.Business.id.in_(visited))  # remove any that would form a cycle
        .filter(models.Business.name != "system")  # 🚀 exclude "system"
        .all()
    )

    return available


@router.post("/relationships", response_model=schemas.BusinessLink)
def create_relationship(link: schemas.BusinessLinkCreate, db: Session = Depends(get_session)):
    supplier = db.query(models.Business).filter(models.Business.id == link.supplier_id).first()
    customer = db.query(models.Business).filter(models.Business.id == link.customer_id).first()
    if not supplier or not customer:
        raise HTTPException(404, "Supplier or customer not found")

    supplier.customers.append(customer)
    db.commit()
    db.refresh(supplier)
    return {"supplier": supplier, "customer": customer}


@router.get("/relationships/{business_id}", response_model=List[schemas.BusinessLink])
def get_all_relationships(business_id: int, db: Session = Depends(get_session)):

    Supplier = aliased(models.Business)
    Customer = aliased(models.Business)

    rows = (
        db.query(models.BusinessRelationship, models.Transportation)
        .join(Supplier, Supplier.id == models.BusinessRelationship.supplier_id)
        .join(Customer, Customer.id == models.BusinessRelationship.customer_id)
        .outerjoin(
            models.Transportation,
            and_(
                models.Transportation.source_location_id == Supplier.location_id,
                models.Transportation.target_location_id == Customer.location_id,
                models.Transportation.material_id == models.BusinessRelationship.material_id,
            )
        )
        .options(
            joinedload(models.BusinessRelationship.supplier).joinedload(models.Business.location),
            joinedload(models.BusinessRelationship.customer).joinedload(models.Business.location),
            joinedload(models.BusinessRelationship.material),
        )
        # .filter(models.BusinessRelationship.business_id == business_id)
        .all()
    )

    result = []
    for rel, trans in rows:
        transportation_schema = (
            schemas.Transportation(
                #source_location=trans.source_location,
                #target_location=trans.target_location,
                #material=trans.material,
                mode=trans.mode,
                duration=trans.duration,
                price=trans.price
            ) if trans else None
        )

        result.append(
            schemas.BusinessLink(
                supplier=rel.supplier,
                customer=rel.customer,
                material=rel.material,
                transportation=transportation_schema,
            )
        )

    return result

def SAVE_get_all_relationships(business_id: int, db: Session = Depends(get_session)):
    relationships = (
        db.query(models.BusinessRelationship)
        .options(
            joinedload(models.BusinessRelationship.supplier).joinedload(models.Business.location),
            joinedload(models.BusinessRelationship.customer).joinedload(models.Business.location),
            joinedload(models.BusinessRelationship.material)
        )
        .all()
    )

    return [
        schemas.BusinessLink(
            supplier=rel.supplier,
            customer=rel.customer,
            material=rel.material
        )
        for rel in relationships
    ]

@router.put("/relationships/{id}", response_model=schemas.BusinessLink)
def update_relationship(id: int, update: schemas.BusinessLinkUpdate, db: Session = Depends(get_session)):
    db_relationship = (
        db.query(models.BusinessRelationship)
        .filter(models.BusinessRelationship.supplier_id == update.supplier_id)
        .filter(models.BusinessRelationship.customer_id == update.customer_id)
        .first()
    )

    if not db_relationship:
        raise HTTPException(status_code=404, detail="relationship not found")

    setattr(db_relationship, "material_id", update.material_id)

    db.commit()
    db.refresh(db_relationship)
    return db_relationship

@router.get("/{business_id}/available-customers", response_model=List[schemas.BusinessOut])
def list_available_customers(business_id: int, db: Session = Depends(get_session)):
    """Return businesses that can be added as customers without creating a cycle."""

    # --- current customers ---
    current_customers = (
        db.query(models.Business.id)
        .join(
            models.BusinessRelationship,
            models.BusinessRelationship.customer_id == models.Business.id,
        )
        .filter(models.BusinessRelationship.supplier_id == business_id)
        .all()
    )
    current_customer_ids = {c.id for c in current_customers}

    # --- fetch all relationships ---
    all_relationships = db.query(
        models.BusinessRelationship.supplier_id,
        models.BusinessRelationship.customer_id,
    ).all()

    # build reverse adjacency: customer -> suppliers
    reverse_adjacency = {}
    for supplier_id, customer_id in all_relationships:
        reverse_adjacency.setdefault(customer_id, set()).add(supplier_id)

    # --- traverse upstream from business_id to find all reachable suppliers ---
    visited = set()
    stack = [business_id]
    while stack:
        node = stack.pop()
        for parent in reverse_adjacency.get(node, []):
            if parent not in visited:
                visited.add(parent)
                stack.append(parent)

    # --- candidates are all businesses except self, current customers, and upstream nodes ---
    available = (
        db.query(models.Business)
        .filter(models.Business.id != business_id)
        .filter(~models.Business.id.in_(current_customer_ids))
        .filter(~models.Business.id.in_(visited))  # remove any that would form a cycle
        .filter(models.Business.name != "system")  # 🚀 exclude "system"
        .all()
    )

    return available

##### User manager
# routes/business.py
#router = APIRouter(prefix="/business", tags=["business"])

INVITE_EXPIRY_HOURS = 72

@router.post("/{business_id}/invite")
def invite_user(business_id: int, invite: schemas.Invite, db: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    # Check admin role
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    b = db.query(models.Business).filter(models.Business.id == business_id).first()

    #token = secrets.token_urlsafe(32)
    token = create_access_token({
        "business_id": business_id,
        "business_name": b.name,
        "email": invite.email
    })

    businessStr = f"businessId={business_id}&token={token}"
    #businessStr = f"businessId={business_id}&businessName={b.name}&token={token}"
    '''
    invite = models.Invite(
        email=email,
        business_id=business_id,
        role="member",
        token=token,
        expires_at=datetime.utcnow() + timedelta(hours=INVITE_EXPIRY_HOURS),
        used=False,
    )
    db.add(invite)
    db.commit()
    '''
    #signup_url = f"https://yourapp.com/signup?token={token}"
    #send_invite_email(email, signup_url)
    send_mail([invite.email], invite.signup_url, token, businessStr)

    return {"message": f"Invitation sent to {invite.email}"}

@router.delete("/{business_id}/users/{user_id}")
def delete_user(business_id: int, user_id: int, db: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    user_to_delete = db.query(models.User).filter(models.User.id == user_id, models.User.business_id == business_id).first()
    if not user_to_delete:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent deleting last admin
    admin_count = db.query(models.User).filter_by(business_id=business_id, role="admin").count()
    if user_to_delete.role == "admin" and admin_count <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete last admin")

    db.delete(user_to_delete)
    db.commit()
    return {"message": f"User {user_id} deleted"}

@router.get("/{business_id}/users", response_model=List[schemas.UserOut])
def list_users(business_id: int, db: Session = Depends(get_session)):
    users = (
        db.query(models.User)
        .filter(models.User.business_id == business_id)
        .all()
    )
    return users

@router.delete("/{business_id}")
def delete_business(business_id: int, db: Session = Depends(get_session), current_user: models.User = Depends(get_current_user)):
    if current_user.role != "admin" or current_user.business_id != business_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    business = db.query(models.Business).filter(models.Business.id == business_id).first()
    if not business:
        raise HTTPException(status_code=404, detail="Business not found")

    # Safer soft-delete
    business.deleted = True
    db.commit()

    return {"message": f"Business {business_id} marked as deleted"}



@router.put("/{business_id}/users/{user_id}")
def update_user(
    business_id: int,
    user_id: int,
    user_update: schemas.UserUpdate,
    db: Session = Depends(get_session),
    current_user: models.User = Depends(get_current_user),
):
    db_user = db.query(models.User).filter(
        models.User.id == user_id,
        models.User.business_id == business_id
    ).first()

    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    # Admin: can edit all fields except email, password
    if current_user.role == "admin" and current_user.business_id == business_id:
        for field, value in user_update.dict(exclude_unset=True).items():
            if field not in ["email", "hashed_password"]:
                setattr(db_user, field, value)

    # Member: can only edit self, except email, role
    elif current_user.id == user_id and current_user.role == "member":
        for field, value in user_update.dict(exclude_unset=True).items():
            if field not in ["email", "role"]:
                setattr(db_user, field, value)

    else:
        raise HTTPException(status_code=403, detail="Not authorized")

    db.commit()
    db.refresh(db_user)
    return db_user