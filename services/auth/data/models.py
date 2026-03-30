from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Table, Boolean, DateTime, Text, func, UniqueConstraint
from sqlalchemy.orm import relationship, declarative_base, Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB

Base = declarative_base()

# Association table for supplier-customer relationships
'''
business_relationship = Table(
    "business_relationships",
    Base.metadata,
    Column("supplier_id", Integer, ForeignKey("businesses.id"), primary_key=True),
    Column("customer_id", Integer, ForeignKey("businesses.id"), primary_key=True),
    Column("material_id", Integer, ForeignKey("materials.id"), nullable=True),
)
'''

class BusinessRelationship(Base):
    __tablename__ = "business_relationships"

    supplier_id = Column(Integer, ForeignKey("businesses.id"), primary_key=True)
    customer_id = Column(Integer, ForeignKey("businesses.id"), primary_key=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=True)

    supplier = relationship("Business", foreign_keys=[supplier_id])
    customer = relationship("Business", foreign_keys=[customer_id])
    material = relationship("Material", lazy="joined")

class Material(Base):
    __tablename__ = "materials"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False, index=True)
    description = Column(String)
    hs_code = Column(String)
    buyer_code = Column(String)
    supplier_code = Column(String)

class Location(Base):
    __tablename__ = "locations"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False, index=True)
    description = Column(String)

class Transportation(Base):
    __tablename__ = "transportations"

    source_location_id = Column(Integer, ForeignKey("locations.id"), primary_key=True)
    target_location_id = Column(Integer, ForeignKey("locations.id"), primary_key=True)
    material_id = Column(Integer, ForeignKey("materials.id"), primary_key=True)

    source_location = relationship("Location", foreign_keys=[source_location_id])
    target_location = relationship("Location", foreign_keys=[target_location_id])
    material = relationship("Material", foreign_keys=[material_id])

    mode = Column(String, nullable=False) # air | land | sea
    duration = Column(Integer, nullable=False) # number of days
    price = Column(Float) 


class Business(Base):
    __tablename__ = "businesses"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)

    agent_prompt = Column(String, nullable=True)

    # One-to-many: a business has many users
    users = relationship("User", back_populates="business")

    location_id = Column(Integer, ForeignKey("locations.id"), nullable=True)
    location = relationship("Location", foreign_keys=[location_id])

    mcp_registry = relationship("MCP_Registry", back_populates="business", cascade="all, delete-orphan")
    tools = relationship("Tool", back_populates="business", cascade="all, delete-orphan")

    # relationships
    customers = relationship(
        "BusinessRelationship",
        foreign_keys="[BusinessRelationship.supplier_id]",
        back_populates="supplier",
        cascade="all, delete-orphan"
    )
    suppliers = relationship(
        "BusinessRelationship",
        foreign_keys="[BusinessRelationship.customer_id]",
        back_populates="customer",
        cascade="all, delete-orphan"
    )
    
    # add this line
    invites = relationship("Invite", back_populates="business", cascade="all, delete-orphan")

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    full_name = Column(String, nullable=False)
    hashed_password = Column(String, nullable=False)

    role = Column(String, nullable=True)
    business_id = Column(Integer, ForeignKey("businesses.id"))
    business = relationship("Business", back_populates="users")


class Invite(Base):
    __tablename__ = "invites"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False)
    business_id = Column(Integer, ForeignKey("businesses.id"), nullable=False)
    role = Column(String(20), default="member")
    token = Column(String(255), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime, nullable=False)
    used = Column(Boolean, default=False)

    # optional: link back to Business
    business = relationship("Business", back_populates="invites")

class MCP_Registry(Base):
    __tablename__ = "mcp_registry"

    id = Column(Integer, primary_key=True, index=True)
    url = Column(String, nullable=False)
    prompt = Column(String, nullable=False)
    name = Column(String, nullable=True)
    description = Column(String, nullable=True)

    business_id = Column(Integer, ForeignKey("businesses.id"))
    business = relationship("Business", back_populates="mcp_registry")

    # NEW OPTIONAL ATTRIBUTE
    subagent_id = Column(Integer, ForeignKey("sub_agents.id"), nullable=True)
    subagent = relationship("SubAgent", back_populates="mcp_registry")
    
class Tool(Base):
    __tablename__ = "tools"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    config = Column(JSONB, nullable=True)

    business_id = Column(Integer, ForeignKey("businesses.id"))
    business = relationship("Business", back_populates="tools")

    # NEW OPTIONAL ATTRIBUTE
    subagent_id = Column(Integer, ForeignKey("sub_agents.id"), nullable=True)
    subagent = relationship("SubAgent", back_populates="tools")

class SubAgent(Base):
    __tablename__ = "sub_agents"

    id = Column(Integer, primary_key=True, index=True)
    business_id = Column(Integer, ForeignKey("businesses.id"), nullable=False)

    name = Column(String, nullable=False)             # used as tool name
    description = Column(String, nullable=True)
    prompt = Column(String, nullable=True)
    enabled = Column(Boolean, default=True)

    business = relationship("Business", backref="sub_agents")

    tools = relationship("Tool", back_populates="subagent")
    mcp_registry = relationship("MCP_Registry", back_populates="subagent")

