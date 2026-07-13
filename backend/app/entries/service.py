"""KPI entry CRUD, submit, lock; formula evaluation for formula fields."""

import ast
import json
import math
from datetime import datetime
from typing import Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct, delete, and_
from sqlalchemy.orm import selectinload

from app.core.models import (
    KPIEntry,
    KPIFieldValue,
    KPIField,
    KPI,
    KPIAssignment,
    KpiRoleAssignment,
    KpiFieldAccess,
    KpiFieldAccessByRole,
    KpiMultiLineRowAccess,
    KpiMultiLineRow,
    KpiMultiLineCell,
    User,
    UserOrganizationRole,
    OrganizationRole,
    Organization,
    TimeDimension,
    effective_kpi_time_dimension,
    period_key_sort_order,
    KPIOrganizationTag,
    OrganizationTag,
)
from app.core.models import FieldType


class EntryValidationError(Exception):
    """Raised when entry values fail validation (e.g. reference field value not in allowed list)."""

    def __init__(self, errors: list[dict]):
        self.errors = errors  # list of {"field_key": str, "sub_field_key": str|None, "row_index": int|None, "value": str, "message": str}
        super().__init__(f"Validation failed: {len(errors)} error(s)")

# Type for multi_line_items data passed to formula evaluator
MultiLineItemsData = dict[str, list[dict]]
from app.entries.schemas import FieldValueInput, EntryCreate
from app.formula_engine.evaluator import evaluate_formula, OtherKpiValues


def _ml_cell_raw(c: KpiMultiLineCell) -> Any:
    if getattr(c, "value_json", None) is not None:
        return c.value_json
    if getattr(c, "value_text", None) is not None:
        return c.value_text
    if getattr(c, "value_number", None) is not None:
        return c.value_number
    if getattr(c, "value_boolean", None) is not None:
        return c.value_boolean
    if getattr(c, "value_date", None) is not None:
        try:
            return c.value_date.isoformat()
        except Exception:
            return str(c.value_date)
    return None


async def load_multi_line_items_rows(db: AsyncSession, *, entry_id: int, field: KPIField) -> list[dict]:
    """Load relational multi_line_items rows into legacy list-of-dicts shape."""
    res = await db.execute(
        select(KpiMultiLineRow)
        .where(KpiMultiLineRow.entry_id == entry_id, KpiMultiLineRow.field_id == field.id)
        .order_by(KpiMultiLineRow.row_index)
        .options(selectinload(KpiMultiLineRow.cells).selectinload(KpiMultiLineCell.sub_field))
    )
    rows_orm = list(res.scalars().all())
    out: list[dict] = []
    for r in rows_orm:
        d: dict[str, Any] = {}
        for c in getattr(r, "cells", None) or []:
            sf = getattr(c, "sub_field", None)
            key = getattr(sf, "key", None) if sf is not None else None
            if not key:
                continue
            d[str(key)] = _ml_cell_raw(c)
        out.append(d)
    return out


async def _resolve_attachment_filenames_to_urls(
    db: AsyncSession,
    kpi_id: int,
    rows: list[dict],
    sub_fields: list,
) -> list[dict]:
    """Map simple attachment filename strings back to their original JSON URL objects by querying KpiFile table."""
    from app.core.models import KpiFile, FieldType
    import json

    attachment_keys = [
        s.key for s in sub_fields if getattr(s, "field_type", None) in (FieldType.attachment, "attachment")
    ]
    if not attachment_keys or not rows:
        return rows

    # Query all files associated with this KPI to build a filename -> {url, filename} map
    from sqlalchemy import select
    files_stmt = select(KpiFile).where(KpiFile.kpi_id == kpi_id)
    files_res = await db.execute(files_stmt)
    kpi_files = files_res.scalars().all()

    filename_to_obj = {}
    for kf in kpi_files:
        fn = kf.original_filename
        if fn:
            filename_to_obj[fn.strip().lower()] = {
                "url": f"/api/kpis/{kpi_id}/files/{kf.id}/download",
                "filename": fn
            }

    new_rows = []
    for r in rows:
        if not isinstance(r, dict):
            new_rows.append(r)
            continue
        new_row = dict(r)
        for k in attachment_keys:
            val = new_row.get(k)
            if isinstance(val, str):
                s = val.strip()
                if not s:
                    new_row[k] = None
                elif s.startswith("{"):
                    try:
                        new_row[k] = json.loads(s)
                    except Exception:
                        pass
                else:
                    s_lower = s.lower()
                    if s_lower in filename_to_obj:
                        new_row[k] = filename_to_obj[s_lower]
                    elif s_lower in ("none", "null", "attached file"):
                        new_row[k] = None
                    else:
                        new_row[k] = s
        new_rows.append(new_row)
    return new_rows


async def replace_multi_line_items_rows(db: AsyncSession, *, entry_id: int, field: KPIField, rows: list[dict]) -> None:
    """Replace relational multi_line_items rows/cells for (entry, field) from list-of-dicts."""
    existing_rows = await load_multi_line_items_rows(db, entry_id=entry_id, field=field)
    resolved_rows = await _resolve_attachment_filenames_to_urls(db, field.kpi_id, rows, getattr(field, "sub_fields", None) or [])

    existing = await db.execute(
        select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == entry_id, KpiMultiLineRow.field_id == field.id)
    )
    for r in list(existing.scalars().all()):
        await db.delete(r)
    await db.flush()

    sub_fields = getattr(field, "sub_fields", None) or []
    key_to_sub = {getattr(s, "key", None): s for s in sub_fields if getattr(s, "key", None)}
    
    subfields_dict = {}
    for sf in sub_fields:
        subfields_dict[sf.key] = sf
        if getattr(sf, "id", None) is not None:
            subfields_dict[int(sf.id)] = sf

    from app.fields.conditional import is_subfield_visible
    merged_resolved_rows = []
    for idx, inc_row in enumerate(resolved_rows or []):
        inc_row = inc_row if isinstance(inc_row, dict) else {}
        exist_row = existing_rows[idx] if idx < len(existing_rows) and isinstance(existing_rows[idx], dict) else {}
        
        merged_row = {**exist_row, **inc_row}
        
        # Clean up dependent fields recursively in merged_row if condition is false
        changed = True
        while changed:
            changed = False
            for sf in sub_fields:
                if sf.key in merged_row and merged_row[sf.key] not in (None, "", []):
                    if not is_subfield_visible(sf, subfields_dict, merged_row):
                        merged_row[sf.key] = None
                        changed = True

        final_row = {}
        for sub in sub_fields:
            if not getattr(sub, "key", None):
                continue
            if is_subfield_visible(sub, subfields_dict, merged_row):
                if sub.key in inc_row:
                    final_row[sub.key] = inc_row[sub.key]
                else:
                    final_row[sub.key] = exist_row.get(sub.key)
            else:
                final_row[sub.key] = None
        merged_resolved_rows.append(final_row)

    def _add_cell(row_id: int, sub: Any, raw_val: Any) -> None:
        c = KpiMultiLineCell(row_id=row_id, sub_field_id=int(getattr(sub, "id")))
        ft = getattr(sub, "field_type", None)
        ft_s = ft.value if hasattr(ft, "value") else str(ft)
        if raw_val is None:
            pass
        elif ft_s == "number":
            try:
                c.value_number = float(raw_val)
            except Exception:
                c.value_text = str(raw_val)
        elif ft_s == "boolean":
            if isinstance(raw_val, bool):
                c.value_boolean = raw_val
            else:
                s = str(raw_val).strip().lower()
                if s in ("true", "yes", "1"):
                    c.value_boolean = True
                elif s in ("false", "no", "0"):
                    c.value_boolean = False
                else:
                    c.value_text = str(raw_val)
        elif ft_s == "date":
            c.value_text = str(raw_val)
        elif ft_s in ("reference", "multi_reference", "mixed_list", "attachment"):
            if isinstance(raw_val, (dict, list)):
                c.value_json = raw_val
            else:
                c.value_text = str(raw_val)
        else:
            if isinstance(raw_val, (dict, list)):
                c.value_json = raw_val
            else:
                c.value_text = str(raw_val)
        db.add(c)

    for idx, row in enumerate(merged_resolved_rows):
        rdict = row if isinstance(row, dict) else {}
        mlr = KpiMultiLineRow(entry_id=entry_id, field_id=field.id, row_index=int(idx))
        db.add(mlr)
        await db.flush()
        for k, v in rdict.items():
            sub = key_to_sub.get(k)
            if not sub:
                continue
            if getattr(sub, "field_type", None) == FieldType.mixed_list:
                v = coerce_mixed_list_raw(v) or None
            _add_cell(mlr.id, sub, v)


async def _resolve_org_and_kpi(db: AsyncSession, kpi_id: int) -> int | None:
    """Return organization_id for KPI or None (KPI has organization_id directly)."""
    result = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
    row = result.one_or_none()
    return row[0] if row else None


async def get_reference_allowed_values(
    db: AsyncSession,
    source_kpi_id: int,
    source_field_key: str,
    org_id: int,
    source_sub_field_key: str | None = None,
    *,
    year: int | None = None,
) -> list[str]:
    """Return distinct values from a source KPI field (or multi_line_items sub-field) for reference. Same org only."""
    result = await db.execute(
        select(KPIField)
        .join(KPI, KPIField.kpi_id == KPI.id)
        .where(
            KPIField.kpi_id == source_kpi_id,
            KPIField.key == source_field_key,
            KPI.organization_id == org_id,
        )
        .options(selectinload(KPIField.sub_fields))
    )
    source_field = result.scalar_one_or_none()
    if not source_field:
        return []
    subq = select(KPIEntry.id).where(KPIEntry.organization_id == org_id)
    if year is not None:
        subq = subq.where(KPIEntry.year == int(year))

    if source_field.field_type == FieldType.multi_line_items and source_sub_field_key:
        sf = next((s for s in (getattr(source_field, "sub_fields", None) or []) if getattr(s, "key", None) == source_sub_field_key), None)
        if sf is None:
            return []
        q = (
            select(
                KpiMultiLineCell.value_text,
                KpiMultiLineCell.value_number,
                KpiMultiLineCell.value_boolean,
                KpiMultiLineCell.value_date,
                KpiMultiLineCell.value_json,
            )
            .select_from(KpiMultiLineRow)
            .join(KpiMultiLineCell, KpiMultiLineCell.row_id == KpiMultiLineRow.id)
            .where(
                KpiMultiLineRow.field_id == source_field.id,
                KpiMultiLineRow.entry_id.in_(subq),
                KpiMultiLineCell.sub_field_id == int(getattr(sf, "id")),
            )
        )
        rows = await db.execute(q)
        values_set: set[str] = set()
        for vt, vn, vb, vd, vj in rows.all():
            raw = None
            if vt is not None and str(vt).strip() != "":
                raw = vt
            elif vn is not None:
                raw = vn
            elif vb is not None:
                raw = str(vb).lower()
            elif vd is not None:
                raw = vd.isoformat() if hasattr(vd, "isoformat") else str(vd)
            elif vj is not None:
                raw = vj
            if raw is None:
                continue
            s = str(raw).strip()
            if s.lower() in ("true", "false"):
                s = s.lower()
            if s:
                values_set.add(s)
        return sorted(values_set)
    if source_field.field_type == FieldType.number:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_number))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_number.isnot(None),
            )
        )
        values = [str(r[0]) for r in rows.all() if r[0] is not None]
    elif source_field.field_type == FieldType.boolean:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_boolean))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_boolean.isnot(None),
            )
        )
        values = [str(r[0]).lower() for r in rows.all() if r[0] is not None]
    elif source_field.field_type == FieldType.date:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_date))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_date.isnot(None),
            )
        )
        values = []
        for r in rows.all():
            if r[0] is not None:
                values.append(r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]))
    else:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_text))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_text.isnot(None),
                KPIFieldValue.value_text != "",
            )
        )
        values = [r[0] for r in rows.all() if r[0]]
    return sorted(set(values))


def _normalize_reference_value(val: str | None) -> str:
    """Normalize a value for comparison with allowed reference values (strip, lowercase for bool)."""
    if val is None:
        return ""
    s = (val if isinstance(val, str) else str(val)).strip()
    if s.lower() in ("true", "false"):
        return s.lower()
    return s


# Values that are accepted for reference fields without being in the reference list (e.g. "Not Applicable").
_REFERENCE_EMPTY_SENTINELS = frozenset(
    {"", "na", "n/a", "n.a.", "na.", "-", "none", "n.a", "n/a."}
)


def _is_reference_empty_or_sentinel(normalized: str) -> bool:
    """True if the value should be accepted for reference validation without checking the allowed list."""
    return not normalized or normalized.lower().strip() in _REFERENCE_EMPTY_SENTINELS


