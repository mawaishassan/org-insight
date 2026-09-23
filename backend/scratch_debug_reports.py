import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data, get_custom_report
from app.core.models import User, CustomReport, CustomReportSection

async def main():
    async with AsyncSessionLocal() as db:
        for r_id in [36, 37]:
            rep = await get_custom_report(db, r_id, 3)
            if not rep:
                print(f"Report {r_id} not found!")
                continue
            print(f"\n==========================================")
            print(f"REPORT {r_id}: name='{rep.name}', fetch_data_with_date={getattr(rep, 'fetch_data_with_date', None)}")
            print(f"  date_fetching_config={getattr(rep, 'date_fetching_config', None)}")
            
            data = await generate_custom_report_data(db, r_id, 3, year="2026", by_default=True)
            if not data:
                print("  No data generated!")
                continue
            
            for sec in data.get("sections", []):
                print(f"  Section ID {sec.get('section_id')} Title: '{sec.get('title')}'")
                for f in sec.get("fields", []):
                    f_name = f.get("field_name")
                    f_type = f.get("field_type")
                    val = f.get("value")
                    val_items = f.get("value_items")
                    print(f"    Field: '{f_name}' ({f_type})")
                    if f_type == "multi_line_items" and val_items:
                        for row in val_items:
                            dept = row.get("Department Name") or row.get("department_name") or row.get("Department ID")
                            print(f"      Row: dept='{dept}', full_row={row}")
                    elif val:
                        print(f"      Value: {val}")

if __name__ == "__main__":
    asyncio.run(main())
