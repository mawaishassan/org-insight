"""Resolve reference column cells through optional chains of reference fields to a final compare value."""

from __future__ import annotations

import json
import os
from contextvars import ContextVar
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import FieldType, KPI, KPIEntry, KPIField, KPIFieldValue
from app.entries.service import _normalize_reference_value


def _ref_filter_sql_debug_enabled() -> bool:
    return os.environ.get("REFERENCE_FILTER_DEBUG_SQL", "").strip().lower() in ("1", "true", "yes")


# Set only while executing `build_reference_resolution_map` (one Apply-filter request).
_ref_filter_sql_batch: ContextVar[list[tuple[str, str]] | None] = ContextVar("_ref_filter_sql_batch", default=None)


def _compile_ref_filter_sql(stmt: Any) -> str:
    try:
        from sqlalchemy.dialects import postgresql as pg

        compiled = stmt.compile(dialect=pg.dialect(), compile_kwargs={"literal_binds": True})
        return str(compiled)
    except Exception:
        try:
            return str(stmt.compile(compile_kwargs={"literal_binds": False}))
        except Exception:
            return f"<could not compile statement: {stmt!r}>"


def _buffer_ref_filter_sql(tag: str, stmt: Any) -> None:
    """Record SQL for end-of-request summary when REFERENCE_FILTER_DEBUG_SQL=1."""
    if not _ref_filter_sql_debug_enabled():
        return
    batch = _ref_filter_sql_batch.get()
    if batch is None:
        return
    batch.append((tag, _compile_ref_filter_sql(stmt)))


def _flush_ref_filter_sql_batch(batch: list[tuple[str, str]]) -> None:
    """Print once after reference resolution for this filter apply (deduplicated SQL)."""
    if not _ref_filter_sql_debug_enabled() or not batch:
        return
    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for tag, sql in batch:
        if sql in seen:
            continue
        seen.add(sql)
        unique.append((tag, sql))
    print(
        f"\n[ref-filter SQL] apply filter — {len(unique)} distinct statement(s), "
        f"{len(batch)} total executions (REFERENCE_FILTER_DEBUG_SQL)\n",
        flush=True,
    )
    for i, (tag, sql) in enumerate(unique, 1):
        print(f"-- #{i} [{tag}]\n{sql}\n", flush=True)


def _extract_ref_label(v: Any) -> str:
    """Best-effort display label extraction from stored reference-like cells."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float, bool)):
        return str(v)
    if isinstance(v, dict):
        for k in ("label", "text", "name", "value", "id"):
            if k in v and v[k] is not None:
                return str(v[k])
        return ""
    return str(v)


def _extract_ref_labels(v: Any) -> list[str]:
    """Like `_extract_ref_label`, but supports lists/sets/tuples for multi-reference cells."""
    if v is None:
        return []
    if isinstance(v, (list, tuple, set)):
        out: list[str] = []
        for x in v:
            s = _extract_ref_label(x).strip()
            if s:
                out.append(s)
        return out
    s = _extract_ref_label(v).strip()
    return [s] if s else []


def _multi_raw_pieces(raw: Any) -> list[Any]:
    """Split a multi_reference cell into individual raw tokens (dict / str / id)."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return [x for x in raw if x is not None]
    if isinstance(raw, str):
        s = raw.strip()
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    return [x for x in parsed if x is not None]
            except (json.JSONDecodeError, TypeError):
                pass
    return [raw]


def _entry_id_candidates_from_cell(cell: Any) -> list[int]:
    """If client saved {entry_id: n} (or similar), resolve the linked KPI row directly."""
    out: list[int] = []
    if isinstance(cell, dict):
        for k in ("entry_id", "kpi_entry_id", "source_entry_id", "ref_entry_id"):
            v = cell.get(k)
            if v is None:
                continue
            try:
                i = int(v)
                if i > 0:
                    out.append(i)
            except (TypeError, ValueError):
                continue
        return out
    # Multi-line / import rows often store the linked row as a bare id (number or digit string), not a dict.
    if isinstance(cell, bool):
        return out
    if isinstance(cell, int):
        if cell > 0:
            out.append(int(cell))
        return out
    if isinstance(cell, float):
        if cell > 0 and cell == int(cell):
            out.append(int(cell))
        return out
    if isinstance(cell, str):
        s = cell.strip()
        if s.isdigit():
            try:
                i = int(s)
                if i > 0:
                    out.append(i)
            except ValueError:
                pass
    return out


