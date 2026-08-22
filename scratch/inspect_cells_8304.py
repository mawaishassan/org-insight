import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KpiMultiLineCell, KpiMultiLineRow

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(
            select(KpiMultiLineCell, KpiMultiLineRow)
            .join(KpiMultiLineRow, KpiMultiLineRow.id == KpiMultiLineCell.row_id)
            .where(KpiMultiLineCell.sub_field_id == 8304, KpiMultiLineRow.entry_id.in_([353, 181]))
        )
        cells = res.all()
        print(f"Total cells: {len(cells)}")
        for c, r in cells:
            print(f"Cell ID={c.id}, row_id={c.row_id}, entry_id={r.entry_id}, value_date={c.value_date}, value_text={c.value_text}, value_boolean={c.value_boolean}")

if __name__ == "__main__":
    asyncio.run(main())
