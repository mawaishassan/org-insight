"""Multi-line item row filtering: legacy substring map or structured v2 conditions (AND/OR)."""

from __future__ import annotations

from typing import Any

from app.formula_engine.evaluator import match_cell_value


def normalize_filter_op(op: Any) -> str:
    s = str(op).strip().lower()
    if s.startswith("op_"):
        return s[3:]
    return s


def eval_v2_condition_row(row: dict[str, Any], cond: dict[str, Any]) -> bool:
    fk = cond.get("field")
    if not fk:
        return True
    op = normalize_filter_op(cond.get("op", "eq"))
    cell = row.get(str(fk))
    vals_raw = cond.get("values")
    if isinstance(vals_raw, list) and len(vals_raw) > 1:
        if op == "eq":
            return any(match_cell_value(cell, "eq", v) for v in vals_raw)
        if op == "neq":
            return all(match_cell_value(cell, "neq", v) for v in vals_raw)
        return match_cell_value(cell, op, vals_raw[0])
    return match_cell_value(cell, op, cond.get("value"))


def eval_v2_conditions(row: dict[str, Any], conditions: list[Any]) -> bool:
    if not conditions:
        return True
    first_c = conditions[0]
    if not isinstance(first_c, dict):
        return True
    result = eval_v2_condition_row(row, first_c)
    for i in range(1, len(conditions)):
        cond = conditions[i]
        if not isinstance(cond, dict):
            continue
        link = str(cond.get("logic", "and")).strip().lower()
        nxt = eval_v2_condition_row(row, cond)
        if link == "or":
            result = result or nxt
        else:
            result = result and nxt
    return result


def legacy_row_matches(row: dict[str, Any], raw_filters: dict[str, Any]) -> bool:
    """Case-insensitive substring AND across columns (original API behavior)."""
    for fk, fv in raw_filters.items():
        if str(fk).startswith("_"):
            continue
        if fv is None or fv == "":
            continue
        cell = row.get(fk)
        if cell is None:
            return False
        if str(fv).strip().lower() not in str(cell).lower():
            return False
    return True


def row_passes_filters(row: dict[str, Any], raw_filters: dict[str, Any]) -> bool:
    if raw_filters.get("_version") == 2:
        conds = raw_filters.get("conditions")
        if not isinstance(conds, list):
            return True
        return eval_v2_conditions(row, conds)
    return legacy_row_matches(row, raw_filters)
