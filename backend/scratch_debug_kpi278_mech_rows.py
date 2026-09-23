import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPI, KPIField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== KPI 278 (Faculty-Wise Performance) ROWS FOR MECHANICAL ENGINEERING ===")
        # Get KPI 278 details
        kpi = await db.get(KPI, 278)
        print(f"KPI 278: Name='{kpi.name}'")
        
        # Get entry for KPI 278
        entries = (await db.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == 278)
        )).scalars().all()
        print(f"Entries for KPI 278: {len(entries)}")
        
        for e in entries:
            print(f"\nEntry ID {e.id}: year={e.year}, period_key='{e.period_key}', is_draft={e.is_draft}")
            rows = (await db.execute(
                select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id)
            )).scalars().all()
            print(f"Total rows in KPI 278 Entry {e.id}: {len(rows)}")
            
            # Map subfield keys
            fields = (await db.execute(select(KPIField).where(KPIField.kpi_id == 278))).scalars().all()
            sf_map = {}
            for f in fields:
                sfs = (await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == f.id))).scalars().all()
                for sf in sfs:
                    sf_map[sf.id] = sf.key

            mech_rows = []
            for r in rows:
                cells = (await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))).scalars().all()
                rdict = {}
                for c in cells:
                    k = sf_map.get(c.sub_field_id, str(c.sub_field_id))
                    v = c.value_text if c.value_text is not None else (c.value_number if c.value_number is not None else c.value_json)
                    rdict[k] = v
                
                # Check department
                dept_val = str(rdict.get("department_name") or rdict.get("department") or rdict.get("dept") or "")
                dept_id = rdict.get("department_id")
                
                # Department ID for Mechanical Engineering in KPI 277 row 1655397 was 120.0!
                if "mechanical" in dept_val.lower() or dept_id in (120, 120.0, "120", "120.0"):
                    mech_rows.append((r.id, dept_val, dept_id, rdict))

            print(f"Mechanical Rows in KPI 278 Entry {e.id}: {len(mech_rows)}")
            
            fall_surveys_gt_0 = 0
            spring_surveys_gt_0 = 0
            for rid, dval, did, rd in mech_rows:
                fall_surv = rd.get("total_survays_fall_2025") or 0
                spring_surv = rd.get("total_survays_spring_2026") or 0
                if float(fall_surv) > 0:
                    fall_surveys_gt_0 += 1
                if float(spring_surv) > 0:
                    spring_surveys_gt_0 += 1
                print(f"  Row {rid}: Dept='{dval}', DeptID={did}, FallSurveys={fall_surv}, SpringSurveys={spring_surv}")
                
            print(f"\n  SUMMARY for Mechanical Engineering in KPI 278:")
            print(f"  Fall rows with total_survays_fall_2025 > 0: {fall_surveys_gt_0}")
            print(f"  Spring rows with total_survays_spring_2026 > 0: {spring_surveys_gt_0}")

if __name__ == "__main__":
    asyncio.run(main())
