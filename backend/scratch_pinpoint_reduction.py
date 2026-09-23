import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.service import _load_multi_line_items_rows_batch
from app.core.models import User, KPIField, KPIFieldSubField
from app.formula_engine.evaluator import evaluate_formula

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)
        print(f"User 147: Email='{user_147.email}', FullName='{user_147.full_name}', Key='{user_147.unique_user_key}'")

        # Get KPI 278 Field (ID 624)
        kfield_278 = await db.get(KPIField, 624)
        
        # Load MLI rows for KPI 278 with custom_report_id=36 and current_user=user_147
        batch_278 = await _load_multi_line_items_rows_batch(
            db, entry_ids=[401], field=kfield_278, limit=None, date_range=None, custom_report_id=36, current_user=user_147
        )
        rows_278 = batch_278.get(401, [])
        print(f"\n1. Rows returned by _load_multi_line_items_rows_batch for KPI 278: {len(rows_278)} rows")
        
        mech_278 = [r for r in rows_278 if r.get("department_id") in (120, 120.0, "120", "120.0")]
        print(f"   Mechanical Engineering rows (department_id==120): {len(mech_278)}")
        print(f"   Fall > 0 in mech_278: {len([r for r in mech_278 if float(r.get('total_survays_fall_2025') or 0) > 0])}")
        print(f"   Spring > 0 in mech_278: {len([r for r in mech_278 if float(r.get('total_survays_spring_2026') or 0) > 0])}")

        # Now check if _load_multi_line_items_rows_batch filtered rows_278 by unique_user_key = 'Mechanical Engineering'!
        print(f"\n2. Departments present in rows_278:")
        dept_counts = {}
        for r in rows_278:
            dname = r.get("department_name") or r.get("department") or r.get("dept") or str(r.get("department_id"))
            dept_counts[dname] = dept_counts.get(dname, 0) + 1
        for dname, cnt in dept_counts.items():
            print(f"   '{dname}': {cnt} rows")

        # Now test evaluate_formula for Subfield 9746 (COUNT_KPI_ITEMS_WHERE for Fall) and Subfield 9752 (Spring)
        sf_fall = await db.get(KPIFieldSubField, 9746) # total_faculty_taught_fall_2025
        sf_spring = await db.get(KPIFieldSubField, 9752) # total_faculty_taught__spring_2026

        print(f"\n3. Testing evaluate_formula for Fall formula: '{sf_fall.config['formula_expression']}'")
        other_mli_data = {(278, "qec_faculty_performance_faculty_wise"): rows_278}
        current_row = {"department_id": 120.0, "department_name": "Mechanical Engineering"}
        
        res_fall = evaluate_formula(
            sf_fall.config['formula_expression'],
            {},
            {},
            {},
            current_row=current_row,
            other_kpi_multi_line_data=other_mli_data
        )
        print(f"   Fall result from evaluate_formula: {res_fall}")

        res_spring = evaluate_formula(
            sf_spring.config['formula_expression'],
            {},
            {},
            {},
            current_row=current_row,
            other_kpi_multi_line_data=other_mli_data
        )
        print(f"   Spring result from evaluate_formula: {res_spring}")

if __name__ == "__main__":
    from sqlalchemy import select
    asyncio.run(main())
