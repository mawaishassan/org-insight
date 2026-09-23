import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import KpiMultiLineCell, KpiMultiLineRow, KPIEntry, KPIFieldSubField
from sqlalchemy import select, or_, and_

async def main():
    async with AsyncSessionLocal() as db:
        print("=== Searching KpiMultiLineCell for 82.85 or 84.45 ===")
        stmt = select(KpiMultiLineCell).where(
            or_(
                KpiMultiLineCell.value_number.between(82.8, 82.9),
                KpiMultiLineCell.value_number.between(84.4, 84.5),
                KpiMultiLineCell.value_text.like("%82.85%"),
                KpiMultiLineCell.value_text.like("%84.45%")
            )
        )
        cells = (await db.execute(stmt)).scalars().all()
        print(f"Found {len(cells)} cells matching 82.85 or 84.45:")
        for c in cells:
            row = (await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.id == c.row_id))).scalar_one_or_none()
            if row:
                entry = (await db.execute(select(KPIEntry).where(KPIEntry.id == row.entry_id))).scalar_one_or_none()
                sf = (await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.id == c.sub_field_id))).scalar_one_or_none()
                print(f"  Cell ID {c.id}: row_id={c.row_id}, entry_id={row.entry_id} (kpi={entry.kpi_id if entry else '?'}, yr={entry.year if entry else '?'}), subfield='{sf.name if sf else c.sub_field_id}', num={c.value_number}, text='{c.value_text}'")

if __name__ == "__main__":
    asyncio.run(main())
