import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data, CUSTOM_REPORT_CACHE
from app.core.models import User
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        CUSTOM_REPORT_CACHE.invalidate_report(36)
        CUSTOM_REPORT_CACHE.invalidate_report(37)
        admin = (await db.execute(select(User).where(User.role == "SUPER_ADMIN"))).scalars().first()
        
        for r_id in [36, 37]:
            data = await generate_custom_report_data(db, r_id, 3, year="2026", current_user=admin, by_default=True)
            if not data:
                print(f"Report {r_id}: No data")
                continue
            for sec in data.get("sections", []):
                for f in sec.get("fields", []):
                    if f.get("field_type") == "multi_line_items":
                        rows = f.get("value_items") or []
                        for r in rows:
                            dept = str(r.get("department_name") or r.get("Department Name") or r.get("Department ID") or "")
                            if "Mechanical Engineering" in dept or dept == "120" or dept == "120.0":
                                print(f"Report {r_id} row: dept='{dept}', fall_taught={r.get('total_faculty_taught_fall_2025')}, spring_taught={r.get('total_faculty_taught__spring_2026')}, spring_avg={r.get('average_score__spring_2026')}, fall_avg={r.get('average_score_fall_2025')}")

if __name__ == "__main__":
    asyncio.run(main())
