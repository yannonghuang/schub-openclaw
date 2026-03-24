from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy.orm import Session
from passlib.hash import bcrypt
from passlib.context import CryptContext
import uuid

from data import models, schemas

#from shared.db.session import get_session
from utils.database import get_session

#from shared.auth.jwt import create_reset_token, verify_reset_token
from utils.auth import hash_password, create_reset_token, verify_reset_token, decode_access_token
from utils.email import send_mail

import logging
logger = logging.getLogger("main")
logging.basicConfig(level=logging.INFO)

#router = APIRouter(prefix="/auth", tags=["auth"])
router = APIRouter()

# In-memory session store (replace with Redis in prod)
sessions = {}

def get_current_user(request: Request, db: Session = Depends(get_session)):
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in sessions:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user_id = sessions[session_id]["user_id"]
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid session")
    return user#, sessions[session_id].get("selected_business_id")


@router.post("/signup", response_model=schemas.UserOut)
def signup(payload: schemas.UserCreate, db: Session = Depends(get_session)):
    # Check email already exists
    existing = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    business = None
    admin_existed = False
    # Case A: join existing business
    if payload.business_id:
        business = db.query(models.Business).filter(models.Business.id == payload.business_id).first()
        if not business:
            raise HTTPException(status_code=404, detail="Business not found")
        else:
            if payload.token:
                decoded = decode_access_token(payload.token)
                if (decoded["business_id"] != payload.business_id 
                    or decoded["business_name"] != payload.business.name
                    #or decoded["email"] != payload.email
                    ):
                    raise HTTPException(status_code=404, detail="Invalid invite")

            admin_count = db.query(models.User).filter_by(business_id=business.id, role="admin").count()
            if admin_count >= 1:
                admin_existed = True

    # Case B: create new business
    elif payload.business:
        business = models.Business(name=payload.business.name)
        db.add(business)
        db.commit()
        db.refresh(business)

    # Create user and link to business (one-to-many)
    user = models.User(
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role="member" if admin_existed else "admin",
        business=business,   # ✅ just assign the relationship
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.post("/signin")
def signin(data: schemas.SignInRequest, response: Response, db: Session = Depends(get_session)):
    user = db.query(models.User).filter(models.User.email == data.username).first()
    if not user or not bcrypt.verify(data.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    session_id = str(uuid.uuid4())
    sessions[session_id] = {"user_id": user.id, "selected_business_id": None}
    response.set_cookie("session_id", session_id, httponly=True)

    #return {"user": schemas.UserBase.from_orm(user)}
    # Include associated business in response
    return {
        "user": {
            "id": user.id,
            "email": user.email,
            "full_name": user.full_name,
            "business": {
                "id": user.business.id,
                "name": user.business.name,
                "location": user.business.location
            } if user.business else None,
            "role": user.role
        }
    }

@router.post("/signout")
def signout(response: Response, request: Request):
    session_id = request.cookies.get("session_id")
    if session_id and session_id in sessions:
        del sessions[session_id]
    response.delete_cookie("session_id")
    return {"message": "Signed out"}

@router.get("/me")
def get_me(user_info=Depends(get_current_user)):
    user = user_info
    user_data = schemas.UserBase.from_orm(user).dict()
    '''
    if selected_business_id:
        selected = next((b for b in user.businesses if b.id == selected_business_id), None)
        user_data["selected_business"] = selected
    '''
    return {"user": user_data}

@router.post("/select_business")
def select_business(data: schemas.SelectBusinessRequest, request: Request):
    session_id = request.cookies.get("session_id")
    if not session_id or session_id not in sessions:
        raise HTTPException(status_code=401, detail="Not authenticated")

    sessions[session_id]["selected_business_id"] = data.business_id
    return {"message": "Business selected"}


@router.post("/forgot-password")
def forgot_password(data: schemas.ForgotPasswordRequest, session: Session = Depends(get_session)):
    #user = session.exec(select(Account).where(Account.email == data.email)).first()
    user = session.query(models.User).filter(models.User.email == data.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="Email not found")
    token = create_reset_token(data.email)

    send_mail([data.email], data.url, token)

    return {"reset_token": "Please check your email and following instruction to reset your password"}

@router.post("/reset-password")
def reset_password(data: schemas.ResetPasswordRequest, session: Session = Depends(get_session)):
    email = verify_reset_token(data.token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    #user = session.exec(select(Account).where(Account.email == email)).first()
    user = session.query(models.User).filter(models.User.email == email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    #user.password_hash = pwd_context.hash(data.new_password)
    user.hashed_password = hash_password(data.new_password)
    session.commit()
    return {"message": "Password updated successfully"}