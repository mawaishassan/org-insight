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
    Dashboard,
    DashboardAccessPermission,
    Organization,
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
    fetch_multiline_single_value_agg,
    _wf_alias,
)
from app.core.database import AsyncSessionLocal
from app.core.config import get_settings


def trace(msg: str):
    pass


import time


class DashboardWidgetMemoryCache:
    """
    High-performance in-memory cache for aggregated dashboard widget responses.
    Guarantees < 10ms response times for repeat views and period shifts while
    strictly isolating user scope, period type, reporting time, and revision.
    """
    def __init__(self, max_size: int = 5000, default_ttl: int = 180):
        self._cache: dict[str, tuple[float, Any]] = {}
        self._max_size = max_size
        self._default_ttl = default_ttl

    def make_key(
        self,
        dashboard_id: int | None,
        user_scope: str,
        period_type: str | None,
        reporting_time: str | None,
        widget_id: str | None,
        extra: str = ""
    ) -> str:
        d_id = str(dashboard_id or 0)
        u_sc = str(user_scope or "anon").strip().lower()
        p_t = str(period_type or "by_default").strip().lower()
        r_t = str(reporting_time or "").strip().lower()
        w_id = str(widget_id or "").strip()
        return f"dwc:{d_id}:{u_sc}:{p_t}:{r_t}:{w_id}:{extra}"

    def get(self, key: str) -> Any | None:
        item = self._cache.get(key)
        if not item:
            return None
        expire_at, val = item
        if time.time() > expire_at:
            self._cache.pop(key, None)
            return None
        return val

    def set(self, key: str, val: Any, ttl: int | None = None) -> None:
        if len(self._cache) >= self._max_size:
            keys_to_remove = list(self._cache.keys())[: max(1, self._max_size // 5)]
            for k in keys_to_remove:
                self._cache.pop(k, None)
        expire_at = time.time() + (ttl or self._default_ttl)
        self._cache[key] = (expire_at, val)

    def invalidate_dashboard(self, dashboard_id: int) -> int:
        prefix = f"dwc:{dashboard_id}:"
        keys_to_del = [k for k in self._cache if k.startswith(prefix)]
        for k in keys_to_del:
            self._cache.pop(k, None)
        return len(keys_to_del)

    def invalidate_all(self) -> int:
        cnt = len(self._cache)
        self._cache.clear()
        return cnt


_widget_cache = DashboardWidgetMemoryCache()


def invalidate_dashboard_cache(dashboard_id: int) -> int:
    return _widget_cache.invalidate_dashboard(dashboard_id)


def invalidate_all_widget_caches() -> int:
    return _widget_cache.invalidate_all()


async def _get_org(db: AsyncSession, org_id: int) -> Organization | None:
    cache_key = ("org", int(org_id))
    if cache_key in db.info:
        return db.info[cache_key]
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    db.info[cache_key] = org
    return org


def get_widget_date_col_key(config: dict, kpi_id: int, source_key: str, field_def: Any) -> str | None:
    if not config:
        return None

    # 1. Check if specific custom mapping for this MLI in mli_date_cols is set
    mli_date_cols = config.get("mli_date_cols") or {}
    field_id = getattr(field_def, "id", None)
    specific_key = mli_date_cols.get(f"{kpi_id}_{source_key}") or (mli_date_cols.get(f"{kpi_id}_{field_id}") if field_id else None)
    if specific_key:
        return specific_key

    # Check if field belongs to a Joined KPI and inherit date column from primary KPI
    kpi_obj = getattr(field_def, "kpi", None)
    if kpi_obj and getattr(kpi_obj, "is_joined", False):
        jcfg = getattr(kpi_obj, "joined_config", None) or {}
        for m in jcfg.get("mappings", []):
            if m.get("joined_field_key") == source_key:
                pkpi = m.get("primary_kpi_id")
                pfield = m.get("primary_field_key")
                if pkpi and pfield:
                    pspecific = mli_date_cols.get(f"{pkpi}_{pfield}")
                    if pspecific:
                        return pspecific

    # 2. Check if new dashboard-wide/report-wide date_column configuration is set
    date_column = config.get("date_column")
    if date_column:
        if field_def and hasattr(field_def, "sub_fields"):
            # Get date/datetime subfields
            date_subfields = []
            for sf in field_def.sub_fields:
                sft = getattr(sf.field_type, "value", sf.field_type)
                if sft in ("date", "datetime") or str(sft).lower() == "fieldtype.date" or str(sft).lower() == "fieldtype.datetime":
                    date_subfields.append(sf)
            if date_subfields:
                # Find matching subfield by key or name (case-insensitive)
                for sf in date_subfields:
                    if sf.key.lower() == date_column.lower() or sf.name.lower() == date_column.lower():
                        return sf.key
                # Fallback to the first date subfield in this MLI
                return date_subfields[0].key
        return None

    # 3. If mli_date_cols has configured date cols, check if any date subfield in this MLI matches one of them
    if field_def and hasattr(field_def, "sub_fields"):
        known_date_keys = set(mli_date_cols.values())
        for sf in (field_def.sub_fields or []):
            if sf.key in known_date_keys:
                return sf.key
        # Check for standard date names
        for sf in (field_def.sub_fields or []):
            sft = getattr(sf.field_type, "value", sf.field_type)
            if (sft in ("date", "datetime") or "date" in str(sft).lower()) and "date" in sf.key.lower():
                return sf.key

    return None

def _clean_by_default_overrides(mod_overrides: dict[str, Any], by_default_bypass: bool) -> None:
    if by_default_bypass:
        y_val = mod_overrides.get("year")
        if y_val is not None:
            try:
                int(str(y_val))
            except ValueError:
                mod_overrides.pop("year", None)


def _find_sub_field_key_match(target_key: str, sub_id_by_key: dict[str, int] | None) -> str | None:
    if not target_key or not sub_id_by_key:
        return None
    if target_key in sub_id_by_key:
        return target_key
    target_norm = target_key.strip().lower()
    for k in sub_id_by_key.keys():
        k_norm = str(k).strip().lower()
        if (
            k_norm == target_norm
            or k_norm == f"{target_norm}_name"
            or k_norm == f"{target_norm}_id"
            or target_norm == f"{k_norm}_name"
            or target_norm == f"{k_norm}_id"
        ):
            return k
    return None


def _combine_with_runtime_filters(
    raw_filters: Any,
    column_filter: dict[str, Any] | None = None,
    normal_filters: dict[str, Any] | None = None,
    kpi_id: int | None = None,
    source_field_key: str | None = None,
    sub_id_by_key: dict[str, int] | None = None,
) -> dict[str, Any] | None:
    """
    Synthesize column_filter and normal_filters into standard _version: 2 filter conditions
    so that SQL filter compilation (compile_multiline_row_filters_sql) and in-memory row filtering
    (filter_multiline_rows_v2) naturally and automatically apply them across all charts, cards,
    tables, and aggregations.
    """
    conditions: list[dict[str, Any]] = []
    
    # Preserve existing conditions if any
    if isinstance(raw_filters, dict):
        if raw_filters.get("_version") == 2:
            conds = raw_filters.get("conditions")
            if isinstance(conds, list):
                conditions.extend([dict(c) for c in conds if isinstance(c, dict)])
        else:
            # Legacy key-value map
            for k, v in raw_filters.items():
                if not str(k).startswith("_") and v not in (None, ""):
                    conditions.append({
                        "field": str(k),
                        "op": "eq",
                        "value": str(v),
                        "logic": "and",
                    })

    # Add column_filter condition if applicable
    if column_filter and isinstance(column_filter, dict):
        target_kpi = column_filter.get("kpi_id")
        target_source = column_filter.get("source_field_key")
        col_key = column_filter.get("column_key") or column_filter.get("key")
        col_val = column_filter.get("value")

        # Only apply direct row filter condition if target KPI matches or column belongs to this MLI
        kpi_matches = (target_kpi is None or kpi_id is None or int(target_kpi) == int(kpi_id))
        source_matches = (target_source is None or source_field_key is None or str(target_source) == str(source_field_key))

        matched_col_key = _find_sub_field_key_match(str(col_key), sub_id_by_key) if (sub_id_by_key and col_key) else (str(col_key) if col_key else None)
        
        applies = (kpi_matches and source_matches)
        if sub_id_by_key is not None:
            applies = bool(matched_col_key) and (kpi_matches or not target_kpi)

        if applies and matched_col_key and col_val not in (None, ""):
            # Avoid duplicate condition if already present
            if not any(c.get("field") == matched_col_key and c.get("value") == str(col_val) for c in conditions):
                conditions.append({
                    "field": matched_col_key,
                    "op": "eq",
                    "value": str(col_val),
                    "logic": "and",
                })

    # Add normal_filters conditions if applicable
    if normal_filters and isinstance(normal_filters, dict):
        for f_key, f_vals in normal_filters.items():
            if not f_key or f_vals in (None, "", []):
                continue
            matched_key = _find_sub_field_key_match(str(f_key), sub_id_by_key) if sub_id_by_key else str(f_key)
            if sub_id_by_key is not None and not matched_key:
                continue
            actual_key = matched_key or str(f_key)
            if isinstance(f_vals, list):
                clean_vals = [str(v) for v in f_vals if v not in (None, "")]
                if len(clean_vals) == 1:
                    if not any(c.get("field") == actual_key and c.get("value") == clean_vals[0] for c in conditions):
                        conditions.append({
                            "field": actual_key,
                            "op": "eq",
                            "value": clean_vals[0],
                            "logic": "and",
                        })
                elif len(clean_vals) > 1:
                    if not any(c.get("field") == actual_key for c in conditions):
                        conditions.append({
                            "field": actual_key,
                            "op": "eq",
                            "values": clean_vals,
                            "value": clean_vals[0],
                            "logic": "and",
                        })
            else:
                s_val = str(f_vals).strip()
                if s_val and not any(c.get("field") == actual_key and c.get("value") == s_val for c in conditions):
                    conditions.append({
                        "field": actual_key,
                        "op": "eq",
                        "value": s_val,
                        "logic": "and",
                    })

    if not conditions:
        return raw_filters if isinstance(raw_filters, dict) else None

    return {
        "_version": 2,
        "logic": "and",
        "conditions": conditions,
    }


async def resolve_dashboard_chart_widget_data_batch(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    items: list[dict[str, Any]],
    *,
    _dashboard: Any = None,
    _org: Any = None,
    _user_filters: dict[str, list[str]] | None = None,
    _col_fetching_config: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Batch resolver for dashboard bar/pie charts.

    Returns dict keyed by widget.id (string) or idx fallback:
      {"<key>": {"ok": bool, "widget_type": str, "meta": {}, "data": {}, "entry_revision": str|None, "error": str?}}

    When called from resolve_dashboard_universal_batch, pass _dashboard, _org, _user_filters
    and _col_fetching_config to skip redundant DB queries.
    """
    trace(f"resolve_dashboard_chart_widget_data_batch: items={items}")
    # ---- Pre-parse + group ----
    # Use pre-fetched dashboard object when available to avoid a duplicate DB query
    dashboard = _dashboard if _dashboard is not None else (
        await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    ).scalar_one_or_none()
    is_date_fetching = False
    org = _org  # may be None if dashboard doesn't use date-fetching
    if dashboard and getattr(dashboard, "fetch_data_with_date", False):
        is_date_fetching = True
        if org is None:
            org = await _get_org(db, org_id)

    # ---- Caches ----
    fields_cache: dict[int, list[KPIField]] = {}
    fmap_cache: dict[int, dict[str, Any]] = {}
    mline_field_cache: dict[tuple[int, str], KPIField | None] = {}
    sub_map_cache: dict[int, tuple[dict[str, int], dict[str, str]]] = {}

    async def _fields_for(kpi_id: int) -> list[KPIField]:
        if kpi_id not in fields_cache:
            fs = await list_kpi_field_definitions(db, kpi_id, org_id)
            fields_cache[kpi_id] = fs
            fmap_cache[kpi_id] = build_kpi_field_maps(fs)
        return fields_cache[kpi_id]

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
        return f_full

    is_column_fetching = False
    col_fetching_config: dict[str, Any] = {}
    if _col_fetching_config is not None:
        # Pre-fetched by caller — use directly
        col_fetching_config = _col_fetching_config
        is_column_fetching = bool(col_fetching_config)
    elif dashboard and getattr(dashboard, "fetch_data_with_column", False):
        is_column_fetching = True
        col_fetching_config = getattr(dashboard, "column_fetching_config", None) or {}

    # Use pre-fetched user filters when provided, otherwise fetch now
    if _user_filters is not None:
        user_filters: dict[str, list[str]] = _user_filters
    else:
        user_filters = {}
        if dashboard_id and user:
            try:
                user_filters, _ = await _get_dashboard_user_filter_and_permissions(db, user, int(dashboard_id))
            except Exception:
                pass

    parsed: list[tuple[str, dict[str, Any], dict[str, Any] | None, tuple[datetime.date, datetime.date, str] | None]] = []
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
        
        mod_overrides = dict(overrides) if overrides else {}
        date_range = None
        
        # Pop "by_default" override so it doesn't contaminate the merged widget year
        by_default_bypass = False
        if mod_overrides.get("year") in ("by_default", "By Default"):
            by_default_bypass = True
            mod_overrides.pop("year", None)
        if mod_overrides.get("by_default") is True:
            by_default_bypass = True
            mod_overrides.pop("by_default", None)
        _clean_by_default_overrides(mod_overrides, by_default_bypass)

        if is_date_fetching and org and not by_default_bypass:
            selected_period = (overrides or {}).get("year") or w.get("year")
            period_type = (overrides or {}).get("period_type") or (w.get("period_type") if isinstance(w, dict) else None)
            if selected_period and selected_period != "by_default" and selected_period != "By Default":
                try:
                    start_date, end_date, start_year = resolve_date_range_for_period(org, str(selected_period), period_type=period_type)
                    mod_overrides["year"] = start_year
                    kpi_id = int(w.get("kpi_id") or 0)
                    source_key = (w.get("source_field_key") or "").strip()
                    config = getattr(dashboard, "date_fetching_config", None) or {}
                    
                    f_def = None
                    if kpi_id and source_key:
                        f_def = await _mline_field_for(kpi_id, source_key)
                    date_col_key = get_widget_date_col_key(config, kpi_id, source_key, f_def)
                    
                    if date_col_key:
                        date_range = (start_date, end_date, str(date_col_key))
                except Exception:
                    pass

        column_filter = mod_overrides.get("column_filter")
        if not column_filter and is_column_fetching and col_fetching_config:
            sel_col_val = mod_overrides.get("selected_column_value")
            if sel_col_val is not None and str(sel_col_val).strip() != "":
                column_filter = {
                    "kpi_id": col_fetching_config.get("kpi_id"),
                    "source_field_key": col_fetching_config.get("source_field_key"),
                    "column_key": col_fetching_config.get("column_key"),
                    "value": str(sel_col_val).strip(),
                }
                mod_overrides["column_filter"] = column_filter

        normal_filters = dict(mod_overrides.get("normal_filters") or mod_overrides.get("dashboard_filters") or {})
        if user_filters:
            for fk, fvals in user_filters.items():
                if fk not in normal_filters:
                    normal_filters[fk] = fvals
        if normal_filters:
            mod_overrides["normal_filters"] = normal_filters
        
        merged = _merge_overrides(w, mod_overrides)
        parsed.append((key, merged, mod_overrides, date_range))
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
    for _key, w, _ov, date_range in parsed:
        if str(w.get("type") or "") != "kpi_bar_chart":
            continue
        kpi_ids.add(int(w.get("kpi_id") or 0))

    for kpi_id in sorted({k for k in kpi_ids if k > 0}):
        if not await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id):
            # Mark all widgets of this KPI as forbidden.
            for key, w, _ov, date_range in parsed:
                if int(w.get("kpi_id") or 0) == kpi_id:
                    results[key] = {"ok": False, "error": "forbidden"}

    entry_cache: dict[tuple[int, int, str | None], tuple[int | None, Any]] = {}

    async def _entry_for(kpi_id: int, year: int, period_key: Any) -> tuple[int | None, Any]:
        pk = _period_key_norm(period_key)
        k = (int(kpi_id), int(year), pk)
        if k not in entry_cache:
            eid_res = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
            if not eid_res[0]:
                kpi_check = await db.execute(select(KPI).where(KPI.id == int(kpi_id)))
                kpi_o = kpi_check.scalar_one_or_none()
                if kpi_o and getattr(kpi_o, "is_joined", False):
                    try:
                        from app.entries.joined_sync import sync_joined_kpi_physical_data
                        await sync_joined_kpi_physical_data(db, kpi_o, year=int(year), period_key=period_key, current_user_id=user.id if user else None)
                        await db.commit()
                        eid_res = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
                    except Exception as ex:
                        logger.error("Failed to sync joined KPI in _entry_for: %s", ex)
            entry_cache[k] = eid_res
        return entry_cache[k]

    # Re-declare sub_map_cache logic for internal payload mapping (uses cached mline field data)
    async def _populate_sub_map_for(kpi_id: int, source_field_key: str):
        f_full = await _mline_field_for(kpi_id, source_field_key)
        if f_full and int(f_full.id) not in sub_map_cache:
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

    dash_obj = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none() if dashboard_id else None
    dash_date_config = (dash_obj.date_fetching_config if dash_obj else None) or {}

    for key, w, _ov, date_range in parsed:
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
            # Keep existing per-widget path for non-mline charts (rare on bar/pie)
            meta, data, e_rev = await _kpi_bar_chart_payload(db, org_id, w, user=user, date_range=date_range)
            results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": meta, "data": data, "entry_revision": e_rev}
            continue

        source_key = str(w.get("source_field_key") or "").strip()
        f_full = await _populate_sub_map_for(kpi_id, source_key)
        if not f_full:
            results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": {"kpi_id": kpi_id, "year": year, "entry_id": None, "row_count": 0}, "data": {"mode": "multi_line_items", "raw_rows": []}, "entry_revision": None}
            continue

        date_sid = None
        if date_range:
            start_date, end_date, _col = date_range
            org_obj = await _get_org(db, org_id)
            spanned_years = _get_spanned_years(org_obj, start_date, end_date)
            entries_res = await db.execute(
                select(KPIEntry.id, KPIEntry.updated_at)
                .where(
                    KPIEntry.kpi_id == kpi_id,
                    KPIEntry.organization_id == org_id,
                    KPIEntry.is_draft == False,
                    KPIEntry.year.in_(spanned_years),
                )
            )
            entries_data = entries_res.all()
            eid = [r[0] for r in entries_data]
            e_rev = revision_for_parts(eid[0] if eid else 0, entries_data[0][1] if entries_data else None)
            if not eid:
                results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": {"kpi_id": kpi_id, "year": year, "entry_id": None, "row_count": 0, "source_field_id": int(f_full.id)}, "data": {"mode": "multi_line_items", "multi_line_agg_buckets": [], "raw_rows": []}, "entry_revision": None}
                continue
            date_col_key = get_widget_date_col_key(dash_date_config, kpi_id, source_key, f_full)
            if not date_col_key:
                date_col_key = getattr(f_full, "date_field_key", None)
            sub_id_by_key, ref_types = sub_map_cache[int(f_full.id)]
            date_sid = sub_id_by_key.get(str(date_col_key)) if date_col_key else None
        else:
            eid, e_ts = await _entry_for(kpi_id, year, period_key)
            e_rev = revision_for_parts(eid, e_ts)
            if not eid:
                results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": {"kpi_id": kpi_id, "year": year, "entry_id": None, "row_count": 0, "source_field_id": int(f_full.id)}, "data": {"mode": "multi_line_items", "multi_line_agg_buckets": [], "raw_rows": []}, "entry_revision": None}
                continue
            sub_id_by_key, ref_types = sub_map_cache[int(f_full.id)]

        agg_w = str(w.get("agg") or "count_rows").strip().lower()
        group_key = str(w.get("group_by_sub_field_key") or "").strip()
        filt_key = str(w.get("filter_sub_field_key") or "").strip()
        val_key = str(w.get("value_sub_field_key") or "").strip()

        gid = sub_id_by_key.get(group_key)
        fid = sub_id_by_key.get(filt_key) if filt_key else None
        vid = sub_id_by_key.get(val_key) if val_key else None

        if gid is None:
            results[key] = {"ok": False, "error": "missing group_by_sub_field_key"}
            continue

        col_filter = _ov.get("column_filter") if isinstance(_ov, dict) else w.get("column_filter")
        norm_filters = _ov.get("normal_filters") if isinstance(_ov, dict) else w.get("normal_filters")

        raw_filters = _combine_with_runtime_filters(
            w.get("filters"),
            column_filter=col_filter,
            normal_filters=norm_filters,
            kpi_id=kpi_id,
            source_field_key=source_key,
            sub_id_by_key=sub_id_by_key,
        )
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
                        entry_id=int(eid[0] if isinstance(eid, list) else eid),
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
        from app.entries.service import extract_cross_kpi_mli_references
        cross_kpi_refs = set()
        for sf in (getattr(f_full, "sub_fields", None) or []):
            if isinstance(sf.config, dict) and sf.config.get("formula_expression"):
                cross_kpi_refs.update(extract_cross_kpi_mli_references(sf.config.get("formula_expression")))
        has_cross_kpi_formula_subfields = bool(cross_kpi_refs)
        has_runtime_filter = bool(col_filter or norm_filters)
        needs_dynamic_recalc = has_cross_kpi_formula_subfields and has_runtime_filter

        if needs_dynamic_recalc or compiled is None:
            # Fallback: do not aggregate in SQL for this widget (dynamically evaluate formula subfields in memory).
            # For widgets with cross-KPI references, the column_filter and normal_filters belong to the referenced base KPI/MLI.
            # We preserve existing widget.filters for this MLI, while passing col_filter & norm_filters so recalculate_multi_line_rows_formulas
            # can filter the referenced base MLI data.
            base_filters = w.get("filters")
            w_fallback = {
                **w,
                "filters": base_filters,
                "column_filter": col_filter,
                "normal_filters": norm_filters,
            }
            meta, data, e_rev2 = await _kpi_bar_chart_payload(db, org_id, w_fallback, user=user, date_range=date_range)
            results[key] = {"ok": True, "widget_type": "kpi_bar_chart", "meta": meta, "data": data, "entry_revision": e_rev2}
            continue
        filter_where_sql, filter_params, filter_sid_params = compiled
        if not (filter_where_sql or "").strip():
            filter_where_sql, filter_params = (None, None)
            filter_sid_params = []

        eid_key = tuple(sorted(eid)) if isinstance(eid, (list, tuple)) else int(eid)
        sig = (
            eid_key,
            int(f_full.id),
            int(gid),
            int(fid) if fid is not None else None,
            int(vid) if vid is not None else None,
            agg_w,
            filter_where_sql or "",
            repr(sorted((filter_params or {}).items())),
            repr(filter_sid_params or []),
            int(date_sid) if date_sid is not None else None,
            repr(date_range) if date_range is not None else None,
        )
        sig_to_widgets.setdefault(sig, []).append(key)
        sig_to_args[sig] = {
            "entry_id": eid,
            "multiline_field_id": int(f_full.id),
            "group_sub_field_id": int(gid),
            "filter_sub_field_id": int(fid) if fid is not None else None,
            "value_sub_field_id": int(vid) if vid is not None else None,
            "agg": agg_w,
            "filter_where_sql": filter_where_sql,
            "filter_params": filter_params,
            "filter_sid_params": filter_sid_params or [],
            "date_sub_field_id": int(date_sid) if date_sid is not None else None,
            "date_range": date_range,
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
    max_concurrency = int(getattr(settings, "WIDGET_CHART_MAX_CONCURRENCY", 4) or 4)

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
                            f"entry_id={args.get('entry_id')} multiline_field_id={args.get('multiline_field_id')}"
                        )
                except Exception:
                    pass
                return (sig, None, str(e))

    sig_tasks = [_run_sig(sig) for sig in sigs]
    agg_results = await asyncio.gather(*sig_tasks) if sig_tasks else []

    for sig, buckets, err in agg_results:
        keys = sig_to_widgets.get(sig) or []
        args = sig_to_args.get(sig) or {}
        if err or buckets is None:
            for key in keys:
                # Unify timeout messaging for UI.
                msg = "aggregate timed out" if "statement timeout" in str(err or "").lower() else (err or "aggregate failed")
                results[key] = {"ok": False, "error": msg}
            continue
        row_count = sum(int(b["n"]) for b in buckets)
        eid_val = args.get("entry_id")
        meta_eid = eid_val[0] if isinstance(eid_val, list) and eid_val else eid_val
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
                    "entry_id": meta_eid,
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


def _get_config_val(config: Any, key: str, default: Any = None) -> Any:
    if hasattr(config, key):
        val = getattr(config, key)
        return val if val is not None else default
    if isinstance(config, dict):
        val = config.get(key)
        return val if val is not None else default
    return default


def resolve_date_range_for_period(config: Any, selected_period: str, period_type: str | None = None) -> tuple[datetime.date, datetime.date, int]:
    if selected_period == "by_default" or selected_period == "By Default":
        raise ValueError("Cannot resolve date range for default period")
    import datetime as dt
    import calendar
    import re
    import math

    # Try to find a matching custom period configuration from config.custom_periods if it exists
    custom_periods = _get_config_val(config, "custom_periods")
    if custom_periods and isinstance(custom_periods, list):
        matched_config = None
        if period_type:
            for cp in custom_periods:
                if isinstance(cp, dict) and _get_config_val(cp, "custom_period_name") == period_type:
                    matched_config = cp
                    break
        if not matched_config:
            for cp in custom_periods:
                if not isinstance(cp, dict):
                    continue
                # Get prefix, suffix, and display format for this configuration
                prefix = _get_config_val(cp, "custom_period_prefix") or ""
                suffix = _get_config_val(cp, "custom_period_suffix") or ""
                display_format = _get_config_val(cp, "custom_period_display_format") or "YYYY"
                
                val = selected_period
                if prefix and not val.startswith(prefix):
                    continue
                if suffix and not val.endswith(suffix):
                    continue
                    
                if prefix:
                    val = val[len(prefix):]
                if suffix:
                    val = val[:-len(suffix)] if len(suffix) > 0 else val
                val = val.strip()
                
                # Check pattern matching based on display format
                matched = False
                if display_format == "YYYY":
                    matched = bool(re.match(r'^\d{4}$', val))
                elif display_format in ("YYYY/YY", "YYYY-YY", "YYYY-YYYY", "YYYY–YYYY"):
                    matched = bool(re.match(r'^\d{4}[/\-–]\d{2,4}$', val))
                elif display_format == "YY/YYYY":
                    matched = bool(re.match(r'^\d{2}/\d{4}$', val))
                else:
                    matched = bool(re.search(r'\b\d{4}\b', val))
                    
                if matched:
                    matched_config = cp
                    break
        
        if matched_config:
            config = matched_config

    prefix = _get_config_val(config, "custom_period_prefix") or ""
    suffix = _get_config_val(config, "custom_period_suffix") or ""
    display_format = _get_config_val(config, "custom_period_display_format") or "YYYY"
    start_month = int(_get_config_val(config, "custom_period_start_month", 1))
    start_day = int(_get_config_val(config, "custom_period_start_day", 1))
    duration_months = int(_get_config_val(config, "custom_period_duration_months", 12))
    
    val = selected_period
    if prefix and val.startswith(prefix):
        val = val[len(prefix):]
    if suffix and val.endswith(suffix):
        val = val[:-len(suffix)] if len(suffix) > 0 else val
        
    start_year = dt.date.today().year
    val = val.strip()
    
    if display_format == "YYYY":
        try:
            start_year = int(val)
        except ValueError:
            pass
    elif display_format in ("YYYY/YY", "YYYY-YY", "YYYY-YYYY", "YYYY–YYYY"):
        try:
            start_year = int(val[:4])
        except ValueError:
            pass
    elif display_format == "YY/YYYY":
        try:
            end_year = int(val[-4:])
            years_diff = math.ceil(duration_months / 12)
            start_year = end_year - years_diff
        except ValueError:
            pass
    else:
        match = re.search(r'\b\d{4}\b', val)
        if match:
            start_year = int(match.group(0))
            
    start_date = dt.date(start_year, start_month, start_day)
    
    month = start_date.month - 1 + duration_months
    end_year = start_date.year + (month // 12)
    end_month = (month % 12) + 1
    max_days = calendar.monthrange(end_year, end_month)[1]
    end_day = min(start_date.day, max_days)
    end_date = dt.date(end_year, end_month, end_day)
    
    entry_year = start_year
    if start_month > 1:
        entry_year = start_year + 1
    return start_date, end_date, entry_year


def _get_spanned_years(org: Organization | None, start_date: datetime.date, end_date: datetime.date) -> list[int]:
    import datetime
    start_month = start_date.month
    start_day = start_date.day
        
    def _entry_year(d: datetime.date) -> int:
        if start_month == 1:
            return d.year
        if (d.month > start_month) or (d.month == start_month and d.day >= start_day):
            return d.year + 1
        return d.year
        
    last_date = end_date - datetime.timedelta(days=1) if end_date > start_date else start_date
    y_start = _entry_year(start_date)
    y_end = _entry_year(last_date)
    
    return list(range(min(y_start, y_end), max(y_start, y_end) + 1))


async def preprocess_dashboard_date_fetching(
    db: AsyncSession,
    org_id: int,
    dashboard_id: int | None,
    w: dict[str, Any],
    overrides: dict[str, Any] | None
) -> tuple[dict[str, Any], dict[str, Any] | None, tuple[datetime.date, datetime.date, str] | None]:
    import datetime as dt
    merged = _merge_overrides(w, overrides)
    if dashboard_id is None:
        return merged, overrides, None
        
    dashboard = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
    if not dashboard or not getattr(dashboard, "fetch_data_with_date", False):
        return merged, overrides, None
        
    org = await _get_org(db, org_id)
    if not org:
        return merged, overrides, None
        
    selected_period = (overrides or {}).get("year") or w.get("year")
    period_type = (overrides or {}).get("period_type") or (w.get("period_type") if isinstance(w, dict) else None)
    if not selected_period or selected_period == "by_default" or selected_period == "By Default":
        return merged, overrides, None
        
    try:
        start_date, end_date, start_year = resolve_date_range_for_period(org, str(selected_period), period_type=period_type)
    except Exception:
        return merged, overrides, None
        
    mod_overrides = dict(overrides or {})
    mod_overrides["year"] = start_year
    
    mod_w = dict(w)
    mod_w["year"] = start_year
    
    merged_mod = _merge_overrides(mod_w, mod_overrides)
    
    kpi_id = int(merged_mod.get("kpi_id") or 0)
    source_key = (merged_mod.get("source_field_key") or merged_mod.get("field_key") or "").strip()
    
    date_fetching_config = getattr(dashboard, "date_fetching_config", None) or {}
    mli_date_cols = date_fetching_config.get("mli_date_cols") or {}
    
    date_col_key = None
    if kpi_id and source_key:
        date_col_key = mli_date_cols.get(f"{kpi_id}_{source_key}") or mli_date_cols.get(f"{kpi_id}_{merged_mod.get('source_field_id')}")
        
    date_range = None
    if date_col_key:
        date_range = (start_date, end_date, str(date_col_key))
        
    return merged_mod, mod_overrides, date_range


async def resolve_date_context_for_dashboard(
    db: AsyncSession,
    org_id: int,
    dashboard_id: int | None,
    selected_period: Any,
    period_type: str | None = None,
) -> tuple[datetime.date, datetime.date, int, dict] | None:
    if dashboard_id is None or not selected_period:
        return None
    if selected_period == "by_default" or selected_period == "By Default":
        return None
    dashboard = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
    if not dashboard or not getattr(dashboard, "fetch_data_with_date", False):
        return None
    org = await _get_org(db, org_id)
    if not org:
        return None
    try:
        start_date, end_date, start_year = resolve_date_range_for_period(org, str(selected_period), period_type=period_type)
        return start_date, end_date, start_year, getattr(dashboard, "date_fetching_config", None) or {}
    except Exception:
        return None


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
            KPIEntry.is_draft == False,
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
            KPIEntry.is_draft == False,
        )
    )
    row = r.one_or_none()
    if not row:
        return None, None
    return int(row[0]), row[1]


async def get_field_values_for_field_ids(
    db: AsyncSession, *, entry_id: int, field_ids: list[int], current_user_id: int | None = None
) -> dict[int, KPIFieldValue]:
    if not field_ids:
        return {}
    uq = sorted({int(x) for x in field_ids})
    
    from app.core.models import KPIEntry, KPI
    entry_res = await db.execute(select(KPIEntry).where(KPIEntry.id == entry_id))
    entry = entry_res.scalar_one_or_none()
    if entry:
        kpi_res = await db.execute(select(KPI).where(KPI.id == entry.kpi_id).options(selectinload(KPI.fields)))
        kpi = kpi_res.scalar_one_or_none()
        if kpi and kpi.is_joined:
            from app.entries.load_joined import load_joined_scalar_values
            mock_fvs = await load_joined_scalar_values(db, joined_kpi=kpi, entry_id=entry_id, current_user_id=current_user_id)
            return {int(fv.field_id): fv for fv in mock_fvs if int(fv.field_id) in uq}

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
    
    from app.core.models import KPI
    kpi_res = await db.execute(select(KPI).where(KPI.id == kpi_id).options(selectinload(KPI.fields)))
    kpi = kpi_res.scalar_one_or_none()
    if kpi and kpi.is_joined:
        from app.core.models import KPIEntry
        entry_res = await db.execute(
            select(KPIEntry).where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == kpi_id,
                KPIEntry.year == int(year),
                KPIEntry.period_key == pk,
                KPIEntry.is_draft == False,
            )
        )
        entry = entry_res.scalar_one_or_none()
        if not entry:
            entry = KPIEntry(
                organization_id=org_id,
                kpi_id=kpi_id,
                year=int(year),
                period_key=pk,
                is_draft=False,
            )
            db.add(entry)
            await db.flush()
        
        eid = entry.id
        e_ts = entry.updated_at
        
        from app.entries.load_joined import load_joined_scalar_values
        mock_fvs = await load_joined_scalar_values(db, joined_kpi=kpi, entry_id=eid)
        fv_by_id = {int(fv.field_id): fv for fv in mock_fvs if int(fv.field_id) in uq}
        return eid, e_ts, fv_by_id

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
            KPIEntry.is_draft == False,
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
                KPIEntry.is_draft == False,
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


def _row_matches_specific_column_filter(r: dict[str, Any], column_filter: dict[str, Any] | None) -> bool:
    """Check if an MLI row dict matches the active specific column filter."""
    if not column_filter or not isinstance(column_filter, dict):
        return True
    col_key = str(column_filter.get("column_key") or column_filter.get("key") or "").strip()
    if not col_key:
        return True
    if col_key not in r:
        return True
    
    val = r.get(col_key)
    if val is None:
        return False
    if isinstance(val, dict):
        val_str = str(val.get("label") or val.get("name") or val.get("value") or "").strip()
    else:
        val_str = str(val).strip()

    expected_val = column_filter.get("value")
    expected_vals = column_filter.get("values")
    if expected_vals and isinstance(expected_vals, list):
        valid_exp = [str(v).strip().lower() for v in expected_vals if str(v).strip()]
        return val_str.lower() in valid_exp if valid_exp else True
    if expected_val is not None and str(expected_val).strip() != "":
        return val_str.lower() == str(expected_val).strip().lower()
    return True


def _row_matches_normal_filters(
    r: dict[str, Any],
    normal_filters: dict[str, Any] | None,
    known_sub_field_keys: set[str] | list[str] | None = None,
) -> bool:
    """Check if an MLI row dict matches configured normal filters."""
    if not normal_filters or not isinstance(normal_filters, dict):
        return True
    norm_known = {str(k).strip().lower() for k in known_sub_field_keys} if known_sub_field_keys else set()
    for f_key, sel_vals in normal_filters.items():
        if not f_key or not sel_vals:
            continue

        val = None
        found_key = False

        if f_key in r:
            val = r[f_key]
            found_key = True
        else:
            target_norm = str(f_key).strip().lower()
            for k, v in r.items():
                k_norm = str(k).strip().lower()
                if (
                    k_norm == target_norm
                    or k_norm == f"{target_norm}_name"
                    or k_norm == f"{target_norm}_id"
                    or target_norm == f"{k_norm}_name"
                    or target_norm == f"{k_norm}_id"
                ):
                    val = v
                    found_key = True
                    break

        if not found_key:
            target_norm = str(f_key).strip().lower()
            if norm_known and (
                target_norm in norm_known
                or f"{target_norm}_name" in norm_known
                or f"{target_norm}_id" in norm_known
                or any(k == target_norm or k == f"{target_norm}_name" or target_norm == f"{k}_name" for k in norm_known)
            ):
                return False
            continue

        if val is None:
            return False

        if isinstance(val, dict):
            val_str = str(val.get("label") or val.get("name") or val.get("value") or "").strip()
        else:
            val_str = str(val).strip()

        if isinstance(sel_vals, list):
            valid_exp = [str(v).strip().lower() for v in sel_vals if str(v).strip()]
            if valid_exp and val_str.lower() not in valid_exp:
                return False
        elif str(sel_vals).strip():
            if val_str.lower() != str(sel_vals).strip().lower():
                return False
    return True


async def recalculate_multi_line_rows_formulas(
    db: AsyncSession,
    org_id: int,
    year: int,
    field: KPIField,
    rows: list[dict[str, Any]],
    *,
    column_filter: dict[str, Any] | None = None,
    normal_filters: dict[str, Any] | None = None,
    period_key: str | None = None,
) -> list[dict[str, Any]]:
    """
    Dynamically recomputes all formula subfields on a list of MLI rows in memory.
    If any subfield formulas reference other KPIs (e.g. AVG_KPI_ITEMS_WHERE, COUNT_KPI_ITEMS_WHERE),
    the referenced other KPI MLI rows are loaded and filtered by column_filter and normal_filters.
    """
    if not rows:
        return rows

    sub_fields = list(getattr(field, "sub_fields", None) or [])
    if not sub_fields:
        sres = await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.field_id == field.id))
        sub_fields = list(sres.scalars().all())
        field.sub_fields = sub_fields

    formula_subs = [
        sf for sf in sub_fields
        if getattr(sf, "field_type", None) in ("formula", FieldType.formula) or
        getattr(getattr(sf, "field_type", None), "value", None) == "formula" or
        (isinstance(sf.config, dict) and (sf.config.get("is_formula") or sf.config.get("formula_expression") or sf.config.get("conditional_logic")))
    ]
    if not formula_subs:
        return rows

    from app.entries.service import (
        extract_cross_kpi_mli_references,
        _load_other_kpi_multi_line_data,
        _load_other_kpi_values,
        _topological_sort_subfields,
    )
    from app.formula_engine.evaluator import evaluate_formula, apply_conditional_logic
    import re

    refs = set()
    for sf in sub_fields:
        cfg = sf.config if isinstance(sf.config, dict) else {}
        expr = cfg.get("formula_expression")
        if expr:
            refs.update(extract_cross_kpi_mli_references(expr))

    # If this MLI field has no cross-KPI formula references, stored DB cells are already valid per row.
    if not refs:
        return rows

    other_kpi_mli_data = {}
    if refs:
        raw_other_kpi_mli = await _load_other_kpi_multi_line_data(
            db, year, org_id, refs, period_key=period_key, is_draft=False
        )
        for (ref_kpi_id, ref_field_key), r_rows in raw_other_kpi_mli.items():
            filtered_r_rows = r_rows
            if column_filter:
                filtered_r_rows = [r for r in filtered_r_rows if _row_matches_specific_column_filter(r, column_filter)]
            if normal_filters:
                r_keys = set().union(*(r.keys() for r in filtered_r_rows if isinstance(r, dict))) if filtered_r_rows else set()
                filtered_r_rows = [r for r in filtered_r_rows if _row_matches_normal_filters(r, normal_filters, known_sub_field_keys=r_keys)]
            other_kpi_mli_data[(ref_kpi_id, ref_field_key)] = filtered_r_rows

    other_kpi_values = {}
    try:
        other_kpi_values = await _load_other_kpi_values(
            db, year, org_id, int(field.kpi_id), period_key=period_key, is_draft=False
        )
    except Exception:
        pass

    sorted_subs = _topological_sort_subfields(sub_fields)
    working_rows = [dict(r) for r in rows]

    for sf in sorted_subs:
        cfg = sf.config if isinstance(sf.config, dict) else {}
        expr = cfg.get("formula_expression")
        cond_logic = cfg.get("conditional_logic") if isinstance(cfg, dict) else None
        if not expr and not (cond_logic and cond_logic.get("enabled")):
            continue

        norm_expr = str(expr) if expr else ""
        if norm_expr:
            sorted_all_subs = sorted(sub_fields, key=lambda s: len(s.name or ""), reverse=True)
            for sub_item in sorted_all_subs:
                s_name = (sub_item.name or "").strip()
                s_key = (sub_item.key or "").strip()
                if s_name and s_key and s_name != s_key:
                    pattern = r'("[^"]*"|\'[^\']*\')|\b' + re.escape(s_name) + r'\b'
                    norm_expr = re.sub(pattern, lambda m: m.group(1) if m.group(1) is not None else s_key, norm_expr)

        for working_row in working_rows:
            if norm_expr:
                computed = evaluate_formula(
                    norm_expr,
                    {},
                    {field.key: working_rows},
                    other_kpi_values,
                    current_row=working_row,
                    other_kpi_multi_line_data=other_kpi_mli_data,
                )
            else:
                computed = working_row.get(sf.key)

            if cond_logic and isinstance(cond_logic, dict) and cond_logic.get("enabled"):
                computed = apply_conditional_logic(computed, cond_logic)

            dec_places = cfg.get("decimal_places") if isinstance(cfg, dict) else None
            if dec_places is None:
                dec_places = 2
            if dec_places is not None and str(dec_places).lower() != "auto":
                try:
                    dp = int(dec_places)
                    if isinstance(computed, (float, int)) and not isinstance(computed, bool):
                        computed = round(float(computed), dp)
                        if dp == 0:
                            computed = int(computed)
                except (ValueError, TypeError):
                    pass

            working_row[sf.key] = computed

    return working_rows


async def load_multi_line_row_dicts_filtered(
    db: AsyncSession,
    org_id: int,
    *,
    entry_id: int | list[int],
    field: KPIField,
    kpi_id: int,
    year: int,
    raw_filters: Any,
    current_user_id: int | None = None,
    date_range: tuple[datetime.date, datetime.date, str] | None = None,
    column_filter: dict[str, Any] | None = None,
    normal_filters: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], int]:
    pairs = await load_multi_line_row_dicts(
        db, entry_id=entry_id, field=field, current_user_id=current_user_id, date_range=date_range
    )
    rows = [d for _i, d in pairs if isinstance(d, dict)]
    n_before = len(rows)
    if column_filter:
        rows = [r for r in rows if _row_matches_specific_column_filter(r, column_filter)]
    if normal_filters:
        all_keys = set().union(*(r.keys() for r in rows if isinstance(r, dict))) if rows else set()
        for sf in (getattr(field, "sub_fields", None) or []):
            if getattr(sf, "key", None):
                all_keys.add(sf.key)
        rows = [r for r in rows if _row_matches_normal_filters(r, normal_filters, known_sub_field_keys=all_keys)]
    recalculated = await recalculate_multi_line_rows_formulas(
        db,
        org_id,
        int(year) if year else 0,
        field,
        rows,
        column_filter=column_filter,
        normal_filters=normal_filters,
    )
    final_filtered = await _apply_row_filters(
        db,
        org_id,
        field,
        int(year) if year else None,
        raw_filters,
        recalculated,
    )
    return final_filtered, n_before


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
    db: AsyncSession, org_id: int, w: dict[str, Any], user: User | None = None, date_range: tuple[datetime.date, datetime.date, str] | None = None
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
        if date_range:
            start_date, end_date, _col = date_range
            org = await _get_org(db, org_id)
            spanned_years = _get_spanned_years(org, start_date, end_date)
            entries_res = await db.execute(
                select(KPIEntry.id)
                .where(
                    KPIEntry.kpi_id == kpi_id,
                    KPIEntry.organization_id == org_id,
                    KPIEntry.is_draft == False,
                    KPIEntry.year.in_(spanned_years)
                )
            )
            eid = [r[0] for r in entries_res.all()]
            if not eid:
                latest_res = await db.execute(
                    select(KPIEntry.id)
                    .where(
                        KPIEntry.kpi_id == kpi_id,
                        KPIEntry.organization_id == org_id,
                        KPIEntry.is_draft == False
                    )
                    .order_by(KPIEntry.year.desc())
                    .limit(1)
                )
                latest_eid = latest_res.scalar_one_or_none()
                if latest_eid:
                    eid = [latest_eid]
            e_rev = None
        else:
            eid, e_ts = await get_entry_id_updated(
                db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
            )
            if not eid and kpi.is_joined:
                try:
                    from app.entries.joined_sync import sync_joined_kpi_physical_data
                    await sync_joined_kpi_physical_data(db, kpi, year=year, period_key=period_key, current_user_id=user.id if user else None)
                    await db.commit()
                    eid, e_ts = await get_entry_id_updated(
                        db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key
                    )
                except Exception as ex:
                    logger.error("Failed to sync joined KPI in _kpi_bar_chart_payload: %s", ex)
            e_rev = revision_for_parts(eid, e_ts)
        source_key = (w.get("source_field_key") or "").strip()
        f_obj = next((f for f in fields if f.key == source_key and f.field_type == FieldType.multi_line_items), None)
        if not f_obj or not eid:
            meta_eid = eid[0] if isinstance(eid, list) and eid else (None if isinstance(eid, list) else eid)
            return (
                {
                    "kpi_id": kpi_id,
                    "year": year,
                    "period_key": _period_key_norm(period_key),
                    "entry_id": meta_eid,
                    "row_count": 0,
                    "source_field_id": f_obj.id if f_obj else None,
                },
                {
                    "mode": "multi_line_items",
                    "raw_rows": [],
                },
                e_rev,
            )
        col_filter = w.get("column_filter")
        norm_filters = w.get("normal_filters")
        raw_filters = _combine_with_runtime_filters(
            w.get("filters"),
            column_filter=col_filter,
            normal_filters=norm_filters,
            kpi_id=kpi_id,
            source_field_key=source_key,
        )
        agg_w = str(w.get("agg") or "count_rows").strip().lower()
        group_key = (w.get("group_by_sub_field_key") or "").strip()
        filt_key = (w.get("filter_sub_field_key") or "").strip()
        val_key = (w.get("value_sub_field_key") or "").strip()
        use_sql_agg = agg_w in ("count_rows", "sum", "avg") if not date_range else False
        filter_where_sql: str | None = None
        filter_sql_params: dict[str, Any] | None = None
        filter_sid_params: list[str] | None = None
        gid, fid, vid = None, None, None
        if use_sql_agg:
            f_full = await get_field_with_subfields_only(db, int(f_obj.id), org_id) or f_obj
            from app.entries.service import extract_cross_kpi_mli_references
            has_cross_kpi_formula_subfields = any(
                isinstance(sf.config, dict) and sf.config.get("formula_expression") and
                bool(extract_cross_kpi_mli_references(sf.config.get("formula_expression")))
                for sf in (getattr(f_full, "sub_fields", None) or [])
            )
            has_runtime_filter = bool(col_filter or norm_filters)
            needs_dynamic_recalc = has_cross_kpi_formula_subfields and has_runtime_filter
            if needs_dynamic_recalc:
                use_sql_agg = False
            else:
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
                    filter_where_sql, filter_sql_params, filter_sid_params = compiled
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
                        filter_sid_params=filter_sid_params,
                    )
                except Exception:
                    buckets = None
                if buckets is not None:
                    row_count = sum(int(b["n"]) for b in buckets)
                    filter_col_opts: dict[str, list[str]] = {}
                    cf_keys = w.get("configured_filter_keys") or []
                    if filt_key:
                        cf_keys = list(set(list(cf_keys) + [filt_key]))
                    for fk_item in cf_keys:
                        sid_item = sub_id_by_key.get(str(fk_item))
                        if sid_item and eid and not isinstance(eid, list):
                            labs = await _distinct_multiline_subfield_labels(
                                db, entry_id=int(eid), multiline_field_id=int(f_obj.id), sub_field_id=int(sid_item)
                            )
                            if labs:
                                filter_col_opts[str(fk_item)] = labs
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
                            "filter_column_options": filter_col_opts,
                            "raw_rows": [],
                            "field_map": fmap,
                        },
                        e_rev,
                    )
        col_filter = w.get("column_filter")
        norm_filters = w.get("normal_filters")
        f_obj = await _field_with_subs_if_mline_filters(
            db, org_id, f_obj, raw_filters
        )
        rows, _n_before = await load_multi_line_row_dicts_filtered(
            db,
            org_id,
            entry_id=eid,
            field=f_obj,
            kpi_id=kpi_id,
            year=year,
            raw_filters=raw_filters,
            current_user_id=user.id if user else None,
            date_range=date_range,
            column_filter=col_filter,
            normal_filters=norm_filters,
        )
        meta_eid = eid[0] if isinstance(eid, list) and eid else (None if isinstance(eid, list) else eid)
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": meta_eid,
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
    all_kpi_fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    field_by_key = {fld.key: fld for fld in all_kpi_fields}
    for key in keys:
        fid = fmap["id_by_key"].get(key)
        f_obj = field_by_key.get(key)
        is_formula = f_obj and (
            f_obj.field_type == FieldType.formula or
            (isinstance(f_obj.config, dict) and (f_obj.config.get("is_formula") or f_obj.config.get("formula_expression")))
        )
        if is_formula and (col_filter or norm_filters):
            raw = await evaluate_kpi_scalar_formula_field(
                db, org_id, kpi_id, year, period_key, f_obj, eid,
                column_filter=col_filter,
                normal_filters=norm_filters,
                user=user,
            )
            val = to_numeric(raw)
        else:
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
    return await _kpi_bar_chart_payload(db, org_id, w, user=user)


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
    col_filter = w.get("column_filter")
    norm_filters = w.get("normal_filters")
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
                db,
                org_id,
                entry_id=eid_y,
                field=f_obj,
                kpi_id=kpi_id,
                year=yy,
                raw_filters=w.get("filters"),
                current_user_id=user.id,
                column_filter=col_filter,
                normal_filters=norm_filters,
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

    # --- Bulk fetch: all entries for this KPI+period across all years in one query ---
    pk_norm = _period_key_norm(period_key)
    entries_res = await db.execute(
        select(KPIEntry.year, KPIEntry.id, KPIEntry.updated_at)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year.in_(years),
            KPIEntry.period_key == pk_norm,
            KPIEntry.is_draft == False,
        )
    )
    trend_entry_by_year: dict[int, tuple[int, Any]] = {}
    for yr_val, eid_val, e_ts_val in entries_res.all():
        trend_entry_by_year[int(yr_val)] = (int(eid_val), e_ts_val)

    # --- Bulk fetch: all field values for those entries in one query ---
    all_trend_eids = [eid for eid, _ in trend_entry_by_year.values()]
    trend_fv_by_eid: dict[int, dict[int, Any]] = {}
    if all_trend_eids and fids:
        fvs_res = await db.execute(
            select(KPIFieldValue)
            .where(
                KPIFieldValue.entry_id.in_(all_trend_eids),
                KPIFieldValue.field_id.in_([int(f) for f in fids]),
            )
        )
        for fv in fvs_res.scalars().all():
            eid_key = int(fv.entry_id)
            if eid_key not in trend_fv_by_eid:
                trend_fv_by_eid[eid_key] = {}
            trend_fv_by_eid[eid_key][int(fv.field_id)] = fv

    for yy in years:
        bars: list[dict[str, Any]] = []
        if yy not in trend_entry_by_year:
            for key in keys:
                bars.append({"key": key, "label": fmap["name_by_key"].get(key) or key, "value": None})
        else:
            eid_y, e_ts = trend_entry_by_year[yy]
            r = revision_for_parts(eid_y, e_ts)
            if r:
                revisions.append(r)
            fv_map_for_entry = trend_fv_by_eid.get(eid_y, {})
            for key in keys:
                fid_k = fmap["id_by_key"].get(key)
                fv_row = fv_map_for_entry.get(int(fid_k)) if fid_k else None
                raw = _field_value_raw(fv_row) if fv_row else None
                v = to_numeric(raw) if fid_k else None
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
    pk = _period_key_norm(period_key)

    # --- Bulk fetch: all entries for this KPI+period across all years in one query ---
    entries_res = await db.execute(
        select(KPIEntry.year, KPIEntry.id, KPIEntry.updated_at)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year.in_(years),
            KPIEntry.period_key == pk,
            KPIEntry.is_draft == False,
        )
    )
    entry_by_year: dict[int, tuple[int, Any]] = {}
    for yr_val, eid_val, e_ts_val in entries_res.all():
        entry_by_year[int(yr_val)] = (int(eid_val), e_ts_val)

    # --- Bulk fetch: all field values for those entries in one query ---
    all_eids = [eid for eid, _ in entry_by_year.values()]
    fv_by_eid: dict[int, Any] = {}
    if all_eids:
        fvs_res = await db.execute(
            select(KPIFieldValue)
            .where(
                KPIFieldValue.entry_id.in_(all_eids),
                KPIFieldValue.field_id == int(fid),
            )
        )
        for fv in fvs_res.scalars().all():
            fv_by_eid[int(fv.entry_id)] = fv

    points: list[dict[str, Any]] = []
    revisions: list[str] = []
    for y in years:
        if y not in entry_by_year:
            points.append({"year": y, "value": None})
            continue
        eid_y, e_ts = entry_by_year[y]
        r = revision_for_parts(eid_y, e_ts)
        if r:
            revisions.append(r)
        fv_row = fv_by_eid.get(eid_y)
        raw = _field_value_raw(fv_row) if fv_row else None
        v = to_numeric(raw)
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
    fv_by_id = await get_field_values_for_field_ids(db, entry_id=eid, field_ids=fids, current_user_id=user.id) if eid else {}
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
        fvm = await get_field_values_for_field_ids(db, entry_id=eid, field_ids=[int(fid)], current_user_id=user.id)
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
        f_obj = next((fld for fld in fields if fld.key == fk), None)
        c_flt = w.get("column_filter")
        n_flt = w.get("normal_filters")
        raw = await evaluate_kpi_scalar_formula_field(
            db, org_id, kpi_id, year, period_key, f_obj, eid,
            column_filter=c_flt,
            normal_filters=n_flt,
            user=user,
        )
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
            db, org_id, entry_id=eid, field=f_obj, kpi_id=kpi_id, year=year, raw_filters=w.get("filters"), current_user_id=user.id
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
        db, org_id, entry_id=eid, field=f_obj, kpi_id=kpi_id, year=year, raw_filters=w.get("filters"), current_user_id=user.id
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
                db, org_id, entry_id=jeid, field=jf, kpi_id=jkpi, year=year, raw_filters=None, current_user_id=user.id
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
    date_ctx = await resolve_date_context_for_dashboard(
        db,
        org_id,
        dashboard_id,
        (overrides or {}).get("year") or widget.get("year"),
        period_type=(overrides or {}).get("period_type") or (widget.get("period_type") if isinstance(widget, dict) else None),
    )
    mod_overrides = dict(overrides) if overrides else {}
    by_default_bypass = False
    if mod_overrides.get("year") in ("by_default", "By Default"):
        by_default_bypass = True
        mod_overrides.pop("year", None)
    if mod_overrides.get("by_default") is True:
        by_default_bypass = True
        mod_overrides.pop("by_default", None)
    _clean_by_default_overrides(mod_overrides, by_default_bypass)

    if date_ctx and not by_default_bypass:
        _start_date, _end_date, start_year, _config = date_ctx
        mod_overrides["year"] = start_year

    merged = _merge_overrides(widget, mod_overrides)
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

    date_range = None
    if date_ctx:
        start_date, end_date, start_year, config = date_ctx
        source_key = (merged.get("source_field_key") or "").strip()
        f_def = None
        if kpi_id and source_key:
            fs = await list_kpi_field_definitions(db, kpi_id, org_id)
            f_def = next((f for f in fs if f.key == source_key), None)
        date_col_key = get_widget_date_col_key(config, kpi_id, source_key, f_def)
        if date_col_key:
            date_range = (start_date, end_date, str(date_col_key))

    meta, data, e_rev = await _kpi_bar_chart_payload(db, org_id, merged, user=user, date_range=date_range)
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


async def evaluate_kpi_scalar_formula_field(
    db: AsyncSession,
    org_id: int,
    kpi_id: int,
    year: int,
    period_key: str | None,
    f: KPIField | None,
    eid: int | list[int] | None,
    *,
    date_range: tuple[datetime.date, datetime.date, str] | None = None,
    column_filter: dict[str, Any] | None = None,
    normal_filters: dict[str, Any] | None = None,
    user: User | None = None,
) -> Any:
    """
    Evaluates a KPI scalar formula field dynamically against runtime filtered multi-line data.
    If the field is not a formula, returns the stored DB cell value.
    """
    if not f:
        return None

    is_formula = f.field_type == FieldType.formula or (
        isinstance(f.config, dict) and (f.config.get("is_formula") or f.config.get("formula_expression"))
    )

    if not is_formula:
        if eid and not isinstance(eid, list):
            fvm = await get_field_values_for_field_ids(
                db, entry_id=int(eid), field_ids=[int(f.id)], current_user_id=user.id if user else None
            )
            return raw_field_from_fv_map(fvm, int(f.id))
        return None

    entry_ids: list[int] = []
    if date_range:
        start_date, end_date, _col = date_range
        org = await _get_org(db, org_id)
        spanned_years = _get_spanned_years(org, start_date, end_date)
        entries_res = await db.execute(
            select(KPIEntry.id)
            .where(
                KPIEntry.kpi_id == kpi_id,
                KPIEntry.organization_id == org_id,
                KPIEntry.is_draft == False,
                KPIEntry.year.in_(spanned_years),
            )
        )
        entry_ids = [r[0] for r in entries_res.all()]
        if not entry_ids:
            latest_res = await db.execute(
                select(KPIEntry.id)
                .where(
                    KPIEntry.kpi_id == kpi_id,
                    KPIEntry.organization_id == org_id,
                    KPIEntry.is_draft == False,
                )
                .order_by(KPIEntry.year.desc())
                .limit(1)
            )
            latest_eid = latest_res.scalar_one_or_none()
            if latest_eid:
                entry_ids = [latest_eid]
    else:
        if isinstance(eid, list):
            entry_ids = [int(x) for x in eid if x]
        elif eid:
            entry_ids = [int(eid)]
        else:
            resolved_eid, _ = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
            if resolved_eid:
                entry_ids = [int(resolved_eid)]

    target_eid = entry_ids[0] if entry_ids else None
    all_fields = await list_kpi_field_definitions(db, kpi_id, org_id)
    value_by_key = {}
    if target_eid:
        fvm = await get_field_values_for_field_ids(
            db,
            entry_id=int(target_eid),
            field_ids=[int(fld.id) for fld in all_fields],
            current_user_id=user.id if user else None,
        )
        for fld in all_fields:
            val = raw_field_from_fv_map(fvm, int(fld.id))
            n_val = to_numeric(val)
            if n_val is not None:
                value_by_key[fld.key] = n_val

    formula_expr = f.formula_expression or (f.config.get("formula_expression") if isinstance(f.config, dict) else "") or ""
    import re
    expr_tokens = set(re.findall(r'\b[a-zA-Z_][a-zA-Z0-9_]*\b', formula_expr))

    multi_line_items_data = {}
    for fld in all_fields:
        if fld.field_type == FieldType.multi_line_items:
            # Skip loading MLI tables that are not referenced in the scalar formula:
            if formula_expr and fld.key not in expr_tokens:
                continue

            mli_cache_key = f"_mli_cache_{fld.id}_{tuple(entry_ids)}_{date_range}_{repr(column_filter)}_{repr(normal_filters)}"
            if hasattr(db, "info") and mli_cache_key in db.info:
                multi_line_items_data[fld.key] = db.info[mli_cache_key]
                continue

            fld_date_range = None
            if date_range:
                start_date, end_date, passed_col = date_range
                fld_date_col = (str(passed_col).strip() if passed_col else None) or getattr(fld, "date_field_key", None)
                if not fld_date_col:
                    for sf in (getattr(fld, "sub_fields", None) or []):
                        if getattr(sf, "field_type", None) == FieldType.date:
                            fld_date_col = sf.key
                            break
                fld_date_range = (start_date, end_date, str(fld_date_col)) if fld_date_col else None
            if entry_ids:
                pairs = await load_multi_line_row_dicts(
                    db, entry_id=entry_ids, field=fld, current_user_id=user.id if user else None, date_range=fld_date_range
                )
                rows = [d for _i, d in pairs if isinstance(d, dict)]
            else:
                rows = []
            if column_filter:
                rows = [r for r in rows if _row_matches_specific_column_filter(r, column_filter)]
            if normal_filters:
                all_keys = set().union(*(r.keys() for r in rows if isinstance(r, dict))) if rows else set()
                for sf in (getattr(fld, "sub_fields", None) or []):
                    if getattr(sf, "key", None):
                        all_keys.add(sf.key)
                rows = [r for r in rows if _row_matches_normal_filters(r, normal_filters, known_sub_field_keys=all_keys)]

            has_subfield_formula = any(
                isinstance(sf.config, dict) and sf.config.get("formula_expression")
                for sf in (getattr(fld, "sub_fields", None) or [])
            )
            if has_subfield_formula:
                rows = await recalculate_multi_line_rows_formulas(
                    db,
                    org_id,
                    year,
                    fld,
                    rows,
                    column_filter=column_filter,
                    normal_filters=normal_filters,
                    period_key=period_key,
                )
            multi_line_items_data[fld.key] = rows
            if hasattr(db, "info"):
                db.info[mli_cache_key] = rows

    from app.entries.service import (
        _load_other_kpi_values,
        _load_other_kpi_multi_line_data,
        extract_cross_kpi_mli_references,
        _topological_sort_subfields,
    )
    other_kpi_cache_key = f"_other_kpi_vals_{org_id}_{year}_{period_key}"
    if hasattr(db, "info") and other_kpi_cache_key in db.info:
        other_kpi_values = db.info[other_kpi_cache_key]
    else:
        other_kpi_values = await _load_other_kpi_values(
            db, year, org_id, kpi_id, period_key=period_key, is_draft=False
        )
        if hasattr(db, "info"):
            db.info[other_kpi_cache_key] = other_kpi_values

    refs = set()
    if formula_expr:
        refs.update(extract_cross_kpi_mli_references(formula_expr))

    for fld in all_fields:
        if fld.field_type == FieldType.multi_line_items and fld.key in multi_line_items_data:
            for sf in (getattr(fld, "sub_fields", None) or []):
                cfg = sf.config if isinstance(sf.config, dict) else {}
                expr = cfg.get("formula_expression")
                if expr:
                    refs.update(extract_cross_kpi_mli_references(expr))

    other_kpi_mli_data = {}
    if refs:
        raw_other_kpi_mli = await _load_other_kpi_multi_line_data(
            db, year, org_id, refs, period_key=period_key, is_draft=False
        )
        for (ref_kpi_id, ref_field_key), r_rows in raw_other_kpi_mli.items():
            filtered_r_rows = r_rows
            if column_filter:
                filtered_r_rows = [r for r in filtered_r_rows if _row_matches_specific_column_filter(r, column_filter)]
            if normal_filters:
                filtered_r_rows = [r for r in filtered_r_rows if _row_matches_normal_filters(r, normal_filters)]
            other_kpi_mli_data[(ref_kpi_id, ref_field_key)] = filtered_r_rows

    from app.formula_engine.evaluator import evaluate_formula

    raw = evaluate_formula(
        formula_expr or "",
        value_by_key,
        multi_line_items_data,
        other_kpi_values,
        other_kpi_multi_line_data=other_kpi_mli_data,
    )
    return raw


async def _dashboard_card_payload(
    db: AsyncSession, org_id: int, merged: dict[str, Any], user: User | None = None, date_range: tuple[datetime.date, datetime.date, str] | None = None
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
    col_filter = merged.get("column_filter")
    norm_filters = merged.get("normal_filters")
    if sm == "field":
        fk = (merged.get("field_key") or "").strip()
        f_res = await db.execute(
            select(KPIField).where(
                KPIField.kpi_id == kpi_id,
                KPIField.key == fk,
            )
        )
        f = f_res.scalar_one_or_none()
        raw = await evaluate_kpi_scalar_formula_field(
            db, org_id, kpi_id, year, period_key, f, eid,
            date_range=date_range,
            column_filter=col_filter,
            normal_filters=norm_filters,
            user=user,
        )
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

    if sm == "multi_line_agg":
        fields = await list_kpi_field_definitions(db, kpi_id, org_id)
        fmap = build_kpi_field_maps(fields)
        mls = (merged.get("source_field_key") or "").strip()
        f_obj = next((f for f in fields if f.key == mls and f.field_type == FieldType.multi_line_items), None)
        
        card_eid = eid
        card_erev = e_rev
        if date_range:
            entries_res = await db.execute(
                select(KPIEntry.id)
                .where(KPIEntry.kpi_id == kpi_id, KPIEntry.organization_id == org_id, KPIEntry.is_draft == False)
            )
            card_eid = [r[0] for r in entries_res.all()]
            card_erev = None
            
        if not f_obj or not card_eid:
            meta_eid = card_eid[0] if isinstance(card_eid, list) and card_eid else (None if isinstance(card_eid, list) else card_eid)
            return (
                {
                    "kpi_id": kpi_id,
                    "year": year,
                    "period_key": _period_key_norm(period_key),
                    "entry_id": meta_eid,
                    "row_count": 0,
                },
                {"source_mode": "multi_line_agg", "numeric": None, "raw_rows": []},
                card_erev,
            )
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

        val_key = (merged.get("value_sub_field_key") or "").strip()
        vid = sub_id_by_key.get(val_key) if val_key else None
        agg = (merged.get("agg") or "sum").strip().lower()

        raw_filters = _combine_with_runtime_filters(
            merged.get("filters"),
            column_filter=col_filter,
            normal_filters=norm_filters,
            kpi_id=kpi_id,
            source_field_key=mls,
            sub_id_by_key=sub_id_by_key,
        )

        from app.entries.service import extract_cross_kpi_mli_references
        has_cross_kpi_formula_subfields = any(
            isinstance(sf.config, dict) and sf.config.get("formula_expression") and
            bool(extract_cross_kpi_mli_references(sf.config.get("formula_expression")))
            for sf in (getattr(f_full, "sub_fields", None) or [])
        )
        has_runtime_filter = bool(col_filter or norm_filters)
        needs_dynamic_recalc = has_cross_kpi_formula_subfields and has_runtime_filter

        use_sql = (
            not needs_dynamic_recalc
            and isinstance(card_eid, int)
            and not date_range
            and (agg in ("count", "count_rows") or (val_key and vid is not None))
        )

        if use_sql:
            compiled = compile_multiline_row_filters_sql(
                raw_filters,
                sub_id_by_key=sub_id_by_key,
                reference_field_types=reference_field_types,
            )
            if compiled is not None:
                filter_where_sql, filter_params, filter_sid_params = compiled
                if not (filter_where_sql or "").strip():
                    filter_where_sql, filter_params = (None, None)
                    filter_sid_params = []
                try:
                    num_val = await fetch_multiline_single_value_agg(
                        db,
                        entry_id=int(card_eid),
                        multiline_field_id=int(f_obj.id),
                        value_sub_field_id=vid,
                        agg=agg,
                        filter_where_sql=filter_where_sql,
                        filter_params=filter_params,
                        filter_sid_params=filter_sid_params,
                    )
                    meta_eid = card_eid
                    return (
                        {
                            "kpi_id": kpi_id,
                            "year": year,
                            "period_key": _period_key_norm(period_key),
                            "entry_id": meta_eid,
                            "row_count": 0,
                        },
                        {"source_mode": "multi_line_agg", "numeric": num_val, "raw_rows": [], "field_map": fmap},
                        card_erev,
                    )
                except Exception:
                    pass

        rows, _n = await load_multi_line_row_dicts_filtered(
            db,
            org_id,
            entry_id=card_eid,
            field=f_full,
            kpi_id=kpi_id,
            year=year,
            raw_filters=merged.get("filters"),
            current_user_id=user.id if user else None,
            date_range=date_range,
            column_filter=col_filter,
            normal_filters=norm_filters,
        )
        n = aggregate_single_value(rows, agg=agg, value_key=val_key or None)
        meta_eid = card_eid[0] if isinstance(card_eid, list) and card_eid else (None if isinstance(card_eid, list) else card_eid)
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": meta_eid,
                "row_count": len(rows),
            },
            {"source_mode": "multi_line_agg", "numeric": n, "raw_rows": [], "field_map": fmap},
            card_erev,
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
    mod_overrides = dict(overrides) if overrides else {}
    by_default_bypass = False
    if mod_overrides.get("year") in ("by_default", "By Default"):
        by_default_bypass = True
        mod_overrides.pop("year", None)
    if mod_overrides.get("by_default") is True:
        by_default_bypass = True
        mod_overrides.pop("by_default", None)
    _clean_by_default_overrides(mod_overrides, by_default_bypass)

    date_ctx = None
    if not by_default_bypass:
        date_ctx = await resolve_date_context_for_dashboard(
            db,
            org_id,
            dashboard_id,
            (overrides or {}).get("year") or widget.get("year"),
            period_type=(overrides or {}).get("period_type") or (widget.get("period_type") if isinstance(widget, dict) else None),
        )

    if date_ctx and not by_default_bypass:
        _start_date, _end_date, start_year, _config = date_ctx
        mod_overrides["year"] = start_year

    merged = _merge_overrides(widget, mod_overrides)
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

    date_range = None
    if date_ctx and not by_default_bypass and (merged.get("source_mode") == "multi_line_agg" or merged.get("source_mode") == "field"):
        start_date, end_date, start_year, config = date_ctx
        source_key = (merged.get("source_field_key") or merged.get("field_key") or "").strip()
        f_def = None
        if kpi_id and source_key:
            fs = await list_kpi_field_definitions(db, kpi_id, org_id)
            f_def = next((f for f in fs if f.key == source_key), None)
        date_col_key = get_widget_date_col_key(config, kpi_id, source_key, f_def)
        if date_col_key:
            date_range = (start_date, end_date, str(date_col_key))
        elif f_def and f_def.field_type == FieldType.formula:
            date_range = (start_date, end_date, "")
        merged["date_fetching_config"] = config

    meta, data, e_rev = await _dashboard_card_payload(db, org_id, merged, user=user, date_range=date_range)
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
    *,
    _dashboard: Any = None,
    _org: Any = None,
    _user_filters: dict[str, list[str]] | None = None,
    _col_fetching_config: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Batch resolver for dashboard KPI cards.

    Supports:
    - source_mode=static (no DB)
    - source_mode=field (scalar/formula stored in kpi_field_values)

    When called from resolve_dashboard_universal_batch, pass _dashboard, _org, _user_filters
    and _col_fetching_config to skip redundant DB queries.
    """
    trace(f"resolve_dashboard_card_widget_data_batch: items={items}")
    out: dict[str, dict[str, Any]] = {}
    parsed: list[tuple[str, dict[str, Any], tuple[datetime.date, datetime.date, str] | None]] = []
    # Use pre-fetched dashboard object when available to avoid a duplicate DB query
    dashboard = _dashboard if _dashboard is not None else (
        await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))
    ).scalar_one_or_none()
    is_date_fetching = False
    org = _org  # may be None if dashboard doesn't use date-fetching
    config = {}
    if dashboard and getattr(dashboard, "fetch_data_with_date", False):
        is_date_fetching = True
        if org is None:
            org = await _get_org(db, org_id)
        config = getattr(dashboard, "date_fetching_config", None) or {}

    is_column_fetching = False
    col_fetching_config: dict[str, Any] = {}
    if _col_fetching_config is not None:
        # Pre-fetched by caller — use directly
        col_fetching_config = _col_fetching_config
        is_column_fetching = bool(col_fetching_config)
    elif dashboard and getattr(dashboard, "fetch_data_with_column", False):
        is_column_fetching = True
        col_fetching_config = getattr(dashboard, "column_fetching_config", None) or {}

    # Use pre-fetched user filters when provided, otherwise fetch now
    if _user_filters is not None:
        user_filters: dict[str, list[str]] = _user_filters
    else:
        user_filters = {}
        if dashboard_id and user:
            try:
                user_filters, _ = await _get_dashboard_user_filter_and_permissions(db, user, int(dashboard_id))
            except Exception:
                pass

    fields_cache: dict[int, list[KPIField]] = {}
    async def _fields_for(kpi_id: int) -> list[KPIField]:
        if kpi_id not in fields_cache:
            fields_cache[kpi_id] = await list_kpi_field_definitions(db, kpi_id, org_id)
        return fields_cache[kpi_id]


    for idx, it in enumerate(items or []):
        if not isinstance(it, dict):
            continue
        w = it.get("widget")
        if not isinstance(w, dict):
            continue
        overrides = it.get("overrides") if isinstance(it.get("overrides"), dict) else None
        
        mod_overrides = dict(overrides) if overrides else {}
        date_range = None
        
        # Pop "by_default" override so it doesn't contaminate the merged widget year
        by_default_bypass = False
        if mod_overrides.get("year") in ("by_default", "By Default"):
            by_default_bypass = True
            mod_overrides.pop("year", None)
        if mod_overrides.get("by_default") is True:
            by_default_bypass = True
            mod_overrides.pop("by_default", None)
        _clean_by_default_overrides(mod_overrides, by_default_bypass)

        if is_date_fetching and org and not by_default_bypass:
            selected_period = (overrides or {}).get("year") or w.get("year")
            period_type = (overrides or {}).get("period_type") or (w.get("period_type") if isinstance(w, dict) else None)
            if selected_period and selected_period != "by_default" and selected_period != "By Default":
                try:
                    start_date, end_date, start_year = resolve_date_range_for_period(org, str(selected_period), period_type=period_type)
                    mod_overrides["year"] = start_year
                    kpi_id = int(w.get("kpi_id") or 0)
                    source_key = (w.get("source_field_key") or w.get("field_key") or "").strip()
                    
                    f_def = None
                    if kpi_id and source_key:
                        fs = await _fields_for(kpi_id)
                        f_def = next((f for f in fs if f.key == source_key), None)
                    date_col_key = get_widget_date_col_key(config, kpi_id, source_key, f_def)
                    
                    if date_col_key:
                        date_range = (start_date, end_date, str(date_col_key))
                    elif f_def and f_def.field_type == FieldType.formula:
                        date_range = (start_date, end_date, "")
                except Exception:
                    pass

        column_filter = mod_overrides.get("column_filter")
        if not column_filter and is_column_fetching and col_fetching_config:
            sel_col_val = mod_overrides.get("selected_column_value")
            if sel_col_val is not None and str(sel_col_val).strip() != "":
                column_filter = {
                    "kpi_id": col_fetching_config.get("kpi_id"),
                    "source_field_key": col_fetching_config.get("source_field_key"),
                    "column_key": col_fetching_config.get("column_key"),
                    "value": str(sel_col_val).strip(),
                }
                mod_overrides["column_filter"] = column_filter

        normal_filters = dict(mod_overrides.get("normal_filters") or mod_overrides.get("dashboard_filters") or {})
        if user_filters:
            for fk, fvals in user_filters.items():
                if fk not in normal_filters:
                    normal_filters[fk] = fvals
        if normal_filters:
            mod_overrides["normal_filters"] = normal_filters

        merged = _merge_overrides(w, mod_overrides)
        merged["date_fetching_config"] = config
        wid = merged.get("id")
        key = str(wid) if wid is not None else f"idx:{idx}"
        parsed.append((key, merged, date_range))

    # dashboard auth once per KPI
    kpi_ids = sorted({int(w.get("kpi_id") or 0) for _k, w, _dr in parsed if int(w.get("kpi_id") or 0) > 0})
    allowed_kpi: dict[int, bool] = {}
    for kpi_id in kpi_ids:
        allowed_kpi[kpi_id] = await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id)

    # group field cards by period
    groups: dict[tuple[int, int, str | None], list[tuple[str, dict[str, Any]]]] = {}
    for key, w, date_range in parsed:
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
        if sm == "multi_line_agg":
            try:
                meta, data, e_rev = await _dashboard_card_payload(db, org_id, w, user=user, date_range=date_range)
                out[key] = {
                    "ok": True,
                    "widget_type": "kpi_card_single_value",
                    "meta": meta,
                    "data": data,
                    "entry_revision": e_rev,
                }
            except Exception as e:
                out[key] = {"ok": False, "error": str(e)}
            continue
        if sm == "field":
            fk = str(w.get("field_key") or "").strip()
            fs = await _fields_for(kpi_id)
            fld = next((f for f in fs if f.key == fk), None)
            if fld and fld.field_type == FieldType.formula and date_range:
                try:
                    meta, data, e_rev = await _dashboard_card_payload(db, org_id, w, user=user, date_range=date_range)
                    out[key] = {
                        "ok": True,
                        "widget_type": "kpi_card_single_value",
                        "meta": meta,
                        "data": data,
                        "entry_revision": e_rev,
                    }
                except Exception as e:
                    out[key] = {"ok": False, "error": str(e)}
                continue

        if sm != "field":
            out[key] = {"ok": False, "error": f"unsupported source_mode: {sm}"}
            continue
        pk = _period_key_norm(w.get("period_key"))
        groups.setdefault((kpi_id, year, pk), []).append((key, w))

    for (kpi_id, year, pk), items2 in groups.items():
        eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=pk)
        e_rev = revision_for_parts(eid, e_ts)
        fields = await list_kpi_field_definitions(db, kpi_id, org_id)
        field_by_key = {fld.key: fld for fld in fields}
        key_to_fid: dict[str, int] = {}
        for key, w in items2:
            fk = str(w.get("field_key") or "").strip()
            fid = await _field_id_for_kpi_key(db, org_id=org_id, kpi_id=kpi_id, field_key=fk)
            if fid:
                key_to_fid[key] = int(fid)
        fids = sorted(set(key_to_fid.values()))
        fvm = await get_field_values_for_field_ids(db, entry_id=int(eid), field_ids=fids, current_user_id=user.id if user else None) if (eid and fids) else {}
        for key, w in items2:
            fk = str(w.get("field_key") or "").strip()
            fid = key_to_fid.get(key)
            f_obj = field_by_key.get(fk)
            c_flt = w.get("column_filter")
            n_flt = w.get("normal_filters")
            is_formula = f_obj and (
                f_obj.field_type == FieldType.formula or
                (isinstance(f_obj.config, dict) and (f_obj.config.get("is_formula") or f_obj.config.get("formula_expression")))
            )
            if is_formula and (c_flt or n_flt):
                raw = await evaluate_kpi_scalar_formula_field(
                    db, org_id, kpi_id, year, pk, f_obj, eid,
                    column_filter=c_flt,
                    normal_filters=n_flt,
                    user=user,
                )
            else:
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
    date_ctx = await resolve_date_context_for_dashboard(
        db,
        org_id,
        dashboard_id,
        (overrides or {}).get("year") or widget.get("year"),
        period_type=(overrides or {}).get("period_type") or (widget.get("period_type") if isinstance(widget, dict) else None),
    )
    mod_overrides = dict(overrides) if overrides else {}
    if date_ctx:
        _start_date, _end_date, start_year, _config = date_ctx
        mod_overrides["year"] = start_year

    merged = _merge_overrides(widget, mod_overrides)
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

    date_range = None
    if date_ctx:
        start_date, end_date, start_year, config = date_ctx
        source_key = (merged.get("source_field_key") or "").strip()
        f_def = None
        if kpi_id and source_key:
            fs = await list_kpi_field_definitions(db, kpi_id, org_id)
            f_def = next((f for f in fs if f.key == source_key), None)
        date_col_key = get_widget_date_col_key(config, kpi_id, source_key, f_def)
        if date_col_key:
            date_range = (start_date, end_date, str(date_col_key))

    meta, data, e_rev = await _dashboard_multi_line_table_payload(
        db, org_id, merged, user=user, dashboard_id=dashboard_id, date_range=date_range
    )
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
    db: AsyncSession,
    org_id: int,
    w: dict[str, Any],
    user: User | None = None,
    dashboard_id: int | None = None,
    date_range: tuple[datetime.date, datetime.date, str] | None = None,
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

    tbl_eid = eid
    tbl_erev = e_rev
    if date_range:
        entries_res = await db.execute(
            select(KPIEntry.id)
            .where(KPIEntry.kpi_id == kpi_id, KPIEntry.organization_id == org_id, KPIEntry.is_draft == False)
        )
        tbl_eid = [r[0] for r in entries_res.all()]
        tbl_erev = None
    else:
        tbl_eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
        tbl_erev = revision_for_parts(tbl_eid, e_ts)

    label_by_key: dict[str, str] = {}
    if f_obj and f_obj.sub_fields:
        for sf in f_obj.sub_fields:
            label_by_key[str(sf.key)] = str(sf.name or sf.key)

    if not f_obj or not tbl_eid:
        meta_eid = tbl_eid[0] if isinstance(tbl_eid, list) and tbl_eid else (None if isinstance(tbl_eid, list) else tbl_eid)
        return (
            {
                "kpi_id": kpi_id,
                "year": year,
                "period_key": _period_key_norm(period_key),
                "entry_id": meta_eid,
                "row_count": 0,
            },
            {
                "rows": [],
                "sub_field_labels": label_by_key,
                "joins": [],
                "source_field_id": f_obj.id if f_obj else (f_light.id if f_light else None),
            },
            tbl_erev,
        )

    col_filter = w.get("column_filter")
    norm_filters = w.get("normal_filters")
    rows, _n = await load_multi_line_row_dicts_filtered(
        db,
        org_id,
        entry_id=tbl_eid,
        field=f_obj,
        kpi_id=kpi_id,
        year=year,
        raw_filters=w.get("filters"),
        current_user_id=user.id if user else None,
        date_range=date_range,
        column_filter=col_filter,
        normal_filters=norm_filters,
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
        
        # Resolve date range for joined tables first so we know if date-based is active
        j_date_range = None
        if date_range and dashboard_id:
            dashboard = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
            if dashboard and getattr(dashboard, "fetch_data_with_date", False):
                config = getattr(dashboard, "date_fetching_config", None) or {}
                mli_date_cols = config.get("mli_date_cols") or {}
                j_date_col_key = mli_date_cols.get(f"{jkpi}_{jsrc}") or mli_date_cols.get(f"{jkpi}_{jf_obj.id if jf_obj else ''}")
                if j_date_col_key:
                    start_date, end_date, _col = date_range
                    j_date_range = (start_date, end_date, str(j_date_col_key))

        if j_date_range:
            j_entries_res = await db.execute(
                select(KPIEntry.id)
                .where(KPIEntry.kpi_id == jkpi, KPIEntry.organization_id == org_id, KPIEntry.is_draft == False)
            )
            tbl_jeid = [r[0] for r in j_entries_res.all()]
        else:
            tbl_jeid, _je_ts = await get_entry_id_updated(
                db, org_id=org_id, kpi_id=jkpi, year=year, period_key=period_key
            )

        j_labels: dict[str, str] = {}
        if jf_obj and jf_obj.sub_fields:
            for sf in jf_obj.sub_fields:
                j_labels[str(sf.key)] = str(sf.name or sf.key)
        if not jf_obj or not tbl_jeid:
            joins_pack.append(
                {
                    "rows": [],
                    "sub_field_labels": j_labels,
                    "source_field_id": jf_obj.id if jf_obj else (jf_light.id if jf_light else None),
                }
            )
            continue

        jrows, _jn = await load_multi_line_row_dicts_filtered(
            db,
            org_id,
            entry_id=tbl_jeid,
            field=jf_obj,
            kpi_id=jkpi,
            year=year,
            raw_filters=j.get("filters"),
            current_user_id=user.id if user else None,
            date_range=j_date_range,
            column_filter=col_filter,
            normal_filters=norm_filters,
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

    meta_eid = tbl_eid[0] if isinstance(tbl_eid, list) and tbl_eid else (None if isinstance(tbl_eid, list) else tbl_eid)
    return (
        {
            "kpi_id": kpi_id,
            "year": year,
            "period_key": _period_key_norm(period_key),
            "entry_id": meta_eid,
            "row_count": len(rows),
            "truncated": truncated,
        },
        {
            "rows": rows,
            "sub_field_labels": label_by_key,
            "joins": joins_pack,
            "source_field_id": int(f_obj.id),
        },
        tbl_erev,
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
    date_ctx = await resolve_date_context_for_dashboard(
        db,
        org_id,
        dashboard_id,
        (overrides or {}).get("year") or widget.get("year"),
        period_type=(overrides or {}).get("period_type") or (widget.get("period_type") if isinstance(widget, dict) else None),
    )
    mod_overrides = dict(overrides) if overrides else {}
    if date_ctx:
        _start_date, _end_date, start_year, _config = date_ctx
        mod_overrides["year"] = start_year

    merged = _merge_overrides(widget, mod_overrides)
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

    date_range = None
    if date_ctx:
        start_date, end_date, start_year, config = date_ctx
        date_col_key = get_widget_date_col_key(config, kpi_id, mls, f_obj)
        if date_col_key:
            date_range = (start_date, end_date, str(date_col_key))

    eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
    if not eid:
        kpi_res_c = await db.execute(select(KPI).where(KPI.id == kpi_id))
        kpi_c = kpi_res_c.scalar_one_or_none()
        if kpi_c and getattr(kpi_c, "is_joined", False):
            try:
                from app.entries.joined_sync import sync_joined_kpi_physical_data
                await sync_joined_kpi_physical_data(db, kpi_c, year=year, period_key=period_key, current_user_id=user.id if user else None)
                await db.commit()
                eid, e_ts = await get_entry_id_updated(db, org_id=org_id, kpi_id=kpi_id, year=year, period_key=period_key)
            except Exception as ex:
                logger.error("Failed to sync joined KPI in table resolver: %s", ex)
    e_rev = revision_for_parts(eid, e_ts)

    label_by_key: dict[str, str] = {}
    if f_obj and f_obj.sub_fields:
        for sf in f_obj.sub_fields:
            label_by_key[str(sf.key)] = str(sf.name or sf.key)

    if not f_obj or not eid:
        meta0 = {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": eid, "row_count": 0}
        data0 = {"rows": [], "total": 0, "page": page, "page_size": page_size, "sub_field_labels": label_by_key, "joins": [], "source_field_id": f_obj.id if f_obj else (f_light.id if f_light else None)}
        return (meta0, data0, "kpi_multi_line_table", e_rev)

    # Check if this is a Joined KPI
    from app.core.models import KPI
    kpi_res = await db.execute(select(KPI).where(KPI.id == f_obj.kpi_id))
    kpi = kpi_res.scalar_one_or_none()
        
    if kpi and getattr(kpi, "is_joined", False):
        from app.entries.load_joined import load_joined_multi_line_rows
        combined_rows = await load_joined_multi_line_rows(
            db,
            joined_field=f_obj,
            organization_id=org_id,
            year=year,
            period_key=period_key,
            current_user_id=user.id
        )
        
        if date_range:
            start_date, end_date, date_col_key = date_range
            import datetime as dt
            def _parse_cell_date(v):
                if isinstance(v, dt.date):
                    return v
                if isinstance(v, str):
                    try:
                        return dt.date.fromisoformat(v[:10])
                    except Exception:
                        pass
                return None
                
            filtered_rows = []
            for row in combined_rows:
                rv = row.get(date_col_key)
                rd = _parse_cell_date(rv)
                if rd and start_date <= rd < end_date:
                    filtered_rows.append(row)
            combined_rows = filtered_rows
            
        # Apply search and filters in-memory
        rows = [{"__index": idx, **r} for idx, r in enumerate(combined_rows)]
        raw_filters = merged.get("filters")
        
        if search and search.strip():
            q = search.strip().lower()
            rows = [r for r in rows if any(q in str(v).lower() for v in r.values() if v is not None)]
            
        if raw_filters:
            from app.entries.routes import row_passes_filters
            reference_field_types = {str(getattr(sf, "key", "")): str(getattr(getattr(sf, "field_type", None), "value", getattr(sf, "field_type", "")) or "") for sf in (f_obj.sub_fields or []) if getattr(sf, "key", None)}
            rows = [r for r in rows if row_passes_filters(r, raw_filters, reference_field_types=reference_field_types)]
            
        allowed_keys = [str(x) for x in (merged.get("sub_field_keys") or []) if str(x).strip()]
        sf_by_key = {str(getattr(sf, "key", "")): sf for sf in (f_obj.sub_fields or []) if getattr(sf, "key", None)}
        if not allowed_keys:
            allowed_keys = [k for k in sf_by_key.keys() if k]
            
        if sort_by and sort_by in sf_by_key:
            reverse = sort_dir == "desc"
            def sort_key(row: dict):
                v = row.get(sort_by)
                try:
                    return float(v)
                except (TypeError, ValueError):
                    return str(v) if v is not None else ""
            try:
                rows = sorted(rows, key=sort_key, reverse=reverse)
            except Exception:
                pass
                
        total = len(rows)
        start = (int(page) - 1) * int(page_size)
        paged_rows = rows[start:start+int(page_size)]
        
        # Keep only visible columns in the output
        allowed_keys_set = set(allowed_keys)
        paged_rows = [{"__index": r["__index"], **{k: v for k, v in r.items() if k in allowed_keys_set}} for r in paged_rows]
        
        meta0 = {"kpi_id": kpi_id, "year": year, "period_key": _period_key_norm(period_key), "entry_id": eid, "row_count": len(paged_rows), "total": total, "source_field_id": int(f_obj.id)}
        data0 = {"rows": paged_rows, "total": total, "page": page, "page_size": page_size, "sub_field_labels": label_by_key, "joins": [], "source_field_id": int(f_obj.id)}
        return (meta0, data0, "kpi_multi_line_table", e_rev)

    allowed_keys: list[str] = [str(x) for x in (merged.get("sub_field_keys") or []) if str(x).strip()]
    sf_by_key: dict[str, KPIFieldSubField] = {str(getattr(sf, "key", "")): sf for sf in (f_obj.sub_fields or []) if getattr(sf, "key", None)}
    if not allowed_keys:
        allowed_keys = [k for k in sf_by_key.keys() if k]
    visible_sf_ids = [int(getattr(sf_by_key[k], "id")) for k in allowed_keys if k in sf_by_key]

    r = KpiMultiLineRow.__table__.alias("r")
    stmt = select(r.c.id, r.c.row_index).where(r.c.entry_id == int(eid), r.c.field_id == int(f_obj.id))

    if date_range:
        start_date, end_date, date_col_key = date_range
        date_sf = sf_by_key.get(date_col_key)
        if date_sf:
            date_sf_id = int(getattr(date_sf, "id"))
            dc = KpiMultiLineCell.__table__.alias("dc")
            stmt = stmt.join(dc, and_(dc.c.row_id == r.c.id, dc.c.sub_field_id == date_sf_id))
            from sqlalchemy import func
            stmt = stmt.where(
                or_(
                    and_(
                        dc.c.value_date.isnot(None),
                        dc.c.value_date >= start_date,
                        dc.c.value_date < end_date,
                    ),
                    and_(
                        dc.c.value_text.isnot(None),
                        dc.c.value_text != "",
                        ~dc.c.value_text.in_(["false", "null", "none", "False", "Null", "None"]),
                        dc.c.value_text >= start_date.isoformat(),
                        dc.c.value_text < end_date.isoformat(),
                    )
                )
            )

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
        needed_strs = set(needed)
        needed_nums = set()
        for x in needed:
            try:
                fval = float(x)
                needed_nums.add(fval)
                if fval.is_integer():
                    needed_strs.add(str(int(fval)))
                    needed_strs.add(f"{int(fval)}.0")
            except (ValueError, TypeError):
                pass

        key_expr = func.coalesce(
            func.nullif(func.trim(jc.c.value_text), ''),
            func.trim(func.to_char(jc.c.value_number, 'FM9999999999990'))
        )

        conds = [key_expr.in_(list(needed_strs))]
        if needed_nums:
            conds.append(jc.c.value_number.in_(list(needed_nums)))
        if needed_strs:
            conds.append(jc.c.value_text.in_(list(needed_strs)))

        jbase = (
            select(func.min(jr.c.id).label("id"), func.min(jr.c.row_index).label("row_index"))
            .select_from(jr)
            .join(jc, and_(jc.c.row_id == jr.c.id, jc.c.sub_field_id == right_sf_id))
            .where(jr.c.entry_id == int(jeid), jr.c.field_id == int(jf_obj.id), or_(*conds))
            .group_by(key_expr)
        )
        jrows = list((await db.execute(jbase)).all())
        jrow_ids = [int(x[0]) for x in jrows]
        jlabels = {str(getattr(sf, "key", "")): str(getattr(sf, "name", "") or getattr(sf, "key", "")) for sf in (jf_obj.sub_fields or []) if getattr(sf, "key", None)}
        if not jrow_ids:
            joins_pack.append({"rows": [], "sub_field_labels": jlabels, "source_field_id": int(jf_obj.id)})
            continue
        want_keys = [str(x) for x in (j.get("sub_field_keys") or []) if str(x).strip()]
        if want_keys:
            if right_key and right_key not in want_keys:
                want_keys.append(right_key)
        else:
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

        def _clean_key(v: Any) -> str:
            s = str(v or "").strip()
            if s.endswith(".0"):
                return s[:-2]
            return s

        # Normalize right_key in rows to ensure matching against integer / float strings
        for row_dict in jrow_data.values():
            raw_k = row_dict.get(right_key)
            if raw_k is not None:
                c_k = _clean_key(raw_k)
                if c_k:
                    row_dict[right_key] = c_k

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
            KPIEntry.is_draft == False,
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
    dashboard = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
    is_date_fetching = False
    org = None
    if dashboard and getattr(dashboard, "fetch_data_with_date", False):
        selected_period = (overrides or {}).get("year")
        by_default_mode = selected_period in ("by_default", "By Default") or (overrides or {}).get("by_default") is True
        if not by_default_mode:
            is_date_fetching = True
            org = await _get_org(db, org_id)

    def _map_period_to_year(val: Any) -> Any:
        if not is_date_fetching or not org or not val:
            return val
        try:
            _start_date, _end_date, start_year = resolve_date_range_for_period(org, str(val))
            return start_year
        except Exception:
            return val

    mod_overrides = dict(overrides) if overrides else {}
    by_default_bypass = False
    if mod_overrides.get("year") in ("by_default", "By Default"):
        by_default_bypass = True
        mod_overrides.pop("year", None)
    if mod_overrides.get("by_default") is True:
        by_default_bypass = True
        mod_overrides.pop("by_default", None)
    _clean_by_default_overrides(mod_overrides, by_default_bypass)

    if is_date_fetching and org:
        if "start_year" in mod_overrides:
            mod_overrides["start_year"] = _map_period_to_year(mod_overrides["start_year"])
        elif "start_year" in widget:
            mod_overrides["start_year"] = _map_period_to_year(widget["start_year"])
            
        if "end_year" in mod_overrides:
            mod_overrides["end_year"] = _map_period_to_year(mod_overrides["end_year"])
        elif "end_year" in widget:
            mod_overrides["end_year"] = _map_period_to_year(widget["end_year"])

    merged = _merge_overrides(widget, mod_overrides)
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
    date_ctx = await resolve_date_context_for_dashboard(
        db,
        org_id,
        dashboard_id,
        (overrides or {}).get("year") or widget.get("year"),
        period_type=(overrides or {}).get("period_type") or (widget.get("period_type") if isinstance(widget, dict) else None),
    )
    mod_overrides = dict(overrides) if overrides else {}
    if date_ctx:
        _start_date, _end_date, start_year, _config = date_ctx
        mod_overrides["year"] = start_year

    merged = _merge_overrides(widget, mod_overrides)
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
        fvm = await get_field_values_for_field_ids(db, entry_id=int(eid), field_ids=[int(fid)], current_user_id=user.id)
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
    dashboard = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
    is_date_fetching = False
    org = None
    if dashboard and getattr(dashboard, "fetch_data_with_date", False):
        selected_period = (overrides or {}).get("year")
        by_default_mode = selected_period in ("by_default", "By Default") or (overrides or {}).get("by_default") is True
        if not by_default_mode:
            is_date_fetching = True
            org = await _get_org(db, org_id)

    def _map_period_to_year(val: Any) -> Any:
        if not is_date_fetching or not org or not val:
            return val
        try:
            _start_date, _end_date, start_year = resolve_date_range_for_period(org, str(val))
            return start_year
        except Exception:
            return val

    mod_overrides = dict(overrides) if overrides else {}
    by_default_bypass = False
    if mod_overrides.get("year") in ("by_default", "By Default"):
        by_default_bypass = True
        mod_overrides.pop("year", None)
    if mod_overrides.get("by_default") is True:
        by_default_bypass = True
        mod_overrides.pop("by_default", None)
    _clean_by_default_overrides(mod_overrides, by_default_bypass)

    if is_date_fetching and org:
        if "start_year" in mod_overrides:
            mod_overrides["start_year"] = _map_period_to_year(mod_overrides["start_year"])
        elif "start_year" in widget:
            mod_overrides["start_year"] = _map_period_to_year(widget["start_year"])
            
        if "end_year" in mod_overrides:
            mod_overrides["end_year"] = _map_period_to_year(mod_overrides["end_year"])
        elif "end_year" in widget:
            mod_overrides["end_year"] = _map_period_to_year(widget["end_year"])
            
        if "selected_years" in mod_overrides:
            mod_overrides["selected_years"] = [_map_period_to_year(y) for y in mod_overrides["selected_years"]]
        elif "selected_years" in widget:
            mod_overrides["selected_years"] = [_map_period_to_year(y) for y in widget["selected_years"]]

    merged = _merge_overrides(widget, mod_overrides)
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
                KPIEntry.is_draft == False,
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

        all_trend_fields = await list_kpi_field_definitions(db, kpi_id, org_id)
        field_by_key = {fld.key: fld for fld in all_trend_fields}
        c_flt = merged.get("column_filter")
        n_flt = merged.get("normal_filters")

        field_bars: dict[str, list[dict[str, Any]]] = {}
        for yy in years:
            bars: list[dict[str, Any]] = []
            fvals = by_year_field.get(int(yy), {})
            for k in keys:
                fid = fid_by_key.get(str(k))
                f_obj = field_by_key.get(str(k))
                is_formula = f_obj and (
                    f_obj.field_type == FieldType.formula or
                    (isinstance(f_obj.config, dict) and (f_obj.config.get("is_formula") or f_obj.config.get("formula_expression")))
                )
                if is_formula and (c_flt or n_flt):
                    raw = await evaluate_kpi_scalar_formula_field(
                        db, org_id, kpi_id, int(yy), period_key, f_obj, None,
                        column_filter=c_flt,
                        normal_filters=n_flt,
                        user=user,
                    )
                    v = to_numeric(raw)
                else:
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
    date_ctx = await resolve_date_context_for_dashboard(
        db,
        org_id,
        dashboard_id,
        (overrides or {}).get("year") or widget.get("year"),
        period_type=(overrides or {}).get("period_type") or (widget.get("period_type") if isinstance(widget, dict) else None),
    )
    mod_overrides = dict(overrides) if overrides else {}
    if date_ctx:
        _start_date, _end_date, start_year, _config = date_ctx
        mod_overrides["year"] = start_year

    merged = _merge_overrides(widget, mod_overrides)
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
    fv_by_id = await get_field_values_for_field_ids(db, entry_id=int(eid), field_ids=list(id_by_key.values()), current_user_id=user.id) if eid else {}

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
    d_id = merged.get("dashboard_id") or (overrides or {}).get("dashboard_id")
    if d_id and user:
        try:
            user_filters, _ = await _get_dashboard_user_filter_and_permissions(db, user, int(d_id))
            if user_filters:
                existing_filters = dict(merged.get("normal_filters") or merged.get("dashboard_filters") or {})
                for fk, fvals in user_filters.items():
                    existing_filters[fk] = fvals
                merged["normal_filters"] = existing_filters
        except Exception:
            pass

    wtype = str(merged.get("type") or "")
    resolver = WIDGET_RESOLVERS.get(wtype)
    if not resolver:
        rt = wtype or "unknown"
        return ({"error": f"Unknown widget type: {rt}"}, {"known": list(WIDGET_RESOLVERS.keys())}, rt, None)
    meta, data, e_rev = await resolver(db, user, org_id, merged)
    return meta, data, wtype, e_rev


async def _get_dashboard_user_filter_and_permissions(
    db: AsyncSession, user: User, dashboard_id: int
) -> tuple[dict[str, list[str]], dict[str, bool]]:
    try:
        if not user:
            return {}, {"can_load_lms": True, "can_change_period": True, "can_use_unique_value": True}

        role_str = str(getattr(user.role, "value", user.role) or "").upper()
        if role_str in ("SUPER_ADMIN", "ORG_ADMIN"):
            return {}, {"can_load_lms": True, "can_change_period": True, "can_use_unique_value": True}

        cache_key = ("dashboard_perm_user_filter", int(dashboard_id), int(user.id))
        if cache_key in db.info:
            return db.info[cache_key]

        res = await db.execute(
            select(DashboardAccessPermission).where(
                DashboardAccessPermission.dashboard_id == dashboard_id,
                DashboardAccessPermission.user_id == user.id,
            )
        )
        perm = res.scalar_one_or_none()
        if not perm:
            res_tuple = ({}, {"can_load_lms": True, "can_change_period": True, "can_use_unique_value": False})
            db.info[cache_key] = res_tuple
            return res_tuple

        permissions = {
            "can_load_lms": getattr(perm, "can_load_lms", True),
            "can_change_period": getattr(perm, "can_change_period", True),
            "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
        }

        user_filters: dict[str, list[str]] = {}
        if getattr(perm, "can_use_unique_value", False) and getattr(user, "unique_user_key", None):
            val = str(user.unique_user_key).strip()
            if val:
                cfg = getattr(perm, "filter_column_configs", None)
                if cfg and isinstance(cfg, dict):
                    for _k, sub_k in cfg.items():
                        if sub_k and str(sub_k).strip():
                            user_filters[str(sub_k).strip()] = [val]

                if getattr(perm, "filter_sub_field_key", None):
                    k = str(perm.filter_sub_field_key).strip()
                    if k and k not in user_filters:
                        user_filters[k] = [val]

        res_tuple = (user_filters, permissions)
        db.info[cache_key] = res_tuple
        return res_tuple
    except Exception:
        return {}, {"can_load_lms": True, "can_change_period": True, "can_use_unique_value": False}


async def resolve_dashboard_universal_batch(
    db: AsyncSession,
    user: User,
    org_id: int,
    dashboard_id: int,
    items: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """
    Universal batch resolver for ALL dashboard widget types during period shifts.

    Accepts a list of {widget, overrides} items (any widget type), performs
    dashboard-level auth once per unique KPI, pre-fetches all entries and field
    definitions in bulk, then dispatches each item to its specialized resolver.

    Returns: {"<widget_id|idx:N>": {"ok": bool, "widget_type": str, "meta": {}, "data": {}, "entry_revision": str|None}}
    """
    import logging as _logging
    _log = _logging.getLogger(__name__)

    # ------------------------------------------------------------------
    # 1. Resolve dashboard date-fetching config once
    # ------------------------------------------------------------------
    trace("resolve_dashboard_universal_batch: resolving dashboard date-fetching config")
    dashboard = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
    is_date_fetching = False
    org = None
    d_config: dict[str, Any] = {}
    if dashboard and getattr(dashboard, "fetch_data_with_date", False):
        is_date_fetching = True
        org = await _get_org(db, org_id)
        d_config = getattr(dashboard, "date_fetching_config", None) or {}
    db.info["org"] = org

    is_column_fetching = False
    col_fetching_config: dict[str, Any] = {}
    if dashboard and getattr(dashboard, "fetch_data_with_column", False):
        is_column_fetching = True
        col_fetching_config = getattr(dashboard, "column_fetching_config", None) or {}

    # Check user-specific unique key filter configuration for this dashboard
    user_filters, user_perms = await _get_dashboard_user_filter_and_permissions(db, user, dashboard_id)

    # Check in-memory context-aware widget cache
    u_role = getattr(user, "role", "user") if user else "anon"
    if hasattr(u_role, "value"):
        u_role = u_role.value
    u_dict = getattr(user, "__dict__", {}) if user else {}
    u_key = u_dict.get("unique_user_key") or (getattr(user, "unique_user_key", None) if user else None) or u_dict.get("id") or (getattr(user, "id", "") if user else "")
    user_scope = f"{u_role or 'user'}:{u_key or ''}"
    cache_keys_by_id: dict[str, str] = {}
    uncached_items: list[dict[str, Any]] = []
    results: dict[str, dict[str, Any]] = {}

    for it in items or []:
        if not isinstance(it, dict):
            continue
        w = it.get("widget")
        if not isinstance(w, dict):
            continue
        wid = str(w.get("id") or "")
        ov = it.get("overrides") or {}
        p_type = ov.get("period_type") or w.get("period_type")
        r_time = ov.get("year") or w.get("year")
        norm_flt = ov.get("normal_filters")
        col_flt = ov.get("column_filter") or ov.get("selected_column_value")
        extra_parts = []
        if norm_flt and isinstance(norm_flt, dict):
            extra_parts.append(f"nf:{repr(sorted(norm_flt.items()))}")
        if col_flt:
            extra_parts.append(f"cf:{repr(col_flt)}")
        extra_str = ";".join(extra_parts)
        c_key = _widget_cache.make_key(dashboard_id, user_scope, p_type, r_time, wid, extra=extra_str)
        cache_keys_by_id[wid] = c_key
        cached_val = _widget_cache.get(c_key)
        if cached_val is not None:
            results[wid] = cached_val
        else:
            uncached_items.append(it)

    if not uncached_items:
        return results

    # ------------------------------------------------------------------
    # 2. Parse + normalise all items, build per-item merged widget dicts
    # ------------------------------------------------------------------
    parsed: list[tuple[str, str, dict[str, Any], tuple | None, dict[str, Any], dict[str, Any] | None]] = []
    # (key, widget_type, merged_widget, date_range, original_widget, original_overrides)

    fields_cache: dict[int, list[KPIField]] = {}
    async def _fields_for(kpi_id: int) -> list[KPIField]:
        if kpi_id not in fields_cache:
            fields_cache[kpi_id] = await list_kpi_field_definitions(db, kpi_id, org_id)
        return fields_cache[kpi_id]

    for idx, it in enumerate(uncached_items):
        if not isinstance(it, dict):
            continue
        w = it.get("widget")
        if not isinstance(w, dict):
            continue
        overrides = it.get("overrides") if isinstance(it.get("overrides"), dict) else None
        mod_overrides = dict(overrides) if overrides else {}
        date_range = None

        by_default_bypass = False
        if mod_overrides.get("year") in ("by_default", "By Default"):
            by_default_bypass = True
            mod_overrides.pop("year", None)
        if mod_overrides.get("by_default") is True:
            by_default_bypass = True
            mod_overrides.pop("by_default", None)
        _clean_by_default_overrides(mod_overrides, by_default_bypass)

        if is_date_fetching and org and not by_default_bypass:
            selected_period = (overrides or {}).get("year") or w.get("year")
            period_type = (overrides or {}).get("period_type") or (w.get("period_type") if isinstance(w, dict) else None)
            if selected_period and selected_period not in ("by_default", "By Default"):
                try:
                    start_date, end_date, start_year = resolve_date_range_for_period(org, str(selected_period), period_type=period_type)
                    mod_overrides["year"] = start_year
                    kpi_id_dr = int(w.get("kpi_id") or 0)
                    src_key_dr = (w.get("source_field_key") or w.get("field_key") or "").strip()
                    f_def_dr = None
                    if kpi_id_dr and src_key_dr:
                        fs_dr = await _fields_for(kpi_id_dr)
                        f_def_dr = next((f for f in fs_dr if f.key == src_key_dr), None)
                    date_col = get_widget_date_col_key(d_config, kpi_id_dr, src_key_dr, f_def_dr)
                    if date_col:
                        date_range = (start_date, end_date, str(date_col))
                    elif f_def_dr and getattr(f_def_dr, "field_type", None) == FieldType.formula:
                        date_range = (start_date, end_date, "")
                except Exception:
                    pass

        column_filter = mod_overrides.get("column_filter")
        if not column_filter and is_column_fetching and col_fetching_config:
            sel_col_val = mod_overrides.get("selected_column_value")
            if sel_col_val is not None and str(sel_col_val).strip() != "":
                column_filter = {
                    "kpi_id": col_fetching_config.get("kpi_id"),
                    "source_field_key": col_fetching_config.get("source_field_key"),
                    "column_key": col_fetching_config.get("column_key"),
                    "value": str(sel_col_val).strip(),
                }
                mod_overrides["column_filter"] = column_filter

        # Inject user unique-key filters if configured for this dashboard assignment
        if user_filters:
            existing_filters = dict(mod_overrides.get("normal_filters") or mod_overrides.get("dashboard_filters") or {})
            for fk, fvals in user_filters.items():
                existing_filters[fk] = fvals
            mod_overrides["normal_filters"] = existing_filters
        else:
            normal_filters = mod_overrides.get("normal_filters") or mod_overrides.get("dashboard_filters")
            if normal_filters:
                mod_overrides["normal_filters"] = normal_filters

        merged = _merge_overrides(w, mod_overrides)
        wtype = str(merged.get("type") or "")
        wid = merged.get("id")
        key = str(wid) if wid is not None else f"idx:{idx}"
        # Store mod_overrides (fully processed: column_filter injected, year resolved,
        # normal_filters merged) so sub-batch dispatchers can forward them correctly.
        parsed.append((key, wtype, merged, date_range, w, mod_overrides))

    # ------------------------------------------------------------------
    # 3. Auth — check dashboard access once per unique KPI id
    # ------------------------------------------------------------------
    trace(f"resolve_dashboard_universal_batch: parsed {len(parsed)} items, performing auth checks")
    unique_kpi_ids = sorted({int(m[2].get("kpi_id") or 0) for m in parsed if int(m[2].get("kpi_id") or 0) > 0})
    allowed_kpi: dict[int, bool] = {}
    for kpi_id in unique_kpi_ids:
        allowed_kpi[kpi_id] = await can_view_dashboard_for_kpi_chart(db, user, dashboard_id, org_id, kpi_id)

    # ------------------------------------------------------------------
    # 4. Separate heavy MLI table widgets (handled individually to avoid
    #    hogging the batch response for the lighter widgets).
    # ------------------------------------------------------------------
    HEAVY_TYPES = {"kpi_multi_line_table"}
    light_items: list[tuple[str, str, dict[str, Any], tuple | None, dict[str, Any], dict[str, Any] | None]] = []
    heavy_items: list[tuple[str, str, dict[str, Any], tuple | None, dict[str, Any], dict[str, Any] | None]] = []
    for item in parsed:
        key, wtype, merged, dr, w_orig, ov_orig = item
        if wtype in HEAVY_TYPES:
            heavy_items.append(item)
        else:
            light_items.append(item)

    # ------------------------------------------------------------------
    # 5. Split by existing batch resolvers for optimal code reuse
    # ------------------------------------------------------------------
    # Collect chart items (kpi_bar_chart) and card items (kpi_card_single_value) separately
    chart_items: list[dict[str, Any]] = []
    card_items: list[dict[str, Any]] = []
    other_items: list[tuple[str, str, dict[str, Any], tuple | None]] = []

    for key, wtype, merged, date_range, w_orig, mod_ov in light_items:
        kpi_id = int(merged.get("kpi_id") or 0)
        if kpi_id and not allowed_kpi.get(kpi_id, False):
            results[key] = {"ok": False, "error": "forbidden"}
            continue
        if wtype == "kpi_bar_chart":
            # Pass mod_ov (processed overrides) not raw overrides — this ensures
            # column_filter from col_fetching_config reaches ALL chart widgets,
            # including those on dependent KPIs/MLIs (e.g. Faculty Wise Status
            # referencing QEC Faculty Perf via cross-KPI formula subfields).
            chart_items.append({"widget": w_orig, "overrides": mod_ov})
        elif wtype == "kpi_card_single_value":
            # Same reasoning: mod_ov carries column_filter for cross-KPI cards.
            card_items.append({"widget": w_orig, "overrides": mod_ov})
        else:
            other_items.append((key, wtype, merged, date_range))

    # Run Chart and Card batches concurrently in parallel using dedicated db sessions.
    # Pass pre-fetched dashboard, org, user_filters, and col_fetching_config so the
    # sub-batch functions can skip the redundant Dashboard/org/user_filter DB queries.
    _prefetch_col_config = col_fetching_config if is_column_fetching else None

    async def _resolve_chart_batch() -> dict[str, dict[str, Any]]:
        if not chart_items:
            return {}
        async with AsyncSessionLocal() as session:
            return await resolve_dashboard_chart_widget_data_batch(
                session, user, org_id, dashboard_id, chart_items,
                _dashboard=dashboard,
                _org=org,
                _user_filters=user_filters,
                _col_fetching_config=_prefetch_col_config,
            )

    async def _resolve_card_batch() -> dict[str, dict[str, Any]]:
        if not card_items:
            return {}
        async with AsyncSessionLocal() as session:
            return await resolve_dashboard_card_widget_data_batch(
                session, user, org_id, dashboard_id, card_items,
                _dashboard=dashboard,
                _org=org,
                _user_filters=user_filters,
                _col_fetching_config=_prefetch_col_config,
            )

    # ------------------------------------------------------------------
    # 6. Resolve "other" light widget types (line, trend, single_value,
    #    kv_table, text) concurrently instead of sequentially.
    #    Each widget gets its own DB session to avoid shared-state issues.
    # ------------------------------------------------------------------
    async def _resolve_other_item(key: str, wtype: str, merged: dict[str, Any], date_range: tuple | None) -> tuple[str, dict[str, Any]]:
        try:
            async with AsyncSessionLocal() as session:
                if wtype == "kpi_line_chart":
                    meta, data, e_rev, _ = await resolve_dashboard_line_widget_data(
                        session, user, org_id, dashboard_id, merged, None
                    )
                elif wtype == "kpi_trend":
                    meta, data, e_rev, _ = await resolve_dashboard_trend_widget_data(
                        session, user, org_id, dashboard_id, merged, None
                    )
                elif wtype == "kpi_single_value":
                    meta, data, e_rev, _ = await resolve_dashboard_single_value_widget_data(
                        session, user, org_id, dashboard_id, merged, None
                    )
                elif wtype == "kpi_table":
                    meta, data, e_rev, _ = await resolve_dashboard_kpi_table_widget_data(
                        session, user, org_id, dashboard_id, merged, None
                    )
                elif wtype == "text":
                    meta, data, e_rev = await _resolve_text(session, user, org_id, merged)
                    return key, {"ok": True, "widget_type": wtype, "meta": meta, "data": data, "entry_revision": e_rev}
                else:
                    return key, {"ok": False, "error": f"unsupported_widget_type:{wtype}"}
            err = data.get("error") or meta.get("error")
            if err == "forbidden":
                return key, {"ok": False, "error": "forbidden"}
            elif err:
                return key, {"ok": False, "error": str(err)}
            else:
                return key, {"ok": True, "widget_type": wtype, "meta": meta, "data": data, "entry_revision": e_rev}
        except Exception as exc:
            _log.exception("universal_batch: error resolving key=%s type=%s", key, wtype)
            return key, {"ok": False, "error": str(exc)}

    # ------------------------------------------------------------------
    # 7. Resolve "heavy" (MLI table) items concurrently using separate sessions.
    # ------------------------------------------------------------------
    async def _resolve_heavy_item(key: str, wtype: str, merged: dict[str, Any], date_range: tuple | None) -> tuple[str, dict[str, Any]]:
        kpi_id = int(merged.get("kpi_id") or 0)
        if kpi_id and not allowed_kpi.get(kpi_id, False):
            return key, {"ok": False, "error": "forbidden"}
        try:
            async with AsyncSessionLocal() as session:
                meta, data, e_rev, _ = await resolve_dashboard_table_widget_data(
                    session, user, org_id, dashboard_id, merged, None
                )
            err = data.get("error") or meta.get("error")
            if err == "forbidden":
                return key, {"ok": False, "error": "forbidden"}
            elif err:
                return key, {"ok": False, "error": str(err)}
            else:
                return key, {"ok": True, "widget_type": wtype, "meta": meta, "data": data, "entry_revision": e_rev}
        except Exception as exc:
            _log.exception("universal_batch: heavy error key=%s", key)
            return key, {"ok": False, "error": str(exc)}

    # Run all resolution tasks concurrently
    other_tasks = [_resolve_other_item(key, wtype, merged, dr) for key, wtype, merged, dr in other_items]
    heavy_tasks = [_resolve_heavy_item(key, wtype, merged, dr) for key, wtype, merged, dr in heavy_items]

    gathered = await asyncio.gather(
        _resolve_chart_batch(),
        _resolve_card_batch(),
        *other_tasks,
        *heavy_tasks,
    )

    # Unpack chart + card results (first two items from gather)
    chart_results = gathered[0]
    card_results = gathered[1]
    results.update(chart_results)
    results.update(card_results)

    # Unpack other + heavy results (remaining items are (key, result) tuples)
    for item_result in gathered[2:]:
        k, v = item_result
        results[k] = v

    # Cache all successfully resolved widgets
    for k, v in results.items():
        if isinstance(v, dict) and v.get("ok"):
            ck = cache_keys_by_id.get(k)
            if ck:
                _widget_cache.set(ck, v)

    trace("resolve_dashboard_universal_batch: successfully completed")
    return results


