import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIField

async def main():
    async with AsyncSessionLocal() as db:
        f_res = await db.execute(select(KPIField).where(KPIField.kpi_id == 277))
        fields = f_res.scalars().all()
        print("=== KPI 277 FIELDS & FORMULAS ===")
        for f in fields:
            print(f"ID: {f.id}, Key: '{f.key}', Name: '{f.name}', Type: {f.field_type}, Config: {f.config}")

if __name__ == '__main__':
    asyncio.run(main())
