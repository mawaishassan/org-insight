import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIField, KPIFieldSubField
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== KPI 277 SUBFIELDS & FORMULAS ===")
        subfields = (await db.execute(
            select(KPIFieldSubField)
            .join(KPIField, KPIField.id == KPIFieldSubField.field_id)
            .where(KPIField.kpi_id == 277)
        )).scalars().all()
        
        for sf in subfields:
            print(f"\nSubfield ID {sf.id}: Name='{sf.name}', Key='{sf.key}', FieldType='{sf.field_type}'")
            print(f"  Config: {sf.config}")

if __name__ == "__main__":
    asyncio.run(main())