async def _entry_id_in_kpi_or_none(
    db: AsyncSession,
    org_id: int,
    prefer_year: int | None,
    kpi_id: int,
    entry_id: int,
) -> int | None:
    """Validate entry id belongs to org + KPI. Year is not checked — id is unique (labels may match other years)."""
    _ = prefer_year  # unused; kept for call-site compatibility
    q = (
        select(KPIEntry.id)
        .where(
            KPIEntry.id == int(entry_id),
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == int(kpi_id),
        )
    )
    _buffer_ref_filter_sql(
        f"_entry_id_in_kpi_or_none entry_id={entry_id} org_id={org_id} kpi_id={kpi_id}",
        q,
    )
    res = await db.execute(q)
    row = res.scalar_one_or_none()
    return int(row) if row is not None else None


async def resolve_source_kpi_entry_id(
    db: AsyncSession,
    org_id: int,
    prefer_year: int | None,
    kpi_id: int,
    label_field: KPIField,
    label_sub_field_key: str | None,
    normalized_label: str,
    anchor_raw: Any | None,
) -> int | None:
    """
    Find the KPI entry row identified by a reference cell.
    Prefer explicit entry_id embedded in JSON clients; else match the configured label field
    (the actual link field), optionally using anchor_raw for robust label extraction.
    """
    if anchor_raw is not None:
        for eid in _entry_id_candidates_from_cell(anchor_raw):
            hit = await _entry_id_in_kpi_or_none(db, org_id, prefer_year, kpi_id, eid)
            if hit is not None:
                return hit

    lab = normalized_label
    if not lab and anchor_raw is not None:
        lab = _normalize_reference_value(_extract_ref_label(anchor_raw))
    if not lab:
        return None

    hit = await find_entry_id_by_label(
        db, org_id, prefer_year, kpi_id, label_field, label_sub_field_key, lab
    )
    if hit is not None:
        return hit

    # Labels that still equal the normalized search (string compare is in find_entry_id_by_label)
    return None


def _subfield_by_key(fld: KPIField, sub_key: str) -> Any:
    for sf in getattr(fld, "sub_fields", None) or []:
        if getattr(sf, "key", None) == sub_key:
            return sf
    return None


def _effective_field_type_for_step(fld: KPIField, subk: str | None) -> str:
    """For multi_line_items|subKey steps, use the sub-field type (e.g. reference), not the parent's."""
    if fld.field_type == FieldType.multi_line_items and subk:
        sf = _subfield_by_key(fld, subk)
        if sf is not None:
            sft = sf.field_type
            return sft.value if hasattr(sft, "value") else str(sft)
    ft = fld.field_type
    return ft.value if hasattr(ft, "value") else str(ft)


def _reference_hop_config(fld: KPIField, subk: str | None) -> dict[str, Any]:
    """reference_source_* for the next hop: sub-field config when step is multi_line_items|subcolumn."""
    if fld.field_type == FieldType.multi_line_items and subk:
        sf = _subfield_by_key(fld, subk)
        if sf is not None:
            return getattr(sf, "config", None) or {}
    return getattr(fld, "config", None) or {}


