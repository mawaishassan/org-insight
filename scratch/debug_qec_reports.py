import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPI, KPIField, KPIFieldSubField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell,
    CustomReport, CustomReportSection, CustomReportField
)

async def main():
    async with AsyncSessionLocal() as db:
        cr_res = await db.execute(select(CustomReport).where(CustomReport.name.ilike('%QEC Faculty Performance%')))
        reports = cr_res.scalars().all()
        print("=== CUSTOM REPORTS FOUND ===")
        for r in reports:
            print(f"\nReport ID: {r.id}, Name: '{r.name}', Org: {r.organization_id}")
            sec_res = await db.execute(select(CustomReportSection).where(CustomReportSection.custom_report_id == r.id).order_by(CustomReportSection.order))
            sections = sec_res.scalars().all()
            for sec in sections:
                print(f"  Section ID: {sec.id}, Title: '{sec.title}'")
                f_res = await db.execute(select(CustomReportField).where(CustomReportField.section_id == sec.id).order_by(CustomReportField.order))
                fields = f_res.scalars().all()
                for f in fields:
                    print(f"    Field ID: {f.id}, Label: '{f.label}', Source Type: {f.source_type}, KPI ID: {f.kpi_id}, Field ID: {f.kpi_field_id}, SubField ID: {f.sub_field_id}, Formula: {f.formula_definition}")

if __name__ == '__main__':
    asyncio.run(main())
