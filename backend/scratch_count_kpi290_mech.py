import asyncio
import sys
import os
from collections import defaultdict

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== Counting KPI 290 (Individual Faculty) for Department 120 (Mechanical Engineering) ===")
        entry = (await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == 290))).scalars().first()
        if not entry:
            print("No entry found for KPI 290")
            return
        
        # Load all subfields for KPI 290
        sfs = (await db.execute(select(KPIFieldSubField))).scalars().all()
        sf_name_map = {sf.id: (sf.name or sf.key) for sf in sfs}

        # Load all rows for entry
        rows = (await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == entry.id))).scalars().all()
        row_ids = [r.id for r in rows]
        
        # Bulk load cells
        cells = (await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id.in_(row_ids)))).scalars().all()
        
        cells_by_row = defaultdict(dict)
        for c in cells:
            sf_name = sf_name_map.get(c.sub_field_id, str(c.sub_field_id))
            cells_by_row[c.row_id][sf_name] = c.value_text or c.value_number

        fall_taught_count = 0
        spring_taught_count = 0
        fall_scores = []
        spring_scores = []
        
        fall_above_90 = 0
        fall_60_90 = 0
        fall_below_60_atleast_1 = 0
        
        spring_above_90 = 0
        spring_60_90 = 0
        spring_below_60_atleast_1 = 0

        for r_id, c_dict in cells_by_row.items():
            dept_id = str(c_dict.get("Department ID") or "")
            dept_name = str(c_dict.get("Faculty's Department") or c_dict.get("Department Name") or "")
            
            if dept_id in ("120", "120.0") or dept_name == "Mechanical Engineering":
                # Fall 2025
                fall_t = c_dict.get("Total Courses Taught (Fall 2025)")
                fall_avg = c_dict.get("Overall Average Fall 2025")
                if fall_t is not None and float(fall_t or 0) > 0:
                    fall_taught_count += 1
                    if fall_avg is not None:
                        f_sc = float(fall_avg)
                        fall_scores.append(f_sc)
                        if f_sc > 90:
                            fall_above_90 += 1
                        elif f_sc >= 60:
                            fall_60_90 += 1
                
                fall_planning = c_dict.get("Course Planning and Delivery Fall 2025")
                fall_teaching = c_dict.get("Teaching and Professional Behavior Fall 2025")
                fall_eval = c_dict.get("Student Evaluation Fall 2025")
                fall_counsel = c_dict.get("Student Counselling Fall 2025")
                fall_sub_scores = [fall_planning, fall_teaching, fall_eval, fall_counsel]
                if any(s is not None and float(s) < 60 for s in fall_sub_scores if s is not None):
                    fall_below_60_atleast_1 += 1

                # Spring 2026
                spring_t = c_dict.get("Total Courses Taught Spring 2026")
                spring_avg = c_dict.get("Overall Score Spring 2026")
                if spring_t is not None and float(spring_t or 0) > 0:
                    spring_taught_count += 1
                    if spring_avg is not None:
                        sp_sc = float(spring_avg)
                        spring_scores.append(sp_sc)
                        if sp_sc > 90:
                            spring_above_90 += 1
                        elif sp_sc >= 60:
                            spring_60_90 += 1

                spring_planning = c_dict.get("Course Planning and Delivery Spring 2026")
                spring_teaching = c_dict.get("Teaching and Professional Behavior Spring 2026")
                spring_eval = c_dict.get("Student Evaluation Spring 2026")
                spring_counsel = c_dict.get("Student Counselling Spring 2026")
                spring_sub_scores = [spring_planning, spring_teaching, spring_eval, spring_counsel]
                if any(s is not None and float(s) < 60 for s in spring_sub_scores if s is not None):
                    spring_below_60_atleast_1 += 1

        print(f"\n--- KPI 290 Faculty Counts for Mechanical Engineering (Dept 120) ---")
        print(f"Fall 2025:")
        print(f"  Total Faculty Taught: {fall_taught_count}")
        print(f"  Faculty Above 90: {fall_above_90}")
        print(f"  Faculty 60 to 90: {fall_60_90}")
        print(f"  Faculty Below 60 in 1 subject: {fall_below_60_atleast_1}")
        print(f"  Average Score: {sum(fall_scores)/len(fall_scores) if fall_scores else 0:.2f}")

        print(f"\nSpring 2026:")
        print(f"  Total Faculty Taught: {spring_taught_count}")
        print(f"  Faculty Above 90: {spring_above_90}")
        print(f"  Faculty 60 to 90: {spring_60_90}")
        print(f"  Faculty Below 60 in 1 subject: {spring_below_60_atleast_1}")
        print(f"  Average Score: {sum(spring_scores)/len(spring_scores) if spring_scores else 0:.2f}")

if __name__ == "__main__":
    asyncio.run(main())
