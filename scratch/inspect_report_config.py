import asyncio
import sys
import os
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import CustomReport, KPI, KPIField

async def main():
    async with AsyncSessionLocal() as db:
        # Load the custom report (id=1, org_id=3 or similar)
        # Let's search all custom reports
        res = await db.execute(select(CustomReport))
        reports = res.scalars().all()
        print(f"Found {len(reports)} Custom Reports:")
        for r in reports:
            print(f"- ID: {r.id}, Name: {r.name}, fetch_data_with_date: {r.fetch_data_with_date}, date_fetching_config: {r.date_fetching_config}")
            
        # Load KPI 219
        kpi_res = await db.execute(
            select(KPI).where(KPI.id == 219).options(
                select(KPI).options(
                    # Load fields
                )
            )
        )
        kpi = kpi_res.scalar_one_or_none()
        if kpi:
            print(f"\nKPI 219: {kpi.name}, Code: {kpi.code}")
            fields_res = await db.execute(
                select(KPIField).where(KPIField.kpi_id == 219)
            )
            fields = fields_res.scalars().all()
            print("\nFields in KPI 219:")
            for f in fields:
                print(f"- ID: {f.id}, Key: {f.key}, Name: {f.name}, Type: {f.field_type}")
                if f.field_type.value == "multi_line_items":
                    for sf in f.sub_fields:
                        print(f"  * Subfield Key: {sf.key}, Name: {sf.name}, Type: {sf.field_type}")

if __name__ == "__main__":
    asyncio.run(main())
