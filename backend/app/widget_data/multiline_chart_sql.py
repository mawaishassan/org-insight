"""
Single-query aggregates for multi_line_items bar/pie charts (PostgreSQL).

Returns sparse buckets (group_label, filter_label, row_count, sum_numeric) so the client
can apply filter-chip selection without receiving every raw row.

Structured row filters (legacy substring map or v2 conditions) can be pushed into SQL when
they only touch non-reference sub-fields and use operators we can mirror; otherwise callers
fall back to Python-side filtering.
"""

from __future__ import annotations

import json
from datetime import date, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.entries.multi_item_filters import normalize_filter_op


def _label_sql(alias: str) -> str:
    """Coalesce typed cell columns into one text label (aligns roughly with _cell_value_raw → str)."""
    return f"""(
      COALESCE(
        NULLIF(TRIM(BOTH FROM {alias}.value_text), ''),
        CASE WHEN {alias}.value_number IS NOT NULL
          THEN TRIM(TO_CHAR({alias}.value_number, 'FM999999990.999999999999'))
          ELSE NULL END,
        CASE WHEN {alias}.value_boolean IS NOT NULL THEN {alias}.value_boolean::text ELSE NULL END,
        CASE WHEN {alias}.value_date IS NOT NULL THEN TO_CHAR({alias}.value_date, 'YYYY-MM-DD') ELSE NULL END,
        CASE WHEN {alias}.value_json IS NOT NULL THEN {alias}.value_json::text ELSE NULL END
      )
    )"""


def _numeric_sql(alias: str) -> str:
    """Best-effort numeric extraction for sum/avg (matches common number + text entry patterns)."""
    return f"""(
      CASE
        WHEN {alias}.value_number IS NOT NULL THEN {alias}.value_number::double precision
        WHEN {alias}.value_text IS NOT NULL AND TRIM({alias}.value_text) <> ''
             AND TRIM({alias}.value_text) ~ '^[-+]?[0-9]+([.,][0-9]+)?$'
          THEN REPLACE(REPLACE(TRIM(BOTH FROM {alias}.value_text), ',', ''), ' ', '')::double precision
        ELSE NULL
      END
    )"""


def _wf_alias(sid_param: str) -> str:
    """Stable SQL alias name for one filter subfield join."""
    return f"wf_{sid_param}"


def _joined_cell_label(sid_param: str) -> str:
    """Label expression referencing a joined alias (no per-row correlated subquery)."""
    return _label_sql(_wf_alias(sid_param))


def _joined_cell_numeric(sid_param: str) -> str:
    return _numeric_sql(_wf_alias(sid_param))


def _joined_cell_date(sid_param: str) -> str:
    return f"{_wf_alias(sid_param)}.value_date"


def _parse_filters_dict(raw_filters: Any) -> dict[str, Any] | None:
    if raw_filters is None or raw_filters == {}:
        return None
    if isinstance(raw_filters, str):
        s = raw_filters.strip()
        if not s:
            return None
        try:
            raw_filters = json.loads(s)
        except json.JSONDecodeError:
            return None
    return raw_filters if isinstance(raw_filters, dict) else None


