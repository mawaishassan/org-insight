import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    CustomReport, CustomReportSection, CustomReportField,
    KPI, KPIField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        r_id = 36
        org_id = 3
        rep = await db.get(CustomReport, r_id)
        print(f"Report {r_id}: Name='{rep.name}', OrgID={rep.organization_id}")
        
        sections = (await db.execute(
            select(CustomReportSection).where(CustomReportSection.custom_report_id == r_id)
        )).scalars().all()
        
        for sec in sections:
            print(f"\nSection ID: {sec.id}, KPI_ID: {sec.kpi_id}")
            kpi = await db.get(KPI, sec.kpi_id)
            print(f"KPI: ID={kpi.id}, Name='{kpi.name}'")
            
            # Check KPI entries for this KPI
            entries = (await db.execute(
                select(KPIEntry).where(
                    KPIEntry.organization_id == org_id,
                    KPIEntry.kpi_id == sec.kpi_id,
                    KPIEntry.is_draft == False
                )
            )).scalars().all()
            print(f"Published KPIEntries for KPI {sec.kpi_id}: {len(entries)}")
            for e in entries:
                print(f"  Entry ID {e.id}: year='{e.year}' (type {type(e.year)}), period_key='{e.period_key}'")

            fields = (await db.execute(
                select(CustomReportField).where(CustomReportField.custom_report_section_id == sec.id)
            )).scalars().all()
            for f in fields:
                kf = await db.get(KPIField, f.kpi_field_id)
                print(f"  Field ID {f.id}: KPIField ID={kf.id if kf else None}, Name='{kf.name if kf else None}', Type='{kf.field_type if kf else None}'")
                print(f"    Config: {f.config}")

if __name__ == "__main__":
    asyncio.run(main())
