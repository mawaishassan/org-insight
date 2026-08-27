import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.formula_engine.evaluator import evaluate_formula

grants_rows = [
    {"department_id": "DEPT_CS", "faculty_name": "FAC_1", "status": "Submission"},
    {"department_id": "DEPT_CS", "faculty_name": "FAC_2", "status": "Not Awarded"},
    {"department_id": "DEPT_CS", "faculty_name": "FAC_3", "status": "Awarded"},
    {"department_id": "DEPT_EE", "faculty_name": "FAC_4", "status": "Submission"},
]

kpi_data = {(219, "research_grants"): grants_rows}
cur_row_name = {"department_name": "DEPT_CS"}

# Variant A: User's original formula (using commas, op_eq, etc. inside nested tuple)
expr_a = "KPI_GROUP_BY(219, 'research_grants', GROUP_BY(department_id, WHERE(department_id, op_eq, CurrentRow.department_name, op_and,( status, op_eq, 'Submission', op_or, status, op_eq, 'Not Awarded')), UNIQUE_COUNT(faculty_name)))"

# Variant B: Modern clean syntax using == and standard python comparisons
expr_b = "KPI_GROUP_BY(219, 'research_grants', GROUP_BY(department_id, WHERE(department_id == CurrentRow.department_name, op_and, (status == 'Submission', op_or, status == 'Not Awarded')), UNIQUE_COUNT(faculty_name)))"

# Variant C: Flat condition structure with comma-based op_eq and nested condition
expr_c = "KPI_GROUP_BY(219, 'research_grants', GROUP_BY(department_id, WHERE(department_id, op_eq, CurrentRow.department_name, op_and, (status, op_eq, 'Submission', op_or, status, op_eq, 'Not Awarded')), UNIQUE_COUNT(faculty_name)))"

print("Evaluating Variant A:")
try:
    print(evaluate_formula(expr_a, {}, {}, None, cur_row_name, kpi_data))
except Exception as e:
    print("Error A:", e)

print("Evaluating Variant B:")
try:
    print(evaluate_formula(expr_b, {}, {}, None, cur_row_name, kpi_data))
except Exception as e:
    print("Error B:", e)

print("Evaluating Variant C:")
try:
    print(evaluate_formula(expr_c, {}, {}, None, cur_row_name, kpi_data))
except Exception as e:
    print("Error C:", e)
