import sys
sys.path.insert(0, ".")
from app.formula_engine.validation import validate_formula_types, validate_formula_references, FormulaValidationError

fields = {
    "employees": "multi_line_items",
    "faculty_name": "single_line_text",
    "department": "single_line_text",
    "salary": "number",
    "score": "number",
}

PASS = "[PASS]"
FAIL = "[FAIL]"
results = []

def check(label, fn):
    try:
        fn()
        print(f"  {PASS}: {label}")
        results.append(True)
    except FormulaValidationError as e:
        print(f"  {FAIL}: {label}  ->  {e}")
        results.append(False)

def check_raises(label, fn):
    try:
        fn()
        print(f"  {FAIL}: {label}  -> expected error but got none")
        results.append(False)
    except FormulaValidationError as e:
        print(f"  {PASS}: {label}  (correctly rejected)")
        results.append(True)

print("[Test: validate_formula_types - text cols in functions should be allowed]")
check("COUNT_ITEMS_WHERE on text col",
      lambda: validate_formula_types("COUNT_ITEMS_WHERE('employees', 'faculty_name', op_eq, 'Science')", fields))
check("GROUP_BY on text col",
      lambda: validate_formula_types("GROUP_BY('faculty_name', COUNT('salary'))", fields))
check("COUNT_UNIQUE_ITEMS on text col",
      lambda: validate_formula_types("COUNT_UNIQUE_ITEMS('employees', 'department')", fields))
check("SUM_ITEMS_WHERE filter on text col",
      lambda: validate_formula_types("SUM_ITEMS_WHERE('employees', 'salary', 'department', op_eq, 'HR')", fields))
check("salary + score (both numeric)",
      lambda: validate_formula_types("salary + score", fields))
check("salary / score (both numeric)",
      lambda: validate_formula_types("salary / score", fields))
check("AVG_ITEMS_WHERE with text filter",
      lambda: validate_formula_types("AVG_ITEMS_WHERE('employees', 'salary', 'faculty_name', op_eq, 'Dr. Ali')", fields))

print()
print("[Test: validate_formula_types - direct arithmetic on text should be rejected]")
check_raises("faculty_name + salary (text in arithmetic)",
             lambda: validate_formula_types("faculty_name + salary", fields))
check_raises("department * 2 (text in arithmetic)",
             lambda: validate_formula_types("department * 2", fields))

total = len(results)
passed = sum(results)
print(f"\n{'='*55}")
print(f"RESULTS: {passed}/{total} passed, {total - passed} failed")
if total - passed:
    sys.exit(1)
else:
    print("All validation tests PASSED [OK]")
