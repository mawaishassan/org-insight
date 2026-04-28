"""
Resolve per-widget `data` for POST /api/widget-data.

Loads KPI/field metadata, entry for period (read-only, no create), and multi_line rows
in one server round-trip; applies structured row filters in-process (aligns with export/list paths).
"""

from __future__ import annotations

import json
import math
import asyncio
from typing import Any, Callable, Awaitable

from sqlalchemy import and_, bindparam, cast, func, or_, select, text
from sqlalchemy.sql import nulls_last
from sqlalchemy.types import String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import (
    FieldType,
    KPI,
    KPIEntry,
    KPIField,
    KPIFieldSubField,
    KPIFieldValue,
    KpiMultiLineCell,
    KpiMultiLineRow,
    User,
)
from app.entries.multi_item_filters import row_passes_filters
from app.entries.reference_filter_resolve import build_reference_resolution_map
from app.entries.multi_line_load import load_multi_line_row_dicts
from app.dashboards.service import can_view_dashboard_for_kpi_chart
from app.entries.service import _normalize_reference_value, can_view_kpi_for_user
from app.fields.service import get_field_with_subfields_only, list_kpi_field_definitions
from app.formula_engine.evaluator import match_cell_value
from app.widget_data.multiline_chart_sql import (
    compile_multiline_row_filters_sql,
    fetch_multiline_bar_agg_buckets,
    _wf_alias,
)
from app.core.database import AsyncSessionLocal
from app.core.config import get_settings


async def resolve_dashboard_chart_widget_data_batch(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    items: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """
    Batch resolver for dashboard bar/pie charts.

    Returns dict keyed by widget.id (string) or idx fallback:
      {"<key>": {"ok": bool, "widget_type": str, "meta": {}, "data": {}, "entry_revision": str|None, "error": str?}}
    """
    # ---- Pre-parse + group ----
    parsed: list[tuple[str, dict[str, Any], dict[str, Any] | None]] = []
    info_by_key: dict[str, dict[str, Any]] = {}
    for idx, it in enumerate(items or []):
        if not isinstance(it, dict):
            continue
        w = it.get("widget")
        if not isinstance(w, dict):
            continue
        wid = w.get("id")
        key = str(wid) if wid is not None else f"idx:{idx}"
        overrides = it.get("overrides") if isinstance(it.get("overrides"), dict) else None
        merged = _merge_overrides(w, overrides)
        parsed.append((key, merged, overrides))
        info_by_key[key] = {
            "kpi_id": int(merged.get("kpi_id") or 0),
            "year": int(merged.get("year") or 0),
            "period_key": _period_key_norm(merged.get("period_key")),
        }

    results: dict[str, dict[str, Any]] = {}
    if not parsed:
        return results

    # Distinct KPI ids, validate access once each.
    kpi_ids: set[int] = set()
    for _key, w, _ov in parsed:
        if str(w.get("type") or "") != "kpi_bar_chart":
            continue
        kpi_ids.add(int(w.get("kpi_id") or 0))

    for kpi_id in sorted({k for k in kpi_ids if k > 0}):
        if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
            # Mark all widgets of this KPI as forbidden.
            for key, w, _ov in parsed:
                if int(w.get("kpi_id") or 0) == kpi_id:
                    results[key] = {"ok": False, "error": "forbidden"}

    # ---- Caches ----
    fields_cache: dict[int, list[KPIField]] = {}
    fmap_cache: dict[int, dict[str, Any]] = {}
    entry_cache: dict[tuple[int, int, str | None], tuple[int | None, Any]] = {}
    mline_field_cache: dict[tuple[int, str], KPIField | None] = {}
    sub_map_cache: dict[int, tuple[dict[str, int], dict[str, str]]] = {}

    async def _fields_for(kpi_id: int) -> list[KPIField]:
        if kpi_id not in fields_cache:
            fs = await list_kpi_field_definitions(db, kpi_id, org_id)
            fields_cache[kpi_id] = fs
            fmap_cache[kpi_id] = build_kpi_field_maps(fs)
        return fields_cache[kpi_id]

    async def _entry_for(kpi_id: int, year: int, period_key: Any) -> tuple[int | None, Any]:
        pk = _period_key_norm(period_key)
        k = (int(kpi_id), int(year), pk)
        if k not in entry_cache:
            entry_cache[k] = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
        return entry_cache[k]

    async def _mline_field_for(kpi_id: int, source_field_key: str) -> KPIField | None:
        k = (int(kpi_id), str(source_field_key))
        if k in mline_field_cache:
            return mline_field_cache[k]
        fs = await _fields_for(kpi_id)
        f = next((x for x in fs if x.key == source_field_key and x.field_type == FieldType.multi_line_items), None)
        if f is None:
            mline_field_cache[k] = None
            return None
        f_full = await get_field_with_subfields_only(db, int(f.id), org_id) or f
        mline_field_cache[k] = f_full
        if int(f_full.id) not in sub_map_cache:
            sub_id_by_key: dict[str, int] = {}
            ref_types: dict[str, str] = {}
            for sf in getattr(f_full, "sub_fields", None) or []:
                sk = getattr(sf, "key", None)
                if not sk:
                    continue
                sks = str(sk)
                sub_id_by_key[sks] = int(sf.id)
                ft = getattr(getattr(sf, "field_type", None), "value", sf.field_type)
                ref_types[sks] = str(ft or "")
            sub_map_cache[int(f_full.id)] = (sub_id_by_key, ref_types)
        return f_full

    # ---- Aggregate signature grouping ----
    sig_to_widgets: dict[tuple[Any, ...], list[str]] = {}
    sig_to_args: dict[tuple[Any, ...], dict[str, Any]] = {}
    sig_to_rev: dict[tuple[Any, ...], str | None] = {}

    for key, w, _ov in parsed:
        if key in results:  # forbidden already
            continue
        if str(w.get("type") or "") != "kpi_bar_chart":
            results[key] = {"ok": False, "error": "unsupported_widget_type"}
            continue
        kpi_id = int(w.get("kpi_id") or 0)
        year = int(w.get("year") or 0)
        period_key = w.get("period_key")
        if not kpi_id or not year:
            results[key] = {"ok": False, "error": "missing kpi_id or year"}
            continue
        mode = w.get("mode") or "fields"
        if mode != "multi_line_items":
            # Keep existing per-widget path for non-mline charts (rare on bar/pie).
            meta, data, e_rev = await _kpi_bar_chart_payload(db, org_id, w)
            results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": meta, "data": data, "entry_revision": e_rev}
            continue

        source_key = str(w.get("source_field_key") or "").strip()
        f_full = await _mline_field_for(kpi_id, source_key)
        if not f_full:
            results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": {"kpi_id": kpi_id, "year": year, "entry_id": None, "row_count": 0}, "data": {"mode": "multi_line_items", "raw_rows": []}, "entry_revision": None}
            continue

        eid, e_ts = await _entry_for(kpi_id, year, period_key)
        e_rev = revision_for_parts(eid, e_ts)
        if not eid:
            results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": {"kpi_id": kpi_id, "year": year, "entry_id": None, "row_count": 0, "source_field_id": int(f_full.id)}, "data": {"mode": "multi_line_items", "multi_line_agg_buckets": [], "raw_rows": []}, "entry_revision": None}
            continue

        agg_w = str(w.get("agg") or "count_rows").strip().lower()
        group_key = str(w.get("group_by_sub_field_key") or "").strip()
        filt_key = str(w.get("filter_sub_field_key") or "").strip()
        val_key = str(w.get("value_sub_field_key") or "").strip()

        sub_id_by_key, ref_types = sub_map_cache[int(f_full.id)]
        gid = sub_id_by_key.get(group_key)
        fid = sub_id_by_key.get(filt_key) if filt_key else None
        vid = sub_id_by_key.get(val_key) if val_key else None

        if gid is None:
            results[key] = {"ok": False, "error": "missing group_by_sub_field_key"}
            continue

        raw_filters = w.get("filters")
        resolved_label_sets: dict[int, set[str]] | None = None
        if isinstance(raw_filters, dict) and raw_filters.get("_version") == 2:
            conds = raw_filters.get("conditions")
            if isinstance(conds, list) and any(isinstance(c, dict) and isinstance(c.get("reference_resolution"), dict) for c in conds):
                resolved_label_sets = {}
                for ci, c in enumerate(conds):
                    if not isinstance(c, dict) or not isinstance(c.get("reference_resolution"), dict):
                        continue
                    fk = c.get("field")
                    if fk is None:
                        continue
                    sid = sub_id_by_key.get(str(fk))
                    if sid is None:
                        continue
                    labs = await _distinct_multiline_subfield_labels(
                        db,
                        entry_id=int(eid),
                        multiline_field_id=int(f_full.id),
                        sub_field_id=int(sid),
                    )
                    row_dicts = [{str(fk): lab} for lab in labs]
                    res_map = await build_reference_resolution_map(db, org_id, int(year), f_full, conds, row_dicts)
                    op = str(c.get("op") or "eq").strip().lower().replace("op_", "", 1)
                    vals_raw = c.get("values")
                    allowed: set[str] = set()
                    for lab in labs:
                        resolved = res_map.get((ci, _normalize_reference_value(lab)))
                        if isinstance(vals_raw, list) and len(vals_raw) > 1:
                            if op == "eq":
                                ok = any(match_cell_value(resolved, "eq", v) for v in vals_raw)
                            elif op == "neq":
                                ok = all(match_cell_value(resolved, "neq", v) for v in vals_raw)
                            else:
                                ok = match_cell_value(resolved, op, vals_raw[0])
                        else:
                            ok = match_cell_value(resolved, op, c.get("value"))
                        if ok:
                            allowed.add(lab)
                    if allowed:
                        resolved_label_sets[ci] = allowed

        compiled = compile_multiline_row_filters_sql(
            raw_filters,
            sub_id_by_key=sub_id_by_key,
            reference_field_types=ref_types,
            resolved_label_sets=resolved_label_sets,
        )
        if compiled is None:
            # Fallback: do not aggregate in SQL for this widget.
            meta, data, e_rev2 = await _kpi_bar_chart_payload(db, org_id, w)
            results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": meta, "data": data, "entry_revision": e_rev2}
            continue
        filter_where_sql, filter_params, filter_sid_params = compiled
        if not (filter_where_sql or "").strip():
            filter_where_sql, filter_params = (None, None)
            filter_sid_params = []

        sig = (
            int(eid),
            int(f_full.id),
            int(gid),
            int(fid) if fid is not None else None,
            int(vid) if vid is not None else None,
            agg_w,
            filter_where_sql or "",
            repr(sorted((filter_params or {}).items())),
            repr(filter_sid_params or []),
        )
        sig_to_widgets.setdefault(sig, []).append(key)
        sig_to_args[sig] = {
            "entry_id": int(eid),
            "multiline_field_id": int(f_full.id),
            "group_sub_field_id": int(gid),
            "filter_sub_field_id": int(fid) if fid is not None else None,
            "value_sub_field_id": int(vid) if vid is not None else None,
            "agg": agg_w,
            "filter_where_sql": filter_where_sql,
            "filter_params": filter_params,
            "filter_sid_params": filter_sid_params or [],
        }
        sig_to_rev[sig] = e_rev

    # Execute unique aggregates.
    #
    # NOTE: We must not run concurrent `db.execute(...)` calls on the same AsyncSession; that can hang.
    # To regain performance on dashboards with many chart widgets, we run aggregates concurrently but
    # each aggregate uses its own short-lived session.
    #
    # Also: prefer DB-level statement timeout (via SET LOCAL) rather than Python cancellation; it
    # avoids leaving connections/transactions in a broken state.
    settings = get_settings()
    # Default to 30s; can be lowered/raised per deployment.
    timeout_ms = int(getattr(settings, "WIDGET_CHART_STATEMENT_TIMEOUT_MS", 30000) or 30000)
    # Keep concurrency modest; each aggregate can be heavy on large multi-line KPIs.
    max_concurrency = int(getattr(settings, "WIDGET_CHART_MAX_CONCURRENCY", 2) or 2)

    sigs = list(sig_to_widgets.keys())
    sem = asyncio.Semaphore(max(1, min(8, max_concurrency)))

    async def _run_sig(sig: tuple[Any, ...]) -> tuple[tuple[Any, ...], list[dict[str, Any]] | None, str | None]:
        args = sig_to_args.get(sig) or {}
        async with sem:
            try:
                async with AsyncSessionLocal() as s:
                    # asyncpg does not support bind params in `SET LOCAL ...` statements.
                    # timeout_ms is int-coerced above; clamp to a reasonable range and inline as literal.
                    ms = int(timeout_ms)
                    if ms < 1000:
                        ms = 1000
                    if ms > 300_000:
                        ms = 300_000
                    await s.execute(text(f"SET LOCAL statement_timeout = {ms}"))
                    buckets = await fetch_multiline_bar_agg_buckets(s, **args)
                    return (sig, buckets, None)
            except Exception as e:
                # Best-effort logging for timeouts/slowness triage.
                try:
                    if "statement timeout" in str(e).lower():
                        # Include minimal identifiers (no PII): entry_id/field ids only.
                        print(
                            "[widget-data] chart aggregate timeout "
                            f"dashboard_id={dashboard_id} org_id={org_id} "
                            f"entry_id={args.get('entry_id')} field_id={args.get('multiline_field_id')} "
                            f"group_sid={args.get('group_sub_field_id')} filter_sid={args.get('filter_sub_field_id')} "
                            f"agg={args.get('agg')} timeout_ms={timeout_ms}"
                        )
                except Exception:
                    pass
                return (sig, None, str(e))

    runs = await asyncio.gather(*[_run_sig(sig) for sig in sigs], return_exceptions=False)

    for sig, buckets, err in runs:
        keys = sig_to_widgets.get(sig) or []
        args = sig_to_args.get(sig) or {}
        if err or buckets is None:
            for key in keys:
                # Unify timeout messaging for UI.
                msg = "aggregate timed out" if "statement timeout" in str(err or "").lower() else (err or "aggregate failed")
                results[key] = {"ok": False, "error": msg}
            continue
        row_count = sum(int(b["n"]) for b in buckets)
        for key in keys:
            info = info_by_key.get(key) or {}
            kpi_id = int(info.get("kpi_id") or 0)
            year = int(info.get("year") or 0)
            pk = info.get("period_key")
            fmap = fmap_cache.get(kpi_id) or {}
            results[key] = {
                "ok": True,
                "widget_type": "kpi_bar_chart",
                "meta": {
                    "kpi_id": kpi_id,
                    "year": year,
                    "period_key": pk,
                    "entry_id": args.get("entry_id"),
                    "row_count": row_count,
                    "source_field_id": args.get("multiline_field_id"),
                },
                "data": {
                    "mode": "multi_line_items",
                    "multi_line_agg_buckets": buckets,
                    "raw_rows": [],
                    "field_map": fmap,
                },
                "entry_revision": sig_to_rev.get(sig),
            }

    return results


async def _distinct_multiline_subfield_labels(
    db: AsyncSession,
    *,
    entry_id: int,
    multiline_field_id: int,
    sub_field_id: int,
) -> list[str]:
    """
    Get distinct display labels for one multi-line subfield in an entry.
    Used to pre-resolve reference_resolution filters without loading all rows.
    """
    # Keep it simple: prefer value_text, else stringify other typed columns.
    stmt = text(
        """
        SELECT DISTINCT
          COALESCE(
            NULLIF(TRIM(BOTH FROM c.value_text), ''),
            CASE WHEN c.value_number IS NOT NULL THEN TRIM(TO_CHAR(c.value_number, 'FM999999990.999999999999')) ELSE NULL END,
            CASE WHEN c.value_boolean IS NOT NULL THEN c.value_boolean::text ELSE NULL END,
            CASE WHEN c.value_date IS NOT NULL THEN TO_CHAR(c.value_date, 'YYYY-MM-DD') ELSE NULL END,
            CASE WHEN c.value_json IS NOT NULL THEN c.value_json::text ELSE NULL END
          ) AS lab
        FROM kpi_multi_line_rows r
        JOIN kpi_multi_line_cells c ON c.row_id = r.id AND c.sub_field_id = :sid
        WHERE r.entry_id = :eid AND r.field_id = :fid
        """
    )
    res = await db.execute(stmt, {"eid": int(entry_id), "fid": int(multiline_field_id), "sid": int(sub_field_id)})
    out: list[str] = []
    for row in res.all():
        v = row[0]
        if v is None:
            continue
        s = str(v).strip()
        if s:
            out.append(s)
    return out

# ---------------------------------------------------------------------------
# Limits (table widgets: protect memory / payload size)
# ---------------------------------------------------------------------------
MAX_MULTILINE_TABLE_ROWS = 2000


# ---------------------------------------------------------------------------
# Small numeric / aggregation helpers (mirror frontend toNumeric / aggregateMultiLine)
# ---------------------------------------------------------------------------
def to_numeric(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            return None
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    try:
        n = float(s.replace(",", ""))
        if math.isnan(n) or math.isinf(n):
            return None
        return n
    except (TypeError, ValueError):
        return None


def safe_key(x: Any) -> str:
    s = "" if x is None else str(x).strip()
    return s or "(empty)"


def aggregate_multi_line(
    items: list[dict[str, Any]],
    *,
    group_by_key: str,
    agg: str,
    value_key: str | None = None,
) -> list[dict[str, Any]]:
    m: dict[str, dict[str, float]] = {}
    for row in items:
        if not row:
            continue
        label = safe_key(row.get(group_by_key))
        cur = m.get(label) or {"sum": 0.0, "count": 0.0}
        cur["count"] += 1.0
        if agg in ("sum", "avg") and value_key:
            n = to_numeric(row.get(value_key))
            if n is not None:
                cur["sum"] += n
        m[label] = cur
    out: list[dict[str, Any]] = []
    for label, v in m.items():
        cnt, s = v["count"], v["sum"]
        if agg == "count_rows":
            out.append({"label": label, "value": cnt})
        elif agg == "sum":
            out.append({"label": label, "value": s})
        else:  # avg
            out.append({"label": label, "value": s / cnt if cnt else 0.0})
    return out


def aggregate_single_value(
    items: list[dict[str, Any]],
    *,
    agg: str,
    value_key: str | None = None,
) -> float | None:
    if agg == "count":
        return float(len(items))
    nums: list[float] = []
    for row in items:
        if not row:
            continue
        n = to_numeric(row.get(value_key or ""))
        if n is not None:
            nums.append(n)
    if not nums:
        return None
    if agg == "sum":
        return float(sum(nums))
    if agg == "avg":
        return sum(nums) / len(nums)
    if agg == "min":
        return min(nums)
    if agg == "max":
        return max(nums)
    return None


def _period_key_norm(period_key: str | None) -> str:
    return (period_key or "").strip()[:8]


def _merge_overrides(w: dict[str, Any], overrides: dict[str, Any] | None) -> dict[str, Any]:
    out = dict(w)
    if not overrides:
        return out
    for k, v in overrides.items():
        out[k] = v
    return out


def _field_value_raw(fv: KPIFieldValue) -> Any:
    for attr in ("value_text", "value_number", "value_boolean", "value_date", "value_json"):
        val = getattr(fv, attr, None)
        if val is not None:
            if attr == "value_date" and hasattr(val, "isoformat"):
                try:
                    return val.isoformat()
                except Exception:  # noqa: S110
                    return str(val)
            return val
    return None


def raw_field_from_entry(entry: KPIEntry | None, field_id: int) -> Any:
    if not entry or not field_id:
        return None
    for fv in entry.field_values or []:
        if int(fv.field_id) == int(field_id):
            return _field_value_raw(fv)
    return None


def raw_field_from_fv_map(fv_by_id: dict[int, KPIFieldValue], field_id: int) -> Any:
    if not field_id:
        return None
    fv = fv_by_id.get(int(field_id))
    return _field_value_raw(fv) if fv else None


def build_kpi_field_maps(fields: list[KPIField]) -> dict[str, Any]:
    id_by_key: dict[str, int] = {}
    name_by_key: dict[str, str] = {}
    for f in fields:
        if f.key is not None:
            id_by_key[str(f.key)] = int(f.id)
            name_by_key[str(f.key)] = f.name
    return {"id_by_key": id_by_key, "name_by_key": name_by_key}


async def get_entry_readonly(
    db: AsyncSession,
    *,
    org_id: int,
    kpi_id: int,
    year: int,
    period_key: str | None,
) -> KPIEntry | None:
    """Full entry with all field values — avoid for hot widget paths; use get_entry_id_updated + targeted FVs."""
    pk = _period_key_norm(period_key)
    res = await db.execute(
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == int(year),
            KPIEntry.period_key == pk,
        )
        .options(selectinload(KPIEntry.field_values))
    )
    return res.scalar_one_or_none()


async def get_entry_id_updated(
    db: AsyncSession,
    *,
    org_id: int,
    kpi_id: int,
    year: int,
    period_key: str | None,
) -> tuple[int | None, Any]:
    """
    One lightweight query: entry id + updated_at only.
    Avoids selectinload of every KPIFieldValue (can be 100+ rows and megabytes for large KPIs).
    """
    pk = _period_key_norm(period_key)
    r = await db.execute(
        select(KPIEntry.id, KPIEntry.updated_at)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == int(year),
            KPIEntry.period_key == pk,
        )
    )
    row = r.one_or_none()
    if not row:
        return None, None
    return int(row[0]), row[1]