def coerce_multi_reference_raw(raw: Any) -> list[Any]:
    """Normalize client/Excel input into a list of raw tokens (strings or JSON-like)."""
    if raw is None:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    return parsed
                return [parsed]
            except (json.JSONDecodeError, TypeError):
                pass
        if ";" in s:
            return [p.strip() for p in s.split(";") if p.strip()]
        return [p.strip() for p in s.split(",") if p.strip()]
    return [raw]


_ISO_DATE_RE = __import__("re").compile(r"^\d{4}-\d{2}-\d{2}$")


def _infer_mixed_list_atom(val: Any) -> Any | None:
    """Infer a JSON-storable atom for mixed_list: number, ISO date string, or string. Returns None for empty."""
    if val is None:
        return None
    if isinstance(val, bool):
        # Keep booleans as strings to avoid ambiguity in UI and Excel ("true"/"false" tokens are common labels).
        return "true" if val else "false"
    if isinstance(val, (int, float)) and not isinstance(val, bool):
        if isinstance(val, float):
            if math.isfinite(val) and val == int(val):
                return int(val)
            return float(val)
        return int(val)
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return None
        # ISO date detection (as typed date)
        if _ISO_DATE_RE.match(s):
            return s
        # Numeric detection (accept thousands separators)
        try:
            num = float(s.replace(",", ""))
            if math.isfinite(num) and num == int(num):
                return int(num)
            if math.isfinite(num):
                return num
        except ValueError:
            pass
        return s
    # Fallback: stringify unknown objects
    s = str(val).strip()
    return s or None


def coerce_mixed_list_raw(raw: Any) -> list[Any]:
    """
    Normalize input into a heterogeneous JSON list of atoms:
    - Accept list inputs directly.
    - Accept strings with ';' separated tokens (primary) and ',' as fallback.
    - Infer numbers and ISO dates (YYYY-MM-DD) per token; otherwise keep as string.
    """
    if raw is None:
        return []
    if isinstance(raw, list):
        out: list[Any] = []
        for x in raw:
            atom = _infer_mixed_list_atom(x)
            if atom is not None:
                out.append(atom)
        return out
    if isinstance(raw, str):
        s = raw.strip()
        if not s:
            return []
        # JSON list payload in string form
        if s.startswith("["):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    return coerce_mixed_list_raw(parsed)
            except (json.JSONDecodeError, TypeError):
                pass
        parts = [p.strip() for p in (s.split(";") if ";" in s else s.split(",")) if p.strip()]
        out: list[Any] = []
        for p in parts:
            atom = _infer_mixed_list_atom(p)
            if atom is not None:
                out.append(atom)
        return out
    # Single scalar: wrap
    atom = _infer_mixed_list_atom(raw)
    return [atom] if atom is not None else []


def _canonical_by_normalized_reference(allowed: list[str]) -> dict[str, str]:
    """Map normalized token -> first canonical display string from allowed list."""
    out: dict[str, str] = {}
    for a in allowed:
        n = _normalize_reference_value(str(a))
        if n and n not in out:
            out[n] = str(a).strip()
    return out


def filter_multi_reference_to_allowed(raw: Any, allowed: list[str]) -> list[str]:
    """Keep only values that match the reference allowed list (canonical casing). Dedupe."""
    norm_map = _canonical_by_normalized_reference(allowed)
    seen: set[str] = set()
    out: list[str] = []
    for item in coerce_multi_reference_raw(raw):
        if isinstance(item, dict):
            s = None
            for k in ("label", "text", "value", "name"):
                if k in item and item[k] is not None:
                    s = str(item[k])
                    break
            if s is None:
                continue
        else:
            s = str(item) if item is not None else ""
        n = _normalize_reference_value(s)
        if _is_reference_empty_or_sentinel(n):
            continue
        if n in norm_map:
            canon = norm_map[n]
            if canon not in seen:
                seen.add(canon)
                out.append(canon)
    return out


def _stringify_for_upsert_match_key(val: Any) -> str:
    """Make Excel / JSON scalars comparable (e.g. 42, 42.0, '42', '42.0' → same id string)."""
    if val is None:
        return ""
    if isinstance(val, bool):
        return "true" if val else "false"
    if isinstance(val, int) and not isinstance(val, bool):
        return str(val)
    if isinstance(val, float):
        if math.isfinite(val) and val == int(val):
            return str(int(val))
        return str(val)
    if isinstance(val, str):
        t = val.strip()
        if not t:
            return ""
        try:
            f = float(t.replace(",", ""))
            if math.isfinite(f) and f == int(f):
                return str(int(f))
        except ValueError:
            pass
        return t
    return str(val).strip()


def _normalize_upsert_match_value(val: Any, field_type: FieldType | str | None) -> str | None:
    """Comparable signature for upsert matching; None => no match key (incoming row is always appended)."""
    if val is None:
        return None
    ft = field_type.value if isinstance(field_type, FieldType) else (field_type or "")
    fts = str(ft)

    if fts == FieldType.boolean.value or fts == "boolean":
        if isinstance(val, bool):
            return "1" if val else "0"
        s = str(val).strip().lower()
        return "1" if s in ("1", "true", "yes", "y", "on") else "0"

    if fts == FieldType.number.value or fts == "number":
        try:
            f = float(val)
            if math.isfinite(f) and f == int(f):
                return str(int(f))
            return str(f)
        except (TypeError, ValueError):
            s = _stringify_for_upsert_match_key(val)
            n = _normalize_reference_value(s)
            return None if _is_reference_empty_or_sentinel(n) else n

    if fts == FieldType.multi_reference.value or fts == "multi_reference":
        norms: list[str] = []
        for tok in coerce_multi_reference_raw(val):
            if isinstance(tok, dict):
                s = None
                for kk in ("label", "text", "value", "name"):
                    if kk in tok and tok[kk] is not None:
                        s = str(tok[kk])
                        break
                if s is None:
                    continue
            else:
                s = str(tok) if tok is not None else ""
            n = _normalize_reference_value(s)
            if not _is_reference_empty_or_sentinel(n):
                norms.append(n)
        if not norms:
            return None
        return "|".join(sorted(set(norms)))

    if fts == FieldType.date.value or fts == "date":
        if hasattr(val, "isoformat"):
            try:
                return val.isoformat()[:10]
            except Exception:
                pass
        t = _stringify_for_upsert_match_key(val)
        return t[:10] if t else None

    s = _stringify_for_upsert_match_key(val)
    n = _normalize_reference_value(s)
    if _is_reference_empty_or_sentinel(n):
        return None
    if fts == FieldType.reference.value or fts == "reference":
        return n.casefold()
    return n


def _upsert_merge_multi_line_items(
    existing_rows: list,
    incoming_rows: list[dict],
    match_key: str,
    match_field_type: FieldType | str | None,
) -> tuple[list, int, int]:
    """
    Merge incoming rows into existing by match_key (first existing row with same normalized key wins).
    Returns (new_rows, rows_updated, rows_added).
    """
    out: list = [dict(r) if isinstance(r, dict) else r for r in existing_rows]
    rows_updated = 0
    rows_added = 0
    sig_to_index: dict[str, int] = {}
    for i, row in enumerate(out):
        if not isinstance(row, dict):
            continue
        sig = _normalize_upsert_match_value(row.get(match_key), match_field_type)
        if sig is None:
            continue
        if sig not in sig_to_index:
            sig_to_index[sig] = i

    for inc in incoming_rows:
        if not isinstance(inc, dict):
            continue
        if _is_multi_items_row_effectively_empty(inc):
            continue
        sig = _normalize_upsert_match_value(inc.get(match_key), match_field_type)
        if sig is None:
            out.append(dict(inc))
            rows_added += 1
            continue
        idx = sig_to_index.get(sig)
        if idx is not None:
            base = out[idx]
            if isinstance(base, dict):
                out[idx] = {**base, **inc}
                rows_updated += 1
        else:
            out.append(dict(inc))
            rows_added += 1
            sig_to_index[sig] = len(out) - 1

    return out, rows_updated, rows_added


def _is_multi_items_row_effectively_empty(item: dict) -> bool:
    """True if the row has no meaningful data (skip template blank rows, whitespace-only cells)."""
    if not item:
        return True
    for v in item.values():
        if v is None:
            continue
        if isinstance(v, str):
            if v.strip() != "":
                return False
        elif isinstance(v, list):
            if len(v) > 0:
                return False
        else:
            return False
    return True


def parse_upsert_match_keys_json(raw: str | None) -> dict[str, str] | None:
    """Parse query/body JSON: parent multi_line field key -> sub_field key for KPI or entry sync upsert."""
    if raw is None or not str(raw).strip():
        return None
    try:
        d = json.loads(raw)
        if not isinstance(d, dict):
            return None
        out = {str(k).strip(): str(v).strip() for k, v in d.items() if str(k).strip() and str(v).strip()}
        return out or None
    except (json.JSONDecodeError, TypeError):
        return None


async def _get_entry(db: AsyncSession, entry_id: int, org_id: int) -> KPIEntry | None:
    """Get entry by id and organization (one entry per org/kpi/year)."""
    result = await db.execute(
        select(KPIEntry).where(
            KPIEntry.id == entry_id,
            KPIEntry.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def _get_entry_admin(db: AsyncSession, entry_id: int, org_id: int) -> KPIEntry | None:
    """Alias for consistency; same as _get_entry (org-scoped)."""
    return await _get_entry(db, entry_id, org_id)


async def _copy_carry_forward_from_previous(
    db: AsyncSession, org_id: int, kpi_id: int, new_entry: KPIEntry, year: int, period_key: str
) -> None:
    """If KPI or any field has carry_forward_data, copy values from the most recent previous period's entry."""
    kpi_res = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id, KPI.organization_id == org_id)
        .options(selectinload(KPI.fields))
    )
    kpi = kpi_res.scalar_one_or_none()
    if not kpi:
        return
    org = await db.get(Organization, org_id)
    if not org:
        return
    org_td_raw = getattr(org, "time_dimension", None) or "yearly"
    kpi_td_raw = getattr(kpi, "time_dimension", None)
    try:
        org_td = TimeDimension(org_td_raw)
    except ValueError:
        org_td = TimeDimension.YEARLY
    kpi_td = None
    if kpi_td_raw:
        try:
            kpi_td = TimeDimension(kpi_td_raw)
        except ValueError:
            pass
    dimension = effective_kpi_time_dimension(kpi_td, org_td)
    kpi_carry = getattr(kpi, "carry_forward_data", False) or False
    carry_field_ids = set()
    for f in kpi.fields or []:
        if f.field_type == FieldType.formula:
            continue
        if kpi_carry or getattr(f, "carry_forward_data", False):
            carry_field_ids.add(f.id)
    if not carry_field_ids:
        return
    prev = _previous_period(year, period_key, dimension)
    while prev:
        pyear, ppk = prev
        prev_res = await db.execute(
            select(KPIEntry)
            .where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == kpi_id,
                KPIEntry.year == pyear,
                KPIEntry.period_key == ppk,
            )
            .options(selectinload(KPIEntry.field_values))
        )
        prev_entry = prev_res.scalar_one_or_none()
        if prev_entry and prev_entry.field_values:
            for fv in prev_entry.field_values:
                if fv.field_id not in carry_field_ids:
                    continue
                new_fv = KPIFieldValue(entry_id=new_entry.id, field_id=fv.field_id)
                new_fv.value_text = fv.value_text
                new_fv.value_number = fv.value_number
                new_fv.value_boolean = fv.value_boolean
                new_fv.value_date = fv.value_date
                new_fv.value_json = fv.value_json
                db.add(new_fv)
            await db.flush()
            return
        prev = _previous_period(pyear, ppk, dimension)


async def _copy_entry_values(db: AsyncSession, src_id: int, dest_id: int) -> None:
    from app.core.models import KPIFieldValue, KpiMultiLineRow, KpiMultiLineCell, KpiMultiLineRowAccess, KpiFile
    
    # 1. Copy scalar values
    scalar_res = await db.execute(
        select(KPIFieldValue).where(KPIFieldValue.entry_id == src_id)
    )
    for fv in scalar_res.scalars().all():
        new_fv = KPIFieldValue(
            entry_id=dest_id,
            field_id=fv.field_id,
            value_text=fv.value_text,
            value_number=fv.value_number,
            value_json=fv.value_json,
            value_boolean=fv.value_boolean,
            value_date=fv.value_date
        )
        db.add(new_fv)
        
    # 2. Copy MLI rows
    mli_rows_res = await db.execute(
        select(KpiMultiLineRow)
        .where(KpiMultiLineRow.entry_id == src_id)
        .options(selectinload(KpiMultiLineRow.cells))
    )
    for r in mli_rows_res.scalars().all():
        new_r = KpiMultiLineRow(
            entry_id=dest_id,
            field_id=r.field_id,
            row_index=r.row_index,
            search_text=r.search_text
        )
        db.add(new_r)
        await db.flush()
        
        for c in r.cells:
            new_c = KpiMultiLineCell(
                row_id=new_r.id,
                sub_field_id=c.sub_field_id,
                value_text=c.value_text,
                value_number=c.value_number,
                value_json=c.value_json,
                value_boolean=c.value_boolean,
                value_date=c.value_date
            )
            db.add(new_c)

    # 3. Copy row access records
    access_res = await db.execute(
        select(KpiMultiLineRowAccess).where(KpiMultiLineRowAccess.entry_id == src_id)
    )
    for ra in access_res.scalars().all():
        new_ra = KpiMultiLineRowAccess(
            user_id=ra.user_id,
            entry_id=dest_id,
            field_id=ra.field_id,
            row_index=ra.row_index,
            can_edit=ra.can_edit,
            can_delete=ra.can_delete
        )
        db.add(new_ra)

    # 4. Copy KPI files
    files_res = await db.execute(
        select(KpiFile).where(KpiFile.entry_id == src_id)
    )
    for f in files_res.scalars().all():
        new_f = KpiFile(
            kpi_id=f.kpi_id,
            organization_id=f.organization_id,
            year=f.year,
            entry_id=dest_id,
            original_filename=f.original_filename,
            stored_path=f.stored_path,
            content_type=f.content_type,
            size=f.size,
            uploaded_by_user_id=f.uploaded_by_user_id
        )
        db.add(new_f)
            
    await db.flush()


