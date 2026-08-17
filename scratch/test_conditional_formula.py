import sys
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from app.formula_engine.evaluator import evaluate_formula, apply_conditional_logic


def run_tests():
    print("=" * 60)
    print("RUNNING CONDITIONAL IF/ELSE FORMULA TEST SUITE")
    print("=" * 60)

    # -------------------------------------------------------------
    # Test 1: Primary Example from User Specification
    # -------------------------------------------------------------
    print("\n[Test 1] Primary Example: Formula Result < 0 -> 'Non Initialized' ELSE 'Initialized'")
    cond_logic_primary = {
        "enabled": True,
        "rules": [
            {
                "operator": "op_lt",
                "value": "0",
                "then": "Non Initialized",
            }
        ],
        "else_output": "Initialized",
    }

    test_cases_1 = [
        (-500, "Non Initialized"),
        (-100, "Non Initialized"),
        (0, "Initialized"),
        (100, "Initialized"),
        (500, "Initialized"),
    ]

    for raw_val, expected in test_cases_1:
        res = apply_conditional_logic(raw_val, cond_logic_primary)
        print(f"  Input: {raw_val} -> Output: '{res}' (expected: '{expected}')")
        assert res == expected, f"Expected '{expected}', got '{res}'"

    # -------------------------------------------------------------
    # Test 2: Formula Expression Evaluation + Conditional Logic
    # -------------------------------------------------------------
    print("\n[Test 2] Formula Expression Evaluation + Conditional Logic (CurrentRow arithmetic)")
    row_negative = {"total_allocated": 1000, "total_utilized": 1500}  # result = -500
    row_positive = {"total_allocated": 2000, "total_utilized": 1500}  # result = 500

    calc_neg = evaluate_formula("CurrentRow.total_allocated - CurrentRow.total_utilized", {}, current_row=row_negative)
    calc_pos = evaluate_formula("CurrentRow.total_allocated - CurrentRow.total_utilized", {}, current_row=row_positive)

    res_neg = apply_conditional_logic(calc_neg, cond_logic_primary)
    res_pos = apply_conditional_logic(calc_pos, cond_logic_primary)

    print(f"  Negative Row Result: {calc_neg} -> Conditional: '{res_neg}' (expected 'Non Initialized')")
    print(f"  Positive Row Result: {calc_pos} -> Conditional: '{res_pos}' (expected 'Initialized')")
    assert res_neg == "Non Initialized"
    assert res_pos == "Initialized"

    # -------------------------------------------------------------
    # Test 3: Numerical Operators (=, !=, >, >=, <, <=)
    # -------------------------------------------------------------
    print("\n[Test 3] Numerical Operators (=, !=, >, >=, <, <=)")
    cond_gt = {
        "enabled": True,
        "rules": [{"operator": "op_gt", "value": "50", "then": "HIGH"}],
        "else_output": "LOW",
    }
    assert apply_conditional_logic(75, cond_gt) == "HIGH"
    assert apply_conditional_logic(25, cond_gt) == "LOW"

    cond_eq = {
        "enabled": True,
        "rules": [{"operator": "op_eq", "value": "0", "then": "ZERO"}],
        "else_output": "NON_ZERO",
    }
    assert apply_conditional_logic(0, cond_eq) == "ZERO"
    assert apply_conditional_logic(10, cond_eq) == "NON_ZERO"

    # -------------------------------------------------------------
    # Test 4: IS EMPTY and IS NOT EMPTY Operators
    # -------------------------------------------------------------
    print("\n[Test 4] IS EMPTY and IS NOT EMPTY Operators")
    cond_empty = {
        "enabled": True,
        "rules": [{"operator": "is_empty", "value": "", "then": "MISSING"}],
        "else_output": "PRESENT",
    }
    assert apply_conditional_logic(None, cond_empty) == "MISSING"
    assert apply_conditional_logic("", cond_empty) == "MISSING"
    assert apply_conditional_logic("Data", cond_empty) == "PRESENT"

    cond_not_empty = {
        "enabled": True,
        "rules": [{"operator": "is_not_empty", "value": "", "then": "PRESENT"}],
        "else_output": "MISSING",
    }
    assert apply_conditional_logic("Hello", cond_not_empty) == "PRESENT"
    assert apply_conditional_logic(None, cond_not_empty) == "MISSING"

    # -------------------------------------------------------------
    # Test 5: Integration with COUNT UNIQUE and GROUP_BY
    # -------------------------------------------------------------
    print("\n[Test 5] Integration with COUNT UNIQUE and GROUP BY")
    dept_rows = [
        {"Department": "Computer Engineering"},
        {"Department": "Civil Engineering"},
        {"Department": "Mechanical Engineering"},
        {"Department": "Electrical Engineering"},
    ]
    mli_data = {"depts": dept_rows}

    # COUNT UNIQUE departments = 4
    calc_uniq = evaluate_formula("COUNT_UNIQUE_ITEMS(depts, Department)", {}, mli_data)
    print(f"  Count Unique Departments: {calc_uniq}")
    assert calc_uniq == 4.0

    cond_depts = {
        "enabled": True,
        "rules": [{"operator": "op_gt", "value": "3", "then": "Multiple Departments"}],
        "else_output": "Single Department",
    }
    res_depts = apply_conditional_logic(calc_uniq, cond_depts)
    print(f"  Conditional Output: '{res_depts}' (expected 'Multiple Departments')")
    assert res_depts == "Multiple Departments"

    # -------------------------------------------------------------
    # Test 6: Backward Compatibility (Disabled / Missing Conditional Logic)
    # -------------------------------------------------------------
    print("\n[Test 6] Backward Compatibility (Disabled / Missing Conditional Logic)")
    cond_disabled = {
        "enabled": False,
        "rules": [{"operator": "op_lt", "value": "0", "then": "Non Initialized"}],
        "else_output": "Initialized",
    }
    assert apply_conditional_logic(50.0, cond_disabled) == 50.0
    assert apply_conditional_logic(-25.0, None) == -25.0

    print("\n" + "=" * 60)
    print("ALL CONDITIONAL FORMULA TEST CASES PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