async def _read_compare_value(
    db: AsyncSession,
    entry_id: int,
    cmp_f: KPIField,
    compare_sub_field_key: str | None,
    *,
    match_row_sub_key: str | None = None,
    match_row_normalized_label: str | None = None,
) -> Any | None:
    fv_stmt = select(KPIFieldValue).where(
        KPIFieldValue.entry_id == entry_id,
        KPIFieldValue.field_id == cmp_f.id,
    )
    _buffer_ref_filter_sql(
        f"_read_compare_value entry_id={entry_id} field_id={cmp_f.id} field_key={getattr(cmp_f, 'key', '?')} "
        f"sub_key={compare_sub_field_key!r} row_match={match_row_sub_key!r}",
        fv_stmt,
    )
    res = await db.execute(fv_stmt)
    fv = res.scalar_one_or_none()
    if not fv:
        return None
    if cmp_f.field_type == FieldType.multi_line_items and compare_sub_field_key:
        rows = fv.value_json if isinstance(fv.value_json, list) else []
        # When the source KPI labels rows via a subfield (e.g. department_name), we must read the
        # compare subfield from the *same* row as the Program anchor — not the first non-empty row.
        if match_row_sub_key and match_row_normalized_label is not None and match_row_normalized_label != "":
            for row in rows:
                if not isinstance(row, dict) or compare_sub_field_key not in row:
                    continue
                lab_cell = row.get(match_row_sub_key)
                cell_lab = _normalize_reference_value(_extract_ref_label(lab_cell if lab_cell is not None else ""))
                if cell_lab != match_row_normalized_label:
                    continue
                v = row.get(compare_sub_field_key)
                if v is not None and str(v).strip() != "":
                    return v
                return v
            return None
        fallback: Any = None
        for row in rows:
            if not isinstance(row, dict) or compare_sub_field_key not in row:
                continue
            v = row.get(compare_sub_field_key)
            if v is not None and str(v).strip() != "":
                return v
            fallback = v
        return fallback
    if cmp_f.field_type == FieldType.number and fv.value_number is not None:
        return fv.value_number
    if cmp_f.field_type == FieldType.boolean and fv.value_boolean is not None:
        return fv.value_boolean
    if cmp_f.field_type == FieldType.date and fv.value_date is not None:
        return fv.value_date.isoformat() if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
    # Reference cells often store display/ids in value_json; value_text may be "" — do not stop on empty string.
    if cmp_f.field_type in (FieldType.reference, FieldType.multi_reference):
        vt = fv.value_text
        if vt is not None and str(vt).strip() != "":
            return vt
        if fv.value_json is not None:
            return fv.value_json
        return None
    if fv.value_text is not None:
        return fv.value_text
    if fv.value_json is not None:
        return fv.value_json
    return None


def _scalar_fv_matches_label(fv: KPIFieldValue, label_field: KPIField, normalized_label: str) -> bool:
    raw = None
    if label_field.field_type == FieldType.number and fv.value_number is not None:
        raw = str(fv.value_number)
    elif label_field.field_type == FieldType.boolean and fv.value_boolean is not None:
        raw = str(fv.value_boolean).lower()
    elif label_field.field_type == FieldType.date and fv.value_date is not None:
        raw = fv.value_date.isoformat() if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
    elif label_field.field_type in (FieldType.reference, FieldType.multi_reference):
        vt = fv.value_text
        if vt is not None and str(vt).strip() != "":
            raw = vt
        elif fv.value_json is not None:
            raw = _extract_ref_label(fv.value_json)
        else:
            raw = None
    elif fv.value_text is not None:
        raw = fv.value_text
    elif fv.value_json is not None:
        raw = _extract_ref_label(fv.value_json)
    if raw is None:
        return False
    return _normalize_reference_value(str(raw)) == normalized_label


async def find_entry_id_by_label(
    db: AsyncSession,
    org_id: int,
    prefer_year: int | None,
    kpi_id: int,
    label_field: KPIField,
    label_sub_field_key: str | None,
    normalized_label: str,
) -> int | None:
    """
    Match label to a KPI entry. Same org/kpi as get_reference_allowed_values (all years).
    Prefer the consuming entry's year first when provided, then any year — master/reference
    rows often exist only under a different KPIEntry.year than the Program row.
    """
    if not normalized_label and label_field.field_type != FieldType.multi_line_items:
        return None

    base = (
        select(KPIFieldValue, KPIEntry.id)
        .join(KPIEntry, KPIFieldValue.entry_id == KPIEntry.id)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
        )
    )
    year_tries: list[int | None]
    if prefer_year is not None:
        year_tries = [prefer_year, None]
    else:
        year_tries = [None]

    if label_field.field_type != FieldType.multi_line_items:
        q0 = base.where(KPIFieldValue.field_id == label_field.id)
        for y in year_tries:
            q = q0
            if y is not None:
                q = q.where(KPIEntry.year == y)
            _buffer_ref_filter_sql("find_entry_id_by_label (scalar label field)", q)
            res = await db.execute(q)
            for fv, entry_id in res.all():
                if _scalar_fv_matches_label(fv, label_field, normalized_label):
                    return int(entry_id)
        return None

    if not label_sub_field_key:
        return None
    ml_f = label_field
    q0 = base.where(KPIFieldValue.field_id == ml_f.id)
    for y in year_tries:
        q = q0
        if y is not None:
            q = q.where(KPIEntry.year == y)
        _buffer_ref_filter_sql("find_entry_id_by_label (multi_line_items label field)", q)
        res = await db.execute(q)
        for fv, entry_id in res.all():
            rows = fv.value_json if isinstance(fv.value_json, list) else []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                lab_cell = row.get(label_sub_field_key)
                cell_lab = _normalize_reference_value(_extract_ref_label(lab_cell if lab_cell is not None else ""))
                if cell_lab != normalized_label:
                    continue
                return int(entry_id)
    return None


