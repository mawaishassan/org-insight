"""Load multi_line_items rows for API consumers (keeps `routes.py` from being imported by other packages)."""

from __future__ import annotations

from typing import Any

import logging

from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import KPIField, KpiMultiLineCell, KpiMultiLineRow

logger = logging.getLogger(__name__)


def _cell_value_raw(c: KpiMultiLineCell) -> Any:
    """Return the raw value for a typed multi-line cell (mirrors legacy row dict semantics)."""
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


async def load_multi_line_row_dicts(
    db: AsyncSession,
    *,
    entry_id: int | list[int],
    field: KPIField,
    row_indices: list[int] | None = None,
    current_user_id: int | None = None,
    date_range: tuple[datetime.date, datetime.date, str] | None = None,
) -> list[tuple[int, dict]]:
    """Optimized direct load of multi_line rows and cells to scale efficiently for large entries."""
    import datetime
    from app.core.models import KPI
    kpi_res = await db.execute(select(KPI).where(KPI.id == field.kpi_id))
    kpi = kpi_res.scalar_one_or_none()
        
    if kpi and getattr(kpi, "is_joined", False):
        from app.core.models import KPIEntry
        # Resolve entry_id as single integer if list is passed for joined check
        joined_eid = entry_id[0] if isinstance(entry_id, list) else entry_id
        entry_res = await db.execute(select(KPIEntry).where(KPIEntry.id == joined_eid))
        entry = entry_res.scalar_one_or_none()
        if not entry:
            return []
            
        from app.entries.load_joined import load_joined_multi_line_rows
        combined_rows = await load_joined_multi_line_rows(
            db,
            joined_field=field,
            organization_id=entry.organization_id,
            year=entry.year,
            period_key=entry.period_key,
            current_user_id=current_user_id
        )
        
        if date_range:
            start_date, end_date, date_col_key = date_range
            def _parse_cell_date(v):
                if isinstance(v, datetime.date):
                    return v
                if isinstance(v, str):
                    try:
                        return datetime.date.fromisoformat(v[:10])
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
            
        out = [(idx, r) for idx, r in enumerate(combined_rows)]
        if row_indices is not None:
            idx_set = {int(x) for x in row_indices}
            out = [(i, r) for i, r in out if i in idx_set]

        # Apply extraction rules (in-memory, non-mutating)
        rules = await _fetch_rules_for_field(db, field.id)
        if rules:
            try:
                from app.entries.mli_extraction import apply_extraction_rules
                processed = apply_extraction_rules([r for _, r in out], rules)
                out = [(idx, processed[i]) for i, (idx, _) in enumerate(out)]
            except ValueError as exc:
                logger.warning("MLI extraction skipped (circular dependency): %s", exc)

        return out

    q_rows = (
        select(KpiMultiLineRow.id, KpiMultiLineRow.row_index)
        .where(KpiMultiLineRow.field_id == field.id)
        .order_by(KpiMultiLineRow.row_index)
    )
    if isinstance(entry_id, list):
        q_rows = q_rows.where(KpiMultiLineRow.entry_id.in_(entry_id))
    else:
        q_rows = q_rows.where(KpiMultiLineRow.entry_id == entry_id)

    if date_range:
        start_date, end_date, date_col_key = date_range
        from app.core.models import KPIFieldSubField
        sf_res = await db.execute(
            select(KPIFieldSubField.id).where(
                KPIFieldSubField.field_id == field.id,
                KPIFieldSubField.key == date_col_key
            )
        )
        sf_id = sf_res.scalar_one_or_none()
        if sf_id:
            q_rows = q_rows.join(
                KpiMultiLineCell,
                and_(
                    KpiMultiLineCell.row_id == KpiMultiLineRow.id,
                    KpiMultiLineCell.sub_field_id == sf_id,
                )
            )
            q_rows = q_rows.where(
                or_(
                    and_(
                        KpiMultiLineCell.value_date.isnot(None),
                        KpiMultiLineCell.value_date >= start_date,
                        KpiMultiLineCell.value_date < end_date,
                    ),
                    and_(
                        KpiMultiLineCell.value_text.isnot(None),
                        KpiMultiLineCell.value_text != "",
                        ~KpiMultiLineCell.value_text.in_(["false", "null", "none", "False", "Null", "None"]),
                        KpiMultiLineCell.value_text >= start_date.isoformat(),
                        KpiMultiLineCell.value_text < end_date.isoformat(),
                    )
                )
            )

    if row_indices is not None:
        idx = [int(i) for i in row_indices if isinstance(i, int)]
        if not idx:
            return []
        q_rows = q_rows.where(KpiMultiLineRow.row_index.in_(idx))
        
    rows_res = await db.execute(q_rows)
    rows_list = rows_res.all()
    if not rows_list:
        return []
        
    row_ids = [r[0] for r in rows_list]
    
    # Load cells in chunks to avoid parameter limits
    from app.core.models import KPIFieldSubField
    cells_list = []
    chunk_size = 5000
    for i in range(0, len(row_ids), chunk_size):
        chunk_ids = row_ids[i:i+chunk_size]
        cells_res = await db.execute(
            select(
                KpiMultiLineCell.row_id,
                KpiMultiLineCell.value_text,
                KpiMultiLineCell.value_number,
                KpiMultiLineCell.value_boolean,
                KpiMultiLineCell.value_date,
                KpiMultiLineCell.value_json,
                KPIFieldSubField.key
            )
            .join(KPIFieldSubField, KPIFieldSubField.id == KpiMultiLineCell.sub_field_id)
            .where(KpiMultiLineCell.row_id.in_(chunk_ids))
        )
        cells_list.extend(cells_res.all())
        
    # Reconstruct dictionary
    from collections import defaultdict
    cells_by_row = defaultdict(dict)
    for row_id, vt, vn, vb, vd, vj, sf_key in cells_list:
        raw_val = None
        if vj is not None:
            raw_val = vj
        elif vt is not None:
            raw_val = vt
        elif vn is not None:
            raw_val = vn
        elif vb is not None:
            raw_val = vb
        elif vd is not None:
            try:
                raw_val = vd.isoformat()
            except Exception:
                raw_val = str(vd)
        cells_by_row[row_id][str(sf_key)] = raw_val
        
    out = []
    for rid, r_idx in rows_list:
        out.append((int(r_idx), cells_by_row.get(rid, {})))

    if date_range:
        start_date, end_date, date_col_key = date_range
        def _parse_cell_date(v):
            if v is None:
                return None
            s = str(v).strip().lower()
            if s in ("false", "none", "null", "undefined", ""):
                return None
            if isinstance(v, datetime.date):
                return v
            if isinstance(v, datetime.datetime):
                return v.date()
            if isinstance(v, str):
                try:
                    return datetime.date.fromisoformat(v[:10])
                except Exception:
                    pass
            return None
            
        filtered_out = []
        for r_idx, row in out:
            rv = row.get(date_col_key)
            rd = _parse_cell_date(rv)
            if rd and start_date <= rd < end_date:
                filtered_out.append((r_idx, row))
        out = filtered_out

    # Apply extraction rules (in-memory, non-mutating)
    rules = await _fetch_rules_for_field(db, field.id)
    if rules:
        try:
            from app.entries.mli_extraction import apply_extraction_rules
            processed = apply_extraction_rules([r for _, r in out], rules)
            out = [(idx, processed[i]) for i, (idx, _) in enumerate(out)]
        except ValueError as exc:
            logger.warning("MLI extraction skipped (circular dependency): %s", exc)

    return out