async def get_field_values_for_field_ids(
    db: AsyncSession, *, entry_id: int, field_ids: list[int]
) -> dict[int, KPIFieldValue]:
    if not field_ids:
        return {}
    uq = sorted({int(x) for x in field_ids})
    res = await db.execute(
        select(KPIFieldValue).where(
            KPIFieldValue.entry_id == entry_id,
            KPIFieldValue.field_id.in_(uq),
        )
    )
    rows = res.scalars().all()
    return {int(fv.field_id): fv for fv in rows}


async def fetch_entry_revision_and_field_values(
    db: AsyncSession,
    *,
    org_id: int,
    kpi_id: int,
    year: int,
    period_key: str | None,
    field_ids: list[int],
) -> tuple[int | None, Any, dict[int, KPIFieldValue]]:
    """
    One round-trip: resolve (entry id, updated_at) and all KPIFieldValue rows for those field_ids.
    Replaces get_entry_id_updated + get_field_values_for_field_ids for hot scalar widget paths.
    """
    pk = _period_key_norm(period_key)
    uq = sorted({int(x) for x in field_ids})
    if not uq:
        eid, e_ts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
        )
        return eid, e_ts, {}
    res = await db.execute(
        select(KPIEntry.id, KPIEntry.updated_at, KPIFieldValue)
        .select_from(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == int(year),
            KPIEntry.period_key == pk,
        )
        .outerjoin(
            KPIFieldValue,
            and_(
                KPIFieldValue.entry_id == KPIEntry.id,
                KPIFieldValue.field_id.in_(uq),
            ),
        )
    )
    flat = res.all()
    if not flat:
        return None, None, {}
    eid: int | None = None
    e_ts: Any = None
    fv_by_id: dict[int, KPIFieldValue] = {}
    for r in flat:
        if eid is None and r[0] is not None:
            eid = int(r[0])
            e_ts = r[1]
        fv = r[2]
        if fv is not None:
            fv_by_id[int(fv.field_id)] = fv
    return eid, e_ts, fv_by_id


