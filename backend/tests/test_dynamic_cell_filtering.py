import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
import datetime
from app.formula_engine.evaluator import match_cell_value, evaluate_formula
from app.entries.multi_item_filters import eval_v2_conditions, eval_v2_condition_row
from app.widget_data.service import _row_matches_specific_column_filter


def test_match_cell_value_heterogeneous_types():
    """Verify match_cell_value handles numeric, date, and text cells in the same column."""
    
    # 1. Numeric comparisons
    assert match_cell_value(100, "eq", 100) is True
    assert match_cell_value(100, "eq", "100") is True
    assert match_cell_value(100, "gt", 50) is True
    assert match_cell_value(100, "lt", 150) is True
    assert match_cell_value(100, "gte", 100) is True
    assert match_cell_value("100", "gt", 50) is True

    # 2. Text comparisons on string cells
    assert match_cell_value("Pending Review", "eq", "Pending Review") is True
    assert match_cell_value("Pending Review", "contains", "Review") is True
    assert match_cell_value("Pending Review", "starts_with", "Pending") is True
    assert match_cell_value("Pending Review", "gt", 50) is False  # Text shouldn't crash or match numeric gt

    # 3. Date comparisons
    assert match_cell_value("2026-05-15", "eq", "2026-05-15") is True
    assert match_cell_value("2026-05-15", "gt", "2026-01-01") is True
    assert match_cell_value("2026-05-15", "lt", "2026-12-31") is True
    assert match_cell_value("2026-05-15", "gt", 100) is False

    # 4. Boolean comparisons
    assert match_cell_value(True, "eq", True) is True
    assert match_cell_value(True, "eq", "true") is True
    assert match_cell_value(False, "eq", "false") is True


def test_dynamic_column_row_filtering_v2_conditions():
    """
    Test filtering a multi-line items dataset where a single column 'metric_val'
    contains numbers in some rows, text in some rows, and dates in some rows.
    """
    dataset = [
        {"id": 1, "name": "Project Alpha", "metric_val": 4500, "status": "Active"},
        {"id": 2, "name": "Project Beta", "metric_val": "Exempt from KPI", "status": "Pending"},
        {"id": 3, "name": "Project Gamma", "metric_val": 850, "status": "Active"},
        {"id": 4, "name": "Project Delta", "metric_val": "2026-10-01", "status": "Scheduled"},
        {"id": 5, "name": "Project Epsilon", "metric_val": 12000, "status": "Active"},
        {"id": 6, "name": "Project Zeta", "metric_val": "Pending Approval", "status": "Pending"},
    ]

    # Test 1: Filter where metric_val > 1000 (should only match row 1 and row 5, ignoring text and dates)
    gt_1000_cond = [{"field": "metric_val", "op": "gt", "value": 1000}]
    gt_1000_rows = [r for r in dataset if eval_v2_conditions(r, gt_1000_cond)]
    assert [r["id"] for r in gt_1000_rows] == [1, 5]

    # Test 2: Filter where metric_val contains 'Pending' (should match row 6)
    text_cond = [{"field": "metric_val", "op": "contains", "value": "Pending"}]
    text_rows = [r for r in dataset if eval_v2_conditions(r, text_cond)]
    assert [r["id"] for r in text_rows] == [6]

    # Test 3: Filter where metric_val is a date > '2026-05-01' (should match row 4)
    date_cond = [{"field": "metric_val", "op": "gt", "value": "2026-05-01"}]
    date_rows = [r for r in dataset if eval_v2_conditions(r, date_cond)]
    assert [r["id"] for r in date_rows] == [4]

    # Test 4: Filter with cell_type restriction (e.g. cell_type == 'number' AND metric_val > 500)
    num_type_cond = [
        {"field": "metric_val", "cell_type": "number", "op": "gt", "value": 500}
    ]
    num_rows = [r for r in dataset if eval_v2_conditions(r, num_type_cond)]
    assert [r["id"] for r in num_rows] == [1, 3, 5]