def mark_entry_modified(entry: KPIEntry, user_id: int) -> None:
    entry.last_modified_at = datetime.utcnow()
    entry.last_modified_by_user_id = user_id
    entry.user_id = user_id
    entry.updated_at = datetime.utcnow()
    
    if entry.is_draft:
        if entry.submitted_at is not None:
            entry.is_modified_after_submission = True


async def get_or_create_entry(
    db: AsyncSession, user_id: int, org_id: int, kpi_id: int, year: int, period_key: str = ""
) -> tuple[KPIEntry | None, bool]:
    """Get existing entry or create new one (one per organization per KPI per year per period_key). Returns (entry, created)."""
    pk = (period_key or "").strip()[:8]
    
    # Check edit access
    can_edit = await user_can_edit_kpi(db, user_id, kpi_id, org_id)
    
    if can_edit:
        # User is editor: load or create their private draft
        result = await db.execute(
            select(KPIEntry).where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == kpi_id,
                KPIEntry.year == year,
                KPIEntry.period_key == pk,
                KPIEntry.is_draft == True,
                KPIEntry.user_id == user_id,
            )
        )
        entry = result.scalar_one_or_none()
        if entry:
            return entry, False
            
        # Check if a published version exists
        pub_result = await db.execute(
            select(KPIEntry).where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == kpi_id,
                KPIEntry.year == year,
                KPIEntry.period_key == pk,
                KPIEntry.is_draft == False,
            )
        )
        pub_entry = pub_result.scalar_one_or_none()
        
        # Verify KPI belongs to org
        kpi_org = await _resolve_org_and_kpi(db, kpi_id)
        if kpi_org != org_id:
            return None, False
            
        # Create private draft
        entry = KPIEntry(
            organization_id=org_id,
            kpi_id=kpi_id,
            user_id=user_id,
            year=year,
            period_key=pk,
            is_draft=True,
            is_modified_after_submission=False,
        )
        db.add(entry)
        await db.flush()
        
        if pub_entry:
            # Copy all values from published version to this new draft
            await _copy_entry_values(db, pub_entry.id, entry.id)
            entry.submitted_at = pub_entry.submitted_at
            entry.submitted_by_user_id = pub_entry.submitted_by_user_id
            entry.is_modified_after_submission = False
            await db.flush()
            return entry, True
        else:
            # Copy carry-forward from previous period
            await _copy_carry_forward_from_previous(db, org_id, kpi_id, entry, year, pk)
            return entry, True
    else:
        # User is view-only: retrieve published version
        pub_result = await db.execute(
            select(KPIEntry).where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == kpi_id,
                KPIEntry.year == year,
                KPIEntry.period_key == pk,
                KPIEntry.is_draft == False,
            )
        )
        pub_entry = pub_result.scalar_one_or_none()
        return pub_entry, False


def _assignment_type_value(a) -> str:
    """Return assignment_type as string (handles enum or string column)."""
    t = getattr(a, "assignment_type", None)
    if t is None:
        return "data_entry"
    return t.value if hasattr(t, "value") else str(t)


async def can_view_kpi_for_user(
    db: AsyncSession, user: User, kpi_id: int, org_id: int | None = None
) -> bool:
    """
    Check if the given (already-loaded) user can view the KPI.
    Avoids a redundant SELECT on `users` (use with User from get_current_user).
    """
    if not user or user.id is None:
        return False
    user_id = int(user.id)
    if user.role.value == "SUPER_ADMIN":
        return True
    if user.role.value == "ORG_ADMIN":
        kpi_res = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
        kpi_org = kpi_res.scalar_one_or_none()
        if kpi_org is None:
            return False
        effective_org = org_id if org_id is not None else getattr(user, "organization_id", None)
        return effective_org is not None and kpi_org == effective_org
    kpi_role_res = await db.execute(
        select(KpiRoleAssignment)
        .join(
            UserOrganizationRole,
            UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id,
        )
        .where(
            UserOrganizationRole.user_id == user_id,
            KpiRoleAssignment.kpi_id == kpi_id,
        )
    )
    if kpi_role_res.scalar_one_or_none() is not None:
        return True
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if not access_map:
        return False
    return any(perm in ("view", "data_entry") for perm in access_map.values())


async def user_can_view_kpi(
    db: AsyncSession, user_id: int, kpi_id: int, org_id: int | None = None
) -> bool:
    """Check if user can view KPI.

    - SUPER_ADMIN: full access.
    - ORG_ADMIN: full access within their organization (ignores assignments).
    - Other users: no implicit access; visibility is based on organization roles:
        * KPI-level role assignments (KpiRoleAssignment) with view/data_entry, OR
        * Field-level role access (KpiFieldAccessByRole) that grants at least view to any field.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    u = result.scalar_one_or_none()
    if not u:
        return False
    return await can_view_kpi_for_user(db, u, kpi_id, org_id=org_id)


async def user_can_edit_kpi(
    db: AsyncSession, user_id: int, kpi_id: int, org_id: int | None = None
) -> bool:
    """Check if user can edit KPI.

    - SUPER_ADMIN: full access.
    - ORG_ADMIN: full access within their organization (ignores assignments).
    - Other users: no implicit access; edit permission is based on organization roles:
        * KPI-level role assignments with data_entry, OR
        * Field-level role access (via roles) that grants data_entry to at least one field.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    if user.role.value == "SUPER_ADMIN":
        return True
    if user.role.value == "ORG_ADMIN":
        kpi_res = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
        kpi_org = kpi_res.scalar_one_or_none()
        if kpi_org is None:
            return False
        effective_org = org_id if org_id is not None else getattr(user, "organization_id", None)
        return effective_org is not None and kpi_org == effective_org
    # Non-admins: derive edit permission from role-based KPI/field access only
    # 1) KPI-level role assignment with data_entry?
    kpi_role_res = await db.execute(
        select(KpiRoleAssignment)
        .join(
            UserOrganizationRole,
            UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id,
        )
        .where(
            UserOrganizationRole.user_id == user_id,
            KpiRoleAssignment.kpi_id == kpi_id,
            KpiRoleAssignment.assignment_type == "data_entry",
        )
    )
    if kpi_role_res.scalar_one_or_none() is not None:
        return True
    # 2) Any field-level role access that grants data_entry?
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if not access_map:
        return False
    return any(perm == "data_entry" for perm in access_map.values())


def _merge_access_type(current: str | None, incoming: str) -> str:
    """
    Merge access. Strength order: data_entry > add_row > view.
    Return the stronger of current and incoming.
    """
    if not current:
        return incoming
    order = {"view": 1, "add_row": 2, "data_entry": 3}
    return incoming if order.get(incoming, 0) > order.get(current, 0) else current


async def get_user_field_access_for_kpi(
    db: AsyncSession, user_id: int, kpi_id: int
) -> dict[tuple[int, int | None], str] | None:
    """
    Get field-level access for user on KPI (user direct + role-based with KPI-level inheritance).
    Returns None if no field-level rows exist (use KPI-level assignment for all fields).
    Otherwise returns map (field_id, sub_field_id) -> "view" | "add_row" | "data_entry".
    By default role's field-level access inherits KPI-level; explicit KpiFieldAccessByRole overrides.
    Direct KpiFieldAccess rows for this user are merged last (same strength rules), e.g. per-user Add Row.
    Org admin and super admin always get full access (return None so callers use KPI-level = full).
    """
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if user and user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return None  # Full access to all KPIs and subfields; callers use KPI-level permission
    out: dict[tuple[int, int | None], str] = {}
    # User's roles that are assigned to this KPI (with KPI-level permission)
    role_assignments_res = await db.execute(
        select(KpiRoleAssignment.organization_role_id, KpiRoleAssignment.assignment_type)
        .join(UserOrganizationRole, UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id)
        .where(
            UserOrganizationRole.user_id == user_id,
            KpiRoleAssignment.kpi_id == kpi_id,
        )
    )
    role_kpi_perms: list[tuple[int, str]] = []
    for row in role_assignments_res.all():
        perm = row[1].value if hasattr(row[1], "value") else str(row[1] or "data_entry")
        p = perm.strip().lower()
        if p not in ("view", "data_entry", "add_row"):
            p = "data_entry"
        role_kpi_perms.append((row[0], p))
    # All roles the user belongs to (for explicit field-level KpiFieldAccessByRole)
    user_roles_res = await db.execute(
        select(UserOrganizationRole.organization_role_id).where(
            UserOrganizationRole.user_id == user_id
        )
    )
    user_role_ids = [row[0] for row in user_roles_res.all()]
    # Explicit field-level by role (for any role the user belongs to)
    role_access_res = await db.execute(
        select(
            KpiFieldAccessByRole.organization_role_id,
            KpiFieldAccessByRole.field_id,
            KpiFieldAccessByRole.sub_field_id,
            KpiFieldAccessByRole.access_type,
        ).where(
            KpiFieldAccessByRole.kpi_id == kpi_id,
            KpiFieldAccessByRole.organization_role_id.in_(user_role_ids),
        )
    )
    role_perm_by_key: dict[tuple[int, int, int | None], str] = {}
    for r in role_access_res.all():
        perm = r[3].value if hasattr(r[3], "value") else str(r[3] or "data_entry")
        p = perm.strip().lower()
        if p not in ("view", "data_entry", "add_row"):
            p = "data_entry"
        role_perm_by_key[(r[0], r[1], r[2])] = p
    # Load all fields and subfields for this KPI to apply inherited KPI-level where applicable
    fields_res = await db.execute(
        select(KPIField)
        .where(KPIField.kpi_id == kpi_id)
        .options(selectinload(KPIField.sub_fields))
    )
    fields = list(fields_res.scalars().all())
    if role_kpi_perms:
        # Helper to choose most restrictive between KPI-level and field-level for same role+field
        def _most_restrictive(kpi_perm: str | None, field_perm: str | None) -> str | None:
            if not kpi_perm and not field_perm:
                return None
            if kpi_perm and not field_perm:
                return kpi_perm
            if field_perm and not kpi_perm:
                return field_perm
            # both present: most restrictive → view < add_row < data_entry
            order = {"view": 1, "add_row": 2, "data_entry": 3}
            if order.get(kpi_perm or "", 0) <= order.get(field_perm or "", 0):
                return kpi_perm
            return field_perm

        for f in fields:
            sub_fields = getattr(f, "sub_fields", None) or []
            is_multi = getattr(f, "field_type", None) == FieldType.multi_line_items
            if is_multi and sub_fields:
                for s in sub_fields:
                    key = (f.id, s.id)
                    for rid, kpi_perm in role_kpi_perms:
                        explicit = role_perm_by_key.get((rid, f.id, s.id))
                        merged = _most_restrictive(kpi_perm, explicit)
                        if merged:
                            out[key] = _merge_access_type(out.get(key), merged)
                key_whole = (f.id, None)
                for rid, kpi_perm in role_kpi_perms:
                    explicit = role_perm_by_key.get((rid, f.id, None))
                    merged = _most_restrictive(kpi_perm, explicit)
                    if merged:
                        out[key_whole] = _merge_access_type(out.get(key_whole), merged)
            else:
                key = (f.id, None)
                for rid, kpi_perm in role_kpi_perms:
                    explicit = role_perm_by_key.get((rid, f.id, None))
                    merged = _most_restrictive(kpi_perm, explicit)
                    if merged:
                        out[key] = _merge_access_type(out.get(key), merged)
    # Apply any explicit field-level role permissions even when there is no KPI-level role assignment
    if role_perm_by_key:
        for (_rid, field_id, sub_field_id), perm in role_perm_by_key.items():
            key = (field_id, sub_field_id)
            out[key] = _merge_access_type(out.get(key), perm)
    # Direct per-user rows (KpiFieldAccess), e.g. Add Row from Security tab — not derivable from roles alone
    user_direct_res = await db.execute(
        select(
            KpiFieldAccess.field_id,
            KpiFieldAccess.sub_field_id,
            KpiFieldAccess.access_type,
        ).where(
            KpiFieldAccess.kpi_id == kpi_id,
            KpiFieldAccess.user_id == user_id,
        )
    )
    for r in user_direct_res.all():
        at_raw = r[2]
        at = (at_raw.value if hasattr(at_raw, "value") else str(at_raw or "data_entry")).strip().lower()
        if at not in ("view", "data_entry", "add_row"):
            at = "data_entry"
        key = (r[0], r[1])
        out[key] = _merge_access_type(out.get(key), at)
    if not out:
        return None
    return out


