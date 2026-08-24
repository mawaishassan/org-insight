"""
Secure formula evaluator.
Supports: +, -, *, /, SUM(), AVG(), COUNT(), field references; group functions on
multi_line_items: SUM_ITEMS(field_key, sub_key), AVG_ITEMS, COUNT_ITEMS, MIN_ITEMS, MAX_ITEMS;
conditional group functions: SUM_ITEMS_WHERE(...), COUNT_ITEMS_WHERE(field_key, filter_sub_key, op_xx, value, [op_and/op_or, ...]), etc.;
and cross-KPI refs: KPI_FIELD(kpi_id, "field_key") for numeric fields from the same user's entry for another KPI (same org, same year).
"""

import ast
import datetime
import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

try:
    from simpleeval import SimpleEval, NameNotDefined
except ImportError:
    SimpleEval = None  # type: ignore
    NameNotDefined = Exception  # type: ignore

# Optional: multi_line_items field_key -> list of row dicts (sub_key -> value)
MultiLineItemsData = dict[str, list[dict[str, Any]]]

# Optional: (kpi_id, field_key) -> numeric value for KPI_FIELD(kpi_id, field_key) cross-KPI refs
OtherKpiValues = dict[tuple[int, str], float]

_AST_CACHE: dict[str, Any] = {}


def _clean_num(val: Any) -> Any:
    if isinstance(val, float) and val.is_integer():
        return int(val)
    return val


class AggSpec:
    """Represents a leaf aggregation operation in a Group By hierarchy."""

    def __init__(self, func: str, field: str | None = None, conditions: list | None = None):
        self.func = func.upper()
        self.field = str(field) if field is not None else None
        self.conditions = conditions or []

    def to_dict(self) -> dict:
        res = {"type": "aggregation", "func": self.func}
        if self.field:
            res["field"] = self.field
        if self.conditions:
            res["conditions"] = self.conditions
        return res

    def evaluate(self, rows: list[dict[str, Any]], current_row: dict[str, Any] | None = None) -> float:
        if self.conditions:
            conds, links = _parse_where_args(tuple(self.conditions), 0)
            if conds:
                rows = [r for r in rows if isinstance(r, dict) and _row_matches_conditions(r, conds, links)]

        if self.func == "COUNT":
            if not self.field:
                return len(rows)
            cnt = 0
            for r in rows:
                if not isinstance(r, dict):
                    continue
                v = r.get(self.field)
                if v is not None and v != "":
                    cnt += 1
            return cnt

        elif self.func in ("UNIQUE_COUNT", "COUNT_DISTINCT", "COUNT_UNIQUE"):
            if not self.field:
                return len(rows)
            seen = set()
            for r in rows:
                if not isinstance(r, dict):
                    continue
                v = r.get(self.field)
                if v is not None and v != "":
                    if isinstance(v, dict):
                        v_norm = str(v.get("value") or v.get("id") or v.get("label") or str(v)).strip()
                    else:
                        v_norm = str(v).strip()
                    if v_norm != "":
                        seen.add(v_norm)
            return len(seen)

        elif self.func == "SUM":
            if not self.field:
                return 0
            total = 0.0
            for r in rows:
                if isinstance(r, dict):
                    n = _to_num(r.get(self.field))
                    if n is not None:
                        total += n
            return int(total) if total.is_integer() else total

        elif self.func in ("AVG", "AVERAGE"):
            if not self.field:
                return 0
            nums = []
            for r in rows:
                if isinstance(r, dict):
                    n = _to_num(r.get(self.field))
                    if n is not None:
                        nums.append(n)
            res = sum(nums) / len(nums) if nums else 0
            return int(res) if res.is_integer() else res

        elif self.func == "MIN":
            if not self.field:
                return 0
            nums = []
            for r in rows:
                if isinstance(r, dict):
                    n = _to_num(r.get(self.field))
                    if n is not None:
                        nums.append(n)
            res = min(nums) if nums else 0
            return int(res) if res.is_integer() else res

        elif self.func == "MAX":
            if not self.field:
                return 0
            nums = []
            for r in rows:
                if isinstance(r, dict):
                    n = _to_num(r.get(self.field))
                    if n is not None:
                        nums.append(n)
            res = max(nums) if nums else 0
            return int(res) if res.is_integer() else res

        return 0


class GroupNode:
    """Represents a grouping level in a Group By hierarchy."""

    def __init__(self, field: str, child: Any, conditions: list | None = None):
        self.field = str(field)
        self.child = child
        self.conditions = conditions or []

    def to_dict(self) -> dict:
        return {
            "type": "group_by",
            "field": self.field,
            "conditions": self.conditions,
            "child": self.child.to_dict() if hasattr(self.child, "to_dict") else self.child,
        }

    def collect_group_fields(self) -> list[str]:
        fields = [self.field]
        curr = self.child
        while isinstance(curr, GroupNode):
            fields.append(curr.field)
            curr = curr.child
        return fields

    def get_leaf_agg(self) -> AggSpec | None:
        curr = self
        while isinstance(curr, GroupNode):
            curr = curr.child
        if isinstance(curr, AggSpec):
            return curr
        return None

    def evaluate(
        self,
        rows: list[dict[str, Any]],
        current_row: dict[str, Any] | None = None,
    ) -> float:
        group_fields = self.collect_group_fields()
        leaf_agg = self.get_leaf_agg()
        if not leaf_agg:
            return 0.0

        filtered_rows = rows
        curr = self
        while isinstance(curr, GroupNode):
            if curr.conditions:
                resolved_args = []
                for c in curr.conditions:
                    if isinstance(c, tuple) and len(c) == 3:
                        fk, op, fval = c
                        if isinstance(fval, str) and fval.startswith("CurrentRow."):
                            ref_k = fval.split(".", 1)[1]
                            fval = _get_current_row_val(current_row, ref_k)
                        resolved_args.extend([fk, op, fval])
                    elif isinstance(c, str) and c.startswith("CurrentRow."):
                        ref_k = c.split(".", 1)[1]
                        resolved_args.append(_get_current_row_val(current_row, ref_k))
                    else:
                        resolved_args.append(c)
                conds, links = _parse_where_args(tuple(resolved_args), 0)
                if conds:
                    filtered_rows = [r for r in filtered_rows if isinstance(r, dict) and _row_matches_conditions(r, conds, links)]
            curr = curr.child

        if current_row:
            matched_group_rows = []
            for r in filtered_rows:
                if not isinstance(r, dict):
                    continue
                match = True
                for g_field in group_fields:
                    v_cur = _get_current_row_val(current_row, g_field)
                    if v_cur is None:
                        # Field is not present in current_row (e.g. inner level field not in summary row), skip matching
                        continue
                    v_row = r.get(g_field)
                    if isinstance(v_row, dict):
                        s_row = str(v_row.get("value") or v_row.get("id") or v_row.get("label") or str(v_row)).strip()
                    else:
                        s_row = str(v_row).strip() if v_row is not None else ""

                    if isinstance(v_cur, dict):
                        s_cur = str(v_cur.get("value") or v_cur.get("id") or v_cur.get("label") or str(v_cur)).strip()
                    else:
                        s_cur = str(v_cur).strip()

                    if s_row != s_cur:
                        match = False
                        break
                if match:
                    matched_group_rows.append(r)
            return leaf_agg.evaluate(matched_group_rows)
        else:
            return leaf_agg.evaluate(filtered_rows)

    def __add__(self, other):
        return _GroupNodeOp("+", self, other)

    def __radd__(self, other):
        return _GroupNodeOp("+", other, self)

    def __sub__(self, other):
        return _GroupNodeOp("-", self, other)

    def __rsub__(self, other):
        return _GroupNodeOp("-", other, self)

    def __mul__(self, other):
        return _GroupNodeOp("*", self, other)

    def __rmul__(self, other):
        return _GroupNodeOp("*", other, self)

    def __truediv__(self, other):
        return _GroupNodeOp("/", self, other)

    def __rtruediv__(self, other):
        return _GroupNodeOp("/", other, self)


