import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.core.models import KPI, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIField, KPIFieldSubField

async def main():
    async with AsyncSessionLocal() as db:
        # Check KPI 212
        kpi_res = await db.execute(select(KPI).where(KPI.id == 212))
        kpi = kpi_res.scalar_one()
        print(f"KPI 212: Name={kpi.name}, is_joined={getattr(kpi, 'is_joined', False)}")
        
        # Check entries for KPI 212
        entry_res = await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == 212))
        entries = entry_res.scalars().all()
        for e in entries:
            print(f"Entry: ID={e.id}, Year={e.year}, Period={e.period_key}, is_draft={e.is_draft}")
            # Find field "patents"
            field_res = await db.execute(select(KPIField).where(KPIField.kpi_id == 212, KPIField.key == "patents"))
            f = field_res.scalar_one_or_none()
            if f:
                rows_res = await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id, KpiMultiLineRow.field_id == f.id))
                rows = rows_res.scalars().all()
                print(f"  Field patents (ID={f.id}): Row count={len(rows)}")

if __name__ == "__main__":
    asyncio.run(main())