async def resolve_reference_chain(
    db: AsyncSession,
    org_id: int,
    prefer_year: int | None,
    consuming_sub_field: Any,
    steps: list[dict[str, Any]],
    normalized_label: str,
    anchor_cell_raw: Any | None = None,
) -> Any | None:
    """
    Walk from the consuming reference cell label through zero or more reference hops (steps[:-1]),
    then read the final step field value on the resolved entry.
    """
    if not steps:
        return None
    cfg = getattr(consuming_sub_field, "config", None) or {}
    sid = cfg.get("reference_source_kpi_id")
    lab_key = cfg.get("reference_source_field_key")
    lab_sub = cfg.get("reference_source_sub_field_key")
    if not sid or not lab_key:
        return None

    lf_stmt = select(KPIField).where(KPIField.kpi_id == int(sid), KPIField.key == str(lab_key))
    _buffer_ref_filter_sql("resolve_reference_chain: load label KPIField", lf_stmt)
    lf_res = await db.execute(lf_stmt)
    label_field = lf_res.scalar_one_or_none()
    if not label_field:
        return None

    entry_id = await resolve_source_kpi_entry_id(
        db,
        org_id,
        prefer_year,
        int(sid),
        label_field,
        str(lab_sub) if lab_sub else None,
        normalized_label,
        anchor_cell_raw,
    )
    if entry_id is None:
        return None
    kpi_id = int(sid)

    async def _resolve_from_entry(
        cur_entry_id: int,
        cur_kpi_id: int,
        step_idx: int,
        *,
        hop_row_match_sub_key: str | None = None,
        hop_row_match_label: str | None = None,
    ) -> list[Any]:
        step = steps[step_idx]
        fk = step.get("compare_field_key")
        sk = step.get("compare_sub_field_key")
        if not fk:
            return []

        fld_stmt = (
            select(KPIField)
            .where(KPIField.kpi_id == cur_kpi_id, KPIField.key == str(fk))
            .options(selectinload(KPIField.sub_fields))
        )
        _buffer_ref_filter_sql("_resolve_from_entry: load compare KPIField", fld_stmt)
        fld_res = await db.execute(fld_stmt)
        fld = fld_res.scalar_one_or_none()
        if not fld:
            return []

        subk = str(sk) if sk else None
        eff_ft = _effective_field_type_for_step(fld, subk)

        # Multi_line_items: read compare subfield from the row that matches the anchor label for this hop
        # (Program cell on step 0; previous reference piece on deeper hops) — not the first non-empty row.
        mr_sub: str | None = None
        mr_lab: str | None = None
        if hop_row_match_sub_key and hop_row_match_label:
            mr_sub = hop_row_match_sub_key
            mr_lab = hop_row_match_label
        elif (
            step_idx == 0
            and label_field.field_type == FieldType.multi_line_items
            and lab_sub
            and fld.id == label_field.id
        ):
            mr_sub = str(lab_sub)
            mr_lab = normalized_label

        # Terminal step: read final scalar value
        if step_idx == len(steps) - 1:
            v = await _read_compare_value(
                db,
                cur_entry_id,
                fld,
                subk,
                match_row_sub_key=mr_sub,
                match_row_normalized_label=mr_lab,
            )
            return [v]

        if eff_ft not in ("reference", "multi_reference"):
            return []

        raw = await _read_compare_value(
            db,
            cur_entry_id,
            fld,
            subk,
            match_row_sub_key=mr_sub,
            match_row_normalized_label=mr_lab,
        )
        if raw is None:
            return []

        next_cfg = _reference_hop_config(fld, subk)
        nkpi = next_cfg.get("reference_source_kpi_id")
        nlab_k = next_cfg.get("reference_source_field_key")
        nlab_sk = next_cfg.get("reference_source_sub_field_key")
        if not nkpi or not nlab_k:
            return []

        nlf_stmt = select(KPIField).where(KPIField.kpi_id == int(nkpi), KPIField.key == str(nlab_k))
        _buffer_ref_filter_sql("_resolve_from_entry: load next-hop label KPIField", nlf_stmt)
        nlf_res = await db.execute(nlf_stmt)
        nlab_f = nlf_res.scalar_one_or_none()
        if not nlab_f:
            return []

        pieces = _multi_raw_pieces(raw) if eff_ft == "multi_reference" else [raw]
        out: list[Any] = []
        seen_eids: set[int] = set()
        for piece in pieces:
            nxt_label = _normalize_reference_value(_extract_ref_label(piece))
            if not nxt_label:
                continue
            n_eid = await resolve_source_kpi_entry_id(
                db,
                org_id,
                prefer_year,
                int(nkpi),
                nlab_f,
                str(nlab_sk) if nlab_sk else None,
                nxt_label,
                piece,
            )
            if n_eid is None:
                continue
            if int(n_eid) in seen_eids:
                continue
            seen_eids.add(int(n_eid))
            out.extend(
                await _resolve_from_entry(
                    int(n_eid),
                    int(nkpi),
                    step_idx + 1,
                    hop_row_match_sub_key=str(nlab_sk) if nlab_sk else None,
                    hop_row_match_label=nxt_label,
                )
            )
        return out

    vals = await _resolve_from_entry(entry_id, kpi_id, 0)
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    if len(vals) == 1:
        return vals[0]
    return vals


