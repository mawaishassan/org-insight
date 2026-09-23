import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import (
    CustomReport, CustomReportSection, CustomReportField,
    KPI, KPIField, KPIFieldSubField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell
)

async def inspect_report(db, report_id):
    cr = await db.get(CustomReport, report_id)
    print(f"\n=======================================================")
    print(f"REPORT ID {cr.id}: '{cr.name}' (Org: {cr.organization_id})")
    print(f"=======================================================")
    
    sec_res = await db.execute(
        select(CustomReportSection)
        .where(CustomReportSection.custom_report_id == cr.id)
    )
    sections = sec_res.scalars().all()
    for sec in sections:
        print(f"\n  SECTION ID {sec.id}: Title='{sec.title}'")
        f_res = await db.execute(
            select(CustomReportField)
            .where(CustomReportField.section_id == sec.id)
        )
        fields = f_res.scalars().all()
        for f in fields:
            print(f"    FIELD ID {f.id}: Label='{f.label}', SourceType='{f.source_type}', KPI_ID={f.kpi_id}, KPI_Field_ID={f.kpi_field_id}, SubField_ID={f.sub_field_id}, Formula='{getattr(f, 'formula_definition', None)}'")

async def main():
    async with AsyncSessionLocal() as db:
        await inspect_report(db, 35)
        await inspect_report(db, 37)

if __name__ == '__main__':
    asyncio.run(main())
