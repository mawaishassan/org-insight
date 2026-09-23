import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User, CustomReport
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        admin = (await db.execute(select(User).where(User.role == "SUPER_ADMIN"))).scalars().first()
        
        for r_id in [36, 37]:
            rep = (await db.execute(select(CustomReport).where(CustomReport.id == r_id))).scalar_one_or_none()
            print(f"\n==========================================")
            print(f"Report {r_id}: name='{rep.name}', fetch_data_with_date={getattr(rep, 'fetch_data_with_date', None)}, date_fetching_config={getattr(rep, 'date_fetching_config', None)}")
            
            for test_yr in ["2025", "2026", None]:
                data = await generate_custom_report_data(
                    db, r_id, 3, year=test_yr, by_default=(not getattr(rep, 'fetch_data_with_date', False)), current_user=admin
                )
                if not data:
                    print(f"  year={test_yr}: No data")
                    continue
                print(f"  year={test_yr} -> generated year display: '{data.get('year')}'")
                for sec in data.get("sections", []):
                    for f in sec.get("fields", []):
                        if f.get("field_type") == "multi_line_items":
                            rows = f.get("value_items") or []
                            mech_rows = [r for r in rows if "Mechanical Engineering" in str(r.get("Department Name") or r.get("department_name") or "")]
                            for r in mech_rows:
                                dept = r.get("Department Name") or r.get("department_name")
                                print(f"     Mech Row: dept='{dept}', fall_taught={r.get('total_faculty_taught_fall_2025')}, spring_taught={r.get('total_faculty_taught__spring_2026')}, spring_avg={r.get('average_score__spring_2026')}, fall_avg={r.get('average_score_fall_2025')}")
                        elif f.get("field_type") == "formula":
                            print(f"     Formula '{f.get('field_name')}': {f.get('value')}")

if __name__ == "__main__":
    asyncio.run(main())
