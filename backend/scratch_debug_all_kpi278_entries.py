import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPI, KPIField, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField, User
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== ALL ENTRIES FOR KPI 278 ===")
        entries = (await db.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == 278)
        )).scalars().all()
        
        for e in entries:
            print(f"Entry ID {e.id}: org_id={e.organization_id}, year={e.year}, period_key='{e.period_key}', is_draft={e.is_draft}, user_id={e.user_id}")
            # Count rows for Mechanical Engineering in this entry
            rows = (await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id))).scalars().all()
            print(f"  Total Rows: {len(rows)}")

if __name__ == "__main__":
    asyncio.run(main())
