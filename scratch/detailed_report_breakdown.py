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
        print("=== 1. SCALAR FORMULAS FOR REPORT 35 (Faculty-Wise) ===")
        f_res = await db.execute(
            select(CustomReportField)
            .where(CustomReportField.custom_report_section_id == 370)
            .order_by(CustomReportField.sort_order)
        )
        for f in f_res.scalars().all():
            kf = await db.get(KPIField, f.kpi_field_id)
            print(f"  Field: '{kf.name}' | KPIField ID: {kf.id} | Key: {kf.key}")

        print("\n=== 2. SCALAR FORMULAS FOR REPORT 37 (Dept-Wise) ===")
        f_res = await db.execute(
            select(CustomReportField)
            .where(CustomReportField.custom_report_section_id == 328)
            .order_by(CustomReportField.sort_order)
        )
        for f in f_res.scalars().all():
            kf = await db.get(KPIField, f.kpi_field_id)
            print(f"  Field: '{kf.name}' | KPIField ID: {kf.id} | Key: {kf.key}")

        print("\n=== 3. EXACT FACULTY ROWS FOR MECHANICAL ENGINEERING IN KPI 278 (Spring 2026) ===")
        sf_res = await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == 624))
        sfs = {sf.id: sf for sf in sf_res.scalars().all()}
        
        r_res = await db.execute(
            select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == 401, KpiMultiLineRow.field_id == 624)
        )
        rows = r_res.scalars().all()
        
        me_rows = []
        for r in rows:
            c_res = await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))
            cells = c_res.scalars().all()
            r_dict = {sfs[c.sub_field_id].key: (c.value_text or c.value_number or c.value_date) for c in cells if c.sub_field_id in sfs}
            
            dept = str(r_dict.get('department') or '').strip()
            if dept == 'Mechanical Engineering': # Exact match main campus
                me_rows.append(r_dict)

        print(f"Total Main Campus 'Mechanical Engineering' rows in KPI 278: {len(me_rows)}")
        non_zero_rows = []
        zero_rows = []
        for r in me_rows:
            fname = r.get('faculty_name')
            surveys = float(r.get('total_survays_spring_2026') or 0)
            score = float(r.get('overall_score_spring_2026') or 0)
            below60 = float(r.get('below_60_in_subjects_spring_2026') or 0)
            if surveys > 0:
                non_zero_rows.append((fname, surveys, below60, score))
            else:
                zero_rows.append((fname, surveys, below60, score))

        print(f"-> Non-Zero Surveys Rows (>0 subjects taught): {len(non_zero_rows)}")
        print(f"-> Zero Surveys Rows (=0 subjects taught): {len(zero_rows)}")
        for z in zero_rows:
            print(f"     Zero Row: {z[0]} (Surveys: {z[1]}, Score: {z[3]})")

        scores_non_zero = [r[3] for r in non_zero_rows]
        avg_non_zero = sum(scores_non_zero) / len(scores_non_zero) if scores_non_zero else 0
        print(f"\nAverage Score of Non-Zero Rows (27 faculty): {avg_non_zero:.4f} -> Rounded: {avg_non_zero:.2f}")

        print("\n=== 4. EXACT DEPT ROW FOR MECHANICAL ENGINEERING IN KPI 277 (Spring 2026) ===")
        sf_res = await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == 623))
        sfs_277 = {sf.id: sf for sf in sf_res.scalars().all()}
        
        r_res = await db.execute(
            select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == 378, KpiMultiLineRow.field_id == 623)
        )
        rows_277 = r_res.scalars().all()
        for r in rows_277:
            c_res = await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))
            cells = c_res.scalars().all()
            r_dict = {sfs_277[c.sub_field_id].key: (c.value_text or c.value_number or c.value_date) for c in cells if c.sub_field_id in sfs_277}
            dept_name = str(r_dict.get('department_name') or '').strip()
            if 'Mechanical' in dept_name:
                print(f"Dept Row in KPI 277: {r_dict}")

if __name__ == '__main__':
    asyncio.run(main())
