import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User, CustomReport, KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIFieldSubField
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== Step 1: Check ALL entries for KPI 277 in database ===")
        entries277 = (await db.execute(select(KPIEntry).where(KPIEntry.kpi_id == 277))).scalars().all()
        for e in entries277:
            print(f"Entry ID {e.id}: org_id={e.organization_id}, year={e.year}, period_key='{e.period_key}', is_draft={e.is_draft}")
            # Check rows in entry
            rows = (await db.execute(select(KpiMultiLineRow).where(KpiMultiLineRow.entry_id == e.id))).scalars().all()
            print(f"   Total rows in Entry {e.id}: {len(rows)}")
            for r in rows:
                cells = (await db.execute(select(KpiMultiLineCell).where(KpiMultiLineCell.row_id == r.id))).scalars().all()
                c_dict = {}
                for c in cells:
                    sf = (await db.execute(select(KPIFieldSubField).where(KPIFieldSubField.id == c.sub_field_id))).scalar_one_or_none()
                    sf_name = sf.name if sf else str(c.sub_field_id)
                    c_dict[sf_name] = c.value_text or c.value_number
                dept = str(c_dict.get("Department Name") or c_dict.get("Department ID") or "")
                if dept == "Mechanical Engineering" or str(c_dict.get("Department ID")) in ("120", "120.0"):
                    print(f"   Mech Row {r.id}: {c_dict}")

        print("\n=== Step 2: Check generate_custom_report_data for Report 36 with different parameters ===")
        admin = (await db.execute(select(User).where(User.role == "SUPER_ADMIN"))).scalars().first()
        
        for yr_param in ["2025", "2026", None]:
            for default_param in [True, False]:
                data = await generate_custom_report_data(
                    db, 36, 3, year=yr_param, by_default=default_param, current_user=admin
                )
                if not data:
                    print(f"  yr={yr_param}, by_default={default_param} -> No Data")
                    continue
                sec = data.get("sections", [])
                rows_count = 0
                mech_val = None
                summary_val = None
                for s in sec:
                    for f in s.get("fields", []):
                        if f.get("field_type") == "multi_line_items":
                            rows = f.get("value_items") or []
                            rows_count = len(rows)
                            m = [r for r in rows if r.get("Department Name") == "Mechanical Engineering" or str(r.get("Department ID")) in ("120", "120.0")]
                            if m:
                                mech_val = (m[0].get("total_faculty_taught_fall_2025"), m[0].get("average_score_fall_2025"))
                        elif f.get("field_type") == "formula":
                            if f.get("field_name") == "Total Faculty Taught Courses in Fall 2025":
                                summary_val = f.get("value")
                print(f"  yr={yr_param}, by_default={default_param} -> summary_taught={summary_val}, table_rows={rows_count}, mech_row={mech_val}")

if __name__ == "__main__":
    asyncio.run(main())