async def _fetch_rules_for_field(db: AsyncSession, field_id: int) -> list[dict]:
    """Load active extraction rules for a field, ordered by sort_order."""
    from app.core.models import MLITextExtractionRule
    res = await db.execute(
        select(MLITextExtractionRule)
        .where(
            MLITextExtractionRule.field_id == field_id,
            MLITextExtractionRule.is_active.is_(True),
        )
        .order_by(MLITextExtractionRule.sort_order)
    )
    rules = res.scalars().all()
    return [
        {
            "id": r.id,
            "name": r.name,
            "is_active": r.is_active,
            "source_sub_field_key": r.source_sub_field_key,
            "target_sub_field_key": r.target_sub_field_key,
            "extraction_method": r.extraction_method,
            "start_symbol": r.start_symbol,
            "end_symbol": r.end_symbol,
            "remove_delimiters_too": r.remove_delimiters_too,
            "occurrence": r.occurrence,
            "all_separator": r.all_separator,
            "target_action": r.target_action,
            "remove_from_source": r.remove_from_source,
            "wrap_mode": r.wrap_mode,
            "wrap_symbol": r.wrap_symbol,
            "wrap_end_symbol": r.wrap_end_symbol,
            "output_pattern": r.output_pattern,
        }
        for r in rules
    ]
