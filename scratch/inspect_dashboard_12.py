import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import Dashboard

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Dashboard).where(Dashboard.id == 12))
        d = res.scalar_one()
        print(f"Name: {d.name}")
        print(f"fetch_data_with_date: {d.fetch_data_with_date}")
        print(f"date_fetching_config: {json.dumps(d.date_fetching_config, indent=2)}")
        print("\n--- Widgets Layout ---")
        print(json.dumps(d.layout, indent=2))

if __name__ == "__main__":
    asyncio.run(main())