async def user_can_view_field(
    db: AsyncSession, user_id: int, kpi_id: int, field_id: int, sub_field_id: int | None = None
) -> bool:
    """True if user can view this field (or sub_field). Org/super admin: True. Else field-level or KPI-level."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if access_map is None:
        return await user_can_view_kpi(db, user_id, kpi_id)
    perm = access_map.get((field_id, sub_field_id)) or access_map.get((field_id, None))
    return perm in ("view", "add_row", "data_entry")


async def user_can_edit_field(
    db: AsyncSession, user_id: int, kpi_id: int, field_id: int, sub_field_id: int | None = None
) -> bool:
    """True if user can edit this field (or sub_field)."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if sub_field_id is not None:
        from app.core.models import KPIFieldSubField
        sf_res = await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.id == sub_field_id))
        sf = sf_res.scalar_one_or_none()
        if sf:
            sf_type_s = sf.field_type.value if hasattr(sf.field_type, "value") else str(sf.field_type)
            if sf_type_s == "formula":
                return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if access_map is None:
        return await user_can_edit_kpi(db, user_id, kpi_id)
    perm = access_map.get((field_id, sub_field_id)) or access_map.get((field_id, None))
    return perm == "data_entry"


async def user_can_add_row_multi_line_field(
    db: AsyncSession, user_id: int, kpi_id: int, field_id: int
) -> bool:
    """
    True if user can add a new row to a specific multi_line_items field.
    This is an explicit permission separate from edit/delete.

    Important: merged field access treats whole-field data_entry as stronger than add_row, so users
    with KPI-level or whole-field edit plus an Add Row grant in Security would lose add_row in the
    combined map. We therefore check explicit add_row rows (and role whole-field add_row) directly.
    """
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True

    # Per-user Add Row from Security tab (KpiFieldAccess) — independent of merged map strength order
    direct_res = await db.execute(
        select(KpiFieldAccess.id).where(
            KpiFieldAccess.kpi_id == kpi_id,
            KpiFieldAccess.user_id == user_id,
            KpiFieldAccess.field_id == field_id,
            KpiFieldAccess.sub_field_id.is_(None),
            KpiFieldAccess.access_type == "add_row",
        ).limit(1)
    )
    if direct_res.scalar_one_or_none() is not None:
        return True

    # Whole-field add_row on any of the user's org roles (same idea: do not rely on merge)
    user_roles_res = await db.execute(
        select(UserOrganizationRole.organization_role_id).where(UserOrganizationRole.user_id == user_id)
    )
    role_ids = [row[0] for row in user_roles_res.all()]
    if role_ids:
        role_add_res = await db.execute(
            select(KpiFieldAccessByRole.id).where(
                KpiFieldAccessByRole.kpi_id == kpi_id,
                KpiFieldAccessByRole.organization_role_id.in_(role_ids),
                KpiFieldAccessByRole.field_id == field_id,
                KpiFieldAccessByRole.sub_field_id.is_(None),
                KpiFieldAccessByRole.access_type == "add_row",
            ).limit(1)
        )
        if role_add_res.scalar_one_or_none() is not None:
            return True

    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if access_map is None:
        return False
    return access_map.get((field_id, None)) == "add_row"


def _user_can_edit_sub_field(access_map: dict | None, field_id: int, sub_field_id: int | None) -> bool:
    """Given access_map from get_user_field_access_for_kpi, return True if user can edit (field_id, sub_field_id)."""
    if access_map is None:
        return False
    perm = access_map.get((field_id, sub_field_id)) or access_map.get((field_id, None))
    return perm == "data_entry"


async def user_can_edit_multi_line_field(
    db: AsyncSession, user_id: int, kpi_id: int, field: "KPIField"
) -> bool:
    """True if user can edit this multi_line_items field (whole-field or at least one sub_field)."""
    if await user_can_edit_field(db, user_id, kpi_id, field.id, None):
        return True
    for sub in getattr(field, "sub_fields", None) or []:
        if await user_can_edit_field(db, user_id, kpi_id, field.id, getattr(sub, "id", None)):
            return True
    return False


