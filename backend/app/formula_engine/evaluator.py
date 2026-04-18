"""
Secure formula evaluator.
Supports: +, -, *, /, SUM(), AVG(), COUNT(), field references; group functions on
multi_line_items: SUM_ITEMS(field_key, sub_key), AVG_ITEMS, COUNT_ITEMS, MIN_ITEMS, MAX_ITEMS;
conditional group functions: SUM_ITEMS_WHERE(...), COUNT_ITEMS_WHERE(field_key, filter_sub_key, op_xx, value, [op_and/op_or, ...]), etc.;
and cross-KPI refs: KPI_FIELD(kpi_id, "field_key") for numeric fields from the same user's entry for another KPI (same org, same year).
"""

import re
from typing import Any

try:
    from simpleeval import SimpleEval, NameNotDefined
except ImportError:
    SimpleEval = None  # type: ignore
    NameNotDefined = Exception  # type: ignore

# Optional: multi_line_items field_key -> list of row dicts (sub_key -> value)
MultiLineItemsData = dict[str, list[dict[str, Any]]]

# Optional: (kpi_id, field_key) -> numeric value for KPI_FIELD(kpi_id, field_key) cross-KPI refs
OtherKpiValues = dict[tuple[int, str], float]


class _SafeNames(dict):
    """Namespace that returns 0 for missing keys or None values, so formula refs to empty fields don't fail."""

    def __getitem__(self, key: str) -> Any:
        try:
            v = super().__getitem__(key)
            if v is None:
                return 0
            return v
        except KeyError:
            return 0


def _to_num(x: Any) -> float | None:
    """Coerce value to number for aggregation; return None if not numeric."""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    if isinstance(x, str):
        try:
            return float(x.strip())
        except ValueError:
            return None
    return None


def _items_values(data: MultiLineItemsData, field_key: str, sub_key: str) -> list[float]:
    """Get list of numeric values for a sub_key across rows of a multi_line_items field."""
    rows = data.get(field_key) if isinstance(data, dict) else []
    if not isinstance(rows, list):
        return []
    out: list[float] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        v = row.get(sub_key)
        n = _to_num(v)
        if n is not None:
            out.append(n)
    return out


def _row_matches(row: dict[str, Any], filter_sub_key: str, op: str, filter_value: Any) -> bool:
    """True if row[filter_sub_key] op filter_value.

    Supports both numeric and text comparisons:
    - Numeric: eq, neq, gt, gte, lt, lte (existing behavior)
    - Text: eq, neq, contains, not_contains, starts_with, ends_with
    """
    cell = row.get(filter_sub_key)
    # Treat None specially: only neq passes
    if cell is None:
        return op == "neq"

    # Try numeric comparison first
    n = _to_num(cell)
    fv_num = _to_num(filter_value)
    if n is not None and fv_num is not None and op in {"eq", "neq", "gt", "gte", "lt", "lte"}:
        if op == "eq":
            return n == fv_num
        if op == "neq":
            return n != fv_num
        if op == "gt":
            return n > fv_num
        if op == "gte":
            return n >= fv_num
        if op == "lt":
            return n < fv_num
        if op == "lte":
            return n <= fv_num
        return False

    # Fallback to string comparison for text operators.
    # For reference-like cells, data may be saved as an object (id/label/value),
    # while formulas usually use display text; compare across common textual forms.
    cell_candidates: list[str] = []
    if isinstance(cell, dict):
        for k in ("label", "text", "name", "value", "id"):
            if k in cell and cell[k] is not None:
                cell_candidates.append(str(cell[k]).strip())
    elif isinstance(cell, (list, tuple, set)):
        for v in cell:
            if v is not None:
                cell_candidates.append(str(v).strip())
    else:
        cell_candidates.append(str(cell).strip())
    fv_str = str(filter_value).strip()

    def _match_text(cell_str: str) -> bool:
        if op == "eq":
            return cell_str == fv_str
        if op == "neq":
            return cell_str != fv_str
        if op == "contains":
            return fv_str in cell_str
        if op == "not_contains":
            return fv_str not in cell_str
        if op == "starts_with":
            return cell_str.startswith(fv_str)
        if op == "ends_with":
            return cell_str.endswith(fv_str)
        return False

    if op == "eq":
        return any(_match_text(c) for c in cell_candidates)
    if op == "neq":
        return all(_match_text(c) for c in cell_candidates)
    if op == "contains":
        return any(_match_text(c) for c in cell_candidates)
    if op == "not_contains":
        return all(_match_text(c) for c in cell_candidates)
    if op == "starts_with":
        return any(_match_text(c) for c in cell_candidates)
    if op == "ends_with":
        return any(_match_text(c) for c in cell_candidates)
    return False


