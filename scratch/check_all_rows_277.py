import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField

async def main():
    async with AsyncSessionLocal() as db:
        # Check all entries for KPI 277 (QEC Faculty Performance Dept Wise)
        entries_res = await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == 277))
        entries = entries_res.scalars().all()
        
        print("=== ALL ENTRIES FOR KPI 277 ===")
        for e in entries:
            print(f"\nEntry ID: {e.id}, Year: {e.year}, PeriodKey: '{e.period_key}', IsDraft: {e.is_draft}, Org: {e.organization_id}")
            
            sf_res = await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == 623))
            sfs = {sf.id: sf for sf in sf_res.scalars().all()}
            
            r_res = await db.execute(
                select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id, KpiMultiLineRow.field_id == 623)
            )
            rows = r_res.scalars().all()
            print(f"Total Rows in Entry {e.id}: {len(rows)}")
            
            for r in rows:
                c_res = await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))
                cells = c_res.scalars().all()
                r_dict = {sfs[c.sub_field_id].key: (c.value_text or c.value_number or c.value_date) for c in cells if c.sub_field_id in sfs}
                
                dept_name = str(r_dict.get('department_name') or r_dict.get('department') or '').strip()
                if 'mechanical' in dept_name.lower():
                    print(f"  Row ID {r.id}: Dept='{dept_name}' (ID: {r_dict.get('department_id')}) | Spring2026_Taught={r_dict.get('total_faculty_taught__spring_2026')} | Spring2026_Avg={r_dict.get('average_score__spring_2026')} | Fall2025_Taught={r_dict.get('total_faculty_taught_fall_2025')}")

if __name__ == '__main__':
    asyncio.run(main())
