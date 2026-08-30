import sys
sys.path.insert(0, ".")
from app.entries.service import extract_cross_kpi_mli_references

expr = "COUNT_UNIQUE_KPI_ITEMS_WHERE(289, 'qec_survey_data', 'department_name', 'faculty_id', op_eq, CurrentRow.faculty_id, op_and, 'semester_name', op_eq, 'FALL 2025')"

refs = extract_cross_kpi_mli_references(expr)
print("Extracted refs:", refs)

if (289, "qec_survey_data") in refs:
    print("[PASS] Successfully extracted (289, qec_survey_data)")
else:
    print("[FAIL] Failed to extract refs")