async def user_can_edit_row(
    db: AsyncSession, user_id: int, entry_id: int, field_id: int, row_index: int
) -> bool:
    """True if user can edit this specific row. When row_level_user_access_enabled is False, all rows follow role/field access; when True, row-level user access is enforced."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    # Load field to check row_level_user_access_enabled
    entry_res = await db.execute(select(KPIEntry).where(KPIEntry.id == entry_id))
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return False
    field_res = await db.execute(
        select(KPIField)
        .where(KPIField.id == field_id, KPIField.kpi_id == entry.kpi_id)
        .options(selectinload(KPIField.sub_fields))
    )
    field = field_res.scalar_one_or_none()
    if field and not getattr(field, "row_level_user_access_enabled", False):
        # Row-level user access not enabled: all rows follow role/field access
        if field.field_type == FieldType.multi_line_items:
            return await user_can_edit_multi_line_field(db, user_id, entry.kpi_id, field)
        return await user_can_edit_field(db, user_id, entry.kpi_id, field_id, None)
    # Row-level user access enabled: check KpiMultiLineRowAccess
    row_res = await db.execute(
        select(KpiMultiLineRowAccess).where(
            KpiMultiLineRowAccess.user_id == user_id,
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    row_rules = row_res.scalars().all()
    if not row_rules:
        # Row-level access is enforced: without explicit rules, user is readonly.
        return False
    for r in row_rules:
        if r.row_index == row_index and r.can_edit:
            return True
    return False


async def user_can_delete_row(
    db: AsyncSession, user_id: int, entry_id: int, field_id: int, row_index: int
) -> bool:
    """True if user can delete this specific row. When row_level_user_access_enabled is False, all rows follow role/field access; when True, row-level user access is enforced."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    entry_res = await db.execute(select(KPIEntry).where(KPIEntry.id == entry_id))
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return False
    field_res = await db.execute(
        select(KPIField).where(KPIField.id == field_id, KPIField.kpi_id == entry.kpi_id)
    )
    field = field_res.scalar_one_or_none()
    if field and not getattr(field, "row_level_user_access_enabled", False):
        return await user_can_edit_field(db, user_id, entry.kpi_id, field_id, None)
    row_res = await db.execute(
        select(KpiMultiLineRowAccess).where(
            KpiMultiLineRowAccess.user_id == user_id,
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    row_rules = row_res.scalars().all()
    if not row_rules:
        # Row-level access is enforced: without explicit rules, user is readonly.
        return False
    for r in row_rules:
        if r.row_index == row_index and r.can_delete:
            return True
    return False


async def get_user_row_edit_map(
    db: AsyncSession, user_id: int, entry_id: int, field_id: int
) -> dict[int, bool]:
    """Batch-load {row_index: can_edit} from KpiMultiLineRowAccess for one user/entry/field (single query).

    Used to determine both row *visibility* (row-level access enabled ⇒ only rows with an
    access record are visible, mirroring list_multi_items_rows) and per-row edit rights,
    without the N+1 cost of calling user_can_edit_row() once per row.
    """
    res = await db.execute(
        select(KpiMultiLineRowAccess.row_index, KpiMultiLineRowAccess.can_edit).where(
            KpiMultiLineRowAccess.user_id == user_id,
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    return {int(row_index): bool(can_edit) for row_index, can_edit in res.all()}


async def user_can_export_multi_line_field(
    db: AsyncSession, user_id: int, kpi_id: int, entry_id: int, field: "KPIField"
) -> bool:
    """True if the user may export this multi_line_items field's rows.

    - Org/Super admin: always allowed.
    - Row-level access not enabled: same as whole-field/KPI edit permission.
    - Row-level access enabled: requires edit rights on at least one row for this entry+field.
    """
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    if not getattr(field, "row_level_user_access_enabled", False):
        return await user_can_edit_multi_line_field(db, user_id, kpi_id, field)
    row_edit_map = await get_user_row_edit_map(db, user_id, entry_id, field.id)
    return any(row_edit_map.values())


async def _load_other_kpi_values(
    db: AsyncSession, year: int, org_id: int, exclude_kpi_id: int, period_key: str | None = None, is_draft: bool | None = None
) -> OtherKpiValues:
    """Load numeric field values from org's entries for other KPIs (same org, same year)."""
    out: OtherKpiValues = {}
    q = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.year == year,
            KPIEntry.kpi_id != exclude_kpi_id,
        )
    )
    if period_key is not None:
        q = q.where(KPIEntry.period_key == period_key)
    q = q.options(selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field))
    
    res = await db.execute(q)
    entries = list(res.scalars().all())
    
    from collections import defaultdict
    kpi_entries = defaultdict(list)
    for entry in entries:
        kpi_entries[entry.kpi_id].append(entry)
        
    for kid, entries_list in kpi_entries.items():
        selected_entry = None
        if is_draft is not None:
            selected_entry = next((e for e in entries_list if e.is_draft == is_draft), None)
        if selected_entry is None:
            selected_entry = next((e for e in entries_list if e.is_draft), entries_list[0])
            
        for fv in selected_entry.field_values or []:
            if not fv.field or fv.value_number is None:
                continue
            if fv.field.field_type not in (FieldType.number, FieldType.formula):
                continue
            try:
                out[(kid, fv.field.key)] = float(fv.value_number)
            except (TypeError, ValueError):
                pass
    return out


def _is_subfield_satisfied_for_row(sf, row: dict, key_to_sf: dict) -> bool:
    """Check if a subfield's visibility condition is satisfied for a given row dict."""
    from app.fields.conditional import is_subfield_visible
    return is_subfield_visible(sf, key_to_sf, row)

async def save_entry_values(
    db: AsyncSession,
    entry_id: int,
    user_id: int,
    values: list[FieldValueInput],
    kpi_id: int,
    org_id: int,
) -> KPIEntry | None:
    """Save or update field values for entry; evaluate formula fields."""
    entry = await _get_entry(db, entry_id, org_id)
    if not entry or entry.kpi_id != kpi_id or entry.is_locked:
        return None
    # Load KPI and fields (with sub_fields for multi_line_items formula support)
    result = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id)
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi = result.scalar_one_or_none()
    if not kpi:
        return None
    key_to_field = {f.key: f for f in kpi.fields}
    validation_errors: list[dict] = []

    # Construct merged state to check visibility
    scalar_vals_res = await db.execute(
        select(KPIFieldValue).where(KPIFieldValue.entry_id == entry_id)
    )
    existing_vals = scalar_vals_res.scalars().all()
    existing_values_dict = {fv.field_id: fv for fv in existing_vals}

    class TempVal:
        def __init__(self, vb, vn, vt, vd, vj):
            self.value_boolean = vb
            self.value_number = vn
            self.value_text = vt
            self.value_date = vd
            self.value_json = vj

    merged_values_dict = {**existing_values_dict}
    for v in values:
        coerced_date = None
        if v.value_date is not None:
            if isinstance(v.value_date, datetime):
                coerced_date = v.value_date
            elif isinstance(v.value_date, str):
                try:
                    s = v.value_date.strip()
                    if s:
                        coerced_date = datetime.fromisoformat(s.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass
        merged_values_dict[v.field_id] = TempVal(
            v.value_boolean, v.value_number, v.value_text, coerced_date, v.value_json
        )

    from app.fields.conditional import is_field_visible
    fields_dict = {f.id: f for f in kpi.fields}
    filtered_values = []
    for v in values:
        f = fields_dict.get(v.field_id)
        if f:
            if is_field_visible(f, fields_dict, merged_values_dict):
                filtered_values.append(v)
        else:
            filtered_values.append(v)
    values = filtered_values

    # Field-level access for merging multi_line_items by editable columns
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)

    # Reference field validation (scalar and inside multi_line_items)
    for v in values:
        f = next((x for x in kpi.fields if x.id == v.field_id), None)
        if not f:
            continue
        if f.field_type == FieldType.mixed_list:
            # Accept value_text (semicolon separated), value_json (list), or raw scalars; store in value_json only.
            raw_in = v.value_json if v.value_json is not None else v.value_text
            coerced = coerce_mixed_list_raw(raw_in)
            v.value_text = None
            v.value_json = coerced if coerced else None
            continue
        if f.field_type == FieldType.reference:
            config = getattr(f, "config", None) or {}
            sid = config.get("reference_source_kpi_id")
            skey = config.get("reference_source_field_key")
            sub_key = config.get("reference_source_sub_field_key")
            if sid and skey:
                allowed = await get_reference_allowed_values(db, int(sid), str(skey), org_id, source_sub_field_key=sub_key)
                allowed_normalized = {_normalize_reference_value(a) for a in allowed}
                raw = (v.value_text or "").strip()
                normalized = _normalize_reference_value(v.value_text)
                if not _is_reference_empty_or_sentinel(normalized):
                    # If mapping can't be resolved (no allowed values), or if the submitted value
                    # isn't found in the resolved reference list, coerce it to null instead of failing.
                    if not allowed_normalized or normalized not in allowed_normalized:
                        v.value_text = None
        elif f.field_type == FieldType.multi_reference:
            config = getattr(f, "config", None) or {}
            sid = config.get("reference_source_kpi_id")
            skey = config.get("reference_source_field_key")
            sub_key = config.get("reference_source_sub_field_key")
            v.value_text = None
            if sid and skey:
                allowed = await get_reference_allowed_values(db, int(sid), str(skey), org_id, source_sub_field_key=sub_key)
                if not allowed:
                    v.value_json = None
                else:
                    cleaned = filter_multi_reference_to_allowed(
                        v.value_json if v.value_json is not None else v.value_text,
                        allowed,
                    )
                    v.value_json = cleaned if cleaned else None
            else:
                v.value_json = None
        elif f.field_type == FieldType.multi_line_items and isinstance(v.value_json, list):
            for sub in getattr(f, "sub_fields", []) or []:
                ft = getattr(sub, "field_type", None)
                config = getattr(sub, "config", None) or {}
                sid = config.get("reference_source_kpi_id")
                skey = config.get("reference_source_field_key")
                sub_key = config.get("reference_source_sub_field_key")
                if not sid or not skey:
                    # Still allow normalization for non-reference types.
                    if ft == FieldType.mixed_list:
                        for row in v.value_json:
                            if not isinstance(row, dict):
                                continue
                            row[sub.key] = coerce_mixed_list_raw(row.get(sub.key)) or None
                    continue
                if ft == FieldType.reference:
                    allowed = await get_reference_allowed_values(db, int(sid), str(skey), org_id, source_sub_field_key=sub_key)
                    allowed_normalized = {_normalize_reference_value(a) for a in allowed}
                    for row in v.value_json:
                        if not isinstance(row, dict):
                            continue
                        cell = row.get(sub.key)
                        raw = cell if isinstance(cell, str) else str(cell) if cell is not None else ""
                        normalized = _normalize_reference_value(raw)
                        if not _is_reference_empty_or_sentinel(normalized):
                            if not allowed_normalized or normalized not in allowed_normalized:
                                row[sub.key] = None
                elif ft == FieldType.multi_reference:
                    allowed = await get_reference_allowed_values(db, int(sid), str(skey), org_id, source_sub_field_key=sub_key)
                    if not allowed:
                        for row in v.value_json:
                            if isinstance(row, dict) and sub.key in row:
                                row[sub.key] = None
                        continue
                    for row in v.value_json:
                        if not isinstance(row, dict):
                            continue
                        cell = row.get(sub.key)
                        cleaned = filter_multi_reference_to_allowed(cell, allowed)
                        row[sub.key] = cleaned if cleaned else None
                elif ft == FieldType.mixed_list:
                    for row in v.value_json:
                        if not isinstance(row, dict):
                            continue
                        row[sub.key] = coerce_mixed_list_raw(row.get(sub.key)) or None

    if validation_errors:
        raise EntryValidationError(validation_errors)

    value_by_key: dict[str, float | int] = {}
    multi_line_items_data: MultiLineItemsData = {}
    for v in values:
        f = next((x for x in kpi.fields if x.id == v.field_id), None)
        if not f:
            continue
        if f.field_type == FieldType.formula:
            continue  # computed below
        res_fvs = (
            await db.execute(
                select(KPIFieldValue).where(
                    KPIFieldValue.entry_id == entry_id,
                    KPIFieldValue.field_id == v.field_id,
                )
            )
        ).scalars().all()
        if len(res_fvs) > 1:
            for dup in res_fvs[1:]:
                await db.delete(dup)
        fv = res_fvs[0] if res_fvs else None
        num_val = None
        if v.value_number is not None:
            num_val = float(v.value_number) if not isinstance(v.value_number, (int, float)) else v.value_number
        if f.field_type == FieldType.number and num_val is not None:
            value_by_key[f.key] = num_val
        if fv is None:
            fv = KPIFieldValue(entry_id=entry_id, field_id=v.field_id)
            db.add(fv)
        fv.value_text = v.value_text
        fv.value_number = v.value_number
        if f.field_type == FieldType.multi_line_items and isinstance(v.value_json, list):
            multi_line_items_data[f.key] = v.value_json

            existing_list = await load_multi_line_items_rows(db, entry_id=entry_id, field=f)
            merged_rows: list[dict] = []
            sub_fields = getattr(f, "sub_fields", None) or []
            for i, inc_row in enumerate(v.value_json):
                inc_row = inc_row if isinstance(inc_row, dict) else {}
                exist_row = existing_list[i] if i < len(existing_list) and isinstance(existing_list[i], dict) else {}
                new_row: dict = {}
                for sub in sub_fields:
                    sub_id = getattr(sub, "id", None)
                    sub_key = getattr(sub, "key", None)
                    if sub_key is None:
                        continue
                    sub_type_s = sub.field_type.value if hasattr(sub.field_type, "value") else str(sub.field_type)
                    if sub_type_s == "formula":
                        new_row[sub_key] = exist_row.get(sub_key)
                    elif access_map is None:
                        new_row[sub_key] = inc_row.get(sub_key)
                    elif _user_can_edit_sub_field(access_map, f.id, sub_id):
                        new_row[sub_key] = inc_row.get(sub_key)
                    else:
                        new_row[sub_key] = exist_row.get(sub_key)
                merged_rows.append(new_row)
            await replace_multi_line_items_rows(db, entry_id=entry_id, field=f, rows=merged_rows)
            # Do not store the potentially large multi-line JSON array in kpi_field_values.
            fv.value_json = None
        else:
            fv.value_json = v.value_json
        fv.value_boolean = v.value_boolean
        if v.value_date is not None:
            if isinstance(v.value_date, datetime):
                fv.value_date = v.value_date
            elif isinstance(v.value_date, str):
                try:
                    s = v.value_date.strip()
                    if s:
                        fv.value_date = datetime.fromisoformat(s.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass
            else:
                fv.value_date = None
        if num_val is not None:
            value_by_key[f.key] = num_val

    # Recompute MLI formula subfields before loading them for scalar formulas
    await recompute_mli_formula_subfields(db, entry_id=entry_id, org_id=org_id)

    # For multi_line_items not in request, use existing stored value
    for f in kpi.fields:
        if f.field_type != FieldType.multi_line_items or f.key in multi_line_items_data:
            if f.key in multi_line_items_data:
                multi_line_items_data[f.key] = await load_multi_line_items_rows(db, entry_id=entry_id, field=f)
            continue
        existing_rows = await load_multi_line_items_rows(db, entry_id=entry_id, field=f)
        if existing_rows:
            multi_line_items_data[f.key] = existing_rows

    # Other KPIs' numeric values for KPI_FIELD(kpi_id, field_key) in formulas
    other_kpi_values = await _load_other_kpi_values(
        db, entry.year, org_id, kpi_id, period_key=entry.period_key, is_draft=entry.is_draft
    )

    # Formula fields
    for f in kpi.fields:
        if f.field_type != FieldType.formula or not f.formula_expression:
            continue
        computed = evaluate_formula(
            f.formula_expression, value_by_key, multi_line_items_data, other_kpi_values
        )
        res_fvs = (
            await db.execute(
                select(KPIFieldValue).where(
                    KPIFieldValue.entry_id == entry_id,
                    KPIFieldValue.field_id == f.id,
                )
            )
        ).scalars().all()
        if len(res_fvs) > 1:
            for dup in res_fvs[1:]:
                await db.delete(dup)
        fv = res_fvs[0] if res_fvs else None
        if fv is None:
            fv = KPIFieldValue(entry_id=entry_id, field_id=f.id)
            db.add(fv)
        fv.value_number = computed
        if computed is not None:
            value_by_key[f.key] = computed

    mark_entry_modified(entry, user_id)
    await db.flush()
    return entry


async def recompute_formula_fields_for_entry(
    db: AsyncSession,
    *,
    entry_id: int,
    org_id: int,
) -> bool:
    """
    Recompute formula field values for a single entry.

    Needed when multi_line_items rows change via the multi-items endpoints (which don't go through save_entry_values),
    so formula cards don't become stale.
    Returns True if any formula field was processed.
    """
    entry = await _get_entry(db, entry_id, org_id)
    if not entry:
        return False

    # Load KPI + fields (include sub_fields so multi_line_items data can be used in formulas).
    result = await db.execute(
        select(KPI)
        .where(KPI.id == entry.kpi_id)
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi = result.scalar_one_or_none()
    if not kpi:
        return False

    fields = list(kpi.fields or [])

    # Recompute MLI formula subfields first (must happen even if there are no KPI-level formula fields)
    await recompute_mli_formula_subfields(db, entry_id=entry.id, org_id=org_id)

    formula_fields = [f for f in fields if f.field_type == FieldType.formula and (f.formula_expression or "").strip()]
    if not formula_fields:
        return True

    # Map field_id -> existing KPIFieldValue
    fv_res = await db.execute(
        select(KPIFieldValue)
        .where(KPIFieldValue.entry_id == entry.id)
        .options(selectinload(KPIFieldValue.field))
    )
    fv_list = list(fv_res.scalars().all())
    fv_by_field_id = {fv.field_id: fv for fv in fv_list}

    value_by_key: dict[str, float | int] = {}
    multi_line_items_data: MultiLineItemsData = {}

    # Seed numeric (and existing formula) values so formulas that reference earlier fields can chain.
    # Keep a stable evaluation order by sort_order then id.
    ordered_fields = sorted(fields, key=lambda f: (getattr(f, "sort_order", 0), getattr(f, "id", 0)))
    for f in ordered_fields:
        fv = fv_by_field_id.get(f.id)
        if f.field_type == FieldType.number and fv and fv.value_number is not None:
            try:
                value_by_key[f.key] = float(fv.value_number)
            except (TypeError, ValueError):
                pass
        elif f.field_type == FieldType.formula and fv and fv.value_number is not None:
            try:
                value_by_key[f.key] = float(fv.value_number)
            except (TypeError, ValueError):
                pass
        elif f.field_type == FieldType.multi_line_items:
            # Always load the current relational rows for this field.
            multi_line_items_data[f.key] = await load_multi_line_items_rows(db, entry_id=entry.id, field=f)

    other_kpi_values = await _load_other_kpi_values(
        db, entry.year, org_id, entry.kpi_id, period_key=entry.period_key, is_draft=entry.is_draft
    )

    # Compute + persist
    for f in ordered_fields:
        if f.field_type != FieldType.formula or not (f.formula_expression or "").strip():
            continue
        computed = evaluate_formula(
            f.formula_expression or "",
            value_by_key,
            multi_line_items_data,
            other_kpi_values,
        )
        fv = fv_by_field_id.get(f.id)
        if fv is None:
            fv = KPIFieldValue(entry_id=entry.id, field_id=f.id)
            db.add(fv)
            fv_by_field_id[f.id] = fv
        fv.value_number = computed
        if computed is not None:
            value_by_key[f.key] = computed

    entry.updated_at = datetime.utcnow()
    await db.flush()
    return True


async def recompute_formula_fields_for_kpi(
    db: AsyncSession,
    kpi_id: int,
    org_id: int,
) -> int:
    """
    Recompute all formula field values for all entries of a KPI.

    This is used when a formula definition changes so values refresh
    immediately without requiring a data-entry user to re-save entries.
    Returns number of entries processed.
    """
    kpi_res = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id, KPI.organization_id == org_id)
        .options(selectinload(KPI.fields))
    )
    kpi = kpi_res.scalar_one_or_none()
    if not kpi:
        return 0

    fields = sorted(list(kpi.fields or []), key=lambda f: (getattr(f, "sort_order", 0), getattr(f, "id", 0)))
    formula_fields = [f for f in fields if f.field_type == FieldType.formula and (f.formula_expression or "").strip()]
    if not formula_fields:
        return 0

    entries_res = await db.execute(
        select(KPIEntry)
        .where(KPIEntry.kpi_id == kpi_id, KPIEntry.organization_id == org_id)
        .options(selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field))
    )
    entries = list(entries_res.scalars().all())

    for entry in entries:
        fv_by_field_id = {fv.field_id: fv for fv in (entry.field_values or [])}
        value_by_key: dict[str, float | int] = {}
        multi_line_items_data: MultiLineItemsData = {}

        for f in fields:
            fv = fv_by_field_id.get(f.id)
            if not fv:
                continue
            if f.field_type == FieldType.number and fv.value_number is not None:
                try:
                    value_by_key[f.key] = float(fv.value_number)
                except (TypeError, ValueError):
                    pass
            elif f.field_type == FieldType.multi_line_items:
                multi_line_items_data[f.key] = await load_multi_line_items_rows(db, entry_id=entry.id, field=f)
            elif f.field_type == FieldType.formula and fv.value_number is not None:
                # Keep existing formula values as baseline; overridden when recomputed below.
                try:
                    value_by_key[f.key] = float(fv.value_number)
                except (TypeError, ValueError):
                    pass

        other_kpi_values = await _load_other_kpi_values(
            db, entry.year, org_id, kpi_id, period_key=entry.period_key, is_draft=entry.is_draft
        )
        for f in formula_fields:
            computed = evaluate_formula(
                f.formula_expression or "",
                value_by_key,
                multi_line_items_data,
                other_kpi_values,
            )
            fv = fv_by_field_id.get(f.id)
            if fv is None:
                fv = KPIFieldValue(entry_id=entry.id, field_id=f.id)
                db.add(fv)
                fv_by_field_id[f.id] = fv
            fv.value_number = computed
            if computed is not None:
                value_by_key[f.key] = computed

    await db.flush()
    return len(entries)


