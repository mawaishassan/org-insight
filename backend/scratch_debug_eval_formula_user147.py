import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User, KPIFieldSubField

async def main():
    async with AsyncSessionLocal() as db:
        user_147 = await db.get(User, 147)
        print(f"User 147: Email='{user_147.email}', FullName='{user_147.full_name}', Key='{user_147.unique_user_key}'")

        # Let's inspect what happens during generate_custom_report_data for Report 36 with current_user=user_147
        # We know that in Report 36, Section 325, KPI 277:
        # Subfield 9746 formula: 'COUNT_KPI_ITEMS_WHERE(278, "qec_faculty_performance_faculty_wise", "department_id", "op_eq", CurrentRow.department_id, op_and, "total_survays_fall_2025", "op_gt", 0)'
        # Subfield 9752 formula: 'COUNT_KPI_ITEMS_WHERE(278, "qec_faculty_performance_faculty_wise", "department_id", "op_eq", CurrentRow.department_id, op_and, "total_survays_spring_2026", "op_gt", 0)'

        # Let's run generate_custom_report_data for Report 36 with user_147 and trace the rows of KPI 278 passed to evaluate_formula!
        # In custom_service.py:
        # line 980: batch_res = await _load_multi_line_items_rows_batch(db, entry_ids=target_entry_ids, field=mf, limit=limit_val, date_range=mf_date_range, custom_report_id=id, current_user=current_user)
        
        # When mf is KPI 278 (Faculty-Wise Performance), _load_multi_line_items_rows_batch is called with current_user=user_147!
        # What does _load_multi_line_items_rows_batch return for KPI 278 when current_user=user_147 (unique_user_key='Mechanical Engineering')?!
        
        from app.core.models import KPIField
        # KPI 278 field is ID 625 ('qec_faculty_performance_faculty_wise')
        kfield_278 = (await db.execute(select(KPIField).where(KPIField.kpi_id == 278, KPIField.field_type == "multi_line_items"))).scalars().first()
        print(f"KPI 278 Field: ID={kfield_278.id}, Key='{kfield_278.key}'")
        
        from app.reports.service import _load_multi_line_items_rows_batch
        
        # 1. Load WITHOUT current_user
        res_no_user = await _load_multi_line_items_rows_batch(db, entry_ids=[401], field=kfield_278, custom_report_id=36, current_user=None)
        rows_no_user = res_no_user.get(401, [])
        print(f"\n_load_multi_line_items_rows_batch for KPI 278 WITHOUT current_user: Total rows = {len(rows_no_user)}")
        mech_no_user = [r for r in rows_no_user if r.get("department_id") in (120, 120.0, "120", "120.0")]
        print(f"  Rows with department_id == 120.0: {len(mech_no_user)}")
        print(f"  Fall > 0: {len([r for r in mech_no_user if float(r.get('total_survays_fall_2025') or 0) > 0])}")
        print(f"  Spring > 0: {len([r for r in mech_no_user if float(r.get('total_survays_spring_2026') or 0) > 0])}")

        # 2. Load WITH current_user = user_147
        res_with_user = await _load_multi_line_items_rows_batch(db, entry_ids=[401], field=kfield_278, custom_report_id=36, current_user=user_147)
        rows_with_user = res_with_user.get(401, [])
        print(f"\n_load_multi_line_items_rows_batch for KPI 278 WITH current_user=user_147 (Key='Mechanical Engineering'): Total rows = {len(rows_with_user)}")
        mech_with_user = [r for r in rows_with_user if r.get("department_id") in (120, 120.0, "120", "120.0")]
        print(f"  Rows with department_id == 120.0: {len(mech_with_user)}")
        print(f"  Fall > 0: {len([r for r in mech_with_user if float(r.get('total_survays_fall_2025') or 0) > 0])}")
        print(f"  Spring > 0: {len([r for r in mech_with_user if float(r.get('total_survays_spring_2026') or 0) > 0])}")

        # Print the rows that were filtered OUT when current_user was passed!
        if len(mech_no_user) != len(mech_with_user):
            no_user_ids = {r.get("id") or r.get("row_id") or r.get("teacher_name") or r.get("faculty_name") for r in mech_no_user}
            with_user_ids = {r.get("id") or r.get("row_id") or r.get("teacher_name") or r.get("faculty_name") for r in mech_with_user}
            diff = [r for r in mech_no_user if (r.get("id") or r.get("row_id") or r.get("teacher_name") or r.get("faculty_name")) not in with_user_ids]
            print(f"\n  EXCLUDED ROWS ({len(diff)} rows):")
            for r in diff:
                print(f"    Excluded: {r}")

if __name__ == "__main__":
    from sqlalchemy import select
    asyncio.run(main())
