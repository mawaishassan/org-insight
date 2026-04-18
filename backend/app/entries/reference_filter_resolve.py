"""Resolve reference column cells to another source KPI field value for advanced row filters."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.models import FieldType, KPI, KPIEntry, KPIField, KPIFieldValue
from app.entries.service import _normalize_reference_value


async def _read_compare_value(
    db: AsyncSession,
    entry_id: int,
    cmp_f: KPIField,
    compare_sub_field_key: str | None,
) -> Any | None:
    res = await db.execute(
        select(KPIFieldValue).where(
            KPIFieldValue.entry_id == entry_id,
            KPIFieldValue.field_id == cmp_f.id,
        )
    )
    fv = res.scalar_one_or_none()
    if not fv:
        return None
    if cmp_f.field_type == FieldType.multi_line_items and compare_sub_field_key:
        rows = fv.value_json if isinstance(fv.value_json, list) else []
        for row in rows:
            if isinstance(row, dict) and compare_sub_field_key in row:
                return row.get(compare_sub_field_key)
        return None
    if cmp_f.field_type == FieldType.number and fv.value_number is not None:
        return fv.value_number
    if cmp_f.field_type == FieldType.boolean and fv.value_boolean is not None:
        return fv.value_boolean
    if cmp_f.field_type == FieldType.date and fv.value_date is not None:
        return fv.value_date.isoformat() if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
    if fv.value_text is not None:
        return fv.value_text
    if fv.value_json is not None:
        return fv.value_json
    return None


async def resolve_reference_compare_value(
    db: AsyncSession,
    org_id: int,
    prefer_year: int | None,
    source_kpi_id: int,
    label_field: KPIField,
    label_sub_field_key: str | None,
    cmp_f: KPIField,
    compare_sub_field_key: str | None,
    normalized_label: str,
) -> Any | None:
    """
    Given the normalized display label stored in the consuming reference cell, find the matching
    source KPI record and return the compare field's value.
    """
    if not normalized_label and label_field.field_type != FieldType.multi_line_items:
        return None

    base_q = (
        select(KPIFieldValue, KPIEntry.id)
        .join(KPIEntry, KPIFieldValue.entry_id == KPIEntry.id)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == source_kpi_id,
        )
    )
    if prefer_year is not None:
        base_q = base_q.where(KPIEntry.year == prefer_year)

    if label_field.field_type != FieldType.multi_line_items:
        base_q = base_q.where(KPIFieldValue.field_id == label_field.id)
        res = await db.execute(base_q)
        for fv, entry_id in res.all():
            raw = None
            if label_field.field_type == FieldType.number and fv.value_number is not None:
                raw = str(fv.value_number)
            elif label_field.field_type == FieldType.boolean and fv.value_boolean is not None:
                raw = str(fv.value_boolean).lower()
            elif label_field.field_type == FieldType.date and fv.value_date is not None:
                raw = fv.value_date.isoformat() if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
            elif fv.value_text is not None:
                raw = fv.value_text
            if raw is None:
                continue
            if _normalize_reference_value(str(raw)) != normalized_label:
                continue
            return await _read_compare_value(db, entry_id, cmp_f, compare_sub_field_key)
        return None

    # Label comes from multi_line_items + sub-field
    if not label_sub_field_key:
        return None
    ml_f = label_field
    q = base_q.where(KPIFieldValue.field_id == ml_f.id)
    res = await db.execute(q)
    for fv, entry_id in res.all():
        rows = fv.value_json if isinstance(fv.value_json, list) else []
        for row in rows:
            if not isinstance(row, dict):
                continue
            lab_cell = row.get(label_sub_field_key)
            if _normalize_reference_value(str(lab_cell if lab_cell is not None else "")) != normalized_label:
                continue
            # Same multi_line field: read another column from this row
            if cmp_f.id == ml_f.id and compare_sub_field_key:
                return row.get(compare_sub_field_key)
            # Compare is a scalar (or other) field on the same entry
            return await _read_compare_value(db, entry_id, cmp_f, compare_sub_field_key)
    return None


async def build_reference_resolution_map(
    db: AsyncSession,
    org_id: int,
    prefer_year: int | None,
    field: KPIField,
    conditions: list[Any],
    row_dicts: list[dict[str, Any]],
) -> dict[tuple[int, str], Any]:
    """
    For each condition with reference_resolution and each distinct normalized label seen in row_dicts
    for that condition's column, resolve the compare-field value. Key: (condition_index, normalized_label).
    """
    out: dict[tuple[int, str], Any] = {}
    sub_by_key = {getattr(s, "key", None): s for s in (field.sub_fields or []) if getattr(s, "key", None)}

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
        cfg = getattr(sub, "config", None) or {}
        sid = cfg.get("reference_source_kpi_id")
        lab_key = cfg.get("reference_source_field_key")
        lab_sub = cfg.get("reference_source_sub_field_key")
        if not sid or not lab_key:
            continue

        ck = rr.get("compare_field_key")
        csk = rr.get("compare_sub_field_key")
        if not ck:
            continue

        # Load source KPI fields (same org)
        kpi_check = await db.execute(select(KPI.organization_id).where(KPI.id == int(sid)))
        org_row = kpi_check.one_or_none()
        if not org_row or org_row[0] != org_id:
            continue

        lf_res = await db.execute(
            select(KPIField).where(KPIField.kpi_id == int(sid), KPIField.key == str(lab_key))
        )
        label_field = lf_res.scalar_one_or_none()
        cf_res = await db.execute(
            select(KPIField).where(KPIField.kpi_id == int(sid), KPIField.key == str(ck))
        )
        cmp_f = cf_res.scalar_one_or_none()
        if not label_field or not cmp_f:
            continue

        if csk:
            csk = str(csk)
        if lab_sub:
            lab_sub = str(lab_sub)

        labels: set[str] = set()
        for r in row_dicts:
            cell = r.get(str(fk))
            if ft_s == "multi_reference":
                parts = []
                if isinstance(cell, list):
                    parts = [str(x) for x in cell if x is not None]
                elif cell is not None:
                    parts = [str(cell)]
                for p in parts:
                    labels.add(_normalize_reference_value(p))
            else:
                labels.add(_normalize_reference_value(str(cell) if cell is not None else ""))

        for lab in labels:
            key = (cond_idx, lab)
            if key in out:
                continue
            val = await resolve_reference_compare_value(
                db,
                org_id,
                prefer_year,
                int(sid),
                label_field,
                lab_sub,
                cmp_f,
                csk if csk else None,
                lab,
            )
            out[key] = val

    return out


async def load_kpi_fields_for_resolve(
    db: AsyncSession, source_kpi_id: int, org_id: int
) -> tuple[KPIField | None, list[KPIField]]:
    """Validate KPI belongs to org; return fields."""
    chk = await db.execute(select(KPI).where(KPI.id == source_kpi_id, KPI.organization_id == org_id))
    kpi = chk.scalar_one_or_none()
    if not kpi:
        return None, []
    res = await db.execute(
        select(KPIField).where(KPIField.kpi_id == source_kpi_id).options(selectinload(KPIField.sub_fields))
    )
    fields = list(res.scalars().all())
    return kpi, fields
