import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField
from app.formula_engine.evaluator import evaluate_formula
from app.reports.service import _load_other_kpi_values
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        u_haseeb = (await db.execute(select(User).where(User.id == 110))).scalar_one_or_none()
        print(f"Haseeb User: id={u_haseeb.id}, role='{u_haseeb.role}', key='{u_haseeb.unique_user_key}'")

        # Load other_kpi_values for Haseeb
        other_kpi_values = await _load_other_kpi_values(
            db, 2026, 3, 277, period_key="", is_draft=False, owner_user_id=u_haseeb.id, current_user=u_haseeb
        )
        
        # Test evaluate_formula for subfield 9746
        expr_fall = 'COUNT_KPI_ITEMS_WHERE(278, "qec_faculty_performance_faculty_wise", "department_id", "op_eq", CurrentRow.department_id, op_and, "total_survays_fall_2025", "op_gt", 0)'
        expr_spring = 'COUNT_KPI_ITEMS_WHERE(278, "qec_faculty_performance_faculty_wise", "department_id", "op_eq", CurrentRow.department_id, op_and, "total_survays_spring_2026", "op_gt", 0)'
        expr_fall_avg = 'AVG_KPI_ITEMS_WHERE(278, "qec_faculty_performance_faculty_wise", "overall_score_fall_2025", "department_id", "op_eq", CurrentRow.department_id, op_and, "total_survays_fall_2025", "op_gt", 0)'

        current_row = {"department_id": 120.0, "department_name": "Mechanical Engineering"}

        res_fall = evaluate_formula(expr_fall, {}, {"qec_faculty_performance_dept_wise": [current_row]}, other_kpi_values, current_row=current_row)
        res_spring = evaluate_formula(expr_spring, {}, {"qec_faculty_performance_dept_wise": [current_row]}, other_kpi_values, current_row=current_row)
        res_avg = evaluate_formula(expr_fall_avg, {}, {"qec_faculty_performance_dept_wise": [current_row]}, other_kpi_values, current_row=current_row)

        print(f"Evaluated formula for Fall Taught: {res_fall}")
        print(f"Evaluated formula for Spring Taught: {res_spring}")
        print(f"Evaluated formula for Fall Avg: {res_avg}")

if __name__ == "__main__":
    asyncio.run(main())
