from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime

class BusinessCreate(BaseModel):
    name: str

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    business_id: Optional[int] = None   # join existing business
    token: Optional[str] = None   # join existing business
    business: Optional[BusinessCreate] = None  # create new business

class MaterialOut(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    hs_code: Optional[str] = None
    buyer_code: Optional[str] = None
    supplier_code: Optional[str] = None

    class Config:
        from_attributes = True

class BusinessUpdate(BaseModel):
    id: int
    name: str
    agent_prompt: str

class BusinessBase(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True

class UserOut(BaseModel):
    id: int
    email: EmailStr
    full_name: str
    business: Optional[BusinessBase]
    role: Optional[str]

    class Config:
        from_attributes = True

class UserBase(BaseModel):
    id: int
    email: EmailStr
    #businesses: List[BusinessBase] = []
    #selected_business: Optional[BusinessBase] = None
    business: Optional[BusinessBase] = None

    class Config:
        from_attributes = True

class LocationOut(BaseModel):
    id: int
    name: str
    description: str
    
    class Config:
        from_attributes = True  # ✅ add this

class Transportation(BaseModel):
    #source_location: LocationOut
    #target_location: LocationOut
    #material: MaterialOut
    mode: str
    duration: int
    price: float 
    
class BusinessOut(BaseModel):
    id: int
    name: str
    agent_prompt: Optional[str] = None
    material: Optional[MaterialOut] = None  # new field for linked material
    users: List[UserBase] = []
    location: Optional[LocationOut] = None

    transportation: Optional[Transportation] = None 

    class Config:
        from_attributes = True

class SupplyLinkRequest(BaseModel):
    id: int
    material_id: Optional[int] = None

class SupplyOut(BusinessBase):
    pass

class SupplyCreate(BusinessBase):
    pass

class CustomerLinkRequest(BaseModel):
    id: int
    material_id: Optional[int] = None

class SignInRequest(BaseModel):
    username: str
    password: str

class SelectBusinessRequest(BaseModel):
    business_id: int

class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str

class ForgotPasswordRequest(BaseModel):
    email: EmailStr
    url: str

# For creating a new relationship
class BusinessLinkCreate(BaseModel):
    supplier_id: int
    customer_id: int

# For returning an existing relationship
class BusinessLink(BaseModel):
    supplier: BusinessOut
    customer: BusinessOut

    material: Optional[MaterialOut] = None  
    transportation: Optional[Transportation] = None 

    class Config:
        #from_attributes = True
        orm_mode = True

class BusinessLinkUpdate(BaseModel):
    supplier_id: int
    customer_id: int
    material_id: int


class Invite(BaseModel):
    email: str
    signup_url: str

class UserUpdate(BaseModel):
    id: int
    full_name: Optional[str]
    role: Optional[str]
    #business_id: Optional[int]


class MaterialCandidatesRequest(BaseModel):
    sender: int
    recipients: List[int]
    target: str

class MaterialResponse(BaseModel):
    id: int
    name: str

class MaterialCandidatesResponse(BaseModel):
    materials: List[MaterialResponse]

class MCPServerCreate(BaseModel):
    url: str
    name: str
    description: str
    prompt: str
    business_id: Optional[int] = None

class MCPServerOut(BaseModel):
    id: int
    url: str
    name: str
    description: str
    prompt: str
    subagent_id: Optional[int]
    business_id: Optional[int]
    business: Optional[BusinessOut]

    class Config:
        from_attributes = True

class MCPServerUpdate(BaseModel):
    id: int
    url: Optional[str]
    name: Optional[str]
    description: Optional[str]
    prompt: Optional[str]

class ToolCreate(BaseModel):
    name: str
    description: Optional[str]
    config: Optional[dict] = None
    business_id: Optional[int] = None

class ToolUpdate(BaseModel):
    description: Optional[str]
    config: Optional[dict] = None
    business_id: int

class ToolOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    config: Optional[dict]
    subagent_id: Optional[int]
    business_id: Optional[int]
    business: Optional[BusinessOut]

    class Config:
        from_attributes = True

# ---------------------------
# Pydantic Schemas (local)
# ---------------------------
class SubAgentCreate(BaseModel):
    name: str = Field(..., example="inventory_expert")
    description: Optional[str] = Field(None, example="Handles inventory questions")
    prompt: Optional[str] = Field(None, example="You are an inventory specialist.")
    enabled: Optional[bool] = True


class SubAgentUpdate(BaseModel):
    name: Optional[str]
    description: Optional[str]
    prompt: Optional[str]
    enabled: Optional[bool]


class SubAgentOut(BaseModel):
    id: int
    business_id: int
    name: str
    description: Optional[str]
    prompt: Optional[str]
    enabled: bool

    class Config:
        orm_mode = True


class TransportationBase(BaseModel):
    source_location_id: int
    target_location_id: int
    material_id: int
    mode: str
    duration: int
    price: Optional[float] = None


class TransportationCreate(TransportationBase):
    pass


class TransportationUpdate(BaseModel):
    source_location_id: int
    target_location_id: int
    material_id: int
    mode: Optional[str] = None
    duration: Optional[int] = None
    price: Optional[float] = None


class TransportationOut(BaseModel):
    source_location: "LocationOut"
    target_location: "LocationOut"
    material: "MaterialOut"
    mode: str
    duration: int
    price: Optional[float]

    class Config:
        orm_mode = True

# --- Request body schema for filtering ---
class TransportationFilter(BaseModel):
    source_location_id: Optional[int] = None
    target_location_id: Optional[int] = None
    material_id: Optional[int] = None
    mode: Optional[str] = None

##### LangGraph thread management
#################################
class ThreadMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    class Config:
        orm_mode = True


class ThreadResponse(BaseModel):
    id: int
    graph_id: str
    thread_id: str
    title: Optional[str]
    initial_message: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class ThreadDetailResponse(ThreadResponse):
    messages: List[ThreadMessageResponse]

class ResolveRequest(BaseModel):
    external_thread_id: str
    assistant_id: str
    business_id: int
    initial_message: str | None = None

# -------------------------------
# Request Models
# -------------------------------
class IncomingMessage(BaseModel):
    role: str
    content: str
    created_at: Optional[datetime] = None
    message_id: Optional[str] = None


class SaveMessagesRequest(BaseModel):
    # LangGraph UUID
    thread_id: str
    messages: List[IncomingMessage]

# -------------------------------
# Response Models
# -------------------------------
class SaveMessagesResponse(BaseModel):
    thread_id: str
    saved_count: int
    total_messages: int
    messages: List[dict]

class AdaptorEvent(BaseModel):
    business_id: int
    event_type: str
    message_id: int
    response: str
    original_mail: str
    source: str = "email"


class SystemPromptOut(BaseModel):
    key: str
    content: str
    description: Optional[str]
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class SystemPromptUpdate(BaseModel):
    content: str
    description: Optional[str] = None


# ---------------------------
# MCP Explorer
# ---------------------------
class MCPExploreRequest(BaseModel):
    url: str
    api_key: Optional[str] = None


class MCPToolParam(BaseModel):
    name: str
    type: Optional[str] = None
    description: Optional[str] = None
    required: bool = False


class MCPToolSchema(BaseModel):
    name: str
    description: Optional[str] = None
    input_schema: dict = {}


class MCPExploreResult(BaseModel):
    url: str
    server_name: Optional[str] = None
    tools: List[MCPToolSchema]


# ---------------------------------------------------------------------------
# Async Job schemas
# ---------------------------------------------------------------------------

class AsyncJobCreate(BaseModel):
    job_id: str
    thread_id: str
    business_id: int
    engine_name: str


class AsyncJobUpdate(BaseModel):
    status: str                          # "completed" | "error"
    result: Optional[dict] = None
    error: Optional[str] = None


class AsyncJobOut(BaseModel):
    job_id: str
    thread_id: str
    business_id: int
    engine_name: str
    status: str
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