async def fetch_scalar_bar_chart_bundle(
    db: AsyncSession,
    *,
    org_id: int,
    kpi_id: int,
    year: int,
    period_key: str | None,
) -> tuple[dict[str, Any], int | None, Any, dict[int, KPIFieldValue]]:
    """
    Single SQL for scalar bar/pie: all KPI fields (for field_map) + entry id/updated_at + field values.
    Avoids separate list_kpi_field_definitions + fetch_entry_revision_and_field_values round-trips.
    """
    pk = _period_key_norm(period_key)
    res = await db.execute(
        select(
            KPIField.id,
            KPIField.key,
            KPIField.name,
            KPIField.sort_order,
            KPIEntry.id,
            KPIEntry.updated_at,
            KPIFieldValue,
        )
        .select_from(KPIField)
        .join(
            KPI,
            and_(KPI.id == KPIField.kpi_id, KPI.id == int(kpi_id), KPI.organization_id == org_id),
        )
        .outerjoin(
            KPIEntry,
            and_(
                KPIEntry.kpi_id == int(kpi_id),
                KPIEntry.organization_id == org_id,
                KPIEntry.year == int(year),
                KPIEntry.period_key == pk,
            ),
        )
        .outerjoin(
            KPIFieldValue,
            and_(
                KPIFieldValue.entry_id == KPIEntry.id,
                KPIFieldValue.field_id == KPIField.id,
            ),
        )
        .order_by(KPIField.sort_order, KPIField.id)
    )
    flat = res.all()
    id_by_key: dict[str, int] = {}
    name_by_key: dict[str, str] = {}
    eid: int | None = None
    e_ts: Any = None
    fv_by_id: dict[int, KPIFieldValue] = {}
    for r in flat:
        fid, key, name, _so, e_row_id, e_row_ts, fv = r[0], r[1], r[2], r[3], r[4], r[5], r[6]
        if fid is None:
            continue
        if key is not None and str(key).strip():
            id_by_key[str(key)] = int(fid)
            name_by_key[str(key)] = str(name or key)
        if eid is None and e_row_id is not None:
            eid = int(e_row_id)
            e_ts = e_row_ts
        if fv is not None:
            fv_by_id[int(fv.field_id)] = fv
    fmap: dict[str, Any] = {"id_by_key": id_by_key, "name_by_key": name_by_key}
    return fmap, eid, e_ts, fv_by_id


def entry_revision_for(entry: KPIEntry | None) -> str | None:
    if not entry:
        return None
    ts = getattr(entry, "updated_at", None)
    ts_s = ts.isoformat() if ts is not None and hasattr(ts, "isoformat") else ""
    return f"{entry.id}:{ts_s}"


def revision_for_parts(entry_id: int | None, updated_at: Any) -> str | None:
    if not entry_id:
        return None
    ts = updated_at
    ts_s = ts.isoformat() if ts is not None and hasattr(ts, "isoformat") else ""
    return f"{entry_id}:{ts_s}"


async def _apply_row_filters(
    db: AsyncSession,
    org_id: int,
    field: KPIField,
    year_for_ref: int | None,
    raw_filters: Any,
    rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if raw_filters is None or raw_filters == {}:
        return rows
    if isinstance(raw_filters, str) and not raw_filters.strip():
        return rows
    if isinstance(raw_filters, str):
        try:
            raw_filters = json.loads(raw_filters)
        except json.JSONDecodeError:
            return rows
    if not isinstance(raw_filters, dict):
        return rows
    if raw_filters.get("_version") == 2:
        conds = raw_filters.get("conditions")
        reference_field_types: dict[str, str] = {}
        for sf in field.sub_fields or []:
            k = getattr(sf, "key", "")
            ft = getattr(getattr(sf, "field_type", None), "value", sf.field_type)
            reference_field_types[str(k)] = str(ft or "")
        resolution_maps = None
        if isinstance(conds, list):
            needs_ref = False
            for c in conds:
                if not isinstance(c, dict):
                    continue
                if c.get("reference_resolution"):
                    needs_ref = True
                    break
                fk = c.get("field")
                if fk is not None and reference_field_types.get(str(fk)) in ("reference", "multi_reference"):
                    needs_ref = True
                    break
            if needs_ref:
                resolution_maps = await build_reference_resolution_map(
                    db, org_id, year_for_ref, field, conds, [r for r in rows if isinstance(r, dict)]
                )
        return [r for r in rows if isinstance(r, dict) and row_passes_filters(r, raw_filters, resolution_maps=resolution_maps, reference_field_types=reference_field_types)]
    return [r for r in rows if isinstance(r, dict) and row_passes_filters(r, raw_filters)]


async def load_multi_line_row_dicts_filtered(
    db: AsyncSession,
    org_id: int,
    *,
    entry_id: int,
    field: KPIField,
    kpi_id: int,
    year: int,
    raw_filters: Any,
) -> tuple[list[dict[str, Any]], int]:
    pairs = await load_multi_line_row_dicts(db, entry_id=entry_id, field=field)
    rows = [d for _i, d in pairs if isinstance(d, dict)]
    n_before = len(rows)
    filtered = await _apply_row_filters(
        db,
        org_id,
        field,
        int(year) if year else None,
        raw_filters,
        rows,
    )
    return filtered, n_before


def _multi_line_needs_subfield_rows_for_filters(raw_filters: Any) -> bool:
    """
    _apply_row_filters with empty/None does not use field.sub_fields.
    Row filters and reference resolution use subfield metadata — load those only when needed.
    """
    if raw_filters is None or raw_filters == {}:
        return False
    if isinstance(raw_filters, str) and not str(raw_filters).strip():
        return False
    return True


async def _field_with_subs_if_mline_filters(
    db: AsyncSession,
    org_id: int,
    f: KPIField | None,
    raw_filters: Any,
) -> KPIField | None:
    if not f:
        return None
    if not _multi_line_needs_subfield_rows_for_filters(raw_filters):
        return f
    return await get_field_with_subfields_only(db, f.id, org_id) or f


# ---------------------------------------------------------------------------
# Resolvers: (db, user, org_id, merged) -> (meta, data, etag)
# ---------------------------------------------------------------------------
WidgetResolver = Callable[[AsyncSession, User, int, dict[str, Any]], Awaitable[tuple[dict[str, Any], dict[str, Any], str | None]]]


async def _kpi_bar_chart_payload(
    db: AsyncSession, org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """
    Bar/pie widget data after tenant KPI existence is verified.
    No permission checks — callers must enforce KPI or dashboard access.
    """
    kpi_id = int(w.get("kpi_id") or 0)
    year = int(w.get("year") or 0)
    period_key = w.get("period_key")
    mode = w.get("mode") or "fields"
    if not kpi_id or not year:
        return (
            {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": None},
            {"error": "missing kpi_id or year"},
            None,
        )
    kpi = (await db.execute(select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id))).scalar_one_or_none()
    if not kpi:
        return (
            {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": None},
            {"error": "KPI not found"},
            None,
        )

    if mode == "multi_line_items":
        fields = await list_kpi_field_definitions(db, kpi_id, org_id)
        fmap = build_kpi_field_maps(fields)
        eid, e_ts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
        )
        e_rev = revision_for_parts(eid, e_ts)
        source_key = (w.get("source_field_key") or "").strip()
        f_obj = next((f for f in fields if f.key == source_key and f.field_type == FieldType.multi_line_items), None)
        if not f_obj or not eid:
            return (
                {
                    "kpi_id": kpi_id,
                    "year": year,
                    "period_key": _period_key_norm(period_key),
                    "entry_id": eid,
                    "row_count": 0,
                    "source_field_id": f_obj.id if f_obj else None,
                },
                {
                    "mode": "multi_line_items",
                    "raw_rows": [],
                },
                e_rev,
            )
        raw_filters = w.get("filters")
        agg_w = str(w.get("agg") or "count_rows").strip().lower()
        group_key = (w.get("group_by_sub_field_key") or "").strip()
        filt_key = (w.get("filter_sub_field_key") or "").strip()
        val_key = (w.get("value_sub_field_key") or "").strip()
        use_sql_agg = agg_w in ("count_rows", "sum", "avg")
        filter_where_sql: str | None = None
        filter_sql_params: dict[str, Any] | None = None
        if use_sql_agg:
            f_full = await get_field_with_subfields_only(db, int(f_obj.id), org_id) or f_obj
            sub_id_by_key: dict[str, int] = {}
            reference_field_types: dict[str, str] = {}
            for sf in getattr(f_full, "sub_fields", None) or []:
                sk = getattr(sf, "key", None)
                if sk:
                    sks = str(sk)
                    sub_id_by_key[sks] = int(sf.id)
                    ft = getattr(getattr(sf, "field_type", None), "value", sf.field_type)
                    reference_field_types[sks] = str(ft or "")
            gid = sub_id_by_key.get(group_key)
            fid = sub_id_by_key.get(filt_key) if filt_key else None
            vid = sub_id_by_key.get(val_key) if val_key else None
            if filt_key and fid is None:
                use_sql_agg = False
            if agg_w in ("sum", "avg") and val_key and vid is None:
                use_sql_agg = False
            if use_sql_agg:
                resolved_label_sets: dict[int, set[str]] | None = None
                # reference_resolution: resolve distinct labels once and convert to label IN (...) so we can keep SQL agg.
                if isinstance(raw_filters, dict) and raw_filters.get("_version") == 2:
                    conds = raw_filters.get("conditions")
                    if isinstance(conds, list) and any(
                        isinstance(c, dict) and isinstance(c.get("reference_resolution"), dict) for c in conds
                    ):
                        resolved_label_sets = {}
                        # Need subfield metadata for build_reference_resolution_map.
                        # Distinct labels are extracted via SQL, not from full row dicts.
                        for ci, c in enumerate(conds):
                            if not isinstance(c, dict) or not isinstance(c.get("reference_resolution"), dict):
                                continue
                            fk = c.get("field")
                            if fk is None:
                                continue
                            fk_s = str(fk)
                            sid = sub_id_by_key.get(fk_s)
                            if sid is None:
                                continue
                            labs = await _distinct_multiline_subfield_labels(
                                db,
                                entry_id=int(eid),
                                multiline_field_id=int(f_obj.id),
                                sub_field_id=int(sid),
                            )
                            # Build a minimal row_dict list so reference_filter_resolve can discover labels.
                            row_dicts = [{fk_s: lab} for lab in labs]
                            res_map = await build_reference_resolution_map(
                                db, org_id, int(year) if year else None, f_full, conds, row_dicts
                            )
                            # Apply this condition to resolved values to compute allowed labels.
                            op = str(c.get("op") or "eq").strip().lower().replace("op_", "", 1)
                            vals_raw = c.get("values")
                            allowed: set[str] = set()
                            for lab in labs:
                                resolved = res_map.get((ci, _normalize_reference_value(lab)))
                                if isinstance(vals_raw, list) and len(vals_raw) > 1:
                                    if op == "eq":
                                        ok = any(match_cell_value(resolved, "eq", v) for v in vals_raw)
                                    elif op == "neq":
                                        ok = all(match_cell_value(resolved, "neq", v) for v in vals_raw)
                                    else:
                                        ok = match_cell_value(resolved, op, vals_raw[0])
                                else:
                                    ok = match_cell_value(resolved, op, c.get("value"))
                                if ok:
                                    allowed.add(lab)
                            if allowed:
                                resolved_label_sets[ci] = allowed

                compiled = compile_multiline_row_filters_sql(
                    raw_filters,
                    sub_id_by_key=sub_id_by_key,
                    reference_field_types=reference_field_types,
                    resolved_label_sets=resolved_label_sets,
                )
                if compiled is None:
                    use_sql_agg = False
                else:
                    filter_where_sql, filter_sql_params = compiled
                    if not (filter_where_sql or "").strip():
                        filter_where_sql = None
                        filter_sql_params = None
            if gid is not None and use_sql_agg:
                try:
                    buckets = await fetch_multiline_bar_agg_buckets(
                        db,
                        entry_id=int(eid),
                        multiline_field_id=int(f_obj.id),
                        group_sub_field_id=int(gid),
                        filter_sub_field_id=int(fid) if fid is not None else None,
                        value_sub_field_id=int(vid) if vid is not None else None,
                        agg=agg_w,
                        filter_where_sql=filter_where_sql,
                        filter_params=filter_sql_params,
                    )
                except Exception:
                    buckets = None
                if buckets is not None:
                    row_count = sum(int(b["n"]) for b in buckets)
                    return (
                        {
                            "kpi_id": kpi_id,
                            "year": year,
                            "period_key": _period_key_norm(period_key),
                            "entry_id": eid,
                            "row_count": row_count,
                            "source_field_id": int(f_obj.id),
                        },
                        {
                            "mode": "multi_line_items",
                            "multi_line_agg_buckets": buckets,
                            "raw_rows": [],
                            "field_map": fmap,
                        },
                        e_rev,
                    )
        f_obj = await _field_with_subs_if_mline_filters(
            db, org_id, f_obj, raw_filters
        )
        rows, _n_before = await load_multi_line_row_dicts_filtered(
            db, org_id, entry_id=eid, field=f_obj, kpi_id=kpi_id, year=year, raw_filters=raw_filters
        )
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": eid,
                "row_count": len(rows),
                "source_field_id": int(f_obj.id),
            },
            {"mode": "multi_line_items", "raw_rows": rows, "field_map": fmap},
            e_rev,
        )

    fmap, eid, e_ts, fv_by_id = await fetch_scalar_bar_chart_bundle(
        db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
    )
    e_rev = revision_for_parts(eid, e_ts)
    keys: list[str] = list(w.get("field_keys") or [])
    bars: list[dict[str, Any]] = []
    if not eid:
        for key in keys:
            bars.append({"key": key, "label": fmap["name_by_key"].get(key) or key, "value": None})
        return (
            {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": None, "row_count": 0},
            {"mode": "fields", "bars": bars, "field_map": fmap},
            None,
        )
    for key in keys:
        fid = fmap["id_by_key"].get(key)
        val = to_numeric(raw_field_from_fv_map(fv_by_id, int(fid))) if fid else None
        bars.append({"key": key, "label": fmap["name_by_key"].get(key) or key, "value": val})
    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": eid,
            "row_count": 0,
        },
        {"mode": "fields", "bars": bars, "field_map": fmap},
        e_rev,
    )