class _GroupNodeOp:
    def __init__(self, op: str, left: Any, right: Any):
        self.op = op
        self.left = left
        self.right = right

    def evaluate(self, rows: list[dict[str, Any]], current_row: dict[str, Any] | None = None) -> float:
        v_left = self.left.evaluate(rows, current_row) if hasattr(self.left, "evaluate") else float(self.left)
        v_right = self.right.evaluate(rows, current_row) if hasattr(self.right, "evaluate") else float(self.right)
        if self.op == "+":
            return v_left + v_right
        elif self.op == "-":
            return v_left - v_right
        elif self.op == "*":
            return v_left * v_right
        elif self.op == "/":
            return v_left / v_right if v_right != 0 else 0.0
        return 0.0

    def __add__(self, other):
        return _GroupNodeOp("+", self, other)

    def __radd__(self, other):
        return _GroupNodeOp("+", other, self)

    def __sub__(self, other):
        return _GroupNodeOp("-", self, other)

    def __rsub__(self, other):
        return _GroupNodeOp("-", other, self)

    def __mul__(self, other):
        return _GroupNodeOp("*", self, other)

    def __rmul__(self, other):
        return _GroupNodeOp("*", other, self)

    def __truediv__(self, other):
        return _GroupNodeOp("/", self, other)

    def __rtruediv__(self, other):
        return _GroupNodeOp("/", other, self)


def ast_from_dict(d: Any) -> GroupNode | AggSpec | None:
    if not isinstance(d, dict):
        return None
    t = d.get("type")
    if t == "aggregation":
        return AggSpec(func=d.get("func", "COUNT"), field=d.get("field"), conditions=d.get("conditions"))
    elif t == "group_by":
        child = ast_from_dict(d.get("child"))
        return GroupNode(field=d.get("field", ""), child=child, conditions=d.get("conditions"))
    return None


def serialize_group_by_ast(ast: Any) -> str:
    """Serialize a GroupNode or AggSpec or dict into standard nested GROUP_BY string expression."""
    if isinstance(ast, dict):
        ast = ast_from_dict(ast)
    if isinstance(ast, AggSpec):
        if ast.field:
            if ast.conditions:
                cond_str = ", ".join(str(c) for c in ast.conditions)
                return f"{ast.func}({ast.field}, {cond_str})"
            return f"{ast.func}({ast.field})"
        return f"{ast.func}()"
    elif isinstance(ast, GroupNode):
        child_str = serialize_group_by_ast(ast.child)
        if ast.conditions:
            cond_str = ", ".join(str(c) for c in ast.conditions)
            return f"GROUP_BY({ast.field}, {cond_str}, {child_str})"
        return f"GROUP_BY({ast.field}, {child_str})"
    return str(ast or "")


def _parse_single_agg(s: str) -> AggSpec | None:
    s = s.strip()
    m = re.match(r"^([A-Z_]+)\((.*)\)$", s, re.IGNORECASE)
    if not m:
        return None
    func = m.group(1).upper()
    args_str = m.group(2).strip()
    if not args_str:
        return AggSpec(func=func)
    parts = [p.strip() for p in args_str.split(",") if p.strip()]
    field = parts[0] if parts else None
    conds = parts[1:] if len(parts) > 1 else []
    return AggSpec(func=func, field=field, conditions=conds)


def _parse_group_part_contents(inner: str) -> tuple[str, list[Any]]:
    if " WHERE " in inner.upper():
        field_part, where_part = re.split(r"\s+WHERE\s+", inner, flags=re.IGNORECASE, maxsplit=1)
        field = field_part.strip()
        # Parse filter condition e.g. Campus = "Lahore"
        if "=" in where_part:
            k, v = where_part.split("=", 1)
            return field, [k.strip(), "op_eq", v.strip().strip('"\'')]
        return field, [where_part.strip()]
    elif "=" in inner:
        k, v = inner.split("=", 1)
        return k.strip(), [k.strip(), "op_eq", v.strip().strip('"\'')]
    parts = [p.strip() for p in inner.split(",") if p.strip()]
    return parts[0], parts[1:]


