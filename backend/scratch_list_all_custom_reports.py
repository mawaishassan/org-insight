import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import CustomReport, CustomReportSection, KPI, CustomReportField
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        reports = (await db.execute(select(CustomReport).order_by(CustomReport.id))).scalars().all()
        print(f"Total Custom Reports in DB: {len(reports)}")
        for r in reports:
            print(f"\nReport ID {r.id}: name='{r.name}', org_id={r.organization_id}")
            sections = (await db.execute(select(CustomReportSection).where(CustomReportSection.custom_report_id == r.id))).scalars().all()
            for s in sections:
                kpi = (await db.execute(select(KPI).where(KPI.id == s.kpi_id))).scalar_one_or_none()
                fields = (await db.execute(select(CustomReportField).where(CustomReportField.custom_report_section_id == s.id))).scalars().all()
                print(f"   Section {s.id}: kpi_id={s.kpi_id} ('{kpi.name if kpi else None}')")
                for f in fields:
                    print(f"      Field {f.id}: kpi_field_id={f.kpi_field_id}")

if __name__ == "__main__":
    asyncio.run(main())
