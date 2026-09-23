import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPI, KPIField, KPIFieldSubField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell
)

async def inspect_kpi_data(db, kpi_id, year=2026, dept_filter="Mechanical Engineering"):
    kpi = await db.get(KPI, kpi_id)
    print(f"\n=======================================================")
    print(f"ANALYZING KPI ID {kpi.id}: '{kpi.name}' (Year {year})")
    print(f"=======================================================")
    
    # Get entries
    e_res = await db.execute(
        select(KPIEntry)
        .where(KPIEntry.kpi_id == kpi.id, KPIEntry.year == year)
    )
    entries = e_res.scalars().all()
    for e in entries:
        print(f"Entry ID {e.id}, Draft={e.is_draft}")
        f_res = await db.execute(select(KPIField).where(KPIField.kpi_id == kpi.id))
        fields = f_res.scalars().all()
        for f in fields:
            print(f"  Field {f.id}: '{f.name}' (Type: {f.field_type})")
            if f.field_type == 'multi_line_items':
                sf_res = await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == f.id))
                sfs = {sf.id: sf for sf in sf_res.scalars().all()}
                
                rows_res = await db.execute(
                    select(KpiMultiLineRow)
                    .where(KpiMultiLineRow.entry_id == e.id, KpiMultiLineRow.field_id == f.id)
                )
                rows = rows_res.scalars().all()
                print(f"    Total Rows in DB: {len(rows)}")
                
                # Analyze rows
                matching_rows = []
                for r in rows:
                    c_res = await db.execute(
                        select(KpiMultiLineCell)
                        .where(KpiMultiLineCell.row_id == r.id)
                    )
                    cells = c_res.scalars().all()
                    row_dict = {}
                    for c in cells:
                        sf = sfs.get(c.sub_field_id)
                        if sf:
                            val = c.value_text or c.value_number or c.value_date
                            row_dict[sf.key] = val
                            row_dict[sf.name] = val
                    
                    # Check department match
                    d_val = str(row_dict.get('department') or row_dict.get("Faculty's Department") or row_dict.get('department_name') or '').strip()
                    if dept_filter.lower() in d_val.lower() or d_val.lower() in dept_filter.lower():
                        matching_rows.append(row_dict)
                        
                print(f"    Total Rows matching department '{dept_filter}': {len(matching_rows)}")
                
                # Print details of matching rows
                scores = []
                zero_subjects_count = 0
                for idx, mr in enumerate(matching_rows, 1):
                    # Find teacher name, subjects, score
                    tname = mr.get('faculty_name') or mr.get('Faculty Name') or mr.get('teacher_name') or f"Teacher {idx}"
                    subj = mr.get('total_survays_spring_2026') or mr.get('total_subjects_taught') or mr.get('total_courses_taught') or mr.get('total_faculty_taught__spring_2026') or 0
                    try:
                        subj_num = float(subj)
                    except:
                        subj_num = 0.0
                    
                    score = mr.get('overall_score_spring_2026') or mr.get('average_score') or mr.get('average_score__spring_2026') or 0
                    try:
                        score_num = float(score)
                    except:
                        score_num = 0.0
                    
                    if subj_num == 0:
                        zero_subjects_count += 1
                        print(f"      [ZERO SUBJECTS] Row {idx}: {tname} | Department: {mr.get('department') or mr.get('department_name')} | Subjects: {subj_num} | Score: {score_num}")
                    else:
                        scores.append(score_num)
                        
                print(f"    Summary for '{dept_filter}':")
                print(f"      Rows with >0 subjects taught: {len(matching_rows) - zero_subjects_count}")
                print(f"      Rows with 0 subjects taught: {zero_subjects_count}")
                if scores:
                    avg_score = sum(scores) / len(scores)
                    print(f"      Average score of >0 subject rows: {avg_score:.2f}")

async def main():
    async with AsyncSessionLocal() as db:
        await inspect_kpi_data(db, 278) # Faculty Wise KPI
        await inspect_kpi_data(db, 277) # Dept Wise KPI

if __name__ == '__main__':
    asyncio.run(main())