async def _resolve_kpi_bar_chart(
    db: AsyncSession, user: User, org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    kpi_id = int(w.get("kpi_id") or 0)
    year = int(w.get("year") or 0)
    period_key = w.get("period_key")
    if not kpi_id or not year:
        return (
            {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": None},
            {"error": "missing kpi_id or year"},
            None,
        )
    if not await can_view_kpi_for_user(db, user, kpi_id, org_id=org_id):
        return (
            {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": None},
            {"error": "forbidden"},
            None,
        )
    return await _kpi_bar_chart_payload(db, org_id, w)


async def _resolve_kpi_trend(db: AsyncSession, user: User, org_id: int, w: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    kpi_id = int(w.get("kpi_id") or 0)
    if not kpi_id:
        return ({"kpi_id": 0, "row_count": 0}, {"error": "missing kpi_id"}, None)
    if not await can_view_kpi_for_user(db, user, kpi_id, org_id=org_id):
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "forbidden"}, None)
    kpi = (await db.execute(select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id))).scalar_one_or_none()
    if not kpi:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "KPI not found"}, None)

    start_y = int(w.get("start_year") or 0)
    end_y = int(w.get("end_year") or 0)
    lo, hi = (min(start_y, end_y), max(start_y, end_y)) if start_y and end_y else (0, 0)

    def _y_int(x: Any) -> int | None:
        if x is None or isinstance(x, bool):
            return None
        if isinstance(x, int):
            return int(x)
        if isinstance(x, float):
            if math.isnan(x) or math.isinf(x):
                return None
            return int(x)
        s = str(x).strip()
        if not s:
            return None
        s2 = s[1:] if s.startswith(("-", "+")) else s
        if s2.isdigit() or (("." in s2) and s2.replace(".", "", 1).isdigit()):
            try:
                return int(float(s))
            except (TypeError, ValueError):
                return None
        return None

    selected = w.get("selected_years")
    years: list[int] = []
    if isinstance(selected, list) and selected:
        years = sorted({yy for v in selected if (yy := _y_int(v)) is not None}, reverse=True)
    if not years:
        dy = w.get("default_years")
        if isinstance(dy, list) and dy:
            years = sorted({yy for v in dy if (yy := _y_int(v)) is not None}, reverse=True)
    if not years and hi:
        years = [hi]
    if years and lo and hi and lo <= hi:
        years = [yy for yy in years if lo <= yy <= hi]
    period_key = w.get("period_key")
    mode = w.get("mode") or "fields"
    fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    fmap = build_kpi_field_maps(fields)

    revisions: list[str] = []
    if mode == "multi_line_items":
        source_key = (w.get("source_field_key") or "").strip()
        f_obj = next((f for f in fields if f.key == source_key and f.field_type == FieldType.multi_line_items), None)
        f_obj = await _field_with_subs_if_mline_filters(db, org_id, f_obj, w.get("filters"))
        raw_by_year: dict[str, list[dict[str, Any]]] = {}
        for yy in years:
            eid_y, e_ts = await get_entry_id_updated(
                db, org_id=org_id, kpi_id=kpi_id, year=yy, period_key=period_key
            )
            r = revision_for_parts(eid_y, e_ts)
            if r:
                revisions.append(r)
            if not f_obj or not eid_y:
                raw_by_year[str(yy)] = []
                continue
            row_list, _n = await load_multi_line_row_dicts_filtered(
                db, org_id, entry_id=eid_y, field=f_obj, kpi_id=kpi_id, year=yy, raw_filters=w.get("filters")
            )
            raw_by_year[str(yy)] = row_list
        e_rev = "|".join(revisions) if revisions else None
        return (
            {
                "kpi_id": kpi_id,
                "period_key": _period_key_norm(period_key),
                "row_count": sum(len(v) for v in raw_by_year.values()),
                "years": years,
            },
            {"mode": "multi_line_items", "raw_rows_by_year": raw_by_year, "field_map": fmap},
            e_rev,
        )

    keys: list[str] = list(w.get("field_keys") or [])
    fids = [fmap["id_by_key"][k] for k in keys if fmap["id_by_key"].get(k)]
    field_bars: dict[str, list[dict[str, Any]]] = {}
    for yy in years:
        eid_y, e_ts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=kpi_id, year=yy, period_key=period_key
        )
        r = revision_for_parts(eid_y, e_ts)
        if r:
            revisions.append(r)
        bars: list[dict[str, Any]] = []
        if not eid_y:
            for key in keys:
                bars.append({"key": key, "label": fmap["name_by_key"].get(key) or key, "value": None})
        else:
            fv_by_id = await get_field_values_for_field_ids(db, entry_id=eid_y, field_ids=fids)
            for key in keys:
                fid = fmap["id_by_key"].get(key)
                v = to_numeric(raw_field_from_fv_map(fv_by_id, int(fid))) if fid else None
                bars.append({"key": key, "label": fmap["name_by_key"].get(key) or key, "value": v})
        field_bars[str(yy)] = bars
    e_rev = "|".join(revisions) if revisions else None
    return (
        {"kpi_id": kpi_id, "period_key": _period_key_norm(period_key), "row_count": 0, "years": years},
        {"mode": "fields", "field_bars_by_year": field_bars, "field_map": fmap},
        e_rev,
    )


async def _resolve_kpi_line_chart(
    db: AsyncSession, user: User, org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    kpi_id = int(w.get("kpi_id") or 0)
    fk = (w.get("field_key") or "").strip()
    s = int(w.get("start_year") or 0)
    e = int(w.get("end_year") or 0)
    period_key = w.get("period_key")
    if not kpi_id or not fk or not s or not e:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, None)
    if not await can_view_kpi_for_user(db, user, kpi_id, org_id=org_id):
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "forbidden"}, None)
    fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    fmap = build_kpi_field_maps(fields)
    fid = fmap["id_by_key"].get(fk)
    if not fid:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "unknown field_key", "field_map": fmap}, None)
    lo, hi = min(s, e), max(s, e)
    years = list(range(lo, hi + 1))
    points: list[dict[str, Any]] = []
    revisions: list[str] = []
    for y in years:
        eid_y, e_ts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=kpi_id, year=y, period_key=period_key
        )
        r = revision_for_parts(eid_y, e_ts)
        if r:
            revisions.append(r)
        if not eid_y:
            points.append({"year": y, "value": None})
            continue
        fv_by_id = await get_field_values_for_field_ids(db, entry_id=eid_y, field_ids=[int(fid)])
        v = to_numeric(raw_field_from_fv_map(fv_by_id, int(fid)))
        points.append({"year": y, "value": v})
    e_rev = "|".join(revisions) if revisions else None
    return (
        {"kpi_id": kpi_id, "row_count": 0, "field_key": fk, "field_id": int(fid)},
        {"points": points, "field_map": fmap},
        e_rev,
    )


async def _resolve_kpi_table(db: AsyncSession, user: User, org_id: int, w: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    kpi_id = int(w.get("kpi_id") or 0)
    year = int(w.get("year") or 0)
    period_key = w.get("period_key")
    if not kpi_id or not year:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, None)
    if not await can_view_kpi_for_user(db, user, kpi_id, org_id=org_id):
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "forbidden"}, None)
    fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    fmap = build_kpi_field_maps(fields)
    fkeys: list[str] = list(w.get("field_keys") or []) if w.get("field_keys") else list(fmap["id_by_key"].keys())
    eid, e_ts = await get_entry_id_updated(
        db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
    )
    fids = [fmap["id_by_key"][k] for k in fkeys if fmap["id_by_key"].get(k)]
    fv_by_id = await get_field_values_for_field_ids(db, entry_id=eid, field_ids=fids) if eid else {}
    rows_out: list[dict[str, Any]] = []
    for k in fkeys:
        fid = fmap["id_by_key"].get(k)
        raw = raw_field_from_fv_map(fv_by_id, int(fid)) if (eid and fid) else None
        sval = "" if raw is None else (json.dumps(raw) if isinstance(raw, (dict, list)) else str(raw))
        rows_out.append({"label": fmap["name_by_key"].get(k) or k, "value": sval})
    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": eid,
            "row_count": len(rows_out),
        },
        {"rows": rows_out, "field_map": fmap},
        revision_for_parts(eid, e_ts),
    )


async def _resolve_kpi_single_value(
    db: AsyncSession, user: User, org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    kpi_id = int(w.get("kpi_id") or 0)
    year = int(w.get("year") or 0)
    period_key = w.get("period_key")
    field_key = (w.get("field_key") or "").strip()
    if not kpi_id or not year or not field_key:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, None)
    if not await can_view_kpi_for_user(db, user, kpi_id, org_id=org_id):
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "forbidden"}, None)
    fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    fmap = build_kpi_field_maps(fields)
    fid = fmap["id_by_key"].get(field_key)
    eid, e_ts = await get_entry_id_updated(
        db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
    )
    raw = None
    if eid and fid:
        fvm = await get_field_values_for_field_ids(db, entry_id=eid, field_ids=[int(fid)])
        raw = raw_field_from_fv_map(fvm, int(fid))
    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": eid,
            "row_count": 0,
        },
        {
            "raw": raw,
            "display": raw,
            "field_map": fmap,
        },
        revision_for_parts(eid, e_ts),
    )