def parse_group_by_ast(expr_or_dict: Any) -> GroupNode | AggSpec | None:
    """Parse string expression (arrow syntax '->' or nested syntax 'GROUP_BY(...)') or dict into GroupNode tree."""
    if isinstance(expr_or_dict, dict):
        return ast_from_dict(expr_or_dict)
    if not isinstance(expr_or_dict, str) or not expr_or_dict.strip():
        return None
    s = expr_or_dict.strip()

    if "->" in s:
        parts = [p.strip() for p in s.split("->") if p.strip()]
        if not parts:
            return None
        leaf_part = parts[-1]
        agg_node = _parse_single_agg(leaf_part)
        if not agg_node:
            agg_node = AggSpec("COUNT")

        curr_child = agg_node
        for g_part in reversed(parts[:-1]):
            m = re.match(r"^GROUP_BY\((.*?)\)$", g_part, re.IGNORECASE)
            if m:
                inner = m.group(1).strip()
                field, conds = _parse_group_part_contents(inner)
                curr_child = GroupNode(field=field, child=curr_child, conditions=conds)
        return curr_child

    try:
        ev = _make_evaluator({})
        res = ev.eval(s)
        if isinstance(res, (GroupNode, AggSpec, _GroupNodeOp)):
            return res
    except Exception:
        pass
    return None



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


def _to_date(x: Any) -> datetime.date | None:
    """Coerce value to date for date comparison; return None if not a valid date/datetime."""
    if x is None:
        return None
    if isinstance(x, datetime.date):
        if isinstance(x, datetime.datetime):
            return x.date()
        return x
    if isinstance(x, str):
        s = x.strip()
        if len(s) >= 10:
            try:
                return datetime.date.fromisoformat(s[:10])
            except ValueError:
                pass
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%Y/%m/%d"):
                try:
                    return datetime.datetime.strptime(s, fmt).date()
                except ValueError:
                    continue
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


def _get_current_row_val(current_row: dict[str, Any] | None, key: str) -> Any:
    if not current_row or not isinstance(current_row, dict):
        return None
    if key in current_row:
        return current_row[key]
    lower_k = key.lower()
    for k, v in current_row.items():
        if k.lower() == lower_k:
            return v
    base_k = lower_k.replace("_id", "").replace("_name", "")
    for k, v in current_row.items():
        lk = k.lower().replace("_id", "").replace("_name", "")
        if lk == base_k:
            return v
    return None


def _row_matches(row: dict[str, Any], filter_sub_key: str, op: str, filter_value: Any) -> bool:
    """True if row[filter_sub_key] op filter_value.

    Supports both numeric and text comparisons:
    - Numeric: eq, neq, gt, gte, lt, lte (existing behavior)
    - Text: eq, neq, contains, not_contains, starts_with, ends_with
    """
    cell = row.get(filter_sub_key)
    if cell is None:
        # Fallback to key alias matching (e.g. department_id vs department_name)
        lower_sk = filter_sub_key.lower().replace("_id", "").replace("_name", "")
        for k, v in row.items():
            if k.lower().replace("_id", "").replace("_name", "") == lower_sk:
                cell = v
                break
    
    # Normalize operator (e.g. "op_eq" or "op_EQ" or "eq" -> "eq")
    op_norm = str(op).strip().lower()
    if op_norm.startswith("op_"):
        op_norm = op_norm[3:]

    # Treat None specially: only neq passes
    if cell is None:
        return op_norm == "neq"

    # If filter_value is a list/tuple/set, compare using membership (in/not in)
    if isinstance(filter_value, (list, tuple, set)):
        cell_val = cell
        if isinstance(cell, dict) and "value" in cell:
            cell_val = cell["value"]
        elif isinstance(cell, dict) and "id" in cell:
            cell_val = cell["id"]

        c_num = _to_num(cell_val)
        if c_num is not None:
            num_list = []
            for item in filter_value:
                it_val = item["value"] if isinstance(item, dict) and "value" in item else item
                it_num = _to_num(it_val)
                if it_num is not None:
                    num_list.append(it_num)
            if op_norm in ("eq", "contains"):
                return c_num in num_list
            if op_norm in ("neq", "not_contains"):
                return c_num not in num_list

        # Check date membership
        c_dt = _to_date(cell_val)
        if c_dt is not None:
            date_list = []
            for item in filter_value:
                it_val = item["value"] if isinstance(item, dict) and "value" in item else (item["label"] if isinstance(item, dict) and "label" in item else item)
                it_dt = _to_date(it_val)
                if it_dt is not None:
                    date_list.append(it_dt)
            if date_list:
                if op_norm in ("eq", "contains"):
                    return c_dt in date_list
                if op_norm in ("neq", "not_contains"):
                    return c_dt not in date_list

        c_str = str(cell_val).strip()
        str_list = []
        for item in filter_value:
            it_val = item["value"] if isinstance(item, dict) and "value" in item else (item["label"] if isinstance(item, dict) and "label" in item else item)
            if it_val is not None:
                str_list.append(str(it_val).strip())
        if op_norm in ("eq", "contains"):
            return c_str in str_list
        if op_norm in ("neq", "not_contains"):
            return c_str not in str_list
        return False

    # Try numeric comparison first
    n = _to_num(cell)
    fv_num = _to_num(filter_value)
    
    if n is not None and fv_num is not None and op_norm in {"eq", "neq", "gt", "gte", "lt", "lte"}:
        if op_norm == "eq":
            return n == fv_num
        if op_norm == "neq":
            return n != fv_num
        if op_norm == "gt":
            return n > fv_num
        if op_norm == "gte":
            return n >= fv_num
        if op_norm == "lt":
            return n < fv_num
        if op_norm == "lte":
            return n <= fv_num
        return False

    # Try date comparison
    c_date = _to_date(cell)
    fv_date = _to_date(filter_value)
    if c_date is not None and fv_date is not None and op_norm in {"eq", "neq", "gt", "gte", "lt", "lte"}:
        if op_norm == "eq":
            return c_date == fv_date
        if op_norm == "neq":
            return c_date != fv_date
        if op_norm == "gt":
            return c_date > fv_date
        if op_norm == "gte":
            return c_date >= fv_date
        if op_norm == "lt":
            return c_date < fv_date
        if op_norm == "lte":
            return c_date <= fv_date
        return False

    # Fallback to string comparison for text operators.
    cell_candidates: list[str] = []
    if isinstance(cell, dict):
        for k in ("label", "text", "name", "value", "id"):
            if k in cell and cell[k] is not None:
                cell_candidates.append(str(cell[k]).strip())
    elif isinstance(cell, (list, tuple, set)):
        for v in cell:
            if v is not None:
                cell_candidates.append(str(v).strip())
    elif cell is not None:
        cell_candidates.append(str(cell).strip())

    filter_candidates: list[str] = []
    if isinstance(filter_value, dict):
        for k in ("label", "text", "name", "value", "id"):
            if k in filter_value and filter_value[k] is not None:
                filter_candidates.append(str(filter_value[k]).strip())
    elif isinstance(filter_value, (list, tuple, set)):
        for v in filter_value:
            if v is not None:
                filter_candidates.append(str(v).strip())
    elif filter_value is not None:
        filter_candidates.append(str(filter_value).strip())

    def _match_text(cell_str: str) -> bool:
        if not filter_candidates:
            return False
        for fv in filter_candidates:
            c_low = cell_str.lower()
            f_low = fv.lower()
            if op_norm == "eq" and (cell_str == fv or c_low == f_low):
                return True
            if op_norm == "contains" and f_low in c_low:
                return True
            if op_norm == "starts_with" and c_low.startswith(f_low):
                return True
            if op_norm == "ends_with" and c_low.endswith(f_low):
                return True
        if op_norm == "neq":
            return all(cell_str != fv for fv in filter_candidates)
        if op_norm == "not_contains":
            return all(fv not in cell_str for fv in filter_candidates)
        return False

    if op_norm == "eq":
        return any(_match_text(c) for c in cell_candidates)
    if op_norm == "neq":
        return all(_match_text(c) for c in cell_candidates)
    if op_norm == "contains":
        return any(_match_text(c) for c in cell_candidates)
    if op_norm == "not_contains":
        return all(_match_text(c) for c in cell_candidates)
    if op_norm == "starts_with":
        return any(_match_text(c) for c in cell_candidates)
    if op_norm == "ends_with":
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


