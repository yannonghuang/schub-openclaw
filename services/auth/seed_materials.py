# seed_materials.py
from sqlmodel import create_engine, Session
from data.models import Material
from utils.database import get_session

def seed_materials():
    db_gen = get_session()      # this is a generator
    db = next(db_gen)           # get the actual Session instance

    materials = [
        {"name": "Steel Rod", "description": "High-strength steel rod", "hs_code": "721499", "buyer_code": "BR-ST-01", "supplier_code": "SP-ST-01"},
        {"name": "Copper Wire", "description": "Conductive copper wire", "hs_code": "740819", "buyer_code": "BR-CW-02", "supplier_code": "SP-CW-02"},
        {"name": "Aluminum Sheet", "description": "Lightweight aluminum sheet", "hs_code": "760611", "buyer_code": "BR-AL-03", "supplier_code": "SP-AL-03"},
        {"name": "Plastic Granules", "description": "Injection molding raw plastic", "hs_code": "390120", "buyer_code": "BR-PL-04", "supplier_code": "SP-PL-04"},
    ]

    for m in materials:
        exists = db.query(Material).filter_by(name=m["name"]).first()
        if not exists:
            db.add(Material(**m))

    db.commit()
    db.close()
    print("✅ Materials seeded successfully.")

if __name__ == "__main__":
    seed_materials()