async def _resolve_kpi_card_single_value(
    db: AsyncSession, user: User, org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    kpi_id = int(w.get("kpi_id") or 0)
    year = int(w.get("year") or 0)
    period_key = w.get("period_key")
    if not kpi_id or not year:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, None)
    if not await can_view_kpi_for_user(db, user, kpi_id, org_id=org_id):
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "forbidden"}, None)
    sm = w.get("source_mode") or "field"
    if sm == "static":
        return (
            {"kpi_id": kpi_id, "year": year, "row_count": 0},
            {"source_mode": "static", "static_value": w.get("static_value")},
            None,
        )
    fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    fmap = build_kpi_field_maps(fields)
    if sm == "field":
        fk = (w.get("field_key") or "").strip()
        eid, e_ts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
        )
        fid = fmap["id_by_key"].get(fk)
        raw = None
        if eid and fid:
            fvm = await get_field_values_for_field_ids(db, entry_id=eid, field_ids=[int(fid)])
            raw = raw_field_from_fv_map(fvm, int(fid))
        n = to_numeric(raw)
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": eid,
                "row_count": 0,
            },
            {"source_mode": "field", "numeric": n, "raw": raw, "field_map": fmap},
            revision_for_parts(eid, e_ts),
        )
    if sm == "multi_line_agg":
        mls = (w.get("source_field_key") or "").strip()
        f_obj = next((f for f in fields if f.key == mls and f.field_type == FieldType.multi_line_items), None)
        eid, e_ts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
        )
        e_rev = revision_for_parts(eid, e_ts)
        if not f_obj or not eid:
            return (
                {
                    "kpi_id": kpi_id,
                    "year": year,
                    "period_key": _period_key_norm(period_key),
                    "entry_id": eid,
                    "row_count": 0,
                },
                {"source_mode": "multi_line_agg", "numeric": None, "raw_rows": []},
                e_rev,
            )
        f_obj = await _field_with_subs_if_mline_filters(
            db, org_id, f_obj, w.get("filters")
        )
        rows, _n = await load_multi_line_row_dicts_filtered(
            db, org_id, entry_id=eid, field=f_obj, kpi_id=kpi_id, year=year, raw_filters=w.get("filters")
        )
        agg = w.get("agg") or "sum"
        n = aggregate_single_value(rows, agg=agg, value_key=w.get("value_sub_field_key") or None)
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": eid,
                "row_count": len(rows),
            },
            {"source_mode": "multi_line_agg", "numeric": n, "raw_rows": rows, "field_map": fmap},
            e_rev,
        )
    return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "unknown source_mode"}, None)


async def _resolve_kpi_multi_line_table(
    db: AsyncSession, user: User, org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    kpi_id = int(w.get("kpi_id") or 0)
    year = int(w.get("year") or 0)
    period_key = w.get("period_key")
    mls = (w.get("source_field_key") or "").strip()
    if not kpi_id or not year or not mls:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, None)
    if not await can_view_kpi_for_user(db, user, kpi_id, org_id=org_id):
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "forbidden"}, None)
    fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    fmap = build_kpi_field_maps(fields)
    f_light = next((f for f in fields if f.key == mls and f.field_type == FieldType.multi_line_items), None)
    f_obj = (
        await get_field_with_subfields_only(db, f_light.id, org_id) if f_light is not None else None
    )
    eid, e_ts = await get_entry_id_updated(
        db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
    )
    e_rev = revision_for_parts(eid, e_ts)
    label_by_key: dict[str, str] = {}
    if f_obj and f_obj.sub_fields:
        for sf in f_obj.sub_fields:
            label_by_key[str(sf.key)] = str(sf.name or sf.key)
    if not f_obj or not eid:
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": eid,
                "row_count": 0,
            },
            {
                "rows": [],
                "sub_field_labels": label_by_key,
                "joins": [],
                "source_field_id": f_obj.id if f_obj else (f_light.id if f_light else None),
                "field_map": fmap,
            },
            e_rev,
        )
    # f_obj already has sub_fields from get_field_with_subfields_only (labels + row filters)
    rows, _n = await load_multi_line_row_dicts_filtered(
        db, org_id, entry_id=eid, field=f_obj, kpi_id=kpi_id, year=year, raw_filters=w.get("filters")
    )
    truncated = len(rows) > MAX_MULTILINE_TABLE_ROWS
    if truncated:
        rows = rows[:MAX_MULTILINE_TABLE_ROWS]
    # Joins: legacy single `join` or `joins` list (same as frontend)
    join_specs: list[dict[str, Any]] = []
    if isinstance(w.get("joins"), list):
        for j in w.get("joins") or []:
            if isinstance(j, dict) and j.get("kpi_id") and j.get("source_field_key"):
                join_specs.append(j)
    elif isinstance(w.get("join"), dict) and w.get("join", {}).get("kpi_id"):
        join_specs.append(w["join"])
    joins_data: list[dict[str, Any]] = []
    for j in join_specs:
        jkpi = int(j.get("kpi_id") or 0)
        if not jkpi or not await can_view_kpi_for_user(db, user, jkpi, org_id=org_id):
            joins_data.append(
                {
                    "kpi_id": jkpi,
                    "rows": [],
                    "sub_field_labels": {},
                    "error": "forbidden" if jkpi else "bad_spec",
                }
            )
            continue
        jfields = await list_kpi_field_definitions(db, jkpi, org_id)
        j_sk = (j.get("source_field_key") or "").strip()
        jf = next((f for f in jfields if f.key == j_sk and f.field_type == FieldType.multi_line_items), None)
        jeid, _jts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=jkpi, year=year, period_key=period_key
        )
        jrows: list[dict[str, Any]] = []
        jlabels: dict[str, str] = {}
        if jf and jeid:
            jf = await get_field_with_subfields_only(db, jf.id, org_id) or jf
            jrows_full, _ = await load_multi_line_row_dicts_filtered(
                db, org_id, entry_id=jeid, field=jf, kpi_id=jkpi, year=year, raw_filters=None
            )
            jrows = jrows_full[:MAX_MULTILINE_TABLE_ROWS]
            if jf.sub_fields:
                for sf in jf.sub_fields:
                    jlabels[str(sf.key)] = str(sf.name or sf.key)
        joins_data.append({"kpi_id": jkpi, "rows": jrows, "sub_field_labels": jlabels, "on_right": j.get("on_right_sub_field_key") or ""})
    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": eid,
            "row_count": len(rows) if not truncated else MAX_MULTILINE_TABLE_ROWS,
            "truncated": truncated,
        },
        {
            "rows": rows,
            "sub_field_labels": label_by_key,
            "joins": joins_data,
            "source_field_id": int(f_obj.id),
            "field_map": fmap,
        },
        e_rev,
    )


async def _resolve_text(
    _db: AsyncSession, _user: User, _org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    return ({"row_count": 0}, {"text": w.get("text") or "", "title": w.get("title") or ""}, None)


WIDGET_RESOLVERS: dict[str, WidgetResolver] = {
    "kpi_bar_chart": _resolve_kpi_bar_chart,
    "kpi_trend": _resolve_kpi_trend,
    "kpi_line_chart": _resolve_kpi_line_chart,
    "kpi_table": _resolve_kpi_table,
    "kpi_single_value": _resolve_kpi_single_value,
    "kpi_card_single_value": _resolve_kpi_card_single_value,
    "kpi_multi_line_table": _resolve_kpi_multi_line_table,
    "text": _resolve_text,
}


async def resolve_dashboard_chart_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    """
    Bar/pie (`kpi_bar_chart`) data when the client is on a dashboard view.
    Authorizes with dashboard view only — skips KPI-level and field-level permission queries.
    """
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_bar_chart":
        return (
            {"error": "unsupported_widget_type"},
            {"supported": ["kpi_bar_chart"], "type": merged.get("type")},
            "error",
            None,
        )
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)
    meta, data, e_rev = await _kpi_bar_chart_payload(db, org_id, merged)
    err = data.get("error")
    if err == "KPI not found" or err == "missing kpi_id or year":
        return meta, data, "error", e_rev
    return meta, data, "kpi_bar_chart", e_rev


async def _field_id_for_kpi_key(db: AsyncSession, *, org_id: int, kpi_id: int, field_key: str) -> int | None:
    fk = (field_key or "").strip()
    if not fk:
        return None
    # Ensure KPI belongs to org and field belongs to KPI.
    stmt = (
        select(KPIField.id)
        .join(KPI, KPI.id == KPIField.kpi_id)
        .where(KPI.id == int(kpi_id), KPI.organization_id == int(org_id), KPIField.key == fk)
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _dashboard_card_payload(
    db: AsyncSession, org_id: int, merged: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """
    Fast path for `kpi_card_single_value`:
    - Avoids loading full field definitions/map.
    - Reads only the requested field value (or returns static).
    """
    kpi_id = int(merged.get("kpi_id") or 0)
    year = int(merged.get("year") or 0)
    period_key = merged.get("period_key")
    if not kpi_id or not year:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, None)

    sm = merged.get("source_mode") or "field"
    if sm == "static":
        return (
            {"kpi_id": kpi_id, "year": year, "row_count": 0},
            {"source_mode": "static", "static_value": merged.get("static_value")},
            None,
        )

    eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
    e_rev = revision_for_parts(eid, e_ts)
    if sm == "field":
        fk = (merged.get("field_key") or "").strip()
        fid = await _field_id_for_kpi_key(db, org_id=org_id, kpi_id=kpi_id, field_key=fk)
        raw = None
        if eid and fid:
            fvm = await get_field_values_for_field_ids(db, entry_id=int(eid), field_ids=[int(fid)])
            raw = raw_field_from_fv_map(fvm, int(fid))
        n = to_numeric(raw)
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": eid,
                "row_count": 0,
            },
            {"source_mode": "field", "numeric": n, "raw": raw},
            e_rev,
        )

    return (
        {"kpi_id": kpi_id, "year": year, "row_count": 0},
        {"error": "unsupported source_mode for fast card endpoint", "source_mode": sm},
        e_rev,
    )


async def resolve_dashboard_card_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_card_single_value":
        return (
            {"error": "unsupported_widget_type"},
            {"supported": ["kpi_card_single_value"], "type": merged.get("type")},
            "error",
            None,
        )
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)
    meta, data, e_rev = await _dashboard_card_payload(db, org_id, merged)
    err = data.get("error")
    if err == "KPI not found" or err == "missing parameters":
        return meta, data, "error", e_rev
    return meta, data, "kpi_card_single_value", e_rev


async def resolve_dashboard_card_widget_data_batch(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    items: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """
    Batch resolver for dashboard KPI cards.

    Supports:
    - source_mode=static (no DB)
    - source_mode=field (scalar/formula stored in kpi_field_values)
    """
    out: dict[str, dict[str, Any]] = {}
    parsed: list[tuple[str, dict[str, Any]]] = []
    for idx, it in enumerate(items or []):
        if not isinstance(it, dict):
            continue
        w = it.get("widget")
        if not isinstance(w, dict):
            continue
        overrides = it.get("overrides") if isinstance(it.get("overrides"), dict) else None
        merged = _merge_overrides(w, overrides)
        wid = merged.get("id")
        key = str(wid) if wid is not None else f"idx:{idx}"
        parsed.append((key, merged))

    # dashboard auth once per KPI
    kpi_ids = sorted({int(w.get("kpi_id") or 0) for _k, w in parsed if int(w.get("kpi_id") or 0) > 0})
    allowed_kpi: dict[int, bool] = {}
    for kpi_id in kpi_ids:
        allowed_kpi[kpi_id] = await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id)

    # group field cards by period
    groups: dict[tuple[int, int, str | None], list[tuple[str, dict[str, Any]]]] = {}
    for key, w in parsed:
        if str(w.get("type") or "") != "kpi_card_single_value":
            out[key] = {"ok": False, "error": "unsupported_widget_type"}
            continue
        kpi_id = int(w.get("kpi_id") or 0)
        if not kpi_id or not allowed_kpi.get(kpi_id, False):
            out[key] = {"ok": False, "error": "forbidden" if kpi_id else "missing kpi_id"}
            continue
        year = int(w.get("year") or 0)
        if not year:
            out[key] = {"ok": False, "error": "missing year"}
            continue
        sm = w.get("source_mode") or "field"
        if sm == "static":
            out[key] = {
                "ok": True,
                "widget_type": "kpi_card_single_value",
                "meta": {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(w.get("period_key")), "entry_id": None, "row_count": 0},
                "data": {"source_mode": "static", "static_value": w.get("static_value")},
                "entry_revision": None,
            }
            continue
        if sm != "field":
            out[key] = {"ok": False, "error": f"unsupported source_mode: {sm}"}
            continue
        pk = _period_key_norm(w.get("period_key"))
        groups.setdefault((kpi_id, year, pk), []).append((key, w))

    for (kpi_id, year, pk), items2 in groups.items():
        eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=pk)
        e_rev = revision_for_parts(eid, e_ts)
        # resolve field ids
        key_to_fid: dict[str, int] = {}
        for key, w in items2:
            fk = str(w.get("field_key") or "").strip()
            fid = await _field_id_for_kpi_key(db, org_id=org_id, kpi_id=kpi_id, field_key=fk)
            if fid:
                key_to_fid[key] = int(fid)
        fids = sorted(set(key_to_fid.values()))
        fvm = await get_field_values_for_field_ids(db, entry_id=int(eid), field_ids=fids) if (eid and fids) else {}
        for key, w in items2:
            fid = key_to_fid.get(key)
            raw = raw_field_from_fv_map(fvm, int(fid)) if (eid and fid) else None
            n = to_numeric(raw)
            out[key] = {
                "ok": True,
                "widget_type": "kpi_card_single_value",
                "meta": {"kpi_id": kpi_id, "year": year, "period_key": pk, "entry_id": eid, "row_count": 0},
                "data": {"source_mode": "field", "numeric": n, "raw": raw},
                "entry_revision": e_rev,
            }

    return out


