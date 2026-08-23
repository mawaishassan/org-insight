"""Test script for MLI subfield formula evaluation & human-readable name normalization."""

import re
from app.formula_engine.evaluator import evaluate_formula

def test_mli_row_formula_eval():
    print("--- 1. Testing Subfield Name Normalization ---")
    sub_fields = [
        {"name": "Department Name", "key": "department_name"},
        {"name": "Total Faculty", "key": "total_faculty"},
        {"name": "Faculty Who Submitted Publications", "key": "faculty_who_submitted_publications"},
        {"name": "Total Enntries", "key": "total_enntries"},
    ]

    expr = "Total Faculty + Faculty Who Submitted Publications / Total Faculty"

    norm_expr = expr
    sorted_all_subs = sorted(sub_fields, key=lambda s: len(s["name"]), reverse=True)
    for sub_item in sorted_all_subs:
        s_name = sub_item["name"].strip()
        s_key = sub_item["key"].strip()
        if s_name and s_key and s_name != s_key:
            norm_expr = re.sub(r'\b' + re.escape(s_name) + r'\b', s_key, norm_expr)

    print(" Original Expr:", expr)
    print(" Normalized Expr:", norm_expr)

    assert norm_expr == "total_faculty + faculty_who_submitted_publications / total_faculty"

    print("\n--- 2. Testing Row Formula Evaluation ---")
    working_row = {
        "department_name": "Architectural Engineering and Design",
        "total_faculty": 14,
        "faculty_who_submitted_publications": 6
    }

    result = evaluate_formula(
        norm_expr,
        field_values={},
        multi_line_items_data={},
        other_kpi_values={},
        current_row=working_row
    )

    print(f" Calculated Result for Row (Total Faculty=14, Faculty Submitted=6): {result}")
    # 14 + (6 / 14) = 14 + 0.428571 = 14.428571...
    expected = 14 + (6 / 14)
    assert abs(result - expected) < 0.001, f"Expected {expected}, got {result}"

    print("\n[SUCCESS] MLI ROW FORMULA EVALUATION TEST PASSED!")

if __name__ == "__main__":
    test_mli_row_formula_eval()
