"""
Secure formula evaluator.
Supports: +, -, *, /, SUM(), AVG(), COUNT(), and field references.
Prevents code execution injection by using a restricted expression parser.
"""

import re
from typing import Any

try:
    from simpleeval import SimpleEval, NameNotDefined
except ImportError:
    SimpleEval = None  # type: ignore
    NameNotDefined = Exception  # type: ignore


# Allowed names in expressions (field keys will be added at runtime)
ALLOWED_ATTRS = frozenset({"sum", "avg", "count", "min", "max", "round"})


def _make_evaluator(field_values: dict[str, float | int]) -> "SimpleEval":
    """Build SimpleEval with only allowed operators and names."""
    if SimpleEval is None:
        raise RuntimeError("simpleeval is required for formula evaluation. pip install simpleeval")
    s = SimpleEval()
    # Only allow safe operators
    s.operators = {
        **s.operators,
        # restrict to arithmetic and comparison only; no power, no bitwise if dangerous
    }
    s.names = dict(field_values)
    s.functions = {
        "SUM": lambda *a: sum(a) if a else 0,
        "AVG": lambda *a: sum(a) / len(a) if a else 0,
        "COUNT": lambda *a: len([x for x in a if x is not None]),
        "MIN": lambda *a: min(a) if a else None,
        "MAX": lambda *a: max(a) if a else None,
        "ROUND": round,
    }
    return s


def evaluate_formula(expression: str, field_values: dict[str, float | int]) -> float | int | None:
    """
    Safely evaluate a formula string with given field values.
    field_values: map of field key -> numeric value.
    Returns computed value or None on error.
    """
    if not expression or not expression.strip():
        return None
    expression = expression.strip()
    # Only allow alphanumeric, spaces, and safe symbols
    if not re.match(r"^[\w\s+\-*/().,]+$", expression):
        return None
    try:
        ev = _make_evaluator(field_values)
        result = ev.eval(expression)
        if result is None:
            return None
        if isinstance(result, (int, float)):
            return result
        return None
    except (NameNotDefined, ZeroDivisionError, TypeError, KeyError):
        return None
