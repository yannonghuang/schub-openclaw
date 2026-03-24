
from sqlalchemy.orm import Session
from data import models
from utils.database import get_session
from sqlalchemy import select, distinct



def retrieve_mcp_registry(db: Session, business_id: int | None):
    if business_id is None:
        return db.query(models.MCP_Registry).all()

    return db.query(models.MCP_Registry).filter(models.MCP_Registry.business_id == business_id).all()

def select_mcp_registry(db: Session):
    # Select distinct 'name' and 'email' combinations
    stmt = select(models.MCP_Registry.business_id).distinct()
    results = db.execute(stmt).all()
    return results

def main():
    db_gen = get_session()
    db = next(db_gen)

    mcp_registry = select_mcp_registry(db) #retrieve_mcp_registry(db, None)

    print(f"🎉 mcp_registry: {mcp_registry[0].business_id}")


if __name__ == "__main__":
    main()
