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
            select(KPIEntry).where(
                KPIEntry.kpi_id == 219,
                KPIEntry.year == 2026,
                KPIEntry.organization_id == 3,
                # KPIEntry.period_key == ""
            )
        )
        entries = result.scalars().all()
        print(f"Found {len(entries)} entries:")
        for e in entries:
            print(f"- ID: {e.id}, Org: {e.organization_id}, KPI: {e.kpi_id}, Year: {e.year}, Period: '{e.period_key}', User: {e.user_id}, Draft: {e.is_draft}")

if __name__ == "__main__":
    asyncio.run(main())
