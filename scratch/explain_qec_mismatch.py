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
        .order_by(CustomReportSection.sort_order)
    )
    sections = sec_res.scalars().all()
    for sec in sections:
        kpi_obj = await db.get(KPI, sec.kpi_id) if sec.kpi_id else None
        kpi_name = kpi_obj.name if kpi_obj else "No KPI"
        print(f"\n  SECTION ID {sec.id}: KPI='{kpi_name}' ({sec.kpi_id}), Custom Header='{sec.custom_header}'")
        
        f_res = await db.execute(
            select(CustomReportField)
            .where(CustomReportField.custom_report_section_id == sec.id)
            .order_by(CustomReportField.sort_order)
        )
        fields = f_res.scalars().all()
        for f in fields:
            kf = await db.get(KPIField, f.kpi_field_id) if f.kpi_field_id else None
            kf_name = kf.name if kf else "No Field"
            print(f"    FIELD ID {f.id}: Field Name='{kf_name}', Field Type='{getattr(kf, 'field_type', None)}', Config={f.config}")

async def main():
    async with AsyncSessionLocal() as db:
        await inspect_report(db, 35)
        await inspect_report(db, 37)

if __name__ == '__main__':
    asyncio.run(main())