def _is_condition_tuple(val: Any) -> bool:
    if not isinstance(val, (list, tuple)):
        return False
    if len(val) < 3:
        return False
    op_candidates = {
        "eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with",
        "op_eq", "op_neq", "op_gt", "op_gte", "op_lt", "op_lte", "op_contains", "op_not_contains", "op_starts_with", "op_ends_with"
    }
    op_val = str(val[1]).strip().lower()
    if op_val in op_candidates:
        return True
    for item in val:
        if isinstance(item, str):
            item_lower = item.strip().lower()
            if item_lower in ("and", "or", "op_and", "op_or"):
                return True
    return False


def _row_matches_conditions(row: dict[str, Any], conditions: list[Any], links: list[str]) -> bool:
    """Evaluate multiple conditions with logical links (and/or), left-to-right."""
    if not conditions:
        return False

    def eval_cond(cond):
        if isinstance(cond, tuple) and len(cond) == 2 and isinstance(cond[0], list) and isinstance(cond[1], list):
            return _row_matches_conditions(row, cond[0], cond[1])
        else:
            return _row_matches(row, cond[0], cond[1], cond[2])

    result = eval_cond(conditions[0])
    for i in range(1, len(conditions)):
        next_res = eval_cond(conditions[i])
        link = links[i - 1] if i - 1 < len(links) else "and"
        if link == "or":
            result = result or next_res
        else:
            result = result and next_res
    return result


def _parse_where_args(args: tuple[Any, ...], start_idx: int) -> tuple[list[Any], list[str]]:
    """
    Parse WHERE arguments into:
      conditions: [cond1, ...] where cond can be (filter_sub_key, op, value) or (nested_conditions, nested_links)
      links: ["and"|"or", ...] linking condition i to i+1
    """
    conditions: list[Any] = []
    links: list[str] = []

    if len(args) < start_idx + 3:
        if len(args) == start_idx + 1 and isinstance(args[start_idx], (list, tuple)):
            nested_args = args[start_idx]
            if len(nested_args) >= 3:
                return _parse_where_args(tuple(nested_args), 0)
        return conditions, links

    i = start_idx
    first_arg = args[i]
    if _is_condition_tuple(first_arg):
        cond_val, links_val = _parse_where_args(tuple(first_arg), 0)
        conditions.append((cond_val, links_val))
        i += 1
    else:
        conditions.append((str(args[i]), str(args[i + 1]), args[i + 2]))
        i += 3

    while i < len(args):
        logic = str(args[i]).strip().lower()
        if logic.startswith("op_"):
            logic = logic.replace("op_", "", 1)
        if logic not in ("and", "or"):
            break
        links.append(logic)
        i += 1
        
        if i >= len(args):
            break
            
        next_arg = args[i]
        if _is_condition_tuple(next_arg):
            cond_val, links_val = _parse_where_args(tuple(next_arg), 0)
            conditions.append((cond_val, links_val))
            i += 1
        else:
            conditions.append((str(args[i]), str(args[i + 1]), args[i + 2]))
            i += 3

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


class CurrentRowWrapper:
    """Wrapper to allow dotted attribute access in SimpleEval for CurrentRow (e.g. CurrentRow.Gender)."""

    def __init__(self, data: dict[str, Any]):
        self._data = data

    def __getattr__(self, name: str) -> Any:
        val = _get_current_row_val(self._data, name)
        if val is None:
            return 0
        return val


