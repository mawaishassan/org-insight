import asyncio
import os
import sys

# Add backend app to path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

DATABASE_URL = "postgresql+asyncpg://postgres:postgres123456789987654321@localhost:5432/uni_kpi_mis"

async def main():
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    
    output_lines = []
    
    async with async_session() as db:
        from app.core.models import KPI, KPIEntry, KPIField, KpiMultiLineRow
        
        # Find KPIs matching names
        res = await db.execute(select(KPI).where(KPI.name.ilike("%Faculty%") | KPI.name.ilike("%Testing%")))
        kpis = res.scalars().all()
        kpi_ids = []
        output_lines.append("=== MATCHING KPIs ===")
        for k in kpis:
            output_lines.append(f"KPI: id={k.id}, name='{k.name}'")
            kpi_ids.append(k.id)
            
        if not kpi_ids:
            output_lines.append("No matching KPIs found!")
        else:
            # Find Fields
            res_fields = await db.execute(select(KPIField).where(KPIField.kpi_id.in_(kpi_ids)))
            fields = res_fields.scalars().all()
            output_lines.append("\n=== FIELDS FOR MATCHING KPIs ===")
            for f in fields:
                output_lines.append(f"Field: id={f.id}, kpi_id={f.kpi_id}, name='{f.name}', key='{f.key}', type={f.field_type}, config={f.config}")
                
            # Find Entries
            res_entries = await db.execute(select(KPIEntry).where(KPIEntry.kpi_id.in_(kpi_ids)))
            entries = res_entries.scalars().all()
            output_lines.append("\n=== ENTRIES FOR MATCHING KPIs ===")
            entry_ids = []
            for e in entries:
                output_lines.append(f"Entry: id={e.id}, kpi_id={e.kpi_id}, org_id={e.organization_id}, year={e.year}, period='{e.period_key}'")
                entry_ids.append(e.id)
                
            # Check MultiLine rows count
            if entry_ids:
                res_rows = await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id.in_(entry_ids)))
                rows = res_rows.scalars().all()
                output_lines.append(f"\n=== MULTI LINE ROWS COUNT: {len(rows)} ===")
                from collections import defaultdict
                count_map = defaultdict(int)
                for r in rows:
                    count_map[(r.entry_id, r.field_id)] += 1
                for k, v in count_map.items():
                    output_lines.append(f"Entry ID {k[0]}, Field ID {k[1]} has {v} rows in KpiMultiLineRow")

    with open("scratch/debug_linking_output.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(output_lines))
    print("Done writing to scratch/debug_linking_output.txt")
    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
