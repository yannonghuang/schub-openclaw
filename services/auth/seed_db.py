# services/geopol/seed_db.py

import random
from sqlalchemy.orm import Session
from data import models
from utils.database import get_session


BUSINESS_START_ID = 100
NUM_BUSINESSES = 10


def create_businesses(db: Session):
    """Create businesses with IDs starting at BUSINESS_START_ID."""
    businesses = []
    for i in range(BUSINESS_START_ID, BUSINESS_START_ID + NUM_BUSINESSES):
        b = models.Business(id=i, name=f"business_{i}")
        db.add(b)
        businesses.append(b)
    db.commit()

    print(f"✅ Created {len(businesses)} businesses")
    return businesses


def create_dag_relationships(db: Session, businesses):
    """
    Create supplier → customer relationships as a DAG.
    Rule: suppliers must have smaller IDs than the customer.
    """
    relationships_added = 0

    for customer in businesses:
        possible_suppliers = [b for b in businesses if b.id < customer.id]
        if not possible_suppliers:
            continue

        # Pick 1–3 random suppliers
        num_suppliers = random.randint(1, min(3, len(possible_suppliers)))
        suppliers = random.sample(possible_suppliers, k=num_suppliers)

        for supplier in suppliers:
            rel = models.BusinessRelationship(
                supplier=supplier,
                customer=customer,
                material=None,  # optional
            )
            db.add(rel)
            relationships_added += 1

    db.commit()
    print(f"✅ Created {relationships_added} supplier→customer relationships")


def main():
    db_gen = get_session()
    db = next(db_gen)

    businesses = create_businesses(db)
    create_dag_relationships(db, businesses)

    print("🎉 Database seeded successfully")


if __name__ == "__main__":
    main()