async def resolve_dashboard_table_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_multi_line_table":
        return (
            {"error": "unsupported_widget_type"},
            {"supported": ["kpi_multi_line_table"], "type": merged.get("type")},
            "error",
            None,
        )
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)
    meta, data, e_rev = await _dashboard_multi_line_table_payload(db, org_id, merged)
    err = data.get("error")
    if err == "KPI not found" or err == "missing parameters":
        return meta, data, "error", e_rev
    return meta, data, "kpi_multi_line_table", e_rev


def _parse_join_specs(w: dict[str, Any]) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    if isinstance(w.get("joins"), list):
        for j in w.get("joins") or []:
            if not isinstance(j, dict):
                continue
            specs.append(j)
    if isinstance(w.get("join"), dict):
        specs.append(w.get("join") or {})
    out: list[dict[str, Any]] = []
    for j in specs:
        try:
            out.append(
                {
                    "kpi_id": int(j.get("kpi_id") or 0),
                    "source_field_key": str(j.get("source_field_key") or "").strip(),
                    "on_left_sub_field_key": str(j.get("on_left_sub_field_key") or "").strip(),
                    "on_right_sub_field_key": str(j.get("on_right_sub_field_key") or "").strip(),
                    "sub_field_keys": [str(x) for x in (j.get("sub_field_keys") or []) if str(x).strip()],
                }
            )
        except Exception:
            continue
    return [
        j
        for j in out
        if j["kpi_id"]
        and j["source_field_key"]
        and j["on_left_sub_field_key"]
        and j["on_right_sub_field_key"]
    ]


async def _dashboard_multi_line_table_payload(
    db: AsyncSession, org_id: int, w: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], str | None]:
    """
    Dashboard fast path for `kpi_multi_line_table`:
    - Dashboard auth already checked by caller.
    - Avoids loading full KPI field definitions/map.
    """
    kpi_id = int(w.get("kpi_id") or 0)
    year = int(w.get("year") or 0)
    period_key = w.get("period_key")
    mls = (w.get("source_field_key") or "").strip()
    if not kpi_id or not year or not mls:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, None)

    kpi = (await db.execute(select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id))).scalar_one_or_none()
    if not kpi:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "KPI not found"}, None)

    f_light = (
        await db.execute(
            select(KPIField).where(
                KPIField.kpi_id == int(kpi_id),
                KPIField.key == mls,
                KPIField.field_type == FieldType.multi_line_items,
            )
        )
    ).scalars().first()
    f_obj = await get_field_with_subfields_only(db, int(f_light.id), org_id) if f_light is not None else None

    eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
    e_rev = revision_for_parts(eid, e_ts)

    label_by_key: dict[str, str] = {}
    if f_obj and f_obj.sub_fields:
        for sf in f_obj.sub_fields:
            label_by_key[str(sf.key)] = str(sf.name or sf.key)

    if not f_obj or not eid:
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": eid,
                "row_count": 0,
            },
            {
                "rows": [],
                "sub_field_labels": label_by_key,
                "joins": [],
                "source_field_id": f_obj.id if f_obj else (f_light.id if f_light else None),
            },
            e_rev,
        )

    rows, _n = await load_multi_line_row_dicts_filtered(
        db, org_id, entry_id=int(eid), field=f_obj, kpi_id=kpi_id, year=year, raw_filters=w.get("filters")
    )
    truncated = len(rows) > MAX_MULTILINE_TABLE_ROWS
    if truncated:
        rows = rows[:MAX_MULTILINE_TABLE_ROWS]

    join_specs = _parse_join_specs(w)
    joins_pack: list[dict[str, Any]] = []
    for j in join_specs:
        jkpi = int(j["kpi_id"])
        jsrc = str(j["source_field_key"])
        jf_light = (
            await db.execute(
                select(KPIField).join(KPI, KPI.id == KPIField.kpi_id).where(
                    KPI.id == jkpi,
                    KPI.organization_id == org_id,
                    KPIField.key == jsrc,
                    KPIField.field_type == FieldType.multi_line_items,
                )
            )
        ).scalars().first()
        jf_obj = await get_field_with_subfields_only(db, int(jf_light.id), org_id) if jf_light is not None else None
        jeid, _je_ts = await get_entry_id_updated(
            db, org_id=org_id, kpi_id=jkpi, year=year, period_key=period_key
        )
        j_labels: dict[str, str] = {}
        if jf_obj and jf_obj.sub_fields:
            for sf in jf_obj.sub_fields:
                j_labels[str(sf.key)] = str(sf.name or sf.key)
        if not jf_obj or not jeid:
            joins_pack.append(
                {
                    "rows": [],
                    "sub_field_labels": j_labels,
                    "source_field_id": jf_obj.id if jf_obj else (jf_light.id if jf_light else None),
                }
            )
            continue
        jrows, _jn = await load_multi_line_row_dicts_filtered(
            db, org_id, entry_id=int(jeid), field=jf_obj, kpi_id=jkpi, year=year, raw_filters=j.get("filters")
        )
        if len(jrows) > MAX_MULTILINE_TABLE_ROWS:
            jrows = jrows[:MAX_MULTILINE_TABLE_ROWS]
        joins_pack.append(
            {
                "rows": jrows,
                "sub_field_labels": j_labels,
                "source_field_id": int(jf_obj.id),
            }
        )

    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": eid,
            "row_count": len(rows),
            "truncated": truncated,
        },
        {
            "rows": rows,
            "sub_field_labels": label_by_key,
            "joins": joins_pack,
            "source_field_id": int(f_obj.id),
        },
        e_rev,
    )


