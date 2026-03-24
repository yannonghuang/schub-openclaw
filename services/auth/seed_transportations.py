from sqlalchemy.orm import Session
from sqlalchemy import select
import random

from data.models import Location, Material, Transportation
from utils.database import get_session

TRANSPORT_MODES = [
    ("air", 1, 3, 3.0, 6.0),   # mode, min_days, max_days, min_price, max_price
    ("land", 3, 10, 1.0, 3.0),
    ("sea", 10, 40, 0.5, 1.5),
]

def seed_transportations():
    db_gen = get_session()
    db: Session = next(db_gen)

    locations = db.execute(select(Location)).scalars().all()
    materials = db.execute(select(Material)).scalars().all()

    if not locations or not materials:
        print("❌ No locations or materials found. Seed them first.")
        return

    print(f"🌍 Locations: {len(locations)}, 📦 Materials: {len(materials)}")

    new_count = 0

    for src in locations:
        for tgt in locations:
            if src.id == tgt.id:
                continue  # skip same-location routes

            for m in materials:
                # Skip if record already exists
                existing = db.get(
                    Transportation,
                    (src.id, tgt.id, m.id)
                )
                if existing:
                    continue

                # choose a random mode & realistic numbers
                mode, min_days, max_days, min_price, max_price = random.choice(TRANSPORT_MODES)
                duration = random.randint(min_days, max_days)
                price = round(random.uniform(min_price, max_price), 2)

                route = Transportation(
                    source_location_id=src.id,
                    target_location_id=tgt.id,
                    material_id=m.id,
                    mode=mode,
                    duration=duration,
                    price=price,
                )

                db.add(route)
                new_count += 1

    db.commit()
    db.close()
    print(f"✅ Done. Added {new_count} transportation routes.")


if __name__ == "__main__":
    seed_transportations()
