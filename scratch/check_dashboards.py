import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import Dashboard, ReportTemplate, CustomReport

async def main():
    async with AsyncSessionLocal() as db:
        print("--- Dashboards ---")
        dash_res = await db.execute(select(Dashboard))
        dashes = dash_res.scalars().all()
        for d in dashes:
            print(f"ID: {d.id}, Name: {d.name}, fetch_data_with_date: {getattr(d, 'fetch_data_with_date', None)}, Org ID: {d.organization_id}")
            
        print("\n--- Standard Report Templates ---")
        rep_res = await db.execute(select(ReportTemplate))
        reps = rep_res.scalars().all()
        for r in reps:
            print(f"ID: {r.id}, Name: {r.name}, fetch_data_with_date: {getattr(r, 'fetch_data_with_date', None)}, Org ID: {r.organization_id}")

        print("\n--- Custom Reports ---")
        crep_res = await db.execute(select(CustomReport))
        creps = crep_res.scalars().all()
        for cr in creps:
            print(f"ID: {cr.id}, Name: {cr.name}, fetch_data_with_date: {getattr(cr, 'fetch_data_with_date', None)}, Org ID: {cr.organization_id}")

if __name__ == "__main__":
    asyncio.run(main())