async def resolve_dashboard_table_rows_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
    *,
    page: int,
    page_size: int,
    search: str | None,
    sort_by: str | None,
    sort_dir: str,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    """
    Fast paged rows for dashboard `kpi_multi_line_table`.
    Uses SQL paging so 20k rows doesn't mean 20k JSON payload.
    """
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_multi_line_table":
        return ({"error": "unsupported_widget_type"}, {"type": merged.get("type")}, "error", None)
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)

    year = int(merged.get("year") or 0)
    period_key = merged.get("period_key")
    mls = str(merged.get("source_field_key") or "").strip()
    if not kpi_id or not year or not mls:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, "error", None)

    f_light = (
        await db.execute(
            select(KPIField).where(
                KPIField.kpi_id == int(kpi_id),
                KPIField.key == mls,
                KPIField.field_type == FieldType.multi_line_items,
            )
        )
    ).scalars().first()
    f_obj = await get_field_with_subfields_only(db, int(f_light.id), org_id) if f_light is not None else None

    eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
    e_rev = revision_for_parts(eid, e_ts)

    label_by_key: dict[str, str] = {}
    if f_obj and f_obj.sub_fields:
        for sf in f_obj.sub_fields:
            label_by_key[str(sf.key)] = str(sf.name or sf.key)

    if not f_obj or not eid:
        meta0 = {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": eid, "row_count": 0}
        data0 = {"rows": [], "total": 0, "page": page, "page_size": page_size, "sub_field_labels": label_by_key, "joins": [], "source_field_id": f_obj.id if f_obj else (f_light.id if f_light else None)}
        return (meta0, data0, "kpi_multi_line_table", e_rev)

    allowed_keys: list[str] = [str(x) for x in (merged.get("sub_field_keys") or []) if str(x).strip()]
    sf_by_key: dict[str, KPIFieldSubField] = {str(getattr(sf, "key", "")): sf for sf in (f_obj.sub_fields or []) if getattr(sf, "key", None)}
    if not allowed_keys:
        allowed_keys = [k for k in sf_by_key.keys() if k]
    visible_sf_ids = [int(getattr(sf_by_key[k], "id")) for k in allowed_keys if k in sf_by_key]

    r = KpiMultiLineRow.__table__.alias("r")
    stmt = select(r.c.id, r.c.row_index).where(r.c.entry_id == int(eid), r.c.field_id == int(f_obj.id))

    raw_filters = merged.get("filters")
    sub_id_by_key = {str(getattr(sf, "key", "")): int(getattr(sf, "id")) for sf in (f_obj.sub_fields or []) if getattr(sf, "key", None)}
    reference_field_types = {str(getattr(sf, "key", "")): str(getattr(getattr(sf, "field_type", None), "value", getattr(sf, "field_type", "")) or "") for sf in (f_obj.sub_fields or []) if getattr(sf, "key", None)}
    compiled = compile_multiline_row_filters_sql(
        raw_filters,
        sub_id_by_key=sub_id_by_key,
        reference_field_types=reference_field_types,
        resolved_label_sets=None,
    )
    filter_params: dict[str, Any] = {}
    if compiled is not None:
        where_sql, p, sid_params = compiled
        # Compiled predicates may reference joined cell aliases like `wf_wf_0_sid`.
        # Add the required LEFT JOIN(s) so those aliases exist in the FROM clause.
        for sp in sid_params or []:
            spk = str(sp)
            alias = KpiMultiLineCell.__table__.alias(_wf_alias(spk))
            stmt = stmt.outerjoin(alias, and_(alias.c.row_id == r.c.id, alias.c.sub_field_id == bindparam(spk)))
        if where_sql.strip():
            stmt = stmt.where(text(where_sql))
            filter_params.update(p)

    if search and search.strip():
        q = f"%{search.strip().lower()}%"
        c = KpiMultiLineCell.__table__.alias("cs")
        val_expr = func.lower(
            func.coalesce(
                cast(c.c.value_text, String()),
                cast(c.c.value_json, String()),
                cast(c.c.value_number, String()),
                cast(c.c.value_boolean, String()),
                cast(c.c.value_date, String()),
            )
        )
        stmt = stmt.where(
            select(func.count())
            .select_from(c)
            .where(and_(c.c.row_id == r.c.id, c.c.sub_field_id.in_(visible_sf_ids), val_expr.like(q)))
            .correlate(r)
            .scalar_subquery()
            > 0
        )

    total = int((await db.execute(select(func.count()).select_from(stmt.subquery()), filter_params)).scalar_one() or 0)

    sort_key = (sort_by or "").strip()
    sort_dir_s = "desc" if str(sort_dir).lower() == "desc" else "asc"
    if sort_key and sort_key in sf_by_key:
        sf = sf_by_key[sort_key]
        sort_sf_id = int(getattr(sf, "id"))
        sort_ft = str(getattr(getattr(sf, "field_type", None), "value", getattr(sf, "field_type", "")) or "")
        sc = KpiMultiLineCell.__table__.alias("sc")
        stmt = stmt.outerjoin(sc, and_(sc.c.row_id == r.c.id, sc.c.sub_field_id == sort_sf_id))
        if sort_ft == "number":
            expr = sc.c.value_number
        elif sort_ft == "date":
            expr = sc.c.value_date
        elif sort_ft == "boolean":
            expr = sc.c.value_boolean
        else:
            expr = func.coalesce(
                cast(sc.c.value_text, String()),
                cast(sc.c.value_json, String()),
                cast(sc.c.value_number, String()),
                cast(sc.c.value_boolean, String()),
                cast(sc.c.value_date, String()),
            )
        stmt = stmt.order_by(nulls_last(expr.desc() if sort_dir_s == "desc" else expr.asc()))
    else:
        stmt = stmt.order_by(r.c.row_index)

    start = (int(page) - 1) * int(page_size)
    page_rows = list((await db.execute(stmt.offset(start).limit(int(page_size)), filter_params)).all())
    row_ids = [int(rr[0]) for rr in page_rows]
    row_index_by_id = {int(rr[0]): int(rr[1]) for rr in page_rows}

    if not row_ids:
        meta0 = {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": eid, "row_count": 0, "total": total, "source_field_id": int(f_obj.id)}
        data0 = {"rows": [], "total": total, "page": page, "page_size": page_size, "sub_field_labels": label_by_key, "joins": [], "source_field_id": int(f_obj.id)}
        return (meta0, data0, "kpi_multi_line_table", e_rev)

    ctab = KpiMultiLineCell.__table__
    sftab = KPIFieldSubField.__table__
    cell_res = await db.execute(
        select(ctab.c.row_id, sftab.c.key, ctab.c.value_text, ctab.c.value_number, ctab.c.value_boolean, ctab.c.value_date, ctab.c.value_json)
        .select_from(ctab)
        .join(sftab, sftab.c.id == ctab.c.sub_field_id)
        .where(ctab.c.row_id.in_(row_ids), ctab.c.sub_field_id.in_(visible_sf_ids))
    )
    row_data_by_index: dict[int, dict[str, Any]] = {row_index_by_id[rid]: {} for rid in row_ids}
    for row_id, key, vt, vn, vb, vd, vj in cell_res.all():
        idx = row_index_by_id.get(int(row_id))
        if idx is None or not key:
            continue
        if vj is not None:
            raw = vj
        elif vt is not None:
            raw = vt
        elif vn is not None:
            raw = vn
        elif vb is not None:
            raw = vb
        elif vd is not None:
            raw = vd.isoformat() if hasattr(vd, "isoformat") else str(vd)
        else:
            raw = None
        row_data_by_index[idx][str(key)] = raw

    rows_out = [{"__index": idx, **row_data_by_index.get(idx, {})} for idx in sorted(row_data_by_index.keys())]

    # Joins remain best-effort and limited to keys on this page for speed.
    joins_pack: list[dict[str, Any]] = []
    for j in _parse_join_specs(merged):
        left_key = str(j.get("on_left_sub_field_key") or "").strip()
        right_key = str(j.get("on_right_sub_field_key") or "").strip()
        needed = sorted({str(rw.get(left_key) or "").strip() for rw in rows_out if left_key and str(rw.get(left_key) or "").strip()})
        if not needed:
            joins_pack.append({"rows": [], "sub_field_labels": {}, "source_field_id": None})
            continue
        jkpi = int(j["kpi_id"])
        jsrc = str(j["source_field_key"])
        jf_light = (
            await db.execute(
                select(KPIField).join(KPI, KPI.id == KPIField.kpi_id).where(
                    KPI.id == jkpi,
                    KPI.organization_id == org_id,
                    KPIField.key == jsrc,
                    KPIField.field_type == FieldType.multi_line_items,
                )
            )
        ).scalars().first()
        jf_obj = await get_field_with_subfields_only(db, int(jf_light.id), org_id) if jf_light is not None else None
        jeid, _je_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=jkpi, year=year, period_key=period_key)
        if not jf_obj or not jeid:
            joins_pack.append({"rows": [], "sub_field_labels": {}, "source_field_id": int(jf_obj.id) if jf_obj else None})
            continue
        jsf_by_key = {str(getattr(sf, "key", "")): sf for sf in (jf_obj.sub_fields or []) if getattr(sf, "key", None)}
        right_sf = jsf_by_key.get(right_key)
        if not right_sf:
            joins_pack.append({"rows": [], "sub_field_labels": {}, "source_field_id": int(jf_obj.id)})
            continue
        right_sf_id = int(getattr(right_sf, "id"))
        jr = KpiMultiLineRow.__table__.alias("jr")
        jc = KpiMultiLineCell.__table__.alias("jc")
        jbase = (
            select(jr.c.id, jr.c.row_index)
            .select_from(jr)
            .join(jc, and_(jc.c.row_id == jr.c.id, jc.c.sub_field_id == right_sf_id))
            .where(jr.c.entry_id == int(jeid), jr.c.field_id == int(jf_obj.id), cast(jc.c.value_text, String()).in_(needed))
            .limit(500)
        )
        jrows = list((await db.execute(jbase)).all())
        jrow_ids = [int(x[0]) for x in jrows]
        jlabels = {str(getattr(sf, "key", "")): str(getattr(sf, "name", "") or getattr(sf, "key", "")) for sf in (jf_obj.sub_fields or []) if getattr(sf, "key", None)}
        if not jrow_ids:
            joins_pack.append({"rows": [], "sub_field_labels": jlabels, "source_field_id": int(jf_obj.id)})
            continue
        want_keys = [str(x) for x in (j.get("sub_field_keys") or []) if str(x).strip()]
        if not want_keys:
            want_keys = list(jsf_by_key.keys())
        want_ids = [int(getattr(jsf_by_key[k], "id")) for k in want_keys if k in jsf_by_key]
        jcell_res = await db.execute(
            select(ctab.c.row_id, sftab.c.key, ctab.c.value_text, ctab.c.value_number, ctab.c.value_boolean, ctab.c.value_date, ctab.c.value_json)
            .select_from(ctab)
            .join(sftab, sftab.c.id == ctab.c.sub_field_id)
            .where(ctab.c.row_id.in_(jrow_ids), ctab.c.sub_field_id.in_(want_ids))
        )
        jidx_by_id = {int(rid): int(ridx) for rid, ridx in jrows}
        jrow_data: dict[int, dict[str, Any]] = {jidx_by_id[rid]: {} for rid in jrow_ids}
        for row_id, key2, vt, vn, vb, vd, vj in jcell_res.all():
            idx = jidx_by_id.get(int(row_id))
            if idx is None or not key2:
                continue
            if vj is not None:
                raw = vj
            elif vt is not None:
                raw = vt
            elif vn is not None:
                raw = vn
            elif vb is not None:
                raw = vb
            elif vd is not None:
                raw = vd.isoformat() if hasattr(vd, "isoformat") else str(vd)
            else:
                raw = None
            jrow_data[idx][str(key2)] = raw
        joins_pack.append({"rows": [{"__index": idx, **jrow_data[idx]} for idx in sorted(jrow_data.keys())], "sub_field_labels": jlabels, "source_field_id": int(jf_obj.id)})

    meta = {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": eid, "row_count": len(rows_out), "total": total, "source_field_id": int(f_obj.id)}
    data = {"rows": rows_out, "total": total, "page": int(page), "page_size": int(page_size), "sub_field_labels": label_by_key, "joins": joins_pack, "source_field_id": int(f_obj.id)}
    return (meta, data, "kpi_multi_line_table", e_rev)


async def _fast_line_points(
    db: AsyncSession,
    *,
    org_id: int,
    kpi_id: int,
    field_key: str,
    start_year: int,
    end_year: int,
    period_key: Any,
) -> tuple[list[dict[str, Any]], str | None, int | None]:
    fid = await _field_id_for_kpi_key(db, org_id=org_id, kpi_id=kpi_id, field_key=field_key)
    if not fid:
        return ([], None, None)
    lo, hi = min(int(start_year), int(end_year)), max(int(start_year), int(end_year))
    years = list(range(lo, hi + 1))
    stmt = (
        select(
            KPIEntry.year,
            KPIEntry.id,
            KPIEntry.updated_at,
            KPIFieldValue.value_text,
            KPIFieldValue.value_number,
            KPIFieldValue.value_json,
            KPIFieldValue.value_boolean,
            KPIFieldValue.value_date,
        )
        .select_from(KPIEntry)
        .join(KPI, KPI.id == KPIEntry.kpi_id)
        .outerjoin(
            KPIFieldValue,
            and_(KPIFieldValue.entry_id == KPIEntry.id, KPIFieldValue.field_id == int(fid)),
        )
        .where(
            KPIEntry.kpi_id == int(kpi_id),
            KPI.organization_id == int(org_id),
            KPIEntry.year.in_(years),
            KPIEntry.period_key == _period_key_norm(period_key),
        )
        .order_by(KPIEntry.year.asc())
    )
    res = await db.execute(stmt)
    points_by_year: dict[int, Any] = {int(y): None for y in years}
    revisions: list[str] = []
    for row in res.mappings().all():
        y = int(row["year"])
        eid = row["id"]
        r = revision_for_parts(eid, row["updated_at"])
        if r:
            revisions.append(r)
        # mimic raw_field_from_fv_map for one field id
        raw = (
            row["value_number"]
            if row["value_number"] is not None
            else row["value_text"]
            if row["value_text"] is not None
            else row["value_boolean"]
            if row["value_boolean"] is not None
            else row["value_date"]
            if row["value_date"] is not None
            else row["value_json"]
        )
        points_by_year[y] = to_numeric(raw)
    points = [{"year": int(y), "value": points_by_year.get(int(y))} for y in years]
    e_rev = "|".join(revisions) if revisions else None
    return (points, e_rev, int(fid))


async def resolve_dashboard_line_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_line_chart":
        return (
            {"error": "unsupported_widget_type"},
            {"supported": ["kpi_line_chart"], "type": merged.get("type")},
            "error",
            None,
        )
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)
    fk = (merged.get("field_key") or "").strip()
    s = int(merged.get("start_year") or 0)
    e = int(merged.get("end_year") or 0)
    period_key = merged.get("period_key")
    if not kpi_id or not fk or not s or not e:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, "error", None)
    points, e_rev, fid = await _fast_line_points(
        db,
        org_id=org_id,
        kpi_id=kpi_id,
        field_key=fk,
        start_year=s,
        end_year=e,
        period_key=period_key,
    )
    return (
        {"kpi_id": kpi_id, "row_count": 0, "field_key": fk, "field_id": fid},
        {"points": points},
        "kpi_line_chart",
        e_rev,
    )


async def resolve_dashboard_single_value_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_single_value":
        return (
            {"error": "unsupported_widget_type"},
            {"supported": ["kpi_single_value"], "type": merged.get("type")},
            "error",
            None,
        )
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)
    year = int(merged.get("year") or 0)
    period_key = merged.get("period_key")
    fk = (merged.get("field_key") or "").strip()
    if not kpi_id or not year or not fk:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, "error", None)
    fid = await _field_id_for_kpi_key(db, org_id=org_id, kpi_id=kpi_id, field_key=fk)
    eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
    e_rev = revision_for_parts(eid, e_ts)
    raw = None
    if eid and fid:
        fvm = await get_field_values_for_field_ids(db, entry_id=int(eid), field_ids=[int(fid)])
        raw = raw_field_from_fv_map(fvm, int(fid))
    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": eid,
            "row_count": 0,
            "field_key": fk,
            "field_id": fid,
        },
        {"raw": raw, "display": raw},
        "kpi_single_value",
        e_rev,
    )


