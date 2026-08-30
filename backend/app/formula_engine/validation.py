import ast
import re
from typing import Any, Optional, Dict
from app.formula_engine.circular_validation import extract_formula_dependencies

class FormulaValidationError(ValueError):
    """Exception raised when formula validation fails."""
    pass


# Functions that are safe to use with any column type (text, date, reference, etc.)
# — they use column keys only as identifiers for lookup, not for arithmetic.
_SAFE_AGGREGATE_FUNCTIONS = {
    "SUM_ITEMS", "AVG_ITEMS", "COUNT_ITEMS", "MIN_ITEMS", "MAX_ITEMS",
    "SUM_ITEMS_WHERE", "AVG_ITEMS_WHERE", "COUNT_ITEMS_WHERE", "MIN_ITEMS_WHERE", "MAX_ITEMS_WHERE",
    "COUNT_UNIQUE_ITEMS", "UNIQUE_COUNT_ITEMS", "COUNT_UNIQUE_ITEMS_WHERE", "UNIQUE_COUNT_ITEMS_WHERE",
    "SUM_KPI_ITEMS", "AVG_KPI_ITEMS", "COUNT_KPI_ITEMS", "MIN_KPI_ITEMS", "MAX_KPI_ITEMS",
    "SUM_KPI_ITEMS_WHERE", "AVG_KPI_ITEMS_WHERE", "COUNT_KPI_ITEMS_WHERE", "MIN_KPI_ITEMS_WHERE", "MAX_KPI_ITEMS_WHERE",
    "COUNT_UNIQUE_KPI_ITEMS", "UNIQUE_COUNT_KPI_ITEMS", "COUNT_UNIQUE_KPI_ITEMS_WHERE",
    "GROUP_BY", "KPI_GROUP_BY", "GROUP_BY_KPI",
    "SUM", "AVG", "AVERAGE", "COUNT", "UNIQUE_COUNT", "COUNT_DISTINCT", "COUNT_UNIQUE",
    "MIN", "MAX", "ROUND",
    "FETCH_ITEMS_WHERE", "FETCH_KPI_ITEMS_WHERE",
    "WHERE",
}


def validate_formula_syntax(expression: str) -> None:
    """Validates that a formula expression is syntactically valid and parses with AST."""
    if not expression or not expression.strip():
        raise FormulaValidationError("Formula expression cannot be empty.")

    try:
        ast.parse(expression)
    except SyntaxError as e:
        raise FormulaValidationError(f"Syntax error in formula: {e.msg} at line {e.lineno}, col {e.offset}")


def validate_formula_references(expression: str, available_fields: Dict[str, str]) -> set:
    """
    Verifies that all bare variable references in the formula exist in available_fields.

    Important: string literals passed as arguments (e.g. 'faculty_name' inside a function call)
    are NOT treated as missing field references — they are quoted strings, not variable names.
    Only bare unquoted Name nodes (e.g. `faculty_name + 5`) are checked.

    available_fields: mapping of field_key -> field_type.
    Returns set of referenced field keys.
    """
    deps = extract_formula_dependencies(expression)
    missing = [d for d in deps if d not in available_fields]
    if missing:
        raise FormulaValidationError(
            f"Reference error: Field(s) '{', '.join(missing)}' do not exist in the KPI/MLI definition. "
            f"If you meant to pass a column name as a filter argument, wrap it in quotes: '{missing[0]}'."
        )
    return deps


def _collect_arithmetic_names(tree: ast.AST) -> set:
    """
    Walk the AST and collect bare Name nodes that appear as direct operands
    in arithmetic BinOp expressions (+, -, *, /).
    Names that appear exclusively inside function Call arguments are excluded.
    """
    arithmetic_ops = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow)
    arithmetic_names: set = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp) and isinstance(node.op, arithmetic_ops):
            # Left operand
            if isinstance(node.left, ast.Name):
                arithmetic_names.add(node.left.id)
            # Right operand
            if isinstance(node.right, ast.Name):
                arithmetic_names.add(node.right.id)

    return arithmetic_names


def validate_formula_types(expression: str, available_fields: Dict[str, str]) -> None:
    """
    Validates that non-numeric columns (text, date, boolean, attachment) are NOT used
    as direct arithmetic operands (e.g. faculty_name + 5 is invalid).

    Columns of any type can freely be used:
    - As string arguments inside aggregation function calls (e.g. COUNT_ITEMS_WHERE('employees', 'faculty_name', op_eq, 'Science'))
    - Inside GROUP_BY, SUM_ITEMS, UNIQUE_COUNT, etc.
    - As filter columns or group-by fields

    Only bare arithmetic like `text_col + number` or `text_col * 2` is rejected.
    """
    NON_NUMERIC_TYPES = {"single_line_text", "multi_line_text", "date", "boolean", "attachment", "reference", "text"}

    try:
        tree = ast.parse(expression)
    except SyntaxError:
        return  # Syntax errors caught earlier in validate_formula_syntax

    # Find Names used directly in arithmetic binary operations
    arithmetic_names = _collect_arithmetic_names(tree)

    deps = extract_formula_dependencies(expression)
    for d in deps:
        if d not in arithmetic_names:
            # This name is only referenced inside function args / conditions — always allowed
            continue
        ftype = available_fields.get(d)
        if ftype in NON_NUMERIC_TYPES:
            raise FormulaValidationError(
                f"Type mismatch: Column '{d}' is of type '{ftype}' and cannot be used in arithmetic operations "
                f"(+, -, *, /). Use it inside COUNT_ITEMS_WHERE, GROUP_BY, or other aggregation functions instead."
            )