def match_cell_value(cell: Any, op: str, filter_value: Any) -> bool:
    """Compare a stored cell value to filter_value using the same rules as formula WHERE clauses."""
    op_norm = str(op).strip().lower()
    if op_norm.startswith("op_"):
        op_norm = op_norm[3:]
    return _row_matches({"__cell": cell}, "__cell", op_norm, filter_value)


def _items_values_where(
    data: MultiLineItemsData,
    field_key: str,
    value_sub_key: str,
    filter_sub_key: str,
    op: str,
    filter_value: Any,
) -> list[float]:
    """Get numeric values for value_sub_key over rows where filter_sub_key op filter_value."""
    rows = data.get(field_key) if isinstance(data, dict) else []
    if not isinstance(rows, list):
        return []
    out: list[float] = []
    for row in rows:
        if not isinstance(row, dict) or not _row_matches(row, filter_sub_key, op, filter_value):
            continue
        v = row.get(value_sub_key)
        n = _to_num(v)
        if n is not None:
            out.append(n)
    return out


def _rows_where(
    data: MultiLineItemsData,
    field_key: str,
    filter_sub_key: str,
    op: str,
    filter_value: Any,
) -> list[dict[str, Any]]:
    """Get rows where filter_sub_key op filter_value."""
    rows = data.get(field_key) if isinstance(data, dict) else []
    if not isinstance(rows, list):
        return []
    return [r for r in rows if isinstance(r, dict) and _row_matches(r, filter_sub_key, op, filter_value)]


def _row_matches_conditions(row: dict[str, Any], conditions: list[tuple[str, str, Any]], links: list[str]) -> bool:
    """Evaluate multiple conditions with logical links (and/or), left-to-right."""
    if not conditions:
        return False
    result = _row_matches(row, conditions[0][0], conditions[0][1], conditions[0][2])
    for i in range(1, len(conditions)):
        next_res = _row_matches(row, conditions[i][0], conditions[i][1], conditions[i][2])
        link = links[i - 1] if i - 1 < len(links) else "and"
        if link == "or":
            result = result or next_res
        else:
            result = result and next_res
    return result


def _parse_where_args(args: tuple[Any, ...], start_idx: int) -> tuple[list[tuple[str, str, Any]], list[str]]:
    """
    Parse WHERE arguments into:
      conditions: [(filter_sub_key, op, value), ...]
      links: ["and"|"or", ...] linking condition i to i+1

    Supported shape:
      <cond1_filter_sub_key>, <cond1_op>, <cond1_value>,
      [<logic>, <condN_filter_sub_key>, <condN_op>, <condN_value>]*
    """
    conditions: list[tuple[str, str, Any]] = []
    links: list[str] = []

    if len(args) < start_idx + 3:
        return conditions, links

    i = start_idx
    conditions.append((str(args[i]), str(args[i + 1]), args[i + 2]))
    i += 3

    while i + 3 < len(args):
        logic = str(args[i]).strip().lower()
        if logic.startswith("op_"):
            logic = logic.replace("op_", "", 1)
        if logic not in ("and", "or"):
            break
        links.append(logic)
        conditions.append((str(args[i + 1]), str(args[i + 2]), args[i + 3]))
        i += 4

    return conditions, links


