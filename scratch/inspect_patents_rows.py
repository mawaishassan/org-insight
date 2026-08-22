import asyncio
import sys
from pathlib import Path
import datetime

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select, and_
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIField, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(KPIField).where(KPIField.kpi_id == 212, KPIField.key == "patents"))
        field = res.scalar_one()
        
        entry_ids = [353, 181]
        start_date = datetime.date(2025, 7, 1)
        end_date = datetime.date(2026, 7, 1)
        date_col_key = "date_of_filing"
        
        q_rows = (
            select(KpiMultiLineRow.id, KpiMultiLineRow.row_index)
            .where(KpiMultiLineRow.field_id == field.id)
            .order_by(KpiMultiLineRow.row_index)
        )
        q_rows = q_rows.where(KpiMultiLineRow.entry_id.in_(entry_ids))

        sf_res = await db.execute(
            select(KPIFieldSubField.id).where(
                KPIFieldSubField.field_id == field.id,
                KPIFieldSubField.key == date_col_key
            )
        )
        sf_id = sf_res.scalar_one_or_none()
        print("sf_id:", sf_id)
        if sf_id:
            q_rows = q_rows.join(
                KpiMultiLineCell,
                and_(
                    KpiMultiLineCell.row_id == KpiMultiLineRow.id,
                    KpiMultiLineCell.sub_field_id == sf_id,
                )
            )
            # Print the compiled query before applying the where clause to see it
            print("Query before where:", q_rows)
            
            # Wait, let's see how the where clause is currently defined in multi_line_load.py:
            # and_(
            #     KpiMultiLineCell.value_date >= start_date,
            #     KpiMultiLineCell.value_date < end_date,
            #     KpiMultiLineCell.value_text.isnot(None),
            #     KpiMultiLineCell.value_text != "",
            # )
            # Wait, is this how it is written?
            
            # Let's print the actual code from multi_line_load.py lines 120-127:
            # wait, let's execute it with the logic from multi_line_load.py
            
        # Let's see what is imported in app/entries/multi_line_load.py
        from app.entries.multi_line_load import load_multi_line_row_dicts
        pairs = await load_multi_line_row_dicts(
            db, entry_id=entry_ids, field=field, date_range=(start_date, end_date, date_col_key)
        )
        print("Pairs length from load_multi_line_row_dicts:", len(pairs))

if __name__ == "__main__":
    asyncio.run(main())
