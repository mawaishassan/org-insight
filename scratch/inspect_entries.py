import asyncio
import os
import sys

# Add backend app to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

# We can import db settings or construct engine from environment
DATABASE_URL = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"

async def main():
    engine = create_async_engine(DATABASE_URL, echo=True)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    async with async_session() as db:
        from app.core.models import KPI, KPIEntry, KPIField, KpiMultiLineRow
        
        # 1. Print all KPIs
        kpis_res = await db.execute(select(KPI.id, KPI.name))
        kpis = kpis_res.all()
        print("--- ALL KPIs ---")
        for k in kpis:
            print(f"KPI ID: {k[0]}, Name: {k[1]}")
            
        # 2. Print all Entries
        entries_res = await db.execute(select(KPIEntry.id, KPIEntry.kpi_id, KPIEntry.organization_id, KPIEntry.year, KPIEntry.period_key))
        entries = entries_res.all()
        print("\n--- ALL KPI ENTRIES ---")
        for e in entries:
            print(f"Entry ID: {e[0]}, KPI ID: {e[1]}, Org ID: {e[2]}, Year: {e[3]}, Period: {e[4]}")
            
        # 3. Print all MLI Fields
        fields_res = await db.execute(select(KPIField.id, KPIField.kpi_id, KPIField.name, KPIField.key, KPIField.field_type, KPIField.config))
        fields = fields_res.all()
        print("\n--- ALL FIELDS ---")
        for f in fields:
            print(f"Field ID: {f[0]}, KPI ID: {f[1]}, Name: {f[2]}, Key: {f[3]}, Type: {f[4]}, Config: {f[5]}")

        # 4. Print Row count per Entry
        rows_res = await db.execute(select(KpiMultiLineRow.entry_id, KpiMultiLineRow.field_id))
        rows = rows_res.all()
        from collections import Counter
        counts = Counter(rows)
        print("\n--- MLI ROW COUNTS BY (entry_id, field_id) ---")
        for k, v in counts.items():
            print(f"Entry ID: {k[0]}, Field ID: {k[1]} -> {v} rows")
            
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
