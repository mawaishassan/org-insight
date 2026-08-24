"""Verification script for MLI text extraction wrapping, pattern formatting, and full cell value formatting."""

from app.entries.mli_extraction import apply_extraction_rules

def test_wrapping_and_patterns():
    print("--- 1. Testing Full Cell Value Format: Prefix ---")
    rows1 = [{"dept": "Computer Science"}]
    rules1 = [{
        "name": "Prefix bracket",
        "source_sub_field_key": "dept",
        "target_sub_field_key": "formatted_dept",
        "extraction_method": "full_cell_format",
        "wrap_mode": "prefix",
        "wrap_symbol": "[",
        "target_action": "replace",
        "is_active": True,
    }]
    res1 = apply_extraction_rules(rows1, rules1)
    print("Result 1:", res1[0])
    assert res1[0]["formatted_dept"] == "[Computer Science"

    print("\n--- 2. Testing Full Cell Value Format: Suffix ---")
    rules2 = [{
        "name": "Suffix bracket",
        "source_sub_field_key": "dept",
        "target_sub_field_key": "formatted_dept",
        "extraction_method": "full_cell_format",
        "wrap_mode": "suffix",
        "wrap_symbol": "]",
        "target_action": "replace",
        "is_active": True,
    }]
    res2 = apply_extraction_rules(rows1, rules2)
    print("Result 2:", res2[0])
    assert res2[0]["formatted_dept"] == "Computer Science]"

    print("\n--- 3. Testing Full Cell Value Format: Wrap ---")
    rules3 = [{
        "name": "Wrap brackets",
        "source_sub_field_key": "dept",
        "target_sub_field_key": "formatted_dept",
        "extraction_method": "full_cell_format",
        "wrap_mode": "wrap",
        "wrap_symbol": "[]",
        "target_action": "replace",
        "is_active": True,
    }]
    res3 = apply_extraction_rules(rows1, rules3)
    print("Result 3:", res3[0])
    assert res3[0]["formatted_dept"] == "[Computer Science]"

    print("\n--- 4. Testing Full Cell Value Format: Custom Pattern ---")
    rules4 = [{
        "name": "Faculty Pattern",
        "source_sub_field_key": "dept",
        "target_sub_field_key": "formatted_dept",
        "extraction_method": "full_cell_format",
        "wrap_mode": "pattern",
        "output_pattern": "Faculty: {CELL_VALUE};",
        "target_action": "replace",
        "is_active": True,
    }]
    res4 = apply_extraction_rules(rows1, rules4)
    print("Result 4:", res4[0])
    assert res4[0]["formatted_dept"] == "Faculty: Computer Science;"

    print("\n--- 5. Testing Multi-Cell Pattern Reference ---")
    rows5 = [{"faculty": "Faculty of Computing", "dept": "Computer Science"}]
    rules5 = [{
        "name": "Multi Cell Pattern",
        "source_sub_field_key": "dept",
        "target_sub_field_key": "combined",
        "extraction_method": "full_cell_format",
        "wrap_mode": "pattern",
        "output_pattern": "{faculty} [{CELL_VALUE}]",
        "target_action": "replace",
        "is_active": True,
    }]
    res5 = apply_extraction_rules(rows5, rules5)
    print("Result 5:", res5[0])
    assert res5[0]["combined"] == "Faculty of Computing [Computer Science]"

    print("\n--- 6. Testing Target Action Append with Wrap ---")
    rows6 = [{"target_col": "Faculty of Computing", "src_col": "Computer Science"}]
    rules6 = [{
        "name": "Append Wrapped Value",
        "source_sub_field_key": "src_col",
        "target_sub_field_key": "target_col",
        "extraction_method": "full_cell_format",
        "wrap_mode": "wrap",
        "wrap_symbol": "[]",
        "target_action": "append",
        "all_separator": " ",
        "is_active": True,
    }]
    res6 = apply_extraction_rules(rows6, rules6)
    print("Result 6:", res6[0])
    assert res6[0]["target_col"] == "Faculty of Computing [Computer Science]"

    print("\n--- 7. Testing Separate Start & End Symbols () + Source Preservation ---")
    rows7 = [{"target_col": "Faculty of Computing", "src_col": "Computer Science"}]
    rules7 = [{
        "name": "Append Parentheses",
        "source_sub_field_key": "src_col",
        "target_sub_field_key": "target_col",
        "extraction_method": "full_cell_format",
        "wrap_mode": "wrap",
        "wrap_symbol": "(",
        "wrap_end_symbol": ")",
        "target_action": "append",
        "all_separator": " ",
        "is_active": True,
    }]
    res7 = apply_extraction_rules(rows7, rules7)
    print("Result 7:", res7[0])
    assert res7[0]["target_col"] == "Faculty of Computing (Computer Science)"
    # Source cell value must be preserved intact
    assert res7[0]["src_col"] == "Computer Science"

    print("\n[SUCCESS] ALL MLI WRAPPING, PATTERN FORMATTING, AND SEPARATE START/END SYMBOL TESTS PASSED!")

if __name__ == "__main__":
    test_wrapping_and_patterns()