def _is_field_visible_for_entry(field, values_dict: dict, fields_dict: dict) -> bool:
    from app.fields.conditional import is_field_visible
    return is_field_visible(field, fields_dict, values_dict)


async def submit_entry(
    db: AsyncSession, entry_id: int, user_id: int, org_id: int
) -> KPIEntry | None:
    """Validate and submit the KPI entry (publishing it)."""
    draft_entry = await _get_entry(db, entry_id, org_id)
    if not draft_entry or not draft_entry.is_draft or draft_entry.is_locked:
        return None
        
    # 1. Perform Validation
    from fastapi import HTTPException
    from app.core.models import KPI, KPIField, KPIFieldValue, KpiMultiLineRow, KpiMultiLineCell, KpiMultiLineRowAccess, KpiFile, FieldType
    from sqlalchemy.orm import selectinload
    
    # Load KPI fields and sub_fields
    kpi_res = await db.execute(
        select(KPI)
        .where(KPI.id == draft_entry.kpi_id)
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi = kpi_res.scalar_one_or_none()
    if not kpi:
        return None
        
    # Load scalar values
    scalar_vals_res = await db.execute(
        select(KPIFieldValue).where(KPIFieldValue.entry_id == draft_entry.id)
    )
    scalar_vals = scalar_vals_res.scalars().all()
    values_dict = {fv.field_id: fv for fv in scalar_vals}
    fields_dict = {f.id: f for f in kpi.fields}
    
    missing_fields = []
    
    # Helper to check if a value is empty
    def is_val_empty(val_obj) -> bool:
        if not val_obj:
            return True
        is_num_empty = val_obj.value_number is None
        is_bool_empty = val_obj.value_boolean is None
        is_date_empty = val_obj.value_date is None
        is_json_empty = val_obj.value_json is None or val_obj.value_json == [] or val_obj.value_json == {}
        is_text_empty = val_obj.value_text is None or str(val_obj.value_text).strip() == ""
        return is_num_empty and is_bool_empty and is_date_empty and is_json_empty and is_text_empty

    # 1) Validate Scalar Fields
    for f in kpi.fields:
        if f.field_type == FieldType.multi_line_items or f.field_type == "multi_line_items":
            continue
        if f.field_type == FieldType.formula or f.field_type == "formula":
            continue
        if not f.is_required:
            continue
            
        # Check conditional visibility
        if not _is_field_visible_for_entry(f, values_dict, fields_dict):
            continue
            
        fv = values_dict.get(f.id)
        if is_val_empty(fv):
            missing_fields.append(f.name)
            
    # 2) Validate MLI Fields
    for f in kpi.fields:
        if f.field_type != FieldType.multi_line_items and f.field_type != "multi_line_items":
            continue
            
        # Fetch rows for this MLI field
        mli_rows_res = await db.execute(
            select(KpiMultiLineRow)
            .where(KpiMultiLineRow.entry_id == draft_entry.id, KpiMultiLineRow.field_id == f.id)
            .options(selectinload(KpiMultiLineRow.cells).selectinload(KpiMultiLineCell.sub_field))
        )
        mli_rows = mli_rows_res.scalars().all()
        
        sub_fields = getattr(f, "sub_fields", None) or []
        key_to_sf = {sf.key: sf for sf in sub_fields}
        
        for row in mli_rows:
            # Reconstruct row dictionary for visibility checks
            row_dict = {}
            cell_by_sf_id = {}
            for cell in row.cells:
                val = None
                if cell.value_number is not None:
                    val = cell.value_number
                elif cell.value_boolean is not None:
                    val = cell.value_boolean
                elif cell.value_date is not None:
                    val = cell.value_date
                elif cell.value_json is not None:
                    val = cell.value_json
                elif cell.value_text is not None:
                    val = cell.value_text
                
                if cell.sub_field:
                    row_dict[cell.sub_field.key] = val
                    cell_by_sf_id[cell.sub_field.id] = cell
                    
            for sf in sub_fields:
                if not sf.is_required:
                    continue
                # Check visibility
                if not _is_subfield_satisfied_for_row(sf, row_dict, key_to_sf):
                    continue
                    
                cell = cell_by_sf_id.get(sf.id)
                if is_val_empty(cell):
                    missing_fields.append(f"{f.name} → {sf.name} (Row {row.row_index + 1})")
                    
    if missing_fields:
        errors_str = "\n".join(f"• {m}" for m in missing_fields)
        detail = f"The KPI cannot be submitted because the following required fields are missing:\n\n{errors_str}"
        raise HTTPException(status_code=400, detail=detail)

    # 2. Load or create the published entry
    pub_res = await db.execute(
        select(KPIEntry).where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == draft_entry.kpi_id,
            KPIEntry.year == draft_entry.year,
            KPIEntry.period_key == draft_entry.period_key,
            KPIEntry.is_draft == False,
        )
    )
    pub_entry = pub_res.scalar_one_or_none()
    
    if not pub_entry:
        pub_entry = KPIEntry(
            organization_id=org_id,
            kpi_id=draft_entry.kpi_id,
            year=draft_entry.year,
            period_key=draft_entry.period_key,
            is_draft=False,
        )
        db.add(pub_entry)
        await db.flush()
        
    # 3. Clear existing values on the published entry
    await db.execute(delete(KPIFieldValue).where(KPIFieldValue.entry_id == pub_entry.id))
    await db.execute(delete(KpiMultiLineRowAccess).where(KpiMultiLineRowAccess.entry_id == pub_entry.id))
    await db.execute(delete(KpiFile).where(KpiFile.entry_id == pub_entry.id))
    
    existing_rows = await db.execute(
        select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == pub_entry.id)
    )
    for r in list(existing_rows.scalars().all()):
        await db.delete(r)
        
    await db.flush()
    
    # 4. Copy all values from draft to published entry
    await _copy_entry_values(db, draft_entry.id, pub_entry.id)
    
    # 5. Update submission metadata
    now = datetime.utcnow()
    pub_entry.submitted_at = now
    pub_entry.submitted_by_user_id = user_id
    pub_entry.last_modified_at = now
    pub_entry.last_modified_by_user_id = user_id
    pub_entry.user_id = user_id
    pub_entry.updated_at = now
    
    draft_entry.submitted_at = now
    draft_entry.submitted_by_user_id = user_id
    draft_entry.is_modified_after_submission = False
    draft_entry.updated_at = now
    
    await db.flush()
    return draft_entry


async def lock_entry(
    db: AsyncSession, entry_id: int, org_id: int, is_locked: bool
) -> KPIEntry | None:
    """Lock or unlock entry (admin)."""
    entry = await _get_entry_admin(db, entry_id, org_id)
    if not entry:
        return None
    entry.is_locked = is_locked
    await db.flush()
    return entry


async def list_available_kpis(db: AsyncSession, user_id: int, org_id: int) -> list[KPI]:
    """Return KPIs the user can enter data for.

    - ORG_ADMIN / SUPER_ADMIN: all KPIs in the organization.
    - Other users: no implicit access; KPIs are visible if any organization role for the user
      grants either KPI-level access (KpiRoleAssignment) OR field-level access (KpiFieldAccessByRole)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return []
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        q = select(KPI).where(KPI.organization_id == org_id).order_by(KPI.sort_order, KPI.name)
        res = await db.execute(q)
        return list(res.scalars().all())
    # Non-admins: derive visible KPIs from organization roles
    # 1) KPI-level role assignments
    kpi_from_roles_res = await db.execute(
        select(KpiRoleAssignment.kpi_id)
        .join(
            UserOrganizationRole,
            UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id,
        )
        .join(KPI, KPI.id == KpiRoleAssignment.kpi_id)
        .where(
            UserOrganizationRole.user_id == user_id,
            KPI.organization_id == org_id,
        )
    )
    kpi_ids_from_roles = {row[0] for row in kpi_from_roles_res.all()}
    # 2) Field-level role access (KpiFieldAccessByRole)
    user_roles_res = await db.execute(
        select(UserOrganizationRole.organization_role_id).where(
            UserOrganizationRole.user_id == user_id
        )
    )
    user_role_ids = [row[0] for row in user_roles_res.all()]
    if user_role_ids:
        field_based_res = await db.execute(
            select(KpiFieldAccessByRole.kpi_id)
            .join(KPI, KPI.id == KpiFieldAccessByRole.kpi_id)
            .where(
                KpiFieldAccessByRole.organization_role_id.in_(user_role_ids),
                KPI.organization_id == org_id,
            )
        )
        for row in field_based_res.all():
            kpi_ids_from_roles.add(row[0])
    if not kpi_ids_from_roles:
        return []
    q = (
        select(KPI)
        .where(
            KPI.organization_id == org_id,
            KPI.id.in_(kpi_ids_from_roles),
        )
        .order_by(KPI.sort_order, KPI.name)
    )
    res = await db.execute(q)
    return list(res.scalars().all())


async def list_entries(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    kpi_id: int | None = None,
    year: int | None = None,
    period_key: str | None = None,
    as_admin: bool = False,
) -> list[KPIEntry]:
    """List entries for org (per KPI per year per period_key). Prioritize the user's private draft if it exists."""
    q = select(KPIEntry).where(KPIEntry.organization_id == org_id)
    if kpi_id is not None:
        q = q.where(KPIEntry.kpi_id == kpi_id)
    if year is not None:
        q = q.where(KPIEntry.year == year)
    if period_key is not None:
        q = q.where(KPIEntry.period_key == (period_key.strip()[:8] if period_key else ""))

    q = q.options(selectinload(KPIEntry.field_values), selectinload(KPIEntry.user))
    result = await db.execute(q)
    all_entries = list(result.unique().scalars().all())

    # Group entries by (kpi_id, year, period_key)
    grouped: dict[tuple[int, int, str], list[KPIEntry]] = {}
    for entry in all_entries:
        key = (entry.kpi_id, entry.year, entry.period_key)
        grouped.setdefault(key, []).append(entry)

    filtered_entries: list[KPIEntry] = []
    for key, group in grouped.items():
        # Find current user's draft entry
        my_draft = next((e for e in group if e.is_draft and e.user_id == user_id), None)
        if my_draft:
            filtered_entries.append(my_draft)
        else:
            # Fallback to the published entry
            published = next((e for e in group if not e.is_draft), None)
            if published:
                filtered_entries.append(published)

    # Sort descending
    filtered_entries.sort(key=lambda e: (e.year, e.period_key, e.kpi_id), reverse=True)

    # Non-admin: filter by KPI assignment
    if not as_admin:
        assign_res = await db.execute(
            select(KPIAssignment.kpi_id).where(KPIAssignment.user_id == user_id)
        )
        assigned_kpis = set(assign_res.scalars().all())
        filtered_entries = [e for e in filtered_entries if e.kpi_id in assigned_kpis]

    return filtered_entries


async def get_latest_year_with_entries(
    db: AsyncSession,
    org_id: int,
    kpi_ids: list[int],
) -> int | None:
    """Return the latest (max) year that has at least one entry for the given org and KPIs, or None."""
    if not kpi_ids:
        return None
    q = select(func.max(KPIEntry.year)).where(
        KPIEntry.organization_id == org_id,
        KPIEntry.kpi_id.in_(kpi_ids),
    )
    r = await db.execute(q)
    val = r.scalar()
    return int(val) if val is not None else None


