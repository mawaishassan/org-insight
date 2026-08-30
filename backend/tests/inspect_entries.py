import sys
import asyncio
sys.path.insert(0, ".")
from app.core.database import AsyncSessionLocal
from app.entries.service import load_multi_line_items_rows
from app.core.models import KPIField, KpiMultiLineRow
from sqlalchemy import select

async def inspect():
    async with AsyncSessionLocal() as db:
        field = await db.get(KPIField, 680)
        rows = await load_multi_line_items_rows(db, entry_id=451, field=field)
        print(f"load_multi_line_items_rows returned {len(rows)} rows.")
        if rows:
            print("First row keys:", rows[0].keys())
            print("First row sample:", rows[0])

asyncio.run(inspect())
