import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KpiMultiLineRow, KpiMultiLineCell, KPIField, FieldType

async def main():
    async with AsyncSessionLocal() as db:
        # Get patents field
        fld = (await db.execute(select(KPIField).where(KPIField.key == "patents", KPIField.kpi_id == 212))).scalar_one()
        
        # Load cells for date_of_filing
        from app.fields.service import get_field_with_subfields_only
        f_full = await get_field_with_subfields_only(db, fld.id, 3)
        date_sf = next((sf for sf in f_full.sub_fields if sf.key == "date_of_filing"), None)
        
        # Get cells with date in 2026/27
        import datetime
        cells_res = await db.execute(
            select(KpiMultiLineCell)
            .where(
                KpiMultiLineCell.sub_field_id == date_sf.id,
                KpiMultiLineCell.value_date >= datetime.date(2026, 7, 1),
                KpiMultiLineCell.value_date < datetime.date(2027, 7, 1)
            )
        )
        cells = cells_res.scalars().all()
        print(f"Found {len(cells)} cells in date range.")
        for c in cells:
            row = (await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.id == c.row_id))).scalar_one()
            print(f"Cell value_date={c.value_date}, Row ID={row.id}, Row Index={row.row_index}, Entry ID={row.entry_id}")

if __name__ == "__main__":
    asyncio.run(main())
