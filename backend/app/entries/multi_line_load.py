"""Load multi_line_items rows for API consumers (keeps `routes.py` from being imported by other packages)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import KPIField, KpiMultiLineCell, KpiMultiLineRow


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
    entry_id: int,
    field: KPIField,
    row_indices: list[int] | None = None,
) -> list[tuple[int, dict]]:
    """Load rows then cells (two indexed queries). Avoids one huge JOIN that can stall ORM dedup."""
    q = (
        select(KpiMultiLineRow)
        .where(KpiMultiLineRow.entry_id == entry_id, KpiMultiLineRow.field_id == field.id)
        .order_by(KpiMultiLineRow.row_index)
        .options(selectinload(KpiMultiLineRow.cells).selectinload(KpiMultiLineCell.sub_field))
    )
    if row_indices is not None:
        idx = [int(i) for i in row_indices if isinstance(i, int)]
        if not idx:
            return []
        q = q.where(KpiMultiLineRow.row_index.in_(idx))
    res = await db.execute(q)
    rows_orm = list(res.scalars().all())
    out: list[tuple[int, dict]] = []
    for r in rows_orm:
        data: dict[str, Any] = {}
        for c in getattr(r, "cells", None) or []:
            sf = getattr(c, "sub_field", None)
            key = getattr(sf, "key", None) if sf is not None else None
            if not key:
                continue
            data[str(key)] = _cell_value_raw(c)
        out.append((int(getattr(r, "row_index", 0)), data))
    return out