def _make_evaluator(
    field_values: dict[str, float | int],
    multi_line_items_data: MultiLineItemsData | None = None,
    other_kpi_values: OtherKpiValues | None = None,
    current_row: dict[str, Any] | None = None,
    other_kpi_multi_line_data: dict[tuple[int, str], list[dict[str, Any]]] | None = None,
) -> "SimpleEval":
    """Build SimpleEval with field values, optional multi_line_items data, and optional other-KPI refs."""
    if SimpleEval is None:
        raise RuntimeError("simpleeval is required for formula evaluation. pip install simpleeval")
    s = SimpleEval()
    import ast
    def _eval_tuple(node):
        return tuple(s._eval(elt) for elt in node.elts)
    def _eval_list(node):
        return [s._eval(elt) for elt in node.elts]
    def _eval_compare(node):
        if isinstance(node.left, ast.Name) and len(node.ops) == 1:
            left_name = node.left.id
            op_node = node.ops[0]
            right_val = s._eval(node.comparators[0])
            op_map = {
                ast.Eq: "op_eq",
                ast.NotEq: "op_neq",
                ast.Gt: "op_gt",
                ast.GtE: "op_gte",
                ast.Lt: "op_lt",
                ast.LtE: "op_lte",
            }
            op_str = op_map.get(type(op_node))
            if op_str:
                return (left_name, op_str, right_val)
        left = s._eval(node.left)
        for op, comp in zip(node.ops, node.comparators):
            right = s._eval(comp)
            if isinstance(op, ast.Eq) and left != right:
                return False
            elif isinstance(op, ast.NotEq) and left == right:
                return False
            left = right
        return True

    s.nodes[ast.Tuple] = _eval_tuple
    s.nodes[ast.List] = _eval_list
    s.nodes[ast.Compare] = _eval_compare
    s.operators = {**s.operators}
    # Missing or None field values -> 0 so formulas don't fail when a referenced field has no value
    s.names = _SafeNames(dict(field_values))
    if current_row is not None:
        s.names["CurrentRow"] = CurrentRowWrapper(current_row)
        for rk, rv in current_row.items():
            if isinstance(rk, str):
                rnum = _to_num(rv)
                s.names[rk] = rnum if rnum is not None else (rv if rv is not None else 0)
        
    ref_values = other_kpi_values or {}
    items_data = multi_line_items_data or {}
    # So SUM_ITEMS(field_key, sub_key) works: inject field keys and sub_keys as string names
    for field_key in items_data:
        s.names[field_key] = field_key
    sub_keys: set[str] = set()
    for rows in items_data.values():
        if isinstance(rows, list) and rows:
            row = rows[0]
            if isinstance(row, dict):
                sub_keys.update(row.keys())
    if other_kpi_multi_line_data:
        for (k_id, f_key), rows in other_kpi_multi_line_data.items():
            s.names[f_key] = f_key
            if isinstance(rows, list) and rows:
                row = rows[0]
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

    def _resolve_current_row_args(args: tuple[Any, ...]) -> tuple[Any, ...]:
        if not current_row:
            return args
        resolved = []
        for arg in args:
            if isinstance(arg, str) and arg.startswith("CurrentRow."):
                key = arg.split(".", 1)[1]
                val = _get_current_row_val(current_row, key)
                resolved.append(val if val is not None else 0)
            else:
                resolved.append(arg)
        return tuple(resolved)

    def _other_kpi_rows(kpi_id: int, field_key: str) -> list[dict[str, Any]]:
        if not other_kpi_multi_line_data:
            return []
        return other_kpi_multi_line_data.get((kpi_id, field_key), [])

    def sum_items(field_key: str, sub_key: str) -> Any:
        return _clean_num(sum(_items_values(items_data, field_key, sub_key)))

    def avg_items(field_key: str, sub_key: str) -> Any:
        vals = _items_values(items_data, field_key, sub_key)
        return _clean_num(sum(vals) / len(vals)) if vals else 0

    def count_items(*args: Any) -> Any:
        """
        COUNT_ITEMS supports two forms:
        - COUNT_ITEMS(field_key) or COUNT_ITEMS(field_key, sub_key): count rows (or rows with non-null sub_key)
        - COUNT_ITEMS(field_key, filter_sub_key, op_xx, value): alias for COUNT_ITEMS_WHERE(...)
          (kept for backward/UX compatibility with older builders)
        """
        if not args:
            return 0
        args = _resolve_current_row_args(args)
        field_key = str(args[0])
        rows = items_data.get(field_key) if isinstance(items_data, dict) else []
        if not isinstance(rows, list):
            return 0
        # Alias: COUNT_ITEMS(field, filter_sub_key, op, value[, op_and/op_or, filter_sub_key, op, value]...)
        if len(args) >= 4:
            # Multi-condition path activates when first operator looks like a comparison op.
            first_op = str(args[2]).strip().lower()
            if first_op.startswith("op_"):
                first_op = first_op.replace("op_", "", 1)
            if first_op in {"eq", "neq", "gt", "gte", "lt", "lte", "contains", "not_contains", "starts_with", "ends_with"}:
                return len(_rows_where_multi(items_data, field_key, args, 1))
        # Standard forms
        sub_key = str(args[1]) if len(args) >= 2 and args[1] is not None else ""
        if sub_key == "":
            return len(rows)
        return len([r for r in rows if isinstance(r, dict) and r.get(sub_key) is not None])

    def min_items(field_key: str, sub_key: str) -> Any:
        vals = _items_values(items_data, field_key, sub_key)
        return _clean_num(min(vals)) if vals else 0

    def max_items(field_key: str, sub_key: str) -> Any:
        vals = _items_values(items_data, field_key, sub_key)
        return _clean_num(max(vals)) if vals else 0

    def sum_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return _clean_num(sum(vals))

    def avg_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return _clean_num(sum(vals) / len(vals)) if vals else 0

    def count_items_where(field_key: str, *where_args: Any) -> int:
        where_args = _resolve_current_row_args(where_args)
        return len(_rows_where_multi(items_data, field_key, where_args, 0))

    def min_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return _clean_num(min(vals)) if vals else 0

    def max_items_where(field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        vals = _items_values_where_multi(items_data, field_key, value_sub_key, where_args, 0)
        return _clean_num(max(vals)) if vals else 0

    # Cross-KPI items aggregation functions:
    def sum_kpi_items(kpi_id: int, field_key: str, sub_key: str) -> Any:
        rows = _other_kpi_rows(kpi_id, field_key)
        vals = [_to_num(r.get(sub_key)) for r in rows if isinstance(r, dict)]
        return _clean_num(sum(v for v in vals if v is not None))

    def avg_kpi_items(kpi_id: int, field_key: str, sub_key: str) -> Any:
        rows = _other_kpi_rows(kpi_id, field_key)
        vals = [_to_num(r.get(sub_key)) for r in rows if isinstance(r, dict)]
        vals = [v for v in vals if v is not None]
        return _clean_num(sum(vals) / len(vals)) if vals else 0

    def count_kpi_items(kpi_id: int, field_key: str, sub_key: str | None = None) -> int:
        rows = _other_kpi_rows(kpi_id, field_key)
        if not sub_key:
            return len(rows)
        return len([r for r in rows if isinstance(r, dict) and r.get(sub_key) is not None])

    def min_kpi_items(kpi_id: int, field_key: str, sub_key: str) -> Any:
        rows = _other_kpi_rows(kpi_id, field_key)
        vals = [_to_num(r.get(sub_key)) for r in rows if isinstance(r, dict)]
        vals = [v for v in vals if v is not None]
        return _clean_num(min(vals)) if vals else 0

    def max_kpi_items(kpi_id: int, field_key: str, sub_key: str) -> Any:
        rows = _other_kpi_rows(kpi_id, field_key)
        vals = [_to_num(r.get(sub_key)) for r in rows if isinstance(r, dict)]
        vals = [v for v in vals if v is not None]
        return _clean_num(max(vals)) if vals else 0

    def sum_kpi_items_where(kpi_id: int, field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        rows = _other_kpi_rows(kpi_id, field_key)
        data = {field_key: rows}
        vals = _items_values_where_multi(data, field_key, value_sub_key, where_args, 0)
        return _clean_num(sum(vals))

    def avg_kpi_items_where(kpi_id: int, field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        rows = _other_kpi_rows(kpi_id, field_key)
        data = {field_key: rows}
        vals = _items_values_where_multi(data, field_key, value_sub_key, where_args, 0)
        return _clean_num(sum(vals) / len(vals)) if vals else 0

    def count_kpi_items_where(kpi_id: int, field_key: str, *where_args: Any) -> int:
        where_args = _resolve_current_row_args(where_args)
        rows = _other_kpi_rows(kpi_id, field_key)
        data = {field_key: rows}
        return len(_rows_where_multi(data, field_key, where_args, 0))

    def min_kpi_items_where(kpi_id: int, field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        rows = _other_kpi_rows(kpi_id, field_key)
        data = {field_key: rows}
        vals = _items_values_where_multi(data, field_key, value_sub_key, where_args, 0)
        return _clean_num(min(vals)) if vals else 0

    def max_kpi_items_where(kpi_id: int, field_key: str, value_sub_key: str, *where_args: Any) -> Any:
        where_args = _resolve_current_row_args(where_args)
        rows = _other_kpi_rows(kpi_id, field_key)
        data = {field_key: rows}
        vals = _items_values_where_multi(data, field_key, value_sub_key, where_args, 0)
        return _clean_num(max(vals)) if vals else 0

    def kpi_field(kpi_id: int, field_key: str) -> Any:
        """Return numeric value or list of subfield values of a field from another KPI (same user, same year, same org). Missing => 0."""
        if "." in field_key:
            mli_key, sub_key = field_key.split(".", 1)
            rows = _other_kpi_rows(kpi_id, mli_key)
            vals = []
            for r in rows:
                if isinstance(r, dict):
                    v = r.get(sub_key)
                    v_num = _to_num(v)
                    if v_num is not None:
                        vals.append(_clean_num(v_num))
                    elif v is not None:
                        vals.append(v)
            return vals
        return _clean_num(ref_values.get((kpi_id, field_key), 0))

    def group_by_fn(*args: Any, **kwargs: Any) -> GroupNode:
        if not args:
            return GroupNode("", AggSpec("COUNT"))
        field = str(args[0])
        child = args[-1] if len(args) > 1 else AggSpec("COUNT")
        if not isinstance(child, (GroupNode, AggSpec, _GroupNodeOp)):
            if isinstance(child, str):
                child = AggSpec("COUNT", field=child)
            else:
                child = AggSpec("COUNT")
        conditions = list(args[1:-1]) if len(args) > 2 else []
        for k, v in kwargs.items():
            conditions.append((k, "op_eq", v))
        return GroupNode(field=field, child=child, conditions=conditions)

    def unique_count_fn(*args: Any, **kwargs: Any) -> AggSpec:
        field = str(args[0]) if args else None
        conds = list(args[1:]) if len(args) > 1 else []
        for k, v in kwargs.items():
            conds.append((k, "op_eq", v))
        return AggSpec(func="UNIQUE_COUNT", field=field, conditions=conds)

    def _smart_count(*a: Any) -> Any:
        if not a:
            return AggSpec("COUNT")
        if len(a) == 1 and isinstance(a[0], str):
            return AggSpec("COUNT", field=a[0])
        if any(isinstance(x, (GroupNode, AggSpec, _GroupNodeOp)) for x in a):
            return len([x for x in a if x is not None])
        # Check if first item looks like a string subfield key
        if isinstance(a[0], str) and not a[0].replace('.', '', 1).isdigit():
            return AggSpec("COUNT", field=a[0], conditions=list(a[1:]))
        return len([x for x in a if x is not None])

    def _smart_sum(*a: Any) -> Any:
        if len(a) == 1 and isinstance(a[0], str) and not a[0].replace('.', '', 1).isdigit():
            return AggSpec("SUM", field=a[0])
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return _clean_num(sum(nums))

    def _smart_avg(*a: Any) -> Any:
        if len(a) == 1 and isinstance(a[0], str) and not a[0].replace('.', '', 1).isdigit():
            return AggSpec("AVG", field=a[0])
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return _clean_num(sum(nums) / len(nums)) if nums else 0

    def _smart_min(*a: Any) -> Any:
        if len(a) == 1 and isinstance(a[0], str) and not a[0].replace('.', '', 1).isdigit():
            return AggSpec("MIN", field=a[0])
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return _clean_num(min(nums)) if nums else 0

    def _smart_max(*a: Any) -> Any:
        if len(a) == 1 and isinstance(a[0], str) and not a[0].replace('.', '', 1).isdigit():
            return AggSpec("MAX", field=a[0])
        nums = [float(x) for x in a if x is not None and isinstance(x, (int, float))]
        return _clean_num(max(nums)) if nums else 0

    def kpi_group_by_fn(kpi_id: int, field_key: str, *args: Any, **kwargs: Any) -> Any:
        if not args:
            g_node = GroupNode("", AggSpec("COUNT"))
        elif isinstance(args[0], (GroupNode, AggSpec, _GroupNodeOp)):
            g_node = args[0]
        else:
            g_node = group_by_fn(*args, **kwargs)
        rows = _other_kpi_rows(kpi_id, field_key)
        return _clean_num(g_node.evaluate(rows, current_row=current_row))

    def count_unique_items(field_key: str, sub_key: str | None = None) -> int:
        rows = items_data.get(field_key) if isinstance(items_data, dict) else []
        if not isinstance(rows, list):
            return 0
        if not sub_key:
            return len(rows)
        seen = set()
        for r in rows:
            if not isinstance(r, dict):
                continue
            v = r.get(sub_key)
            if v is not None and v != "":
                if isinstance(v, dict):
                    v_norm = str(v.get("value") or v.get("id") or v.get("label") or str(v)).strip()
                else:
                    v_norm = str(v).strip()
                if v_norm != "":
                    seen.add(v_norm)
        return len(seen)

    def count_unique_items_where(field_key: str, sub_key: str, *where_args: Any) -> int:
        where_args = _resolve_current_row_args(where_args)
        rows = _rows_where_multi(items_data, field_key, where_args, 0)
        seen = set()
        for r in rows:
            if not isinstance(r, dict):
                continue
            v = r.get(sub_key)
            if v is not None and v != "":
                if isinstance(v, dict):
                    v_norm = str(v.get("value") or v.get("id") or v.get("label") or str(v)).strip()
                else:
                    v_norm = str(v).strip()
                if v_norm != "":
                    seen.add(v_norm)
        return len(seen)

    def count_unique_kpi_items(kpi_id: int, field_key: str, sub_key: str | None = None) -> int:
        rows = _other_kpi_rows(kpi_id, field_key)
        if not sub_key:
            return len(rows)
        seen = set()
        for r in rows:
            if not isinstance(r, dict):
                continue
            v = r.get(sub_key)
            if v is not None and v != "":
                if isinstance(v, dict):
                    v_norm = str(v.get("value") or v.get("id") or v.get("label") or str(v)).strip()
                else:
                    v_norm = str(v).strip()
                if v_norm != "":
                    seen.add(v_norm)
        return len(seen)

    def count_unique_kpi_items_where(kpi_id: int, field_key: str, sub_key: str, *where_args: Any) -> int:
        where_args = _resolve_current_row_args(where_args)
        rows = _other_kpi_rows(kpi_id, field_key)
        data = {field_key: rows}
        matched = _rows_where_multi(data, field_key, where_args, 0)
        seen = set()
        for r in matched:
            if not isinstance(r, dict):
                continue
            v = r.get(sub_key)
            if v is not None and v != "":
                if isinstance(v, dict):
                    v_norm = str(v.get("value") or v.get("id") or v.get("label") or str(v)).strip()
                else:
                    v_norm = str(v).strip()
                if v_norm != "":
                    seen.add(v_norm)
        return len(seen)

    def fetch_items_where(
        field_key: str,
        value_sub_key: str,
        separator: str,
        remove_duplicates: Any,
        sort_direction: str,
        empty_val: str,
        *where_args: Any
    ) -> str:
        where_args = _resolve_current_row_args(where_args)
        rows = items_data.get(field_key) if isinstance(items_data, dict) else []
        data = {field_key: rows}
        matched = _rows_where_multi(data, field_key, where_args, 0)
        
        vals = []
        for r in matched:
            v = r.get(value_sub_key)
            if v is not None:
                if isinstance(v, dict):
                    v_str = str(v.get("value") or v.get("label") or str(v)).strip()
                else:
                    v_str = str(v).strip()
                if v_str:
                    vals.append(v_str)
                    
        if not vals:
            return empty_val or ""
            
        rem_dup = str(remove_duplicates).strip().lower() in ("yes", "true", "1")
        if rem_dup:
            seen = set()
            deduped = []
            for val in vals:
                if val not in seen:
                    seen.add(val)
                    deduped.append(val)
            vals = deduped
            
        sort_dir = str(sort_direction).strip().lower()
        if sort_dir in ("asc", "ascending"):
            vals.sort(key=lambda x: x.lower())
        elif sort_dir in ("desc", "descending"):
            vals.sort(key=lambda x: x.lower(), reverse=True)
            
        sep = str(separator) if separator is not None else ", "
        return sep.join(vals)

    def fetch_kpi_items_where(
        kpi_id: int,
        field_key: str,
        value_sub_key: str,
        separator: str,
        remove_duplicates: Any,
        sort_direction: str,
        empty_val: str,
        *where_args: Any
    ) -> str:
        where_args = _resolve_current_row_args(where_args)
        rows = _other_kpi_rows(kpi_id, field_key)
        data = {field_key: rows}
        matched = _rows_where_multi(data, field_key, where_args, 0)
        
        vals = []
        for r in matched:
            v = r.get(value_sub_key)
            if v is not None:
                if isinstance(v, dict):
                    v_str = str(v.get("value") or v.get("label") or str(v)).strip()
                else:
                    v_str = str(v).strip()
                if v_str:
                    vals.append(v_str)
                    
        if not vals:
            return empty_val or ""
            
        rem_dup = str(remove_duplicates).strip().lower() in ("yes", "true", "1")
        if rem_dup:
            seen = set()
            deduped = []
            for val in vals:
                if val not in seen:
                    seen.add(val)
                    deduped.append(val)
            vals = deduped
            
        sort_dir = str(sort_direction).strip().lower()
        if sort_dir in ("asc", "ascending"):
            vals.sort(key=lambda x: x.lower())
        elif sort_dir in ("desc", "descending"):
            vals.sort(key=lambda x: x.lower(), reverse=True)
            
        sep = str(separator) if separator is not None else ", "
        return sep.join(vals)

    s.functions = {
        "WHERE": lambda *a: tuple(a) if len(a) > 1 else (a[0] if a else ()),
        "GROUP_BY": group_by_fn,
        "KPI_GROUP_BY": kpi_group_by_fn,
        "GROUP_BY_KPI": kpi_group_by_fn,
        "UNIQUE_COUNT": unique_count_fn,
        "COUNT_UNIQUE": unique_count_fn,
        "COUNT_DISTINCT": unique_count_fn,
        "SUM": _smart_sum,
        "AVG": _smart_avg,
        "AVERAGE": _smart_avg,
        "COUNT": _smart_count,
        "MIN": _smart_min,
        "MAX": _smart_max,
        "ROUND": round,
        "SUM_ITEMS": sum_items,
        "AVG_ITEMS": avg_items,
        "COUNT_ITEMS": count_items,
        "COUNT_UNIQUE_ITEMS": count_unique_items,
        "UNIQUE_COUNT_ITEMS": count_unique_items,
        "MIN_ITEMS": min_items,
        "MAX_ITEMS": max_items,
        "SUM_ITEMS_WHERE": sum_items_where,
        "AVG_ITEMS_WHERE": avg_items_where,
        "COUNT_ITEMS_WHERE": count_items_where,
        "COUNT_UNIQUE_ITEMS_WHERE": count_unique_items_where,
        "UNIQUE_COUNT_ITEMS_WHERE": count_unique_items_where,
        "MIN_ITEMS_WHERE": min_items_where,
        "MAX_ITEMS_WHERE": max_items_where,
        "SUM_KPI_ITEMS": sum_kpi_items,
        "AVG_KPI_ITEMS": avg_kpi_items,
        "COUNT_KPI_ITEMS": count_kpi_items,
        "COUNT_UNIQUE_KPI_ITEMS": count_unique_kpi_items,
        "UNIQUE_COUNT_KPI_ITEMS": count_unique_kpi_items,
        "MIN_KPI_ITEMS": min_kpi_items,
        "MAX_KPI_ITEMS": max_kpi_items,
        "SUM_KPI_ITEMS_WHERE": sum_kpi_items_where,
        "AVG_KPI_ITEMS_WHERE": avg_kpi_items_where,
        "COUNT_KPI_ITEMS_WHERE": count_kpi_items_where,
        "COUNT_UNIQUE_KPI_ITEMS_WHERE": count_unique_kpi_items_where,
        "UNIQUE_COUNT_KPI_ITEMS_WHERE": count_unique_kpi_items_where,
        "MIN_KPI_ITEMS_WHERE": min_KPI_items_where if "min_KPI_items_where" in locals() else min_kpi_items_where,
        "MAX_KPI_ITEMS_WHERE": max_kpi_items_where,
        "KPI_FIELD": kpi_field,
        "FETCH_ITEMS_WHERE": fetch_items_where,
        "FETCH_KPI_ITEMS_WHERE": fetch_kpi_items_where,
    }
    return s


def evaluate_formula(
    expression: str,
    field_values: dict[str, float | int],
    multi_line_items_data: MultiLineItemsData | None = None,
    other_kpi_values: OtherKpiValues | None = None,
    current_row: dict[str, Any] | None = None,
    other_kpi_multi_line_data: dict[tuple[int, str], list[dict[str, Any]]] | None = None,
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
    if "GROUP_BY" in expression and "=" in expression:
        expression = re.sub(r'(\b\w+\b)\s*(?<![!=><])=\s*(?![=])(CurrentRow\.\w+|"[^"]*"|\w+)', r'\1 == \2', expression)
    if not re.match(r"^[\w\s+\-*/().,\"\'&!=><]+$", expression):
        return None

    parsed_ast = _AST_CACHE.get(expression)
    if parsed_ast is None:
        try:
            parsed_ast = ast.parse(expression).body[0].value
            _AST_CACHE[expression] = parsed_ast
        except Exception:
            _AST_CACHE[expression] = False  # Mark as invalid
            return None
    elif parsed_ast is False:
        return None

    try:
        ev = _make_evaluator(
            field_values,
            multi_line_items_data,
            other_kpi_values,
            current_row,
            other_kpi_multi_line_data,
        )
        result = ev._eval(parsed_ast)
        if result is None:
            return None
        if isinstance(result, (int, float)):
            return _clean_num(result)
        if isinstance(result, (str, bool)):
            return result
        if isinstance(result, (GroupNode, AggSpec, _GroupNodeOp)):
            rows = []
            if multi_line_items_data:
                for val in multi_line_items_data.values():
                    if isinstance(val, list):
                        rows = val
                        break
            return _clean_num(result.evaluate(rows, current_row=current_row))
        return None
    except (NameNotDefined, ZeroDivisionError, TypeError, KeyError, SyntaxError, ValueError) as exc:
        logger.warning("Formula evaluation exception for '%s': %s", expression, exc)
        return None


def _coerce_output_value(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (int, float, bool)):
        return val
    s = str(val).strip()
    if s == "":
        return None
    if s.lower() == "true":
        return True
    if s.lower() == "false":
        return False
    try:
        if "." in s:
            return float(s)
        return int(s)
    except ValueError:
        return s


def apply_conditional_logic(formula_result: Any, cond_logic: dict[str, Any] | None) -> Any:
    """
    Evaluates conditional IF/ELSE logic against formula_result.
    cond_logic structure:
    {
        "enabled": True,
        "rules": [
            {
                "operator": "op_lt" | "<" | "op_eq" | "=" | "op_neq" | "!=" | "op_gt" | ">" | "op_gte" | ">=" | "op_lte" | "<=" | "is_empty" | "is_not_empty",
                "value": "0",
                "then": "Non Initialized"
            }
        ],
        "else_output": "Initialized"
    }
    """
    if not cond_logic or not isinstance(cond_logic, dict) or not cond_logic.get("enabled"):
        return formula_result

    rules = cond_logic.get("rules") or []
    else_output = cond_logic.get("else_output")

    for rule in rules:
        if not isinstance(rule, dict):
            continue
        raw_op = str(rule.get("operator") or "").strip().lower()
        if raw_op.startswith("op_"):
            op = raw_op[3:]
        else:
            op_map = {
                "=": "eq",
                "==": "eq",
                "!=": "neq",
                ">": "gt",
                ">=": "gte",
                "<": "lt",
                "<=": "lte",
            }
            op = op_map.get(raw_op, raw_op)

        cmp_val = rule.get("value")
        then_val = rule.get("then")

        matched = False
        if op == "is_empty":
            matched = (formula_result is None or str(formula_result).strip() == "")
        elif op == "is_not_empty":
            matched = (formula_result is not None and str(formula_result).strip() != "")
        else:
            matched = match_cell_value(formula_result, op, cmp_val)

        if matched:
            return _coerce_output_value(then_val)

    return _coerce_output_value(else_output)


