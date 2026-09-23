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
        entries = (await db.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == 278)
        )).scalars().all()
        
        fields = (await db.execute(select(KPIField).where(KPIField.kpi_id == 278))).scalars().all()
        sf_map = {}
        for f in fields:
            sfs = (await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == f.id))).scalars().all()
            for sf in sfs:
                sf_map[sf.id] = sf.key

        for e in entries:
            rows = (await db.execute(
                select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id)
            )).scalars().all()

            fall_120 = 0
            spring_120 = 0
            all_120 = 0
            for r in rows:
                cells = (await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))).scalars().all()
                rdict = {}
                for c in cells:
                    k = sf_map.get(c.sub_field_id, str(c.sub_field_id))
                    v = c.value_text if c.value_text is not None else (c.value_number if c.value_number is not None else c.value_json)
                    rdict[k] = v
                
                dept_id = rdict.get("department_id")
                if dept_id in (120, 120.0, "120", "120.0"):
                    all_120 += 1
                    fall_surv = float(rdict.get("total_survays_fall_2025") or 0)
                    spring_surv = float(rdict.get("total_survays_spring_2026") or 0)
                    if fall_surv > 0:
                        fall_120 += 1
                    if spring_surv > 0:
                        spring_120 += 1

            print(f"KPI 278 Entry {e.id} (Year {e.year}):")
            print(f"  Total Rows with DeptID 120 (Mechanical Engineering): {all_120}")
            print(f"  Fall Rows (total_survays_fall_2025 > 0): {fall_120}")
            print(f"  Spring Rows (total_survays_spring_2026 > 0): {spring_120}")

if __name__ == "__main__":
    asyncio.run(main())