def _merge_resolution_chain(rr: dict[str, Any]) -> list[dict[str, Any]]:
    chain = rr.get("chain")
    if isinstance(chain, list) and len(chain) > 0:
        out: list[dict[str, Any]] = []
        for s in chain:
            if not isinstance(s, dict):
                continue
            fk = s.get("compare_field_key")
            if not fk:
                continue
            row: dict[str, Any] = {"compare_field_key": str(fk)}
            sk = s.get("compare_sub_field_key")
            if sk:
                row["compare_sub_field_key"] = str(sk)
            out.append(row)
        return out
    fk = rr.get("compare_field_key")
    if fk:
        row = {"compare_field_key": str(fk)}
        sk = rr.get("compare_sub_field_key")
        if sk:
            row["compare_sub_field_key"] = str(sk)
        return [row]
    return []


async def build_reference_resolution_map(
    db: AsyncSession,
    org_id: int,
    prefer_year: int | None,
    field: KPIField,
    conditions: list[Any],
    row_dicts: list[dict[str, Any]],
) -> dict[tuple[int, str], Any]:
    out: dict[tuple[int, str], Any] = {}
    sub_by_key = {getattr(s, "key", None): s for s in (field.sub_fields or []) if getattr(s, "key", None)}

    batch: list[tuple[str, str]] = []
    tok = _ref_filter_sql_batch.set(batch)
    try:
        for cond_idx, cond in enumerate(conditions):
            if not isinstance(cond, dict):
                continue
            rr = cond.get("reference_resolution")
            if not isinstance(rr, dict):
                continue
            fk = cond.get("field")
            if not fk:
                continue
            sub = sub_by_key.get(str(fk))
            if not sub:
                continue
            ft = getattr(sub, "field_type", None)
            ft_s = ft.value if hasattr(ft, "value") else ft
            if ft_s not in ("reference", "multi_reference"):
                continue

            steps = _merge_resolution_chain(rr)
            if not steps:
                continue

            cfg = getattr(sub, "config", None) or {}
            sid = cfg.get("reference_source_kpi_id")
            if not sid:
                continue

            kpi_chk = select(KPI.organization_id).where(KPI.id == int(sid))
            _buffer_ref_filter_sql(f"build_reference_resolution_map: KPI org check source_kpi_id={sid}", kpi_chk)
            kpi_check = await db.execute(kpi_chk)
            org_row = kpi_check.one_or_none()
            if not org_row or org_row[0] != org_id:
                continue

            labels: set[str] = set()
            anchor_by_norm: dict[str, Any] = {}
            for r in row_dicts:
                cell = r.get(str(fk))
                if ft_s == "multi_reference":
                    for tok_p in _multi_raw_pieces(cell):
                        k = _normalize_reference_value(_extract_ref_label(tok_p))
                        if not k:
                            continue
                        labels.add(k)
                        anchor_by_norm.setdefault(k, tok_p)
                else:
                    k = _normalize_reference_value(_extract_ref_label(cell))
                    if not k:
                        continue
                    labels.add(k)
                    anchor_by_norm.setdefault(k, cell)

            for lab in labels:
                if not lab:
                    continue
                key = (cond_idx, lab)
                if key in out:
                    continue
                val = await resolve_reference_chain(
                    db,
                    org_id,
                    prefer_year,
                    sub,
                    steps,
                    lab,
                    anchor_by_norm.get(lab),
                )
                out[key] = val

        return out
    finally:
        _ref_filter_sql_batch.reset(tok)
        _flush_ref_filter_sql_batch(batch)
