import sys
sys.path.insert(0, ".")
from app.formula_engine.circular_validation import extract_formula_dependencies, extract_formula_dependencies_split

formula = "COUNT_UNIQUE_KPI_ITEMS_WHERE(289, 'qec_survey_data', 'department_name', 'faculty_id', op_eq, CurrentRow.faculty_id, op_and, 'semester_name', op_eq, 'FALL 2025')"

# Old function — should now only return CurrentRow.faculty_id as local dep
deps = extract_formula_dependencies(formula)
print("extract_formula_dependencies:", deps)

# New split function
local_refs, cross_kpi_refs = extract_formula_dependencies_split(formula)
print("local_refs:", local_refs)
print("cross_kpi_refs:", cross_kpi_refs)

# Simulate MLI that has faculty_id as a local column
available_subfields = {
    "faculty_id": "single_line_text",
    "department_name": "single_line_text",
    "some_score": "number"
}
missing = [r for r in local_refs if r not in available_subfields]
print("missing local refs:", missing)
print("Validation would PASS:", len(missing) == 0)
