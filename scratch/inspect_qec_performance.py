import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPI, KPIField, KPIFieldSubField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell,
    CustomReport, ReportTemplate
)

async def main():
    async with AsyncSessionLocal() as db:
        # Fetch KPIs matching 'QEC' or 'Faculty'
        stmt = select(KPI).where(KPI.name.ilike('%Faculty%'))
        res = await db.execute(stmt)
        kpis = res.scalars().all()
        
        print("=== MATCHING KPIS ===")
        for k in kpis:
            print(f"KPI ID: {k.id}, Name: {k.name}, Org: {k.organization_id}")
            f_stmt = select(KPIField).where(KPIField.kpi_id == k.id)
            fields = (await db.execute(f_stmt)).scalars().all()
            for f in fields:
                formula = getattr(f, 'formula_config', None) or getattr(f, 'config', None)
                print(f"  Field ID: {f.id}, Key: {f.key}, Name: {f.name}, Type: {f.field_type}")
                sf_stmt = select(KPIFieldSubField).where(KPIFieldSubField.field_id == f.id)
                sfs = (await db.execute(sf_stmt)).scalars().all()
                for sf in sfs:
                    print(f"    SubField ID: {sf.id}, Key: {sf.key}, Name: {sf.name}")

        # Check Reports (CustomReport and ReportTemplate) matching QEC or Faculty
        cr_stmt = select(CustomReport).where(CustomReport.name.ilike('%Faculty%'))
        crs = (await db.execute(cr_stmt)).scalars().all()
        print("\n=== CUSTOM REPORTS ===")
        for cr in crs:
            print(f"CustomReport ID: {cr.id}, Name: {cr.name}, Org: {cr.organization_id}")

        rt_stmt = select(ReportTemplate).where(ReportTemplate.name.ilike('%Faculty%'))
        rts = (await db.execute(rt_stmt)).scalars().all()
        print("\n=== REPORT TEMPLATES ===")
        for rt in rts:
            print(f"ReportTemplate ID: {rt.id}, Name: {rt.name}, Org: {rt.organization_id}")

        print("\n=== ENTRIES AND MLI ROWS FOR YEAR 2026 ===")
        for k in kpis:
            e_stmt = select(KPIEntry).where(KPIEntry.kpi_id == k.id, KPIEntry.year == 2026)
            entries = (await db.execute(e_stmt)).scalars().all()
            for e in entries:
                print(f"\nEntry ID: {e.id}, KPI: {k.name} ({k.id}), Year: {e.year}, IsDraft: {e.is_draft}")
                f_stmt = select(KPIField).where(KPIField.kpi_id == k.id)
                fields = (await db.execute(f_stmt)).scalars().all()
                for f in fields:
                    r_stmt = select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id, KpiMultiLineRow.field_id == f.id)
                    rows = (await db.execute(r_stmt)).scalars().all()
                    print(f"  Field {f.name} ({f.id}) has {len(rows)} MLI rows.")
                    
                    dept_count = {}
                    teacher_names = set()
                    for r in rows:
                        c_stmt = select(KpiMultiLineCell, KPIFieldSubField).join(KPIFieldSubField, KpiMultiLineCell.sub_field_id == KPIFieldSubField.id).where(KpiMultiLineCell.row_id == r.id)
                        cells = (await db.execute(c_stmt)).all()
                        row_dict = {sf.key: cell.value_text or cell.value_number or cell.value_date for cell, sf in cells}
                        
                        # Find department & teacher name
                        dept = None
                        tname = None
                        for k_key, v_val in row_dict.items():
                            if any(d_kw in k_key.lower() for d_kw in ('dept', 'department')):
                                dept = v_val
                            if any(t_kw in k_key.lower() for t_kw in ('teacher', 'faculty', 'name')):
                                tname = v_val
                        dept_key = str(dept or 'UNKNOWN').strip()
                        dept_count[dept_key] = dept_count.get(dept_key, 0) + 1
                        if tname:
                            teacher_names.add(str(tname).strip())
                    print(f"    Department breakdown: {dept_count}")
                    print(f"    Total Unique Teachers/Faculty Names count: {len(teacher_names)}")

if __name__ == '__main__':
    asyncio.run(main())