async def resolve_dashboard_trend_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_trend":
        return (
            {"error": "unsupported_widget_type"},
            {"supported": ["kpi_trend"], "type": merged.get("type")},
            "error",
            None,
        )
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)

    # Reuse existing resolver logic, but skip KPI permission by calling its internals with a pre-checked KPI.
    # We still optimize the heavy "fields" mode by fetching all years in one SQL query.
    start_y = int(merged.get("start_year") or 0)
    end_y = int(merged.get("end_year") or 0)
    lo, hi = (min(start_y, end_y), max(start_y, end_y)) if start_y and end_y else (0, 0)

    def _y_int(x: Any) -> int | None:
        if x is None or isinstance(x, bool):
            return None
        if isinstance(x, int):
            return int(x)
        if isinstance(x, float):
            if math.isnan(x) or math.isinf(x):
                return None
            return int(x)
        s = str(x).strip()
        if not s:
            return None
        s2 = s[1:] if s.startswith(("-", "+")) else s
        if s2.isdigit() or (("." in s2) and s2.replace(".", "", 1).isdigit()):
            try:
                return int(float(s))
            except (TypeError, ValueError):
                return None
        return None

    selected = merged.get("selected_years")
    years: list[int] = []
    if isinstance(selected, list) and selected:
        years = sorted({yy for v in selected if (yy := _y_int(v)) is not None}, reverse=True)
    if not years:
        dy = merged.get("default_years")
        if isinstance(dy, list) and dy:
            years = sorted({yy for v in dy if (yy := _y_int(v)) is not None}, reverse=True)
    if not years and hi:
        years = [hi]
    if years and lo and hi and lo <= hi:
        years = [yy for yy in years if lo <= yy <= hi]

    period_key = merged.get("period_key")
    mode = merged.get("mode") or "fields"

    if mode == "fields":
        keys: list[str] = list(merged.get("field_keys") or [])
        if not keys:
            return (
                {"kpi_id": kpi_id, "period_key": _period_key_norm(period_key), "row_count": 0, "years": years},
                {"mode": "fields", "field_bars_by_year": {}, "field_map": {}},
                "kpi_trend",
                None,
            )
        # resolve field ids once
        fid_by_key: dict[str, int] = {}
        for k in keys:
            fid = await _field_id_for_kpi_key(db, org_id=org_id, kpi_id=kpi_id, field_key=str(k))
            if fid:
                fid_by_key[str(k)] = int(fid)

        if not fid_by_key:
            return (
                {"kpi_id": kpi_id, "period_key": _period_key_norm(period_key), "row_count": 0, "years": years},
                {"mode": "fields", "field_bars_by_year": {}, "field_map": {}},
                "kpi_trend",
                None,
            )

        stmt = (
            select(
                KPIEntry.year,
                KPIEntry.id.label("entry_id"),
                KPIEntry.updated_at,
                KPIFieldValue.field_id,
                KPIFieldValue.value_text,
                KPIFieldValue.value_number,
                KPIFieldValue.value_json,
                KPIFieldValue.value_boolean,
                KPIFieldValue.value_date,
            )
            .select_from(KPIEntry)
            .join(KPI, KPI.id == KPIEntry.kpi_id)
            .outerjoin(
                KPIFieldValue,
                and_(KPIFieldValue.entry_id == KPIEntry.id, KPIFieldValue.field_id.in_(list(fid_by_key.values()))),
            )
            .where(
                KPIEntry.kpi_id == int(kpi_id),
                KPI.organization_id == int(org_id),
                KPIEntry.year.in_(years if years else [0]),
                KPIEntry.period_key == _period_key_norm(period_key),
            )
            .order_by(KPIEntry.year.desc())
        )
        res = await db.execute(stmt)
        # build per-year map for raw values
        by_year_field: dict[int, dict[int, Any]] = {int(y): {} for y in years}
        revisions: list[str] = []
        for row in res.mappings().all():
            yy = int(row["year"])
            eid = row["entry_id"]
            r = revision_for_parts(eid, row["updated_at"])
            if r:
                revisions.append(r)
            fid = row["field_id"]
            if fid is None:
                continue
            raw = (
                row["value_number"]
                if row["value_number"] is not None
                else row["value_text"]
                if row["value_text"] is not None
                else row["value_boolean"]
                if row["value_boolean"] is not None
                else row["value_date"]
                if row["value_date"] is not None
                else row["value_json"]
            )
            by_year_field.setdefault(yy, {})[int(fid)] = raw

        field_bars: dict[str, list[dict[str, Any]]] = {}
        for yy in years:
            bars: list[dict[str, Any]] = []
            fvals = by_year_field.get(int(yy), {})
            for k in keys:
                fid = fid_by_key.get(str(k))
                v = to_numeric(fvals.get(int(fid))) if fid else None
                bars.append({"key": str(k), "label": str(k), "value": v})
            field_bars[str(yy)] = bars
        e_rev = "|".join(revisions) if revisions else None
        return (
            {"kpi_id": kpi_id, "period_key": _period_key_norm(period_key), "row_count": 0, "years": years},
            {"mode": "fields", "field_bars_by_year": field_bars},
            "kpi_trend",
            e_rev,
        )

    # For multi_line_items: prefer SQL buckets per year (no raw rows).
    if mode == "multi_line_items":
        source_key = (merged.get("source_field_key") or "").strip()
        group_key = (merged.get("group_by_sub_field_key") or "").strip()
        filt_key = (merged.get("filter_sub_field_key") or "").strip()
        val_key = (merged.get("value_sub_field_key") or "").strip()
        agg_w = str(merged.get("agg") or "count_rows").strip().lower()
        kpi = (await db.execute(select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id))).scalar_one_or_none()
        if not kpi:
            return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "KPI not found"}, "error", None)
        f_light = (
            await db.execute(
                select(KPIField).where(
                    KPIField.kpi_id == int(kpi_id),
                    KPIField.key == source_key,
                    KPIField.field_type == FieldType.multi_line_items,
                )
            )
        ).scalars().first()
        f_full = await get_field_with_subfields_only(db, int(f_light.id), org_id) if f_light is not None else None
        if not f_full or not group_key:
            return (
                {"kpi_id": kpi_id, "period_key": _period_key_norm(period_key), "row_count": 0, "years": years},
                {"mode": "multi_line_items", "multi_line_agg_buckets_by_year": {}},
                "kpi_trend",
                None,
            )
        sub_id_by_key: dict[str, int] = {}
        reference_field_types: dict[str, str] = {}
        for sf in getattr(f_full, "sub_fields", None) or []:
            if getattr(sf, "key", None):
                sk = str(sf.key)
                sub_id_by_key[sk] = int(sf.id)
                ft = getattr(getattr(sf, "field_type", None), "value", sf.field_type)
                reference_field_types[sk] = str(ft or "")
        gid = sub_id_by_key.get(group_key)
        fid = sub_id_by_key.get(filt_key) if filt_key else None
        vid = sub_id_by_key.get(val_key) if val_key else None
        if gid is None:
            return (
                {"kpi_id": kpi_id, "period_key": _period_key_norm(period_key), "row_count": 0, "years": years},
                {"mode": "multi_line_items", "multi_line_agg_buckets_by_year": {}},
                "kpi_trend",
                None,
            )

        compiled = compile_multiline_row_filters_sql(
            merged.get("filters"),
            sub_id_by_key=sub_id_by_key,
            reference_field_types=reference_field_types,
            resolved_label_sets=None,
        )
        filter_where_sql, filter_params, filter_sid_params = (None, None, [])
        if compiled is not None:
            filter_where_sql, filter_params, filter_sid_params = compiled
            if not (filter_where_sql or "").strip():
                filter_where_sql, filter_params, filter_sid_params = (None, None, [])

        buckets_by_year: dict[str, Any] = {}
        revisions: list[str] = []
        for yy in years:
            eid_y, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=int(yy), period_key=period_key)
            r = revision_for_parts(eid_y, e_ts)
            if r:
                revisions.append(r)
            if not eid_y:
                buckets_by_year[str(yy)] = []
                continue
            try:
                buckets = await fetch_multiline_bar_agg_buckets(
                    db,
                    entry_id=int(eid_y),
                    multiline_field_id=int(f_full.id),
                    group_sub_field_id=int(gid),
                    filter_sub_field_id=int(fid) if fid is not None else None,
                    value_sub_field_id=int(vid) if vid is not None else None,
                    agg=agg_w,
                    filter_where_sql=filter_where_sql,
                    filter_params=filter_params,
                    filter_sid_params=filter_sid_params,
                )
            except Exception:
                buckets = []
            buckets_by_year[str(yy)] = buckets
        e_rev = "|".join(revisions) if revisions else None
        return (
            {"kpi_id": kpi_id, "period_key": _period_key_norm(period_key), "row_count": 0, "years": years},
            {"mode": "multi_line_items", "multi_line_agg_buckets_by_year": buckets_by_year},
            "kpi_trend",
            e_rev,
        )

    return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "unknown mode"}, "error", None)


async def resolve_dashboard_kpi_table_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    merged = _merge_overrides(widget, overrides)
    if str(merged.get("type") or "") != "kpi_table":
        return (
            {"error": "unsupported_widget_type"},
            {"supported": ["kpi_table"], "type": merged.get("type")},
            "error",
            None,
        )
    kpi_id = int(merged.get("kpi_id") or 0)
    if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
        return ({"error": "forbidden"}, {"error": "forbidden"}, "error", None)
    year = int(merged.get("year") or 0)
    period_key = merged.get("period_key")
    if not kpi_id or not year:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "missing parameters"}, "error", None)
    kpi = (await db.execute(select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id))).scalar_one_or_none()
    if not kpi:
        return ({"kpi_id": kpi_id, "row_count": 0}, {"error": "KPI not found"}, "error", None)

    req_keys: list[str] = [str(x) for x in (merged.get("field_keys") or []) if str(x).strip()]
    if req_keys:
        frows = (
            await db.execute(
                select(KPIField.id, KPIField.key, KPIField.name).where(
                    KPIField.kpi_id == int(kpi_id), KPIField.key.in_(req_keys)
                )
            )
        ).all()
    else:
        frows = (
            await db.execute(
                select(KPIField.id, KPIField.key, KPIField.name).where(KPIField.kpi_id == int(kpi_id))
            )
        ).all()
    fields = [{"id": int(r[0]), "key": str(r[1]), "name": str(r[2] or r[1])} for r in frows]
    key_order = req_keys if req_keys else [f["key"] for f in fields]
    id_by_key = {f["key"]: int(f["id"]) for f in fields}
    name_by_key = {f["key"]: str(f["name"]) for f in fields}

    eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
    e_rev = revision_for_parts(eid, e_ts)
    fv_by_id = await get_field_values_for_field_ids(db, entry_id=int(eid), field_ids=list(id_by_key.values())) if eid else {}

    rows_out: list[dict[str, Any]] = []
    for k in key_order:
        fid = id_by_key.get(k)
        raw = raw_field_from_fv_map(fv_by_id, int(fid)) if (eid and fid) else None
        sval = "" if raw is None else (json.dumps(raw) if isinstance(raw, (dict, list)) else str(raw))
        rows_out.append({"label": name_by_key.get(k) or k, "value": sval})

    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": eid,
            "row_count": len(rows_out),
        },
        {"rows": rows_out},
        "kpi_table",
        e_rev,
    )


async def resolve_widget_data(
    db: AsyncSession,
    user: User,
    org_id: int,
    version: int,
    widget: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str, str | None]:
    if version != 1:
        return ({"error": f"Unsupported version: {version}"}, {"supported": 1}, "error", None)
    merged = _merge_overrides(widget, overrides)
    wtype = str(merged.get("type") or "")
    resolver = WIDGET_RESOLVERS.get(wtype)
    if not resolver:
        rt = wtype or "unknown"
        return ({"error": f"Unknown widget type: {rt}"}, {"known": list(WIDGET_RESOLVERS.keys())}, rt, None)
    meta, data, e_rev = await resolver(db, user, org_id, merged)
    return meta, data, wtype, e_rev
