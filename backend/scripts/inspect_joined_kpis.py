import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIField

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(KPI).where(KPI.is_joined == True).options(selectinload(KPI.fields))
        )
        kpis = res.scalars().all()
        print(f"Total Joined KPIs: {len(kpis)}")
        for k in kpis:
            print(f"\nID: {k.id}, Name: {k.name}")
            print(f"  joined_config: {k.joined_config}")
            for f in k.fields:
                print(f"    Field: id={f.id}, key={f.key}, type={f.field_type}, formula={f.formula_expression}")

if __name__ == "__main__":
    asyncio.run(main())
