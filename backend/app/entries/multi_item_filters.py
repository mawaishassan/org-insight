"""Multi-line item row filtering: legacy substring map or structured v2 conditions (AND/OR)."""

from __future__ import annotations

import json
from typing import Any

from app.formula_engine.evaluator import match_cell_value
from app.entries.service import _normalize_reference_value


def normalize_filter_op(op: Any) -> str:
    s = str(op).strip().lower()
    if s.startswith("op_"):
        return s[3:]
    return s


def _multi_reference_cell_parts(cell: Any) -> list[str]:
    if cell is None:
        return []
    if isinstance(cell, list):
        return [str(x) for x in cell if x is not None and str(x).strip() != ""]
    s = str(cell).strip()
    if not s:
        return []
    if s.startswith("["):
        try:
            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x) for x in parsed if x is not None]
        except (json.JSONDecodeError, TypeError):
            pass
    if ";" in s:
        return [p.strip() for p in s.split(";") if p.strip()]
    if "," in s:
        return [p.strip() for p in s.split(",") if p.strip()]
    return [s]


def eval_v2_condition_row(
    row: dict[str, Any],
    cond: dict[str, Any],
    *,
    cond_idx: int = 0,
    resolution_maps: dict[tuple[int, str], Any] | None = None,
    reference_field_types: dict[str, str] | None = None,
) -> bool:
    fk = cond.get("field")
    if not fk:
        return True
    fk_s = str(fk)
    op = normalize_filter_op(cond.get("op", "eq"))
    cell = row.get(fk_s)
    rr = cond.get("reference_resolution")
    ft = (reference_field_types or {}).get(fk_s, "")

    if isinstance(rr, dict) and resolution_maps is not None:
        cmp_vals = lambda resolved: _eval_compare_ops(resolved, op, cond)

        if ft == "multi_reference":
            parts = _multi_reference_cell_parts(cell)
            if not parts:
                return cmp_vals(None)
            results = []
            for p in parts:
                lab = _normalize_reference_value(p)
                resolved = resolution_maps.get((cond_idx, lab))
                results.append(cmp_vals(resolved))
            return any(results) if results else cmp_vals(None)

        lab = _normalize_reference_value(str(cell) if cell is not None else "")
        resolved = resolution_maps.get((cond_idx, lab))
        return cmp_vals(resolved)

    vals_raw = cond.get("values")
    if isinstance(vals_raw, list) and len(vals_raw) > 1:
        if op == "eq":
            return any(match_cell_value(cell, "eq", v) for v in vals_raw)
        if op == "neq":
            return all(match_cell_value(cell, "neq", v) for v in vals_raw)
        return match_cell_value(cell, op, vals_raw[0])
    return match_cell_value(cell, op, cond.get("value"))


def _eval_compare_ops(resolved: Any, op: str, cond: dict[str, Any]) -> bool:
    vals_raw = cond.get("values")
    if isinstance(vals_raw, list) and len(vals_raw) > 1:
        if op == "eq":
            return any(match_cell_value(resolved, "eq", v) for v in vals_raw)
        if op == "neq":
            return all(match_cell_value(resolved, "neq", v) for v in vals_raw)
        return match_cell_value(resolved, op, vals_raw[0])
    return match_cell_value(resolved, op, cond.get("value"))


def eval_v2_conditions(
    row: dict[str, Any],
    conditions: list[Any],
    *,
    resolution_maps: dict[tuple[int, str], Any] | None = None,
    reference_field_types: dict[str, str] | None = None,
) -> bool:
    if not conditions:
        return True
    first_c = conditions[0]
    if not isinstance(first_c, dict):
        return True
    result = eval_v2_condition_row(
        row, first_c, cond_idx=0, resolution_maps=resolution_maps, reference_field_types=reference_field_types
    )
    for i in range(1, len(conditions)):
        cond = conditions[i]
        if not isinstance(cond, dict):
            continue
        link = str(cond.get("logic", "and")).strip().lower()
        nxt = eval_v2_condition_row(
            row,
            cond,
            cond_idx=i,
            resolution_maps=resolution_maps,
            reference_field_types=reference_field_types,
        )
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


def row_passes_filters(
    row: dict[str, Any],
    raw_filters: dict[str, Any],
    *,
    resolution_maps: dict[tuple[int, str], Any] | None = None,
    reference_field_types: dict[str, str] | None = None,
) -> bool:
    if raw_filters.get("_version") == 2:
        conds = raw_filters.get("conditions")
        if not isinstance(conds, list):
            return True
        return eval_v2_conditions(
            row,
            conds,
            resolution_maps=resolution_maps,
            reference_field_types=reference_field_types,
        )
    return legacy_row_matches(row, raw_filters)