##### LangGraph thread management
#################################
class Thread(Base):
    __tablename__ = "threads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    business_id: Mapped[int] = mapped_column(Integer, nullable=False)

    # Thread metadata stored from LangGraph side
    graph_id: Mapped[str] = mapped_column(String, nullable=False)
    
    # LangGraph UUID thread_id
    thread_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)

    # NEW: user-defined ID (WIP:111, etc.)
    external_thread_id: Mapped[str] = mapped_column(String, nullable=True, index=True)
    
    title: Mapped[str] = mapped_column(String, nullable=True)

    fingerprint: Mapped[str] = mapped_column(String, nullable=True)

    # The human message responsible for opening the window
    initial_message: Mapped[str] = mapped_column(Text, nullable=True)

    # "pubsub" (triggered by external event) or "user" (initiated by logged-in user)
    thread_source: Mapped[str] = mapped_column(String, nullable=True)

    created_at: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )
    updated_at: Mapped[str] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Add UNIQUE constraint to prevent duplicates!
    __table_args__ = (
        UniqueConstraint("external_thread_id", "business_id",
                         name="uq_external_business"),
    )

    #messages = relationship("ThreadMessage", back_populates="thread")
    messages = relationship(
        "ThreadMessage",
        back_populates="thread",
        cascade="all, delete, delete-orphan",
        passive_deletes=True  # rely on DB ON DELETE CASCADE
    )

class ThreadMessage(Base):
    __tablename__ = "thread_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)

    thread_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("threads.id", ondelete="CASCADE")
    )

    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)

    created_at: Mapped[str] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    # LangGraph UUID message_id
    message_id: Mapped[str] = mapped_column(String, nullable=False, unique=True)

    thread = relationship("Thread", back_populates="messages")

    def to_dict(self):
        return {
            "role": self.role,
            "content": self.content,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
    

class SystemPrompt(Base):
    __tablename__ = "system_prompts"
    key         = Column(String, primary_key=True)
    content     = Column(Text, nullable=False)
    description = Column(String, nullable=True)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Span(Base):
    __tablename__ = "spans"
    id              = Column(String, primary_key=True)
    trace_id        = Column(String, nullable=False, index=True)
    parent_id       = Column(String, nullable=True)
    name            = Column(String, nullable=False)
    kind            = Column(String, nullable=False)   # event|agent|tool|email
    business_id     = Column(Integer, nullable=False, index=True)
    started_at      = Column(DateTime(timezone=True), nullable=False)
    ended_at        = Column(DateTime(timezone=True), nullable=True)
    status          = Column(String, nullable=True)    # ok|error|pending
    update_event_id = Column(Integer, ForeignKey("update_events.id"), nullable=True)
    thread_id       = Column(String, nullable=True)
    attributes      = Column(JSONB, nullable=True)


########################## audit data models ################################
# models.py
#from sqlalchemy import Column, Integer, Text, String, TIMESTAMP, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.declarative import declarative_base

from sqlalchemy import (
    Column,
    Integer,
    Text,
    String,
    Float,
    ForeignKey,
    TIMESTAMP,
    Index,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

class Channel(Base):
    __tablename__ = "channels"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, nullable=False, index=True)
    business_id = Column(Integer, nullable=True, index=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    channel = Column(String, nullable=False, index=True)
    business_id = Column(Integer, nullable=True, index=True)
    payload = Column(JSONB, nullable=False)
    text_content = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)

    update_event = relationship(
        "UpdateEvent",
        back_populates="message",
        uselist=False,
        cascade="all, delete-orphan",
    )

class UpdateEvent(Base):
    __tablename__ = "update_events"

    id = Column(Integer, primary_key=True)

    # 1–1 projection from messages table
    msg_id = Column(
        Integer,
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    business_id = Column(Integer, nullable=False, index=True)
    event_type = Column(Text, nullable=False)     # e.g. "WIP"
    message_id = Column(Text, nullable=False)
    target = Column(Text, nullable=False)         # "supplier"

    # Flattened multi-value (mostly singleton)
    materials = Column(ARRAY(Text), nullable=False)

    quantity_decrease_percentage = Column(Float)
    delivery_delay_days = Column(Integer)

    source_business_id = Column(Integer)

    recipient_business_id = Column(Integer)

    created_at = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=func.now(),
        index=True,
    )

    # ORM relationships
    message = relationship(
        "Message",
        back_populates="update_event",
        lazy="joined",
    )


Index(
    "ix_update_events_materials_gin",
    UpdateEvent.materials,
    postgresql_using="gin",
)


class EmailHitl(Base):
    """Maps an outbound HITL email's Message-ID to the OpenClaw session that sent it."""
    __tablename__ = "email_hitl"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    message_id  = Column(String, unique=True, nullable=False, index=True)  # SMTP Message-ID
    session_key = Column(String, nullable=False)   # OpenClaw session key to resume
    agent_id    = Column(String, nullable=False, default="")
    business_id = Column(Integer, nullable=False)
    status      = Column(String, nullable=False, default="pending")  # pending|resumed
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)


class AsyncJob(Base):
    """Persistent store for long-running MCP tool jobs."""
    __tablename__ = "async_jobs"

    job_id      = Column(String, primary_key=True)
    thread_id   = Column(String, nullable=False, index=True)
    business_id = Column(Integer, nullable=False)
    engine_name = Column(String, nullable=False)
    status      = Column(String, nullable=False, default="pending")  # pending|completed|error
    result      = Column(JSONB, nullable=True)
    error       = Column(Text, nullable=True)
    created_at  = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at  = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

