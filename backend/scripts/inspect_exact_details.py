import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPIEntry

async def main():
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(KPIEntry).where(KPIEntry.id.in_([166, 281]))
        )
        entries = result.scalars().all()
        for e in entries:
            print(f"ID: {e.id}")
            print(f"  organization_id: {e.organization_id} (type: {type(e.organization_id)})")
            print(f"  kpi_id: {e.kpi_id} (type: {type(e.kpi_id)})")
            print(f"  year: {e.year} (type: {type(e.year)})")
            print(f"  period_key: repr({repr(e.period_key)}) (type: {type(e.period_key)})")
            print(f"  is_draft: {e.is_draft} (type: {type(e.is_draft)})")
            print(f"  user_id: {e.user_id} (type: {type(e.user_id)})")
            print(f"  is_locked: {e.is_locked} (type: {type(e.is_locked)})")

if __name__ == "__main__":
    asyncio.run(main())
