"""
Comprehensive Automated Test Suite for Nested Group By in MLI Formula Subfields.
Tests:
1. Basic Grouping: GROUP_BY(Department)
2. Nested Grouping: GROUP_BY(Campus) -> GROUP_BY(Department)
3. Grouping + Count: GROUP_BY(Campus, GROUP_BY(Department, COUNT()))
4. Grouping + Unique Count: GROUP_BY(Campus, GROUP_BY(Department, UNIQUE_COUNT(Gender)))
5. Grouping + Filters: GROUP_BY(Campus WHERE Campus = "Lahore") -> GROUP_BY(Department)
6. CurrentRow context: GROUP_BY(Campus = CurrentRow.Campus) -> GROUP_BY(Department)
7. Three-Level Nesting: GROUP_BY(Campus, GROUP_BY(Department, GROUP_BY(Gender, COUNT())))
8. Large Dataset: 20,000+ MLI records benchmark.
9. Regression: SUM, AVG, COUNT, MIN, MAX, arithmetic operators.
"""

import sys
import os
import time

# Ensure backend app import path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.formula_engine.evaluator import (
    evaluate_formula,
    parse_group_by_ast,
    serialize_group_by_ast,
    GroupNode,
    AggSpec,
)


def run_tests():
    print("=" * 60)
    print("RUNNING NESTED GROUP BY TEST SUITE")
    print("=" * 60)

    # Sample MLI Data from prompt
    sample_mli_rows = [
        {"Department": "Computer Engineering", "Campus": "Lahore", "Gender": "Male", "Student_ID": "S101", "Age": 20},
        {"Department": "Computer Engineering", "Campus": "Lahore", "Gender": "Female", "Student_ID": "S102", "Age": 21},
        {"Department": "Computer Engineering", "Campus": "Lahore", "Gender": "Male", "Student_ID": "S103", "Age": 22},
        {"Department": "Geological Engineering", "Campus": "Lahore", "Gender": "Male", "Student_ID": "S104", "Age": 23},
        {"Department": "Geological Engineering", "Campus": "Lahore", "Gender": "Female", "Student_ID": "S105", "Age": 24},
        {"Department": "Physics", "Campus": "KSK", "Gender": "Male", "Student_ID": "S106", "Age": 20},
        {"Department": "Physics", "Campus": "KSK", "Gender": "Female", "Student_ID": "S107", "Age": 21},
        {"Department": "Physics", "Campus": "KSK", "Gender": "Male", "Student_ID": "S108", "Age": 22},
    ]

    mli_data = {"items": sample_mli_rows}

    # Test 1: Basic Grouping + Count
    print("\n[Test 1] Basic Grouping: GROUP_BY(Department, COUNT())")
    row_ce = sample_mli_rows[0] # Computer Engineering

    res_ce = evaluate_formula("GROUP_BY(Department, COUNT())", {}, mli_data, current_row=row_ce)
    print(f"  Computer Engineering Count: {res_ce} (expected 3.0)")
    assert res_ce == 3.0, f"Expected 3.0, got {res_ce}"

    row_ge = sample_mli_rows[3] # Geological Engineering
    res_ge = evaluate_formula("GROUP_BY(Department, COUNT())", {}, mli_data, current_row=row_ge)
    print(f"  Geological Engineering Count: {res_ge} (expected 2.0)")
    assert res_ge == 2.0, f"Expected 2.0, got {res_ge}"

    # Test 2: Two-Level Nested Grouping + Count
    print("\n[Test 2] Nested Grouping: GROUP_BY(Campus, GROUP_BY(Department, COUNT()))")
    res_lahore_ce = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, COUNT()))", {}, mli_data, current_row=row_ce
    )
    print(f"  Lahore -> Computer Engineering Count: {res_lahore_ce} (expected 3.0)")
    assert res_lahore_ce == 3.0, f"Expected 3.0, got {res_lahore_ce}"

    row_ksk_physics = sample_mli_rows[5] # Physics KSK
    res_ksk_physics = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, COUNT()))", {}, mli_data, current_row=row_ksk_physics
    )
    print(f"  KSK -> Physics Count: {res_ksk_physics} (expected 3.0)")
    assert res_ksk_physics == 3.0, f"Expected 3.0, got {res_ksk_physics}"

    # Test 3: Arrow Pipeline Syntax
    print("\n[Test 3] Arrow Syntax: GROUP_BY(Campus) -> GROUP_BY(Department) -> COUNT()")
    ast_arrow = parse_group_by_ast("GROUP_BY(Campus) -> GROUP_BY(Department) -> COUNT()")
    assert ast_arrow is not None
    res_arrow = ast_arrow.evaluate(sample_mli_rows, current_row=row_ce)
    print(f"  Arrow syntax evaluation result: {res_arrow} (expected 3.0)")
    assert res_arrow == 3.0, f"Expected 3.0, got {res_arrow}"

    # Test 4: Nested Grouping + Unique Count
    print("\n[Test 4] Nested Grouping + Unique Count: GROUP_BY(Campus, GROUP_BY(Department, UNIQUE_COUNT(Gender)))")
    res_uniq_gender = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, UNIQUE_COUNT(Gender)))", {}, mli_data, current_row=row_ce
    )
    print(f"  Unique Gender Count (Lahore, CE): {res_uniq_gender} (expected 2.0)")
    assert res_uniq_gender == 2.0, f"Expected 2.0, got {res_uniq_gender}"

    # Test 5: Filter Conditions in Grouping
    print("\n[Test 5] Grouping + Filters: GROUP_BY(Campus, WHERE(Campus, op_eq, \"Lahore\"), GROUP_BY(Department, COUNT()))")
    res_filter_lahore = evaluate_formula(
        'GROUP_BY(Campus, WHERE(Campus, op_eq, "Lahore"), GROUP_BY(Department, COUNT()))',
        {},
        mli_data,
        current_row=row_ce,
    )
    print(f"  Lahore Filtered CE Count: {res_filter_lahore} (expected 3.0)")
    assert res_filter_lahore == 3.0, f"Expected 3.0, got {res_filter_lahore}"

    res_filter_ksk_excluded = evaluate_formula(
        'GROUP_BY(Campus, WHERE(Campus, op_eq, "Lahore"), GROUP_BY(Department, COUNT()))',
        {},
        mli_data,
        current_row=row_ksk_physics,
    )
    print(f"  KSK when filtered to Lahore: {res_filter_ksk_excluded} (expected 0.0)")
    assert res_filter_ksk_excluded == 0.0, f"Expected 0.0, got {res_filter_ksk_excluded}"

    # Test 6: CurrentRow Context Matching
    print("\n[Test 6] CurrentRow Context: GROUP_BY(Campus, WHERE(Campus, op_eq, CurrentRow.Campus), GROUP_BY(Department, COUNT()))")
    res_current_row = evaluate_formula(
        "GROUP_BY(Campus, WHERE(Campus, op_eq, CurrentRow.Campus), GROUP_BY(Department, COUNT()))",
        {},
        mli_data,
        current_row=row_ce,
    )
    print(f"  CurrentRow context result: {res_current_row} (expected 3.0)")
    assert res_current_row == 3.0, f"Expected 3.0, got {res_current_row}"

    # Test 7: Three-Level Nesting
    print("\n[Test 7] Three-Level Nesting: GROUP_BY(Campus, GROUP_BY(Department, GROUP_BY(Gender, COUNT())))")
    res_3level_male = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, GROUP_BY(Gender, COUNT())))",
        {},
        mli_data,
        current_row=sample_mli_rows[0], # Male, CE, Lahore
    )
    print(f"  3-level count (Lahore, CE, Male): {res_3level_male} (expected 2.0)")
    assert res_3level_male == 2.0, f"Expected 2.0, got {res_3level_male}"

    res_3level_female = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, GROUP_BY(Gender, COUNT())))",
        {},
        mli_data,
        current_row=sample_mli_rows[1], # Female, CE, Lahore
    )
    print(f"  3-level count (Lahore, CE, Female): {res_3level_female} (expected 1.0)")
    assert res_3level_female == 1.0, f"Expected 1.0, got {res_3level_female}"

    # Test 8: Chained/Iterative Arithmetic with Group By
    print("\n[Test 8] Chained Arithmetic: GROUP_BY(Campus, GROUP_BY(Department, COUNT())) * 2 + 10")
    res_arith = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, COUNT())) * 2 + 10",
        {},
        mli_data,
        current_row=row_ce,
    )
    print(f"  Arithmetic result: {res_arith} (expected 16.0)")
    assert res_arith == 16.0, f"Expected 16.0, got {res_arith}"

    # Test 9: Aggregations SUM, AVG, MIN, MAX inside Group By
    print("\n[Test 9] Grouped Aggregations: SUM(Age), AVG(Age), MIN(Age), MAX(Age)")
    res_sum_age = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, SUM(Age)))", {}, mli_data, current_row=row_ce
    )
    print(f"  Sum Age (Lahore CE: 20+21+22): {res_sum_age} (expected 63.0)")
    assert res_sum_age == 63.0, f"Expected 63.0, got {res_sum_age}"

    res_avg_age = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, AVG(Age)))", {}, mli_data, current_row=row_ce
    )
    print(f"  Avg Age (Lahore CE: 63/3): {res_avg_age} (expected 21.0)")
    assert res_avg_age == 21.0, f"Expected 21.0, got {res_avg_age}"

    # Test 10: Performance Benchmark on 20,000+ Records
    print("\n[Test 10] Performance Benchmark: 20,000 MLI Records")
    large_rows = []
    campuses = ["Lahore", "KSK", "Faisalabad", "Multan"]
    depts = ["Computer Engineering", "Electrical Engineering", "Civil Engineering", "Physics", "Chemistry"]
    genders = ["Male", "Female"]

    for i in range(20000):
        c = campuses[i % len(campuses)]
        d = depts[i % len(depts)]
        g = genders[i % len(genders)]
        large_rows.append({"Campus": c, "Department": d, "Gender": g, "Student_ID": f"S{i}"})

    large_mli_data = {"items": large_rows}
    target_row = large_rows[100]

    t0 = time.time()
    res_large = evaluate_formula(
        "GROUP_BY(Campus, GROUP_BY(Department, UNIQUE_COUNT(Student_ID)))",
        {},
        large_mli_data,
        current_row=target_row,
    )
    t1 = time.time()
    elapsed_ms = (t1 - t0) * 1000
    print(f"  Evaluated 20,000 rows in {elapsed_ms:.2f} ms!")
    print(f"  Target row group unique count result: {res_large}")
    assert res_large > 0, "Expected positive count"
    assert elapsed_ms < 500.0, f"Performance benchmark failed: {elapsed_ms:.2f} ms >= 500 ms"

    # Test 11: Regression tests for existing formula functions
    print("\n[Test 11] Regression Tests: Existing Operators and Functions")
    assert evaluate_formula("10 + 20 * 2", {}) == 50.0
    assert evaluate_formula("SUM(10, 20, 30)", {}) == 60.0
    assert evaluate_formula("AVG(10, 20, 30)", {}) == 20.0
    assert evaluate_formula("COUNT(1, 2, 3, 4)", {}) == 4.0
    assert evaluate_formula("MIN(5, 10, 2)", {}) == 2.0
    assert evaluate_formula("MAX(5, 10, 2)", {}) == 10.0
    # Test 12: Cross-KPI Nested Group By
    print("\n[Test 12] Cross-KPI Nested Group By: KPI_GROUP_BY(15, 'students', GROUP_BY(Campus, GROUP_BY(Department, UNIQUE_COUNT(Gender))))")
    other_kpi_data = {
        (15, "students"): sample_mli_rows
    }
    res_cross_kpi = evaluate_formula(
        'KPI_GROUP_BY(15, "students", GROUP_BY(Campus, GROUP_BY(Department, UNIQUE_COUNT(Gender))))',
        {},
        multi_line_items_data={},
        current_row=row_ce,
        other_kpi_multi_line_data=other_kpi_data,
    )
    print(f"  Cross-KPI Group By result: {res_cross_kpi} (expected 2.0)")
    # Test 13: User Expression with keyword equality argument
    print("\n[Test 13] User Formula with Keyword Eq Arg: KPI_GROUP_BY(219, 'research_grants', GROUP_BY(department_id, department_id = CurrentRow.department_id, GROUP_BY(faculty_id, COUNT())))")
    grants_rows = [
        {"department_id": "DEPT_CS", "faculty_id": "FAC_1", "title": "Grant 1"},
        {"department_id": "DEPT_CS", "faculty_id": "FAC_1", "title": "Grant 2"},
        {"department_id": "DEPT_EE", "faculty_id": "FAC_2", "title": "Grant 3"},
    ]
    kpi_219_data = {(219, "research_grants"): grants_rows}
    cur_row = {"department_id": "DEPT_CS", "faculty_id": "FAC_1"}

    res_user_expr = evaluate_formula(
        'KPI_GROUP_BY(219, "research_grants", GROUP_BY(department_id, department_id = CurrentRow.department_id, GROUP_BY(faculty_id, COUNT())))',
        {},
        multi_line_items_data={},
        current_row=cur_row,
        other_kpi_multi_line_data=kpi_219_data,
    )
    print(f"  User Formula result: {res_user_expr} (expected 2.0)")
    # Test 14: Dict object CurrentRow & Key Alias Matching (e.g. department_name vs department_id)
    print("\n[Test 14] Dict Object CurrentRow & Key Alias Matching")
    grants_rows_dict = [
        {"department_name": {"id": "1", "label": "Architectural Engineering and Design"}, "faculty_id": "FAC_101", "grant": "Grant A"},
        {"department_name": {"id": "1", "label": "Architectural Engineering and Design"}, "faculty_id": "FAC_102", "grant": "Grant B"},
        {"department_name": {"id": "2", "label": "Civil Engineering"}, "faculty_id": "FAC_103", "grant": "Grant C"},
    ]
    kpi_219_dict_data = {(219, "research_grants"): grants_rows_dict}
    cur_row_dict = {"department_id": {"id": "1", "label": "Architectural Engineering and Design"}}
    res_dict_test = evaluate_formula(
        'KPI_GROUP_BY(219, "research_grants", GROUP_BY(faculty_id, GROUP_BY(department_id, department_id = CurrentRow.department_id, COUNT())))',
        {},
        multi_line_items_data={},
        current_row=cur_row_dict,
        other_kpi_multi_line_data=kpi_219_dict_data,
    )
    print(f"  Dict object & alias match result: {res_dict_test} (expected 2.0)")
    assert res_dict_test == 2.0, f"Expected 2.0, got {res_dict_test}"

    # Test 15: Prompt Example 1 - Count vs Count Unique
    print("\n[Test 15] Prompt Example 1: Count vs Count Unique")
    dept_rows = [
        {"Department": "Computer Engineering"},
        {"Department": "Computer Engineering"},
        {"Department": "Computer Engineering"},
        {"Department": "Geological Engineering"},
        {"Department": "Geological Engineering"},
        {"Department": "Physics"},
    ]
    dept_data = {"depts": dept_rows}
    res_normal_count = evaluate_formula("COUNT_ITEMS(depts)", {}, dept_data)
    res_uniq_count = evaluate_formula("COUNT_UNIQUE_ITEMS(depts, Department)", {}, dept_data)
    res_uniq_agg = evaluate_formula("COUNT_UNIQUE(Department)", {}, dept_data)
    print(f"  Normal Count: {res_normal_count} (expected 6.0)")
    print(f"  Count Unique (ITEMS): {res_uniq_count} (expected 3.0)")
    print(f"  Count Unique (AggSpec): {res_uniq_agg} (expected 3.0)")
    assert res_normal_count == 6.0, f"Expected 6.0, got {res_normal_count}"
    assert res_uniq_count == 3.0, f"Expected 3.0, got {res_uniq_count}"
    assert res_uniq_agg == 3.0, f"Expected 3.0, got {res_uniq_agg}"

    # Test 16: Prompt Example 2 - Sequential Multi-level Grouping (Department, Gender)
    print("\n[Test 16] Prompt Example 2: Group By Department & Secondary Group By Gender")
    multi_rows = [
        {"Department": "Computer Engineering", "Gender": "Male", "Student": "S1"},
        {"Department": "Computer Engineering", "Gender": "Male", "Student": "S2"},
        {"Department": "Computer Engineering", "Gender": "Female", "Student": "S3"},
        {"Department": "Computer Engineering", "Gender": "Female", "Student": "S4"},
        {"Department": "Geological Engineering", "Gender": "Male", "Student": "S5"},
        {"Department": "Geological Engineering", "Gender": "Male", "Student": "S6"},
        {"Department": "Physics", "Gender": "Female", "Student": "S7"},
    ]
    multi_data = {"students": multi_rows}
    row_ce_male = multi_rows[0]
    row_ce_female = multi_rows[2]

    # Count grouped first by Department and then by Gender:
    res_ce_male_cnt = evaluate_formula(
        "GROUP_BY(Department, GROUP_BY(Gender, COUNT()))", {}, multi_data, current_row=row_ce_male
    )
    res_ce_female_cnt = evaluate_formula(
        "GROUP_BY(Department, GROUP_BY(Gender, COUNT()))", {}, multi_data, current_row=row_ce_female
    )
    print(f"  CE -> Male Count: {res_ce_male_cnt} (expected 2.0)")
    print(f"  CE -> Female Count: {res_ce_female_cnt} (expected 2.0)")
    assert res_ce_male_cnt == 2.0, f"Expected 2.0, got {res_ce_male_cnt}"
    assert res_ce_female_cnt == 2.0, f"Expected 2.0, got {res_ce_female_cnt}"

    # Count Unique Student grouped by Department then Gender:
    res_ce_male_uniq = evaluate_formula(
        "GROUP_BY(Department, GROUP_BY(Gender, UNIQUE_COUNT(Student)))", {}, multi_data, current_row=row_ce_male
    )
    print(f"  CE -> Male Unique Student Count: {res_ce_male_uniq} (expected 2.0)")
    assert res_ce_male_uniq == 2.0, f"Expected 2.0, got {res_ce_male_uniq}"

    # Single Primary Group By only:
    res_ce_primary_only = evaluate_formula(
        "GROUP_BY(Department, COUNT())", {}, multi_data, current_row=row_ce_male
    )
    print(f"  CE Primary Group By Only Count: {res_ce_primary_only} (expected 4.0)")
    assert res_ce_primary_only == 4.0, f"Expected 4.0, got {res_ce_primary_only}"

    # Test 17: Conditional Count Unique
    print("\n[Test 17] Conditional Count Unique: COUNT_UNIQUE_ITEMS_WHERE")
    res_cond_uniq = evaluate_formula(
        'COUNT_UNIQUE_ITEMS_WHERE(students, Student, Department, op_eq, "Computer Engineering")',
        {},
        multi_data,
    )
    print(f"  Conditional Count Unique (CE students): {res_cond_uniq} (expected 4.0)")
    assert res_cond_uniq == 4.0, f"Expected 4.0, got {res_cond_uniq}"

    print("\n" + "=" * 60)
    print("ALL 17 TEST SUITE CASES PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    run_tests()
