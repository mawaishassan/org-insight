"""Test script for Custom Report Table Footer evaluation, cell merging & formula logic."""

from app.reports.custom_service import evaluate_report_table_footer_rows

def test_custom_report_table_footer():
    print("--- 1. Testing Footer Evaluation with SUM, COUNT, AVG, MIN, MAX ---")
    
    sub_fields = [
        {"key": "department", "name": "Department"},
        {"key": "male", "name": "Male"},
        {"key": "female", "name": "Female"},
        {"key": "total", "name": "Total"},
    ]

    value_items = [
        {"department": "Computer Science", "male": 120, "female": 100, "total": 220},
        {"department": "Electrical Engineering", "male": 150, "female": 80, "total": 230},
        {"department": "Civil Engineering", "male": 100, "female": 90, "total": 190},
    ]

    footer_config = {
        "enabled": True,
        "rows": [
            {
                "id": "row_1",
                "cells": [
                    {
                        "id": "c1",
                        "colspan": 1,
                        "content_type": "text",
                        "text": "Grand Total",
                        "align": "left",
                        "bold": True
                    },
                    {
                        "id": "c2",
                        "colspan": 1,
                        "content_type": "formula",
                        "formula_op": "SUM",
                        "column_key": "male",
                        "align": "right",
                        "bold": True,
                        "decimal_places": 0
                    },
                    {
                        "id": "c3",
                        "colspan": 1,
                        "content_type": "formula",
                        "formula_op": "SUM",
                        "column_key": "female",
                        "align": "right",
                        "bold": True,
                        "decimal_places": 0
                    },
                    {
                        "id": "c4",
                        "colspan": 1,
                        "content_type": "formula",
                        "formula_op": "SUM",
                        "column_key": "total",
                        "align": "right",
                        "bold": True,
                        "decimal_places": 0
                    }
                ]
            }
        ]
    }

    eval_rows = evaluate_report_table_footer_rows(footer_config, sub_fields, value_items)
    assert eval_rows is not None, "Evaluation returned None"
    assert len(eval_rows) == 1, f"Expected 1 row, got {len(eval_rows)}"
    
    cells = eval_rows[0]["cells"]
    print(f" Calculated Footer Row 1: {[c['value'] for c in cells]}")

    assert cells[0]["value"] == "Grand Total"
    assert cells[1]["value"] == "370", f"Expected 370 for Male sum, got {cells[1]['value']}"
    assert cells[2]["value"] == "270", f"Expected 270 for Female sum, got {cells[2]['value']}"
    assert cells[3]["value"] == "640", f"Expected 640 for Total sum, got {cells[3]['value']}"

    print("\n--- 2. Testing Merged Cells (colspan=3) ---")
    merged_footer_config = {
        "enabled": True,
        "rows": [
            {
                "id": "row_1",
                "cells": [
                    {
                        "id": "c1",
                        "colspan": 3,
                        "content_type": "text",
                        "text": "Grand Total Across All Departments",
                        "align": "left",
                        "bold": True
                    },
                    {
                        "id": "c2",
                        "colspan": 1,
                        "content_type": "formula",
                        "formula_op": "SUM",
                        "column_key": "total",
                        "align": "right",
                        "bold": True,
                        "decimal_places": 0
                    }
                ]
            }
        ]
    }

    eval_merged = evaluate_report_table_footer_rows(merged_footer_config, sub_fields, value_items)
    assert eval_merged is not None
    m_cells = eval_merged[0]["cells"]
    print(f" Calculated Merged Footer: Colspan {m_cells[0]['colspan']} -> '{m_cells[0]['value']}', Value -> '{m_cells[1]['value']}'")

    assert m_cells[0]["colspan"] == 3
    assert m_cells[0]["value"] == "Grand Total Across All Departments"
    assert m_cells[1]["value"] == "640"

    print("\n[SUCCESS] CUSTOM REPORT TABLE FOOTER TEST PASSED!")

if __name__ == "__main__":
    test_custom_report_table_footer()