def _sql_float(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except ValueError:
            return None
    return None


def _sql_date(v: Any) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    return None


def _compile_v2_one(
    cond: dict[str, Any],
    *,
    cond_idx: int,
    sub_id_by_key: dict[str, int],
    reference_field_types: dict[str, str],
    resolved_label_sets: dict[int, set[str]] | None,
    params: dict[str, Any],
    needed_sid_params: set[str],
) -> str | None:
    fk = cond.get("field")
    if fk is None or fk == "":
        return "TRUE"
    fk_s = str(fk)
    ft = str(reference_field_types.get(fk_s, "") or "")
    sid = sub_id_by_key.get(fk_s)
    if sid is None:
        return None

    op = normalize_filter_op(cond.get("op", "eq"))
    if op == "in":
        op = "eq"
    text_ops = {"eq", "neq", "contains", "not_contains", "starts_with", "ends_with"}
    cmp_ops = {"eq", "neq", "gt", "gte", "lt", "lte"}
    if op not in text_ops | cmp_ops:
        return None

    sid_key = f"wf_{cond_idx}_sid"
    params[sid_key] = int(sid)
    needed_sid_params.add(sid_key)

    lbl = _joined_cell_label(sid_key)
    num = _joined_cell_numeric(sid_key)
    dte = _joined_cell_date(sid_key)

    # reference_resolution: compile as label IN allowed_labels when pre-resolved by caller
    rr = cond.get("reference_resolution")
    if isinstance(rr, dict):
        allowed = (resolved_label_sets or {}).get(cond_idx)
        if not allowed:
            return None
        arr_key = f"wf_{cond_idx}_allowed"
        params[arr_key] = sorted({str(x).strip() for x in allowed if str(x).strip()})
        if op == "eq":
            return f"({lbl} IS NOT NULL AND TRIM(BOTH FROM COALESCE({lbl}, '')) = ANY(CAST(:{arr_key} AS text[])))"
        if op == "neq":
            return f"({lbl} IS NULL OR NOT (TRIM(BOTH FROM COALESCE({lbl}, '')) = ANY(CAST(:{arr_key} AS text[]))))"
        # Other operators over resolved values are not supported in SQL compilation yet.
        return None

    vals_raw = cond.get("values")
    if not vals_raw and isinstance(cond.get("value"), list):
        vals_raw = cond.get("value")
    if isinstance(vals_raw, list) and len(vals_raw) > 1:
        if op not in ("eq", "neq"):
            return None
        parts: list[str] = []
        for j, v in enumerate(vals_raw):
            pkey = f"wf_{cond_idx}_v{j}"
            params[pkey] = str(v).strip() if v is not None else ""
            if op == "eq":
                parts.append(
                    f"({lbl} IS NOT NULL AND TRIM(BOTH FROM COALESCE({lbl}, '')) = TRIM(BOTH FROM CAST(:{pkey} AS text)))"
                )
            else:
                parts.append(
                    f"({lbl} IS NULL OR TRIM(BOTH FROM COALESCE({lbl}, '')) IS DISTINCT FROM TRIM(BOTH FROM CAST(:{pkey} AS text)))"
                )
        joined = " OR " if op == "eq" else " AND "
        return "(" + joined.join(parts) + ")"

    raw_val = cond.get("value")
    vkey = f"wf_{cond_idx}_v0"

    if op in ("contains", "not_contains"):
        params[vkey] = str(raw_val).strip() if raw_val is not None else ""
        inner = f"POSITION(LOWER(CAST(:{vkey} AS text)) IN LOWER(COALESCE({lbl}, ''))) > 0"
        return f"(NOT ({inner}))" if op == "not_contains" else f"({inner})"

    if op == "starts_with":
        params[vkey] = str(raw_val).strip() if raw_val is not None else ""
        # Postgres has no starts_with() function; use LIKE.
        return f"(LOWER(TRIM(COALESCE({lbl}, ''))) LIKE LOWER(TRIM(CAST(:{vkey} AS text))) || '%')"

    if op == "ends_with":
        params[vkey] = str(raw_val).strip() if raw_val is not None else ""
        return f"(LOWER(TRIM(COALESCE({lbl}, ''))) LIKE '%' || LOWER(TRIM(CAST(:{vkey} AS text))))"

    if op in cmp_ops:
        # Reference-like sub-fields: comparisons are text-only on their display label.
        if ft in ("reference", "multi_reference"):
            if op not in ("eq", "neq"):
                return None
            params[vkey] = str(raw_val).strip() if raw_val is not None else ""
            if op == "eq":
                return (
                    f"({lbl} IS NOT NULL AND TRIM(BOTH FROM COALESCE({lbl}, '')) = "
                    f"TRIM(BOTH FROM CAST(:{vkey} AS text)))"
                )
            return (
                f"({lbl} IS NULL OR TRIM(BOTH FROM COALESCE({lbl}, '')) IS DISTINCT FROM "
                f"TRIM(BOTH FROM CAST(:{vkey} AS text)))"
            )

        if ft == "date" and op in ("gt", "gte", "lt", "lte", "eq", "neq"):
            dv = _sql_date(raw_val)
            if dv is None:
                return None
            params[vkey] = dv
            if op == "eq":
                return f"({dte} IS NOT NULL AND {dte} = CAST(:{vkey} AS date))"
            if op == "neq":
                return f"({dte} IS NULL OR {dte} IS DISTINCT FROM CAST(:{vkey} AS date))"
            sym = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            return f"({dte} IS NOT NULL AND {dte} {sym} CAST(:{vkey} AS date))"

        fn = _sql_float(raw_val)
        if fn is None and op in ("gt", "gte", "lt", "lte"):
            return None
        if op in ("gt", "gte", "lt", "lte"):
            params[vkey] = fn
            sym = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
            return f"({num} IS NOT NULL AND {num} {sym} CAST(:{vkey} AS double precision))"

        if op == "eq":
            if fn is not None:
                params[vkey] = fn
                return f"({num} IS NOT NULL AND {num} = CAST(:{vkey} AS double precision))"
            params[vkey] = str(raw_val).strip() if raw_val is not None else ""
            return (
                f"({lbl} IS NOT NULL AND TRIM(BOTH FROM COALESCE({lbl}, '')) = "
                f"TRIM(BOTH FROM CAST(:{vkey} AS text)))"
            )

        if op == "neq":
            if fn is not None:
                params[vkey] = fn
                return f"({num} IS DISTINCT FROM CAST(:{vkey} AS double precision))"
            params[vkey] = str(raw_val).strip() if raw_val is not None else ""
            return (
                f"({lbl} IS NULL OR TRIM(BOTH FROM COALESCE({lbl}, '')) IS DISTINCT FROM "
                f"TRIM(BOTH FROM CAST(:{vkey} AS text)))"
            )

    return None


def _compile_legacy_map(
    raw: dict[str, Any],
    sub_id_by_key: dict[str, int],
    params: dict[str, Any],
    needed_sid_params: set[str],
) -> str | None:
    parts: list[str] = []
    i = 0
    for fk, fv in raw.items():
        if str(fk).startswith("_"):
            continue
        if fv is None or fv == "":
            continue
        sid = sub_id_by_key.get(str(fk))
        if sid is None:
            return None
        sid_key = f"lf_{i}_sid"
        v_key = f"lf_{i}_val"
        params[sid_key] = int(sid)
        params[v_key] = str(fv)
        needed_sid_params.add(sid_key)
        # legacy map uses substring match on label
        lbl = _joined_cell_label(sid_key)
        parts.append(
            f"(POSITION(LOWER(CAST(:{v_key} AS text)) IN LOWER(COALESCE({lbl}, ''))) > 0)"
        )
        i += 1
    if not parts:
        return None
    return "(" + " AND ".join(parts) + ")"


def compile_multiline_row_filters_sql(
    raw_filters: Any,
    *,
    sub_id_by_key: dict[str, int],
    reference_field_types: dict[str, str],
    resolved_label_sets: dict[int, set[str]] | None = None,
) -> tuple[str, dict[str, Any], list[str]] | None:
    """
    Build an SQL fragment (without leading ``AND``) for ``WHERE`` on ``kpi_multi_line_rows r``.

    Returns:
        ``("", {})`` when there is nothing to filter;
        ``(sql, params)`` when predicates were generated;
        ``None`` when filters include unsupported ops or cannot be expressed as SQL
        (caller should use the Python row filter path).
    """
    raw = _parse_filters_dict(raw_filters)
    if raw is None:
        return ("", {}, [])

    params: dict[str, Any] = {}
    needed_sid_params: set[str] = set()

    if raw.get("_version") == 2:
        conds = raw.get("conditions")
        if not isinstance(conds, list) or not conds:
            return ("", {}, [])
        sql_frags: list[str] = []
        for i, c in enumerate(conds):
            if not isinstance(c, dict):
                sql_frags.append("TRUE")
                continue
            frag = _compile_v2_one(
                c,
                cond_idx=i,
                sub_id_by_key=sub_id_by_key,
                reference_field_types=reference_field_types,
                resolved_label_sets=resolved_label_sets,
                params=params,
                needed_sid_params=needed_sid_params,
            )
            if frag is None:
                return None
            sql_frags.append(frag)
        acc = f"({sql_frags[0]})"
        for i in range(1, len(sql_frags)):
            link = str(conds[i].get("logic", "and")).strip().lower()
            if link not in ("and", "or"):
                link = "and"
            op = " OR " if link == "or" else " AND "
            acc = f"({acc}{op}({sql_frags[i]}))"
        return (acc, params, sorted(needed_sid_params))

    frag = _compile_legacy_map(raw, sub_id_by_key, params, needed_sid_params)
    if frag is None and any(
        not str(k).startswith("_") and raw.get(k) not in (None, "")
        for k in raw.keys()
    ):
        return None
    if frag is None:
        return ("", {}, [])
    return (frag, params, sorted(needed_sid_params))


async def fetch_multiline_bar_agg_buckets(
    db: AsyncSession,
    *,
    entry_id: int | list[int],
    multiline_field_id: int,
    group_sub_field_id: int,
    filter_sub_field_id: int | None,
    value_sub_field_id: int | None,
    agg: str,
    filter_where_sql: str | None = None,
    filter_params: dict[str, Any] | None = None,
    filter_sid_params: list[str] | None = None,
    date_sub_field_id: int | None = None,
    date_range: tuple[date, date, str] | None = None,
) -> list[dict[str, Any]]:
    """
    One SQL round-trip: GROUP BY group label [+ filter label], with counts and optional numeric sums.

    Each row: ``{"g": str, "f": str | None, "n": int, "s": float}``
    - ``n`` = row count in bucket (matches Python aggregate_multi_line denominator)
    - ``s`` = sum of parsed numeric value cells in bucket (0 if none / count_rows mode)
    """
    agg = (agg or "count_rows").strip().lower()
    if agg not in ("count_rows", "sum", "avg"):
        agg = "count_rows"

    grp = _label_sql("cg")
    flt_sql = _label_sql("cf") if filter_sub_field_id else "''::text"
    join_cf = ""
    if filter_sub_field_id:
        join_cf = "LEFT JOIN kpi_multi_line_cells cf ON cf.row_id = r.id AND cf.sub_field_id = :fid"

    join_cv = ""
    val_expr = "NULL::double precision"
    if agg in ("sum", "avg") and value_sub_field_id:
        join_cv = "LEFT JOIN kpi_multi_line_cells cv ON cv.row_id = r.id AND cv.sub_field_id = :vid"
        val_expr = _numeric_sql("cv")

    # Extra joins required by compiled filter predicates (v2/legacy map).
    # Each join uses a stable alias derived from the param key, e.g. wf_wf_0_sid.
    extra_joins = ""
    if filter_sid_params:
        for p in filter_sid_params:
            alias = _wf_alias(p)
            extra_joins += f" LEFT JOIN kpi_multi_line_cells {alias} ON {alias}.row_id = r.id AND {alias}.sub_field_id = :{p}\n"

    # Date range filtering join & where clause
    date_join = ""
    date_where = ""
    if date_sub_field_id and date_range:
        date_join = "LEFT JOIN kpi_multi_line_cells c_dt ON c_dt.row_id = r.id AND c_dt.sub_field_id = :dt_sid\n"
        date_where = """AND (
            (c_dt.value_date IS NOT NULL AND c_dt.value_date >= :dt_start AND c_dt.value_date < :dt_end)
            OR
            (c_dt.value_text IS NOT NULL AND TRIM(c_dt.value_text) <> '' AND TRIM(c_dt.value_text) >= :dt_start_str AND TRIM(c_dt.value_text) < :dt_end_str)
        )\n"""

    # Support single entry_id or list of entry_ids (spanning years)
    is_multi_entry = isinstance(entry_id, (list, tuple, set))
    if is_multi_entry:
        entry_where = "r.entry_id = ANY(:eids)"
    else:
        entry_where = "r.entry_id = :eid"

    stmt = text(
        f"""
        SELECT
          COALESCE(NULLIF(TRIM(BOTH FROM grp_raw), ''), '(empty)') AS g,
          COALESCE(NULLIF(TRIM(BOTH FROM flt_raw), ''), '(empty)') AS f,
          COUNT(*)::int AS n_all,
          COALESCE(SUM(val_raw), 0)::double precision AS s_num
        FROM (
          SELECT
            r.id AS row_id,
            {grp} AS grp_raw,
            {flt_sql} AS flt_raw,
            {val_expr} AS val_raw
          FROM kpi_multi_line_rows r
          LEFT JOIN kpi_multi_line_cells cg ON cg.row_id = r.id AND cg.sub_field_id = :gid
          {join_cf}
          {join_cv}
          {extra_joins}
          {date_join}
          WHERE {entry_where} AND r.field_id = :mfid
            {date_where}
            {("AND (" + filter_where_sql + ")") if (filter_where_sql and str(filter_where_sql).strip()) else ""}
        ) x
        GROUP BY 1, 2
        ORDER BY 1, 2
        """
    )

    params: dict[str, Any] = {
        "mfid": int(multiline_field_id),
        "gid": int(group_sub_field_id),
    }
    if is_multi_entry:
        params["eids"] = [int(x) for x in entry_id if x]
    else:
        params["eid"] = int(entry_id)

    if filter_sub_field_id:
        params["fid"] = int(filter_sub_field_id)
    if value_sub_field_id and agg in ("sum", "avg"):
        params["vid"] = int(value_sub_field_id)
    if date_sub_field_id and date_range:
        params["dt_sid"] = int(date_sub_field_id)
        params["dt_start"] = date_range[0]
        params["dt_end"] = date_range[1]
        params["dt_start_str"] = date_range[0].isoformat()
        params["dt_end_str"] = date_range[1].isoformat()
    if filter_params:
        params.update(filter_params)

    res = await db.execute(stmt, params)
    out: list[dict[str, Any]] = []
    for row in res.mappings().all():
        out.append(
            {
                "g": str(row["g"]),
                "f": None if not filter_sub_field_id else str(row["f"]),
                "n": int(row["n_all"]),
                "s": float(row["s_num"] or 0.0),
            }
        )
    return out


async def fetch_multiline_single_value_agg(
    db: AsyncSession,
    *,
    entry_id: int | list[int] | tuple[int, ...] | set[int],
    multiline_field_id: int,
    value_sub_field_id: int | None = None,
    agg: str = "count",
    filter_where_sql: str | None = None,
    filter_params: dict[str, Any] | None = None,
    filter_sid_params: list[str] | None = None,
    date_sub_field_id: int | None = None,
    date_range: tuple[date, date, str] | None = None,
) -> float | None:
    """
    Computes count, sum, or avg for a multi-line field in a single SQL query.
    Supports date-range filtering and single or multiple entry_ids.
    """
    agg = (agg or "count").strip().lower()
    if agg in ("count_rows", "count"):
        agg = "count"
    elif agg not in ("sum", "avg"):
        agg = "count"

    join_cv = ""
    val_expr = "NULL::double precision"
    if agg in ("sum", "avg") and value_sub_field_id:
        join_cv = "LEFT JOIN kpi_multi_line_cells cv ON cv.row_id = r.id AND cv.sub_field_id = :vid"
        val_expr = _numeric_sql("cv")

    extra_joins = ""
    if filter_sid_params:
        for p in filter_sid_params:
            alias = _wf_alias(p)
            extra_joins += f" LEFT JOIN kpi_multi_line_cells {alias} ON {alias}.row_id = r.id AND {alias}.sub_field_id = :{p}\n"

    # Date range filtering join & where clause
    date_join = ""
    date_where = ""
    if date_sub_field_id and date_range:
        date_join = "LEFT JOIN kpi_multi_line_cells c_dt ON c_dt.row_id = r.id AND c_dt.sub_field_id = :dt_sid\n"
        date_where = """AND (
            (c_dt.value_date IS NOT NULL AND c_dt.value_date >= :dt_start AND c_dt.value_date < :dt_end)
            OR
            (c_dt.value_text IS NOT NULL AND TRIM(c_dt.value_text) <> '' AND TRIM(c_dt.value_text) >= :dt_start_str AND TRIM(c_dt.value_text) < :dt_end_str)
        )\n"""

    is_multi_entry = isinstance(entry_id, (list, tuple, set))
    if is_multi_entry:
        entry_where = "r.entry_id = ANY(:eids)"
    else:
        entry_where = "r.entry_id = :eid"

    if agg == "count":
        agg_expr = "COUNT(*)::double precision"
    elif agg == "sum":
        agg_expr = "COALESCE(SUM(val_raw), 0)::double precision"
    elif agg == "avg":
        agg_expr = "AVG(val_raw)::double precision"
    else:
        agg_expr = "COUNT(*)::double precision"

    stmt = text(
        f"""
        SELECT {agg_expr} AS val
        FROM (
          SELECT
            r.id AS row_id,
            {val_expr} AS val_raw
          FROM kpi_multi_line_rows r
          {join_cv}
          {extra_joins}
          {date_join}
          WHERE {entry_where} AND r.field_id = :mfid
            {date_where}
            {("AND (" + filter_where_sql + ")") if (filter_where_sql and str(filter_where_sql).strip()) else ""}
        ) x
        """
    )

    params: dict[str, Any] = {
        "mfid": int(multiline_field_id),
    }
    if is_multi_entry:
        params["eids"] = list(entry_id)
    else:
        params["eid"] = int(entry_id)

    if value_sub_field_id and agg in ("sum", "avg"):
        params["vid"] = int(value_sub_field_id)

    if date_sub_field_id and date_range:
        dt_start, dt_end, _ = date_range
        params["dt_sid"] = int(date_sub_field_id)
        params["dt_start"] = dt_start
        params["dt_end"] = dt_end
        params["dt_start_str"] = str(dt_start)
        params["dt_end_str"] = str(dt_end)

    if filter_params:
        params.update(filter_params)

    res = await db.execute(stmt, params)
    row = res.mappings().first()
    if not row or row["val"] is None:
        return None
    return float(row["val"])
