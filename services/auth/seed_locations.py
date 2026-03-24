# seed_locations.py
from data.models import Business, Location
from utils.database import get_session
from sqlmodel import select

def seed_locations():
    db_gen = get_session()
    db = next(db_gen)

    businesses = db.exec(select(Business)).all()

    for b in businesses:
        if not b.id or b.id < 1:
            continue

        # 1) Create location without forcing ID
        l = Location(name=f"location_{b.id}", description=f"location_{b.id}")
        db.add(l)
        db.flush()      # get auto-generated l.id
        db.refresh(l)

        # 2) Link to Business
        b.location_id = l.id
        db.add(b)

    db.commit()
    db.close()
    print("✅ Locations seeded successfully.")

if __name__ == "__main__":
    seed_locations()
