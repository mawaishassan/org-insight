"""Verification script for MLI text extraction column behavior & cross-KPI KPI_GROUP_BY formula evaluation."""

from app.entries.mli_extraction import apply_extraction_rules
from app.formula_engine.evaluator import evaluate_formula, match_cell_value

def test_mli_text_extraction_and_formula():
    print("--- 1. Testing Text Extraction Rules ---")
    raw_rows = [
        {"department_raw": "Dept: Department of Physics (PHY)", "qty": 10, "faculty_name": "Prof Dr Shamaila Shahzadi"},
        {"department_raw": "Dept: Department of Physics (PHY)", "qty": 20, "faculty_name": "Prof Dr Shamaila Shahzadi"},
        {"department_raw": "Dept: Petroleum and Gas Engineering (PGE)", "qty": 15, "faculty_name": "Hasan Jehanzaib"},
        {"department_raw": "Dept: Department of Basic Sciences and Humanities (KSK) (BSH)", "qty": 5, "faculty_name": "Mr Imran Sajid"},
    ]

    extraction_rules = [
        {
            "id": 1,
            "name": "Extract Department Name",
            "is_active": True,
            "source_sub_field_key": "department_raw",
            "target_sub_field_key": "department",
            "extraction_method": "between_symbols",
            "start_symbol": "Dept: ",
            "end_symbol": " (",
            "occurrence": "first",
            "target_action": "replace",
            "remove_from_source": False,
        }
    ]

    extracted_rows = apply_extraction_rules(raw_rows, extraction_rules)
    print("Extracted Rows:")
    for r in extracted_rows:
        print(" ", r)

    assert extracted_rows[0]["department"] == "Department of Physics"
    assert extracted_rows[2]["department"] == "Petroleum and Gas Engineering"
    assert extracted_rows[3]["department"] == "Department of Basic Sciences and Humanities"

    print("\n--- 2. Testing Cross-KPI Formula Evaluation (KPI_GROUP_BY) ---")
    # Expression: KPI_GROUP_BY(264, "research_journal_publication", GROUP_BY(department, WHERE(department, op_eq, CurrentRow.department_name), UNIQUE_COUNT(faculty_name)))
    expr = 'KPI_GROUP_BY(264, "research_journal_publication", GROUP_BY(department, WHERE(department, "op_eq", CurrentRow.department_name), UNIQUE_COUNT(faculty_name)))'

    target_rows = [
        {"department_name": "Department of Physics"},
        {"department_name": "Petroleum and Gas Engineering"},
        {"department_name": "Civil Engineering"},
    ]

    other_kpi_mli_data = {
        (264, "research_journal_publication"): extracted_rows
    }

    for tr in target_rows:
        res = evaluate_formula(
            expr,
            field_values={},
            multi_line_items_data={},
            other_kpi_values={},
            current_row=tr,
            other_kpi_multi_line_data=other_kpi_mli_data
        )
        print(f" Target Dept '{tr['department_name']}' -> Faculty Submissions: {res}")

        if tr["department_name"] == "Department of Physics":
            assert res == 1, f"Expected 1 unique faculty for Physics, got {res}"
        elif tr["department_name"] == "Petroleum and Gas Engineering":
            assert res == 1, f"Expected 1 unique faculty for Petroleum, got {res}"
        elif tr["department_name"] == "Civil Engineering":
            assert res == 0, f"Expected 0 for Civil Engineering, got {res}"

    print("\n[SUCCESS] ALL MLI TEXT EXTRACTION & CROSS-KPI FORMULA EVALUATION TESTS PASSED!")

if __name__ == "__main__":
    test_mli_text_extraction_and_formula()
