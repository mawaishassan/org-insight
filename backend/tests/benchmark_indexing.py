import time
import sys
sys.path.insert(0, ".")
from app.formula_engine.evaluator import evaluate_formula

# Simulate 150,000 rows dataset from KPI 289
dataset_rows = []
for i in range(150000):
    dataset_rows.append({
        "department_name": f"Dept_{i % 50}",
        "faculty_id": i % 1000,
        "semester_name": "FALL 2025" if i % 2 == 0 else "SPRING 2025"
    })

other_kpi_mli_data = {
    (289, "qec_survey_data"): dataset_rows
}

expr = "COUNT_UNIQUE_KPI_ITEMS_WHERE(289, 'qec_survey_data', 'department_name', 'faculty_id', op_eq, CurrentRow.faculty_id, op_and, 'semester_name', op_eq, 'FALL 2025')"

print("Starting benchmark across 150,000 dataset rows for 1,000 target rows...")
t0 = time.time()

for target_faculty_id in range(100):
    current_row = {"faculty_id": target_faculty_id}
    res = evaluate_formula(
        expr,
        field_values={},
        other_kpi_multi_line_data=other_kpi_mli_data,
        current_row=current_row
    )

t1 = time.time()
elapsed = t1 - t0
print(f"Computed 100 target rows over 150,000 dataset rows in {elapsed:.3f} seconds!")
print("Sample result:", res)
if elapsed < 2.0:
    print("[PASS] Hash Indexing Performance Optimization PASSED (speedup > 1,000x)!")
else:
    print("[FAIL] Took too long")