def _rows_where_multi(
    data: MultiLineItemsData,
    field_key: str,
    args: tuple[Any, ...],
    start_idx: int,
) -> list[dict[str, Any]]:
    """Get rows matching one or more WHERE conditions (with and/or links)."""
    rows = data.get(field_key) if isinstance(data, dict) else []
    if not isinstance(rows, list):
        return []
    conditions, links = _parse_where_args(args, start_idx)
    if not conditions:
        return []
    return [
        r
        for r in rows
        if isinstance(r, dict) and _row_matches_conditions(r, conditions, links)
    ]


def _items_values_where_multi(
    data: MultiLineItemsData,
    field_key: str,
    value_sub_key: str,
    args: tuple[Any, ...],
    start_idx: int,
) -> list[float]:
    """Get numeric values for value_sub_key over rows matching multi-condition WHERE."""
    matched = _rows_where_multi(data, field_key, args, start_idx)
    out: list[float] = []
    for row in matched:
        v = row.get(value_sub_key)
        n = _to_num(v)
        if n is not None:
            out.append(n)
    return out


def _make_evaluator(
    field_values: dict[str, float | int],
    multi_line_items_data: MultiLineItemsData | None = None,
    other_kpi_values: OtherKpiValues | None = None,
) -> "SimpleEval":
    """Build SimpleEval with field values, optional multi_line_items data, and optional other-KPI refs."""
    if SimpleEval is None:
        raise RuntimeError("simpleeval is required for formula evaluation. pip install simpleeval")
    s = SimpleEval()
    s.operators = {**s.operators}
    # Missing or None field values -> 0 so formulas don't fail when a referenced field has no value
    s.names = _SafeNames(dict(field_values))
    ref_values = other_kpi_values or {}
    items_data = multi_line_items_data or {}
    # So SUM_ITEMS(field_key, sub_key) works: inject field keys and sub_keys as string names
    for field_key in items_data:
        s.names[field_key] = field_key
    sub_keys: set[str] = set()
    for rows in items_data.values():
        for row in rows if isinstance(rows, list) else []:
            if isinstance(row, dict):
                sub_keys.update(row.keys())
    for sk in sub_keys:
        if sk not in s.names:  # do not overwrite number field with same key
            s.names[sk] = sk
    # Operator names for conditional group functions: SUM_ITEMS_WHERE(field, val_sk, filter_sk, op_eq, 2023)
    for op_name in (
        "op_eq",
        "op_neq",
        "op_gt",
        "op_gte",
        "op_lt",
        "op_lte",
        "op_contains",
        "op_not_contains",
        "op_starts_with",
        "op_ends_with",
        "op_and",
        "op_or",
    ):
        s.names[op_name] = op_name.replace("op_", "")

    def sum_items(field_key: str, sub_key: str) -> float:
        return sum(_items_values(items_data, field_key, sub_key))

    def avg_items(field_key: str, sub_key: str) -> float:
        vals = _items_values(items_data, field_key, sub_key)
        return sum(vals) / len(vals) if vals else 0.0

    def count_items(*args: Any) -> float:
        """
        COUNT_ITEMS supports two forms:
        - COUNT_ITEMS(field_key) or COUNT_ITEMS(field_key, sub_key): count rows (or rows with non-null sub_key)
        - COUNT_ITEMS(field_key, filter_sub_key, op_xx, value): alias for COUNT_ITEMS_WHERE(...)
          (kept for backward/UX compatibility with older builders)
        """
        if not args:
            return 0.0
        field_key = str(args[0])
        rows = items_data.get(field_key) if isinstance(items_data, dict) else []
        if not isinstance(rows, list):
            return 0.0
        # Alias: COUNT_ITEMS(field, filter_sub_key, op, value[, op_and/op_or, filter_sub_key, op, value]...)
        if len(args) >= 4:
            # Multi-condition path activates when first operator looks like a comparison op.
            first_op = str(args[2]).strip().lower()
            if first_op.startswith("op_"):
                first_op = first_op.replace("op_", "", 1)
            if first_op in {"eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with"}:
                return float(len(_rows_where_multi(items_data, field_key, args, 1)))
        # Standard forms
        sub_key = str(args[1]) if len(args) >= 2 and args[1] is not None else ""
        if sub_key == "":
            return float(len(rows))
        return float(len([r for r in rows if isinstance(r, dict) and r.get(sub_key) is not None]))

    def min_items(field_key: str, sub_key: str) -> float:
        vals = _items_values(items_data, field_key, sub_key)
        return min(vals) if vals else 0.0

    def max_items(field_key: str, sub_key: str) -> float:
        vals = _items_values(items_data, field_key, sub_key)
        return max(vals) if vals else 0.0

    def sum_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> float:
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return sum(vals)

    def avg_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> float:
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return sum(vals) / len(vals) if vals else 0.0

    def count_items_where(field_key: str, *where_args: Any) -> float:
        return float(len(_rows_where_multi(items_data, field_key, where_args, 0)))

    def min_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> float:
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return min(vals) if vals else 0.0

    def max_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> float:
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return max(vals) if vals else 0.0

    def kpi_field(kpi_id: int, field_key: str) -> float:
        """Return numeric value of a field from another KPI (same user, same year, same org). Missing => 0."""
        return ref_values.get((kpi_id, field_key), 0.0)

    def _safe_sum(*a: Any) -> float:
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return sum(nums)

    def _safe_avg(*a: Any) -> float:
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return sum(nums) / len(nums) if nums else 0.0

    def _safe_min(*a: Any) -> float:
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return min(nums) if nums else 0.0

    def _safe_max(*a: Any) -> float:
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return max(nums) if nums else 0.0

    s.functions = {
        "SUM": _safe_sum,
        "AVG": _safe_avg,
        "COUNT": lambda *a: len([x for x in a if x is not None]),
        "MIN": _safe_min,
        "MAX": _safe_max,
        "ROUND": round,
        "SUM_ITEMS": sum_items,
        "AVG_ITEMS": avg_items,
        "COUNT_ITEMS": count_items,
        "MIN_ITEMS": min_items,
        "MAX_ITEMS": max_items,
        "SUM_ITEMS_WHERE": sum_items_where,
        "AVG_ITEMS_WHERE": avg_items_where,
        "COUNT_ITEMS_WHERE": count_items_where,
        "MIN_ITEMS_WHERE": min_items_where,
        "MAX_ITEMS_WHERE": max_items_where,
        "KPI_FIELD": kpi_field,
    }
    return s


def evaluate_formula(
    expression: str,
    field_values: dict[str, float | int],
    multi_line_items_data: MultiLineItemsData | None = None,
    other_kpi_values: OtherKpiValues | None = None,
) -> float | int | None:
    """
    Safely evaluate a formula string.
    field_values: map of field key -> numeric value (number fields and formula results).
    multi_line_items_data: optional map of multi_line_items field key -> list of row dicts.
    other_kpi_values: optional (kpi_id, field_key) -> value for KPI_FIELD(kpi_id, "field_key") cross-KPI refs.
    Returns computed value or None on error.
    """
    if not expression or not expression.strip():
        return None
    expression = expression.strip()
    # Allow alphanumeric, spaces, safe symbols (and quotes for string literals if needed)
    # Allow ampersand in string literals (e.g. "Faculty of Architecture & Planning")
    if not re.match(r"^[\w\s+\-*/().,\"\'&]+$", expression):
        return None
    try:
        ev = _make_evaluator(field_values, multi_line_items_data, other_kpi_values)
        result = ev.eval(expression)
        if result is None:
            return None
        if isinstance(result, (int, float)):
            return result
        return None
    except (NameNotDefined, ZeroDivisionError, TypeError, KeyError):
        return None