async def get_available_years(
    db: AsyncSession,
    org_id: int,
    kpi_ids: list[int],
    limit: int = 10,
) -> list[int]:
    """Return distinct years (descending) that have at least one entry for the given org and KPIs."""
    if not kpi_ids:
        return []
    q = (
        select(KPIEntry.year)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id.in_(kpi_ids),
        )
        .distinct()
        .order_by(KPIEntry.year.desc())
        .limit(limit)
    )
    r = await db.execute(q)
    return [int(row[0]) for row in r.all()]


async def get_entries_for_kpis(
    db: AsyncSession,
    org_id: int,
    kpi_ids: list[int],
    year: int,
) -> tuple[list[dict], list[dict]]:
    """
    Load entries for given org, kpi_ids, and year. Returns (rows, missing_kpis).
    - rows: list of { "kpi_id", "kpi_name", "entry_id", "row": { field_key: display_value } }
    - missing_kpis: list of { "kpi_id", "kpi_name", "assigned_user_names": [...] } for KPIs with no entry.
    """
    if not kpi_ids:
        return [], []
    # Load KPIs with fields (for names and keys)
    from sqlalchemy.orm import selectinload as sl
    kpi_q = select(KPI).where(KPI.id.in_(kpi_ids)).options(sl(KPI.fields).selectinload(KPIField.sub_fields))
    kpi_res = await db.execute(kpi_q)
    kpis = {k.id: k for k in kpi_res.scalars().all()}
    # Load entries with field_values and field
    entry_q = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id.in_(kpi_ids),
            KPIEntry.year == year,
        )
        .options(
            selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field).selectinload(KPIField.sub_fields),
        )
    )
    entry_res = await db.execute(entry_q)
    entries = list(entry_res.scalars().all())
    entry_by_kpi = {e.kpi_id: e for e in entries}
    rows = []
    for e in entries:
        kpi = kpis.get(e.kpi_id)
        kpi_name = kpi.name if kpi else ""
        row = {}
        for fv in e.field_values or []:
            if fv.field:
                row[fv.field.key] = _format_field_value(fv)
        rows.append({"kpi_id": e.kpi_id, "kpi_name": kpi_name, "entry_id": e.id, "row": row})
    missing_ids = [kid for kid in kpi_ids if kid not in entry_by_kpi]
    if not missing_ids:
        return rows, []
    # Data-entry assignees for missing KPIs
    assign_q = (
        select(KPIAssignment.kpi_id, User.full_name, User.username)
        .join(User, User.id == KPIAssignment.user_id)
        .where(
            KPIAssignment.kpi_id.in_(missing_ids),
            KPIAssignment.assignment_type == "data_entry",
        )
    )
    assign_res = await db.execute(assign_q)
    assignees_by_kpi: dict[int, list[str]] = {}
    for row in assign_res.all():
        kpi_id, full_name, username = row[0], row[1], row[2]
        display = (full_name or "").strip() or username or ""
        if display and kpi_id in missing_ids:
            assignees_by_kpi.setdefault(kpi_id, []).append(display)
    role_names_by_kpi: dict[int, list[str]] = {kid: [] for kid in missing_ids}
    if missing_ids:
        role_assign_q = (
            select(KpiRoleAssignment.kpi_id, OrganizationRole.name)
            .join(OrganizationRole, OrganizationRole.id == KpiRoleAssignment.organization_role_id)
            .where(KpiRoleAssignment.kpi_id.in_(missing_ids))
        )
        role_assign_res = await db.execute(role_assign_q)
        for row in role_assign_res.all():
            kpi_id, role_name = row[0], (row[1] or "").strip()
            if role_name and kpi_id in missing_ids:
                role_names_by_kpi.setdefault(kpi_id, []).append(role_name)
    missing_kpis = [
        {
            "kpi_id": kid,
            "kpi_name": kpis.get(kid).name if kpis.get(kid) else "",
            "assigned_user_names": assignees_by_kpi.get(kid, []),
            "assigned_role_names": role_names_by_kpi.get(kid, []),
        }
        for kid in missing_ids
    ]
    return rows, missing_kpis


def _format_field_value(fv) -> str:
    """Format a field value for display."""
    if getattr(getattr(fv, "field", None), "field_type", None) == FieldType.multi_line_items:
        # Multi-line items are stored relationally (not in KPIFieldValue.value_json).
        # Avoid triggering expensive loads in overview endpoints.
        return "Multi-line items"
    if fv.value_text is not None:
        return str(fv.value_text)[:80]
    if fv.value_number is not None:
        return str(fv.value_number)
    if fv.value_boolean is not None:
        return "Yes" if fv.value_boolean else "No"
    if fv.value_date is not None:
        return str(fv.value_date)[:10] if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
    if fv.value_json is not None:
        return str(fv.value_json)[:80]
    return ""


def _expected_period_keys(dimension: TimeDimension) -> list[str]:
    """Return expected period_key values for the dimension (for display order)."""
    if dimension in (TimeDimension.YEARLY, TimeDimension.MULTI_YEAR):
        return [""]
    if dimension == TimeDimension.HALF_YEARLY:
        return ["H1", "H2"]
    if dimension == TimeDimension.QUARTERLY:
        return ["Q1", "Q2", "Q3", "Q4"]
    if dimension == TimeDimension.MONTHLY:
        return [f"{i:02d}" for i in range(1, 13)]
    return [""]


def _previous_period(year: int, period_key: str, dimension: TimeDimension) -> tuple[int, str] | None:
    """Return (year_prev, period_key_prev) for the period before (year, period_key), or None if no previous (e.g. yearly 2020)."""
    pk = (period_key or "").strip()
    keys = _expected_period_keys(dimension)
    try:
        idx = keys.index(pk) if pk in keys else (keys.index("") if "" in keys else 0)
    except ValueError:
        idx = 0
    if idx > 0:
        return year, keys[idx - 1]
    if year <= 2000:  # arbitrary lower bound
        return None
    return year - 1, keys[-1] if keys else ""


def _period_display(period_key: str) -> str:
    """Human-readable label for period_key."""
    if not period_key or not period_key.strip():
        return "Full year"
    pk = period_key.strip().upper()
    if pk in ("H1", "H2"):
        return f"Half {pk[1]}"
    if pk in ("Q1", "Q2", "Q3", "Q4"):
        return pk
    if period_key.isdigit() and 1 <= int(period_key) <= 12:
        months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
        return months[int(period_key) - 1]
    return period_key or "Full year"


async def _get_entries_for_overview(
    db: AsyncSession, org_id: int, kpi_ids: list[int], year: int
) -> list[KPIEntry]:
    """Load all entries for org, kpi_ids, year with field_values and user."""
    if not kpi_ids:
        return []
    q = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id.in_(kpi_ids),
            KPIEntry.year == year,
        )
        .options(
            selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field),
            selectinload(KPIEntry.user),
        )
    )
    res = await db.execute(q)
    return list(res.unique().scalars().all())


async def list_entries_overview(
    db: AsyncSession, user_id: int, org_id: int, year: int, as_admin: bool = False
) -> list[dict]:
    """
    For the given year, return KPIs with entry status, effective time dimension, and per-period entries.
    Includes last data entry user and assigned users. entries[] has one slot per expected period.
    """
    kpis = await list_available_kpis(db, user_id, org_id)
    kpi_ids = [k.id for k in kpis]
    org = await db.get(Organization, org_id)
    org_td_raw = getattr(org, "time_dimension", None) or "yearly"
    try:
        org_td = TimeDimension(org_td_raw)
    except ValueError:
        org_td = TimeDimension.YEARLY

    assigned_by_kpi: dict[int, list[str]] = {kid: [] for kid in kpi_ids}
    assigned_users_detail_by_kpi: dict[int, list[dict]] = {kid: [] for kid in kpi_ids}
    assigned_data_entry_ids_by_kpi: dict[int, set[int]] = {kid: set() for kid in kpi_ids}
    current_user_permission_by_kpi: dict[int, str] = {}
    if kpi_ids:
        assign_res = await db.execute(
            select(
                KPIAssignment.kpi_id,
                KPIAssignment.user_id,
                KPIAssignment.assignment_type,
                User.full_name,
                User.username,
                User.email,
            )
            .join(User, User.id == KPIAssignment.user_id)
            .where(KPIAssignment.kpi_id.in_(kpi_ids))
        )
        for row in assign_res.all():
            kpi_id, uid, atype, full_name, username, email = row[0], row[1], row[2], row[3], row[4], row[5]
            perm = row[2].value if hasattr(row[2], "value") else str(row[2] or "data_entry")
            if uid == user_id:
                current_user_permission_by_kpi[kpi_id] = perm
            if perm == "data_entry":
                assigned_data_entry_ids_by_kpi.setdefault(kpi_id, set()).add(uid)
                display = (full_name or "").strip() or username or ""
                if display and display not in assigned_by_kpi.get(kpi_id, []):
                    assigned_by_kpi.setdefault(kpi_id, []).append(display)
            assigned_users_detail_by_kpi.setdefault(kpi_id, []).append({
                "display_name": (full_name or "").strip() or username or "",
                "email": (email or "").strip() or None,
                "permission": perm,
            })
    user_res = await db.execute(select(User).where(User.id == user_id))
    current_user_obj = user_res.scalar_one_or_none()
    if current_user_obj and current_user_obj.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        for kid in kpi_ids:
            current_user_permission_by_kpi[kid] = "data_entry"

    all_entries = await _get_entries_for_overview(db, org_id, kpi_ids, year)
    entry_by_kpi_period: dict[tuple[int, str], KPIEntry] = {}
    for e in all_entries:
        pk = getattr(e, "period_key", "") or ""
        entry_by_kpi_period[(e.kpi_id, pk)] = e

    tag_names_by_kpi: dict[int, list[str]] = {kid: [] for kid in kpi_ids}
    if kpi_ids:
        tag_res = await db.execute(
            select(KPIOrganizationTag.kpi_id, OrganizationTag.name)
            .join(OrganizationTag, OrganizationTag.id == KPIOrganizationTag.organization_tag_id)
            .where(KPIOrganizationTag.kpi_id.in_(kpi_ids))
        )
        for row in tag_res.all():
            kpi_id, name = row[0], (row[1] or "").strip()
            if name and name not in tag_names_by_kpi.get(kpi_id, []):
                tag_names_by_kpi.setdefault(kpi_id, []).append(name)

    assigned_role_names_by_kpi: dict[int, list[str]] = {kid: [] for kid in kpi_ids}
    if kpi_ids:
        role_assign_res = await db.execute(
            select(KpiRoleAssignment.kpi_id, OrganizationRole.name)
            .join(OrganizationRole, OrganizationRole.id == KpiRoleAssignment.organization_role_id)
            .where(KpiRoleAssignment.kpi_id.in_(kpi_ids))
        )
        for row in role_assign_res.all():
            kpi_id, role_name = row[0], (row[1] or "").strip()
            if role_name and kpi_id in kpi_ids and role_name not in assigned_role_names_by_kpi.get(kpi_id, []):
                assigned_role_names_by_kpi.setdefault(kpi_id, []).append(role_name)
        # Set current_user_permission from role assignment when not set by direct assignment
        role_perm_res = await db.execute(
            select(KpiRoleAssignment.kpi_id, KpiRoleAssignment.assignment_type)
            .join(UserOrganizationRole, UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id)
            .where(
                UserOrganizationRole.user_id == user_id,
                KpiRoleAssignment.kpi_id.in_(kpi_ids),
            )
        )
        for row in role_perm_res.all():
            kid, atype = row[0], row[1]
            if kid not in current_user_permission_by_kpi:
                perm = atype.value if hasattr(atype, "value") else str(atype or "data_entry")
                if perm not in ("data_entry", "view"):
                    perm = "data_entry"
                current_user_permission_by_kpi[kid] = perm

    result = []
    for kpi in kpis:
        kpi_td_raw = getattr(kpi, "time_dimension", None)
        kpi_td = TimeDimension(kpi_td_raw) if kpi_td_raw else None
        effective_td = effective_kpi_time_dimension(kpi_td, org_td)
        expected_periods = _expected_period_keys(effective_td)

        periods_out = []
        primary_entry: KPIEntry | None = None
        for pk in expected_periods:
            entry = entry_by_kpi_period.get((kpi.id, pk))
            if entry and primary_entry is None:
                primary_entry = entry
            preview = []
            entered_by_name = None
            if entry:
                field_values = list(entry.field_values or [])
                card_ids = getattr(kpi, "card_display_field_ids", None)
                if isinstance(card_ids, list) and len(card_ids) > 0:
                    id_to_fv = {fv.field_id: fv for fv in field_values if fv.field}
                    for field_id in card_ids:
                        fv = id_to_fv.get(field_id)
                        if fv and fv.field:
                            preview.append({"field_name": fv.field.name, "value": _format_field_value(fv)})
                else:
                    field_values.sort(key=lambda fv: (fv.field.sort_order if fv.field else 0, fv.field_id))
                    for fv in field_values[:2]:
                        if fv.field:
                            preview.append({"field_name": fv.field.name, "value": _format_field_value(fv)})
                if entry.user:
                    entered_by_name = (entry.user.full_name or entry.user.username or "").strip() or entry.user.username
            assigned_ids = assigned_data_entry_ids_by_kpi.get(kpi.id, set())
            data_entry_user_is_assigned = entry and entry.user_id is not None and entry.user_id in assigned_ids if entry else False
            period_payload = {
                "period_key": pk,
                "period_display": _period_display(pk),
                "entry": None,
            }
            if entry:
                period_payload["entry"] = {
                    "id": entry.id,
                    "is_draft": entry.is_draft,
                    "is_locked": entry.is_locked,
                    "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
                    "preview": preview,
                    "entered_by_user_name": entered_by_name,
                    "last_updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
                    "data_entry_user_is_assigned": data_entry_user_is_assigned,
                }
            periods_out.append(period_payload)

        item = {
            "kpi_id": kpi.id,
            "kpi_name": kpi.name,
            "kpi_description": getattr(kpi, "description", None) or None,
            "entry_mode": getattr(kpi, "entry_mode", None) or "manual",
            "kpi_year": year,  # context year (data scope), not KPI-level year
            "org_time_dimension": org_td.value,
            "kpi_time_dimension": kpi_td_raw,
            "effective_time_dimension": effective_td.value,
            "organization_tag_names": tag_names_by_kpi.get(kpi.id, []),
            "entries": periods_out,
            "assigned_user_names": assigned_by_kpi.get(kpi.id, []),
            "assigned_role_names": assigned_role_names_by_kpi.get(kpi.id, []),
            "assigned_users": assigned_users_detail_by_kpi.get(kpi.id, []),
            "current_user_permission": current_user_permission_by_kpi.get(kpi.id) or "data_entry",
            "entry": None,
        }
        if primary_entry:
            field_values = list(primary_entry.field_values or [])
            card_ids = getattr(kpi, "card_display_field_ids", None)
            if isinstance(card_ids, list) and len(card_ids) > 0:
                id_to_fv = {fv.field_id: fv for fv in field_values if fv.field}
                preview = []
                for field_id in card_ids:
                    fv = id_to_fv.get(field_id)
                    if fv and fv.field:
                        preview.append({"field_name": fv.field.name, "value": _format_field_value(fv)})
            else:
                field_values.sort(key=lambda fv: (fv.field.sort_order if fv.field else 0, fv.field_id))
                preview = [{"field_name": fv.field.name, "value": _format_field_value(fv)} for fv in field_values[:2] if fv.field]
            entered_by_name = None
            if primary_entry.user:
                entered_by_name = (primary_entry.user.full_name or primary_entry.user.username or "").strip() or primary_entry.user.username
            assigned_ids = assigned_data_entry_ids_by_kpi.get(kpi.id, set())
            data_entry_user_is_assigned = primary_entry.user_id is not None and primary_entry.user_id in assigned_ids
            item["entry"] = {
                "id": primary_entry.id,
                "is_draft": primary_entry.is_draft,
                "is_locked": primary_entry.is_locked,
                "submitted_at": primary_entry.submitted_at.isoformat() if primary_entry.submitted_at else None,
                "preview": preview,
                "entered_by_user_name": entered_by_name,
                "last_updated_at": primary_entry.updated_at.isoformat() if primary_entry.updated_at else None,
                "data_entry_user_is_assigned": data_entry_user_is_assigned,
            }
        result.append(item)
    return result