def test_specific_column_filter_with_dynamic_cells():
    """Verify _row_matches_specific_column_filter with dynamic cells."""
    row_num = {"department": "Computer Science", "value_cell": 99.5}
    row_txt = {"department": "Electrical Engineering", "value_cell": "Grade A"}
    row_date = {"department": "Mechanical Engineering", "value_cell": "2026-08-20"}

    # Numeric match
    assert _row_matches_specific_column_filter(row_num, {"column_key": "value_cell", "value": 99.5}) is True
    assert _row_matches_specific_column_filter(row_num, {"column_key": "value_cell", "value": "99.5"}) is True
    assert _row_matches_specific_column_filter(row_num, {"column_key": "value_cell", "value": 100}) is False

    # Text match
    assert _row_matches_specific_column_filter(row_txt, {"column_key": "value_cell", "value": "Grade A"}) is True
    assert _row_matches_specific_column_filter(row_txt, {"column_key": "value_cell", "value": "grade a"}) is True
    assert _row_matches_specific_column_filter(row_txt, {"column_key": "value_cell", "value": "Grade B"}) is False

    # Date match
    assert _row_matches_specific_column_filter(row_date, {"column_key": "value_cell", "value": "2026-08-20"}) is True
    assert _row_matches_specific_column_filter(row_date, {"column_key": "value_cell", "value": "2026-08-21"}) is False


def test_formula_aggregations_on_dynamic_columns():
    """Verify formula engine functions safely aggregate numeric cells in dynamic columns."""
    mli_data = {
        "projects": [
            {"name": "P1", "budget": 100, "status": "Active"},
            {"name": "P2", "budget": "N/A (Grant Funded)", "status": "Active"},
            {"name": "P3", "budget": 250, "status": "Active"},
            {"name": "P4", "budget": "2026-12-01", "status": "Planned"},
            {"name": "P5", "budget": 50, "status": "Active"},
        ]
    }

    # SUM_ITEMS on budget should sum only numeric rows (100 + 250 + 50 = 400)
    sum_res = evaluate_formula("SUM_ITEMS('projects', 'budget')", {}, mli_data)
    assert sum_res == 400

    # AVG_ITEMS on budget (400 / 3 = 133.333...)
    avg_res = evaluate_formula("AVG_ITEMS('projects', 'budget')", {}, mli_data)
    assert round(avg_res, 2) == 133.33

    # COUNT_ITEMS on projects
    count_res = evaluate_formula("COUNT_ITEMS('projects')", {}, mli_data)
    assert count_res == 5

    # SUM_ITEMS_WHERE active
    sum_where_res = evaluate_formula("SUM_ITEMS_WHERE('projects', 'budget', 'status', op_eq, 'Active')", {}, mli_data)
    assert sum_where_res == 400


def test_sql_compilation_dynamic_cell_type():
    """Verify SQL compilation of cell_type conditions in multiline_chart_sql."""
    from app.widget_data.multiline_chart_sql import _compile_v2_one

    sub_id_by_key = {"metric_val": 42}
    ref_types = {"metric_val": "dynamic"}
    params = {}
    needed = set()

    # 1. Pure cell_type filter (no value)
    cond1 = {"field": "metric_val", "cell_type": "number"}
    sql1 = _compile_v2_one(cond1, cond_idx=0, sub_id_by_key=sub_id_by_key, reference_field_types=ref_types, resolved_label_sets=None, params=params, needed_sid_params=needed)
    assert "cell_type = 'number'" in sql1

    # 2. Combined cell_type + value comparison (cell_type=number AND value > 1000)
    cond2 = {"field": "metric_val", "cell_type": "number", "op": "gt", "value": 1000}
    sql2 = _compile_v2_one(cond2, cond_idx=1, sub_id_by_key=sub_id_by_key, reference_field_types=ref_types, resolved_label_sets=None, params=params, needed_sid_params=needed)
    assert "cell_type = 'number'" in sql2
    assert "> CAST(:wf_1_v0 AS double precision)" in sql2

    # 3. Dynamic column text search without cell_type
    cond3 = {"field": "metric_val", "op": "contains", "value": "Pending"}
    sql3 = _compile_v2_one(cond3, cond_idx=2, sub_id_by_key=sub_id_by_key, reference_field_types=ref_types, resolved_label_sets=None, params=params, needed_sid_params=needed)
    assert "POSITION(" in sql3


if __name__ == "__main__":
    test_match_cell_value_heterogeneous_types()
    test_dynamic_column_row_filtering_v2_conditions()
    test_specific_column_filter_with_dynamic_cells()
    test_formula_aggregations_on_dynamic_columns()
    test_sql_compilation_dynamic_cell_type()
    print("All dynamic cell and cell-based filtering tests passed successfully!")
