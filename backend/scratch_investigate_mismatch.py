import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField, CustomReportSection, CustomReportField
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== All KPI 277 Entries in DB ===")
        entries = (await db.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == 277)
        )).scalars().all()
        for e in entries:
            print(f"Entry ID {e.id}: org_id={e.organization_id}, year={e.year}, period_key={e.period_key}, is_draft={e.is_draft}")

        print("\n=== Mechanical Engineering rows in KpiMultiLineRow for KPIField 623 across all entries ===")
        # Get all subfields for KPIField 623
        sfs = (await db.execute(
            select(KPIFieldSubField).where(KPIFieldSubField.field_id == 623)
        )).scalars().all()
        sf_map = {sf.id: (sf.name or sf.key) for sf in sfs}
        print("Subfields:", sf_map)

        # Get rows for field 623
        rows = (await db.execute(
            select(KpiMultiLineRow).where(KpiMultiLineRow.field_id == 623)
        )).scalars().all()
        
        for r in rows:
            # Load cells
            cells = (await db.execute(
                select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id)
            )).scalars().all()
            row_dict = {}
            for c in cells:
                sf_name = sf_map.get(c.sub_field_id, str(c.sub_field_id))
                val = c.value_text or c.value_number or c.value_boolean
                row_dict[sf_name] = val
            
            dept_name = str(row_dict.get("Department Name") or row_dict.get("Department ID") or "")
            if "Mechanical" in dept_name or str(row_dict.get("Department ID")) in ("120", "120.0"):
                # Get entry info
                entry = (await db.execute(select(KPIEntry).where(KPIEntry.id == r.entry_id))).scalar_one_or_none()
                print(f"Row {r.id} in Entry {r.entry_id} (year={entry.year if entry else '?'}, period_key={entry.period_key if entry else '?'}, is_draft={entry.is_draft if entry else '?'}):")
                print(f"   {row_dict}")

if __name__ == "__main__":
    asyncio.run(main())
