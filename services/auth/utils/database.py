# shared/db/session.py
from sqlmodel import create_engine, Session
from typing import Generator
import os

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/schub")

engine = create_engine(
    DATABASE_URL,
    echo=False,
    isolation_level="READ COMMITTED",  # Explicitly set the transaction isolation level
)

def get_session() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session
