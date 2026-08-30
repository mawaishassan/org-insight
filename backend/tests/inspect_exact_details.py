import sys
import asyncio
sys.path.insert(0, ".")
from app.core.database import AsyncSessionLocal
from app.core.models import KPIField, KpiMultiLineRow, KPIEntry
from sqlalchemy import select

async def inspect():
    async with AsyncSessionLocal() as db:
        # Find entries for KPI 290
        res_entries = await db.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == 290)
        )
        entries = res_entries.scalars().all()
        print(f"Found {len(entries)} entries for KPI 290:")
        for e in entries:
            print(f"  Entry: id={e.id}, org_id={e.organization_id}, year={e.year}, period_key='{e.period_key}', user_id={e.user_id}")

        # Find rows for Field 680
        res_rows = await db.execute(
            select(KpiMultiLineRow).where(KpiMultiLineRow.field_id == 680)
        )
        rows = res_rows.scalars().all()
        print(f"Found {len(rows)} rows for Field 680:")
        distinct_entries = set(r.entry_id for r in rows)
        print("  Distinct entry IDs having rows:", distinct_entries)

asyncio.run(inspect())
