import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPIField, KpiMultiLineRow
from app.entries.multi_line_load import load_multi_line_row_dicts

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(KPIField).where(KPIField.kpi_id == 212, KPIField.key == "patents"))
        f = res.scalar_one()
        
        pairs = await load_multi_line_row_dicts(
            db,
            entry_id=181,
            field=f,
        )
        print(f"Total rows in Entry 181: {len(pairs)}")
        for idx, row in pairs:
            print(f"Row {idx}: id={row.get('id')}, patent_lms_id={row.get('patent_lms_id')}, date_of_filing={row.get('date_of_filing')}")

if __name__ == "__main__":
    asyncio.run(main())