def extract_cross_kpi_mli_references(expression: str) -> set[tuple[int, str]]:
    """Extract (kpi_id, field_key) tuples from any cross-KPI MLI function calls in expression."""
    refs = set()
    if not expression or not expression.strip():
        return refs
    try:
        tree = ast.parse(expression)
    except SyntaxError:
        return refs
        
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            func_name = node.func.id
            if func_name in (
                "SUM_KPI_ITEMS", "AVG_KPI_ITEMS", "COUNT_KPI_ITEMS", "MIN_KPI_ITEMS", "MAX_KPI_ITEMS",
                "SUM_KPI_ITEMS_WHERE", "AVG_KPI_ITEMS_WHERE", "COUNT_KPI_ITEMS_WHERE", "MIN_KPI_ITEMS_WHERE", "MAX_KPI_ITEMS_WHERE"
            ):
                if len(node.args) >= 2:
                    kpi_id = None
                    arg0 = node.args[0]
                    if isinstance(arg0, ast.Constant):
                        kpi_id = arg0.value
                    elif isinstance(arg0, ast.Num):
                        kpi_id = arg0.n
                    
                    field_key = None
                    arg1 = node.args[1]
                    if isinstance(arg1, ast.Constant):
                        field_key = arg1.value
                    elif isinstance(arg1, ast.Str):
                        field_key = arg1.s
                        
                    if isinstance(kpi_id, int) and isinstance(field_key, str):
                        refs.add((kpi_id, field_key))
    return refs


async def _load_other_kpi_multi_line_data(
    db: AsyncSession,
    year: int,
    org_id: int,
    refs: set[tuple[int, str]],
    period_key: str | None = None,
    is_draft: bool | None = None,
) -> dict[tuple[int, str], list[dict[str, Any]]]:
    """Batch-load multi-line item rows for the referenced other KPIs and fields."""
    out = {}
    if not refs:
        return out
        
    from collections import defaultdict
    kpi_to_keys = defaultdict(list)
    for kpi_id, field_key in refs:
        kpi_to_keys[kpi_id].append(field_key)
        
    for kpi_id, field_keys in kpi_to_keys.items():
        q = select(KPIEntry).where(
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == year,
            KPIEntry.organization_id == org_id,
        )
        if period_key is not None:
            q = q.where(KPIEntry.period_key == period_key)
            
        entry_res = await db.execute(q)
        entries = list(entry_res.scalars().all())
        
        entry = None
        if is_draft is not None:
            entry = next((e for e in entries if e.is_draft == is_draft), None)
        if entry is None:
            entry = next((e for e in entries if e.is_draft), entries[0] if entries else None)
            
        if not entry:
            for fk in field_keys:
                out[(kpi_id, fk)] = []
            continue
            
        fields_res = await db.execute(
            select(KPIField).where(
                KPIField.kpi_id == kpi_id,
                KPIField.key.in_(field_keys),
                KPIField.field_type == FieldType.multi_line_items,
            ).options(selectinload(KPIField.sub_fields))
        )
        fields = fields_res.scalars().all()
        for f in fields:
            rows = await load_multi_line_items_rows(db, entry_id=entry.id, field=f)
            out[(kpi_id, f.key)] = rows
            
        found_keys = {f.key for f in fields}
        for fk in field_keys:
            if fk not in found_keys:
                out[(kpi_id, fk)] = []
                
    return out


def _topological_sort_subfields(sub_fields: list[Any]) -> list[Any]:
    """Sort sub-fields in dependency order (dependencies first) to allow cascading formulas."""
    key_to_sf = {sf.key: sf for sf in sub_fields}
    visited = {}  # key -> status: 0=unvisited, 1=visiting, 2=visited
    result = []

    def dfs(u: str):
        visited[u] = 1
        cfg = getattr(key_to_sf[u], "config", None) or {}
        if hasattr(cfg, "get"):
            formula_expr = cfg.get("formula_expression")
        elif isinstance(cfg, dict):
            formula_expr = cfg.get("formula_expression")
        else:
            formula_expr = None
        from app.formula_engine.circular_validation import extract_formula_dependencies
        deps = extract_formula_dependencies(formula_expr)
        for v in deps:
            if v in key_to_sf and visited.get(v, 0) == 0:
                dfs(v)
        visited[u] = 2
        result.append(key_to_sf[u])

    for sf in sub_fields:
        if visited.get(sf.key, 0) == 0:
            dfs(sf.key)
    return result


async def recompute_mli_formula_subfields(
    db: AsyncSession,
    entry_id: int,
    org_id: int,
    field_id: int | None = None,
) -> None:
    """Recompute and persist all formula subfield values for an entry's multi_line_items fields."""
    entry = await db.get(KPIEntry, entry_id)
    if not entry or entry.organization_id != org_id:
        return

    # 1. Load the KPI fields and sub_fields
    q = (
        select(KPIField)
        .where(KPIField.kpi_id == entry.kpi_id, KPIField.field_type == FieldType.multi_line_items)
        .options(selectinload(KPIField.sub_fields))
    )
    if field_id is not None:
        q = q.where(KPIField.id == field_id)
    res = await db.execute(q)
    mli_fields = list(res.scalars().all())

    # Load scalar field values of this entry for formula variables namespace
    fv_res = await db.execute(
        select(KPIFieldValue)
        .where(KPIFieldValue.entry_id == entry.id)
        .options(selectinload(KPIFieldValue.field))
    )
    fv_list = list(fv_res.scalars().all())
    value_by_key: dict[str, float | int] = {}
    for fv in fv_list:
        if fv.field and fv.field.field_type in (FieldType.number, FieldType.formula) and fv.value_number is not None:
            try:
                value_by_key[fv.field.key] = float(fv.value_number)
            except (TypeError, ValueError):
                pass

    # Load scalar values of other KPIs for cross-KPI scalar refs
    other_kpi_values = await _load_other_kpi_values(
        db, entry.year, org_id, entry.kpi_id, period_key=entry.period_key, is_draft=entry.is_draft
    )

    # Load all MLI field rows in the current entry so formulas can reference other MLI fields in the same entry
    multi_line_items_data: MultiLineItemsData = {}
    all_mli_res = await db.execute(
        select(KPIField)
        .where(KPIField.kpi_id == entry.kpi_id, KPIField.field_type == FieldType.multi_line_items)
        .options(selectinload(KPIField.sub_fields))
    )
    for mf in all_mli_res.scalars().all():
        multi_line_items_data[mf.key] = await load_multi_line_items_rows(db, entry_id=entry.id, field=mf)

    # 2. Iterate through each MLI field and compute formula subfields
    for f in mli_fields:
        sub_fields = list(f.sub_fields or [])
        formula_subs = [sf for sf in sub_fields if sf.field_type == FieldType.formula]
        if not formula_subs:
            continue

        # Extract cross-KPI multi-line dependencies
        refs = set()
        for sf in formula_subs:
            cfg = sf.config or {}
            if hasattr(cfg, "get"):
                expr = cfg.get("formula_expression")
            elif isinstance(cfg, dict):
                expr = cfg.get("formula_expression")
            else:
                expr = None
            if expr:
                refs.update(extract_cross_kpi_mli_references(expr))

        other_kpi_mli_data = await _load_other_kpi_multi_line_data(
            db, entry.year, org_id, refs, period_key=entry.period_key, is_draft=entry.is_draft
        )
        sorted_subs = _topological_sort_subfields(sub_fields)

        rows_res = await db.execute(
            select(KpiMultiLineRow)
            .where(KpiMultiLineRow.entry_id == entry.id, KpiMultiLineRow.field_id == f.id)
            .options(selectinload(KpiMultiLineRow.cells).selectinload(KpiMultiLineCell.sub_field))
        )
        rows_orm = list(rows_res.scalars().all())

        for r in rows_orm:
            # Construct working row data from existing cells
            working_row: dict[str, Any] = {}
            cells_by_sub_id: dict[int, KpiMultiLineCell] = {}
            for cell in getattr(r, "cells", None) or []:
                sf = getattr(cell, "sub_field", None)
                if sf:
                    working_row[sf.key] = _ml_cell_raw(cell)
                    cells_by_sub_id[sf.id] = cell
            # Compute formula subfields in topological order
            for sf in sorted_subs:
                sf_type_s = sf.field_type.value if hasattr(sf.field_type, "value") else str(sf.field_type)
                if sf_type_s == "formula":
                    cfg = sf.config or {}
                    if hasattr(cfg, "get"):
                        expr = cfg.get("formula_expression")
                    elif isinstance(cfg, dict):
                        expr = cfg.get("formula_expression")
                    else:
                        expr = None
                    if not expr:
                        computed = None
                    else:
                        computed = evaluate_formula(
                            expr,
                            value_by_key,
                            multi_line_items_data,
                            other_kpi_values,
                            current_row=working_row,
                            other_kpi_multi_line_data=other_kpi_mli_data,
                        )

                    # Update working_row
                    working_row[sf.key] = computed

                    # Persist cell value
                    cell = cells_by_sub_id.get(sf.id)
                    if cell is None:
                        cell = KpiMultiLineCell(row_id=r.id, sub_field_id=sf.id)
                        db.add(cell)
                        cells_by_sub_id[sf.id] = cell

                    cell.value_text = None
                    cell.value_number = None
                    cell.value_json = None
                    cell.value_boolean = None
                    cell.value_date = None

                    if computed is not None:
                        try:
                            cell.value_number = float(computed)
                        except (TypeError, ValueError):
                            cell.value_text = str(computed)

    await db.flush()
