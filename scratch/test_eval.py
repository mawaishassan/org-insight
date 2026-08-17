import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.formula_engine.evaluator import evaluate_formula

grants_rows = [
    {"department_id": "DEPT_CS", "faculty_id": "FAC_1"},
    {"department_id": "DEPT_CS", "faculty_id": "FAC_2"},
]

kpi_data = {(219, "research_grants"): grants_rows}

# Case 1: CurrentRow has department_name instead of department_id
cur_row_name = {"department_name": "DEPT_CS"}

# Case 2: Quotes around string literal in filter
expr1 = 'KPI_GROUP_BY(219, "research_grants", GROUP_BY(department_id, department_id = CurrentRow.department_id, UNIQUE_COUNT(faculty_id)))'
expr2 = 'KPI_GROUP_BY(219, "research_grants", GROUP_BY(department_id, UNIQUE_COUNT(faculty_id)))'
expr3 = 'KPI_GROUP_BY(219, "research_grants", GROUP_BY(department_id, WHERE(department_id, op_eq, CurrentRow.department_name), UNIQUE_COUNT(faculty_id)))'
expr4 = 'KPI_GROUP_BY(219, "research_grants", GROUP_BY(department_id, department_id = CurrentRow.department_name, UNIQUE_COUNT(faculty_id)))'

print("--- With cur_row_name ---")
print("Expr 1 (department_id = CurrentRow.department_id):", evaluate_formula(expr1, {}, {}, None, cur_row_name, kpi_data))
print("Expr 2 (Implicit match):", evaluate_formula(expr2, {}, {}, None, cur_row_name, kpi_data))
print("Expr 3 (WHERE with department_name):", evaluate_formula(expr3, {}, {}, None, cur_row_name, kpi_data))
print("Expr 4 (department_id = CurrentRow.department_name):", evaluate_formula(expr4, {}, {}, None, cur_row_name, kpi_data))
