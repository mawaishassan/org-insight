import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import (
    User, CustomReport, CustomReportSection, CustomReportField,
    KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField, KPI, KPIField
)
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== KPI 277 ENTRIES AND MLI ROWS ===")
        # Get KPI 277 details
        kpi = await db.get(KPI, 277)
        if kpi:
            print(f"KPI 277: Name='{kpi.name}', OrganizationID={kpi.organization_id}")
        
        # Get subfields mapping for KPI 277
        kpi_fields = (await db.execute(
            select(KPIField).where(KPIField.kpi_id == 277)
        )).scalars().all()
        sf_map = {}
        for kf in kpi_fields:
            subfields = (await db.execute(
                select(KPIFieldSubField).where(KPIFieldSubField.field_id == kf.id)
            )).scalars().all()
            for sf in subfields:
                sf_map[sf.id] = (sf.name, sf.key)

        # Get entries for KPI 277
        entries = (await db.execute(
            select(KPIEntry).where(KPIEntry.kpi_id == 277)
        )).scalars().all()
        print(f"\nFound {len(entries)} entries for KPI 277:")
        for e in entries:
            print(f"\n--- Entry ID {e.id}: year='{e.year}', period_key='{e.period_key}', is_draft={e.is_draft}, org_id={e.organization_id} ---")
            
            # Find all multi line rows for this entry
            rows = (await db.execute(
                select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id)
            )).scalars().all()
            print(f"  Total MultiLine Rows in Entry {e.id}: {len(rows)}")
            
            # Check rows for Mechanical Engineering
            mech_rows = []
            dept_counts = {}
            for r in rows:
                cells = (await db.execute(
                    select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id)
                )).scalars().all()
                
                row_values = {}
                dept_name = None
                for c in cells:
                    sf_info = sf_map.get(c.sub_field_id, (f"sf_{c.sub_field_id}", f"sf_{c.sub_field_id}"))
                    val = c.value_text if c.value_text is not None else (c.value_number if c.value_number is not None else c.value_json)
                    row_values[sf_info[1]] = val
                    if sf_info[1] == "department_name":
                        dept_name = str(val).strip() if val else None

                if dept_name:
                    dept_counts[dept_name] = dept_counts.get(dept_name, 0) + 1
                    
                if dept_name and "mechanical" in dept_name.lower():
                    mech_rows.append((r.id, dept_name, row_values))
            
            print("\n  Department Counts:")
            for dname, cnt in sorted(dept_counts.items()):
                print(f"    '{dname}': {cnt}")
                
            print(f"\n  Mechanical Rows ({len(mech_rows)} total):")
            for rid, dname, rvals in mech_rows:
                print(f"    Row ID {rid} | Dept='{dname}' | Values={rvals}")

if __name__ == "__main__":
    asyncio.run(main())
