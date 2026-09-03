"""
Verification test for Specific Column-Based Data Fetching & Runtime Formula Recalculation.
"""
import sys
import os

# Add backend directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.formula_engine.evaluator import evaluate_formula
from app.widget_data.service import _row_matches_specific_column_filter, _row_matches_normal_filters

def test_filter_helpers():
    print("Testing filter helper functions...")
    
    row1 = {"department": "Computer Science", "faculty": "Engineering", "budget": 100000, "staff_count": 15}
    row2 = {"department": "Electrical Engineering", "faculty": "Engineering", "budget": 80000, "staff_count": 12}
    row3 = {"department": "Physics", "faculty": "Science", "budget": 50000, "staff_count": 8}
    row4 = {"department": {"label": "Computer Science", "id": 1}, "faculty": "Engineering", "budget": 95000, "staff_count": 14}
    
    # 1. Single value match
    col_filter_cs = {"column_key": "department", "value": "Computer Science"}
    assert _row_matches_specific_column_filter(row1, col_filter_cs) == True
    assert _row_matches_specific_column_filter(row2, col_filter_cs) == False
    assert _row_matches_specific_column_filter(row3, col_filter_cs) == False
    assert _row_matches_specific_column_filter(row4, col_filter_cs) == True, "Reference object value should match"
    
    # 2. Case-insensitivity and whitespace
    col_filter_cs_lower = {"column_key": "department", "value": "  computer science  "}
    assert _row_matches_specific_column_filter(row1, col_filter_cs_lower) == True
    
    # 3. Multi-value match
    col_filter_multi = {"column_key": "department", "values": ["Computer Science", "Physics"]}
    assert _row_matches_specific_column_filter(row1, col_filter_multi) == True
    assert _row_matches_specific_column_filter(row2, col_filter_multi) == False
    assert _row_matches_specific_column_filter(row3, col_filter_multi) == True
    
    # 4. Normal filters map
    norm_filter_eng = {"faculty": ["Engineering"]}
    assert _row_matches_normal_filters(row1, norm_filter_eng) == True
    assert _row_matches_normal_filters(row3, norm_filter_eng) == False
    
    print("  -> Filter helper tests passed!")

def test_formula_recalculation_on_filtered_dataset():
    print("Testing formula recalculation on filtered dataset...")
    
    # Unfiltered dataset
    full_dataset = [
        {"department": "Computer Science", "budget": 100000, "author": "Alice", "publications": 10},
        {"department": "Computer Science", "budget": 50000, "author": "Bob", "publications": 5},
        {"department": "Electrical Engineering", "budget": 80000, "author": "Charlie", "publications": 8},
        {"department": "Physics", "budget": 40000, "author": "Dave", "publications": 4},
    ]
    
    # 1. Formulas on unfiltered dataset
    res_sum_all = evaluate_formula("SUM_ITEMS(publications_data, 'budget')", {}, {"publications_data": full_dataset}, {})
    assert res_sum_all == 270000, f"Expected 270000, got {res_sum_all}"
    
    res_count_all = evaluate_formula("COUNT_ITEMS(publications_data)", {}, {"publications_data": full_dataset}, {})
    assert res_count_all == 4, f"Expected 4, got {res_count_all}"
    
    res_avg_all = evaluate_formula("AVG_ITEMS(publications_data, 'publications')", {}, {"publications_data": full_dataset}, {})
    assert res_avg_all == 6.75, f"Expected 6.75, got {res_avg_all}"
    
    # 2. Apply Specific Column Filter: department = 'Computer Science'
    cs_filtered = [r for r in full_dataset if _row_matches_specific_column_filter(r, {"column_key": "department", "value": "Computer Science"})]
    assert len(cs_filtered) == 2
    
    res_sum_cs = evaluate_formula("SUM_ITEMS(publications_data, 'budget')", {}, {"publications_data": cs_filtered}, {})
    assert res_sum_cs == 150000, f"Expected 150000, got {res_sum_cs}"
    
    res_count_cs = evaluate_formula("COUNT_ITEMS(publications_data)", {}, {"publications_data": cs_filtered}, {})
    assert res_count_cs == 2, f"Expected 2, got {res_count_cs}"
    
    res_avg_cs = evaluate_formula("AVG_ITEMS(publications_data, 'publications')", {}, {"publications_data": cs_filtered}, {})
    assert res_avg_cs == 7.5, f"Expected 7.5, got {res_avg_cs}"
    
    # 3. Conditional / WHERE formulas on filtered dataset
    res_sum_where = evaluate_formula("SUM_ITEMS_WHERE('publications_data', 'budget', 'author', op_eq, 'Alice')", {}, {"publications_data": cs_filtered}, {})
    assert res_sum_where == 100000, f"Expected 100000, got {res_sum_where}"
    
    # 4. Filter to non-existent value
    empty_filtered = [r for r in full_dataset if _row_matches_specific_column_filter(r, {"column_key": "department", "value": "Medicine"})]
    res_sum_empty = evaluate_formula("SUM_ITEMS(publications_data, 'budget')", {}, {"publications_data": empty_filtered}, {})
    assert res_sum_empty == 0, f"Expected 0, got {res_sum_empty}"
    
    print("  -> Formula recalculation tests passed!")

def test_cross_kpi_formula_with_column_filtering():
    print("Testing cross-kpi formulas with column filtering...")
    
    mli_kpi1 = [
        {"department": "Computer Science", "research_grants": 500000},
        {"department": "Physics", "research_grants": 200000},
    ]
    mli_kpi2 = [
        {"department": "Computer Science", "lab_expenses": 150000},
        {"department": "Physics", "lab_expenses": 80000},
    ]
    
    cs_kpi1 = [r for r in mli_kpi1 if _row_matches_specific_column_filter(r, {"column_key": "department", "value": "Computer Science"})]
    cs_kpi2 = [r for r in mli_kpi2 if _row_matches_specific_column_filter(r, {"column_key": "department", "value": "Computer Science"})]
    
    # Formula adding grants from KPI 1 and lab expenses from KPI 2
    formula = "SUM_ITEMS(grants_data, 'research_grants') - SUM_ITEMS(expenses_data, 'lab_expenses')"
    res_net_cs = evaluate_formula(formula, {}, {"grants_data": cs_kpi1, "expenses_data": cs_kpi2}, {})
    assert res_net_cs == 350000, f"Expected 350000, got {res_net_cs}"
    
    print("  -> Cross-KPI formula tests passed!")

if __name__ == "__main__":
    test_filter_helpers()
    test_formula_recalculation_on_filtered_dataset()
    test_cross_kpi_formula_with_column_filtering()
    print("\nALL BACKEND SPECIFIC COLUMN FILTERING & RECALCULATION TESTS PASSED!")
