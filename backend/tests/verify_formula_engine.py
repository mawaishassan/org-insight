"""
Standalone test script for the formula evaluation engine.
Run: python -m backend.tests.verify_formula_engine
or:  python d:/New folder/org-insight/backend/tests/verify_formula_engine.py
"""

import sys
import os

# Adjust import path so the backend package is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.formula_engine.evaluator import evaluate_formula, AggSpec, GroupNode

PASS = "[PASS]"
FAIL = "[FAIL]"
results = []


def check(name: str, actual, expected) -> None:
    ok = actual == expected
    tag = PASS if ok else FAIL
    results.append(ok)
    if ok:
        print(f"  {tag}: {name}")
    else:
        print(f"  {tag}: {name}  |  got={repr(actual)}  expected={repr(expected)}")


# ── helpers ──────────────────────────────────────────────────────────────────
def make_rows(*dicts):
    return list(dicts)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Basic arithmetic on field_values
# ─────────────────────────────────────────────────────────────────────────────
print("\n[1] Basic arithmetic")
check("a + b", evaluate_formula("a + b", {"a": 10, "b": 20}), 30)
check("a - b", evaluate_formula("a - b", {"a": 50, "b": 15}), 35)
check("a * b", evaluate_formula("a * b", {"a": 4, "b": 5}), 20)
check("a / b", evaluate_formula("a / b", {"a": 20, "b": 4}), 5)
check("division by zero → None", evaluate_formula("a / b", {"a": 10, "b": 0}), None)
check("empty expression → None", evaluate_formula("", {}), None)
check("missing field falls back to 0 (simpleeval default)", evaluate_formula("missing_field + 1", {}), 1)

# ─────────────────────────────────────────────────────────────────────────────
# 2. SUM_ITEMS
# ─────────────────────────────────────────────────────────────────────────────
print("\n[2] SUM_ITEMS")
mli = {
    "sales": [
        {"amount": 100, "region": "North"},
        {"amount": 200, "region": "South"},
        {"amount": None, "region": "East"},        # null – must be ignored
        {"amount": "", "region": "West"},           # empty – must be ignored
        {"amount": "50", "region": "Central"},      # string numeric – must coerce
    ]
}
check("SUM_ITEMS basic", evaluate_formula("SUM_ITEMS('sales', 'amount')", {}, mli), 350)
check("SUM_ITEMS nulls ignored", evaluate_formula("SUM_ITEMS('sales', 'amount')", {}, {"sales": [{"amount": None}, {"amount": 5}]}), 5)
check("AVG_ITEMS skip nulls", evaluate_formula("AVG_ITEMS('sales', 'amount')", {}, {"sales": [{"amount": 10}, {"amount": None}, {"amount": 20}]}), 15)
check("COUNT_ITEMS non-null", evaluate_formula("COUNT_ITEMS('sales', 'amount')", {}, {"sales": [{"amount": 1}, {"amount": None}, {"amount": 3}]}), 2)
check("COUNT_UNIQUE_ITEMS dedup", evaluate_formula("COUNT_UNIQUE_ITEMS('sales', 'region')", {}, {"sales": [{"region": "A"}, {"region": "A"}, {"region": "B"}]}), 2)
check("MIN_ITEMS", evaluate_formula("MIN_ITEMS('sales', 'amount')", {}, {"sales": [{"amount": 10}, {"amount": 3}, {"amount": 7}]}), 3)
check("MAX_ITEMS", evaluate_formula("MAX_ITEMS('sales', 'amount')", {}, {"sales": [{"amount": 10}, {"amount": 3}, {"amount": 7}]}), 10)

# ─────────────────────────────────────────────────────────────────────────────
# 3. SUM_ITEMS_WHERE / COUNT_ITEMS_WHERE (conditional aggregation)
# ─────────────────────────────────────────────────────────────────────────────
print("\n[3] Conditional aggregation (WHERE)")
cond_mli = {
    "sales": [
        {"amount": 100, "region": "North"},
        {"amount": 200, "region": "South"},
        {"amount": 50,  "region": "North"},
        {"amount": 75,  "region": "East"},
    ]
}
check("SUM_WHERE North", evaluate_formula("SUM_ITEMS_WHERE('sales', 'amount', 'region', op_eq, 'North')", {}, cond_mli), 150)
check("COUNT_WHERE South", evaluate_formula("COUNT_ITEMS_WHERE('sales', 'region', op_eq, 'South')", {}, cond_mli), 1)
check("AVG_WHERE North", evaluate_formula("AVG_ITEMS_WHERE('sales', 'amount', 'region', op_eq, 'North')", {}, cond_mli), 75)

# ─────────────────────────────────────────────────────────────────────────────
# 4. GROUP_BY (row-level)
# ─────────────────────────────────────────────────────────────────────────────
print("\n[4] GROUP_BY")
gb_mli = {
    "sales": [
        {"region": "North", "amount": 100},
        {"region": "North", "amount": 200},
        {"region": "South", "amount": 50},
    ]
}
current_north = {"region": "North"}
current_south = {"region": "South"}
gb_result_north = evaluate_formula("GROUP_BY('region', SUM('amount'))", {}, gb_mli, current_row=current_north)
gb_result_south = evaluate_formula("GROUP_BY('region', SUM('amount'))", {}, gb_mli, current_row=current_south)
check("GROUP_BY SUM North", gb_result_north, 300)
check("GROUP_BY SUM South", gb_result_south, 50)

# null group field matching (both sides empty should match)
null_gb_mli = {
    "items": [
        {"cat": None, "val": 10},
        {"cat": None, "val": 20},
        {"cat": "A",  "val": 5},
    ]
}
check("GROUP_BY null field match", evaluate_formula("GROUP_BY('cat', SUM('val'))", {}, null_gb_mli, current_row={"cat": None}), 30)

# ─────────────────────────────────────────────────────────────────────────────
# 5. UNIQUE_COUNT coercion (numbers and strings both considered)
# ─────────────────────────────────────────────────────────────────────────────
print("\n[5] UNIQUE_COUNT value normalisation")
uc_rows = [{"x": 1}, {"x": 1}, {"x": 2}, {"x": None}, {"x": ""}, {"x": "1"}]
spec = AggSpec("UNIQUE_COUNT", field="x")
check("UNIQUE_COUNT numerics+strings deduplicated", spec.evaluate(uc_rows), 2)   # 1, 2 only (None and "" excluded; "1" == 1 as numeric)

# ─────────────────────────────────────────────────────────────────────────────
# 6. _to_num enhanced coercion
# ─────────────────────────────────────────────────────────────────────────────
print("\n[6] _to_num coercion")
from app.formula_engine.evaluator import _to_num
check("_to_num comma string", _to_num("1,234.5"), 1234.5)
check("_to_num dict value key", _to_num({"value": "42"}), 42.0)
check("_to_num dict id key", _to_num({"id": 10}), 10.0)
check("_to_num empty string", _to_num(""), None)
check("_to_num None", _to_num(None), None)
check("_to_num plain string text", _to_num("abc"), None)

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
total = len(results)
passed = sum(results)
failed = total - passed
print(f"\n{'='*60}")
print(f"RESULTS: {passed}/{total} passed, {failed} failed")
if failed:
    print("Some tests FAILED — please review the output above.")
    sys.exit(1)
else:
    print("All tests PASSED [OK]")
