import asyncio
import json
from app.core.database import AsyncSessionLocal
from app.core.models import Dashboard, KPI, KPIField, KPIFieldSubField, KPIEntry
from sqlalchemy import select
from sqlalchemy.orm import selectinload

async def main():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(Dashboard).where(Dashboard.id == 17))
        d = res.scalar_one_or_none()
        if not d:
            print("Dashboard 17 not found")
            return
        print("Dashboard:", d.name)
        print("column_fetching_config:", json.dumps(d.column_fetching_config, indent=2))
        layout = d.layout or {}
        widgets = layout.get("widgets", []) if isinstance(layout, dict) else (layout if isinstance(layout, list) else [])
        for i, w in enumerate(widgets):
            print(f"\n--- Widget {i}: {w.get('title')} ---")
            print("id:", w.get("id"))
            print("kpi_id:", w.get("kpi_id"))
            print("type:", w.get("type"))
            print("mode:", w.get("mode"))
            print("year:", w.get("year"))
            print("source_field_key:", w.get("source_field_key"))
            print("group_by_sub_field_key:", w.get("group_by_sub_field_key"))
            print("filter_sub_field_key:", w.get("filter_sub_field_key"))
            print("agg:", w.get("agg"))
            print("filters:", w.get("filters"))

            # Check KPI and fields
            kpi_res = await db.execute(select(KPI).where(KPI.id == w.get("kpi_id")))
            kpi = kpi_res.scalar_one_or_none()
            if kpi:
                print(f"  KPI name: {kpi.name}")
            
            # Check entries for this KPI
            entries_res = await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == w.get("kpi_id")))
            entries = entries_res.scalars().all()
            print(f"  Entries count: {len(entries)}")
            for e in entries:
                print(f"    Entry id={e.id}, year={e.year}, period_key={e.period_key}, is_draft={e.is_draft}")

            # Check subfields of source_field
            if w.get("source_field_key"):
                f_res = await db.execute(
                    select(KPIField).where(
                        KPIField.kpi_id == w.get("kpi_id"),
                        KPIField.key == w.get("source_field_key")
                    ).options(selectinload(KPIField.sub_fields))
                )
                f = f_res.scalar_one_or_none()
                if f:
                    print(f"  Field {f.key} subfields:")
                    for sf in f.sub_fields:
                        print(f"    sf: {sf.key}, type: {sf.field_type}, config: {sf.config}")

if __name__ == "__main__":
    asyncio.run(main())
