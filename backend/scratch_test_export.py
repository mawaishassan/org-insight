import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User
from app.reports.custom_service import generate_custom_report_data
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        users = (await db.execute(
            select(User).where((User.email.ilike("%haseeb%")) | (User.role.in_(["SUPER_ADMIN", "ORG_ADMIN"])))
        )).scalars().all()

        for u in users:
            print(f"\n==========================================")
            print(f"Testing export generation for User ID {u.id} ({u.email}, role={u.role}):")
            for r_id in [36, 37]:
                data = await generate_custom_report_data(
                    db, r_id, u.organization_id or 3, year="2026", by_default=True, current_user=u
                )
                if not data:
                    print(f"  Report {r_id}: No data")
                    continue
                print(f"  Report {r_id} ({data.get('custom_report_name')}):")
                for sec in data.get("sections", []):
                    for f in sec.get("fields", []):
                        f_type = f.get("field_type")
                        f_name = f.get("field_name")
                        val = f.get("value")
                        val_items = f.get("value_items")
                        if f_type == "formula":
                            print(f"    Formula '{f_name}': {val}")
                        elif f_type == "multi_line_items":
                            print(f"    Table rows count: {len(val_items or [])}")
                            for r in val_items or []:
                                dept = r.get("Department Name") or r.get("department_name") or r.get("Department ID")
                                fall_t = r.get("total_faculty_taught_fall_2025")
                                spring_t = r.get("total_faculty_taught__spring_2026")
                                spring_a = r.get("average_score__spring_2026")
                                fall_a = r.get("average_score_fall_2025")
                                print(f"       Row: dept='{dept}', fall_taught={fall_t}, spring_taught={spring_t}, spring_avg={spring_a}, fall_avg={fall_a}")

if __name__ == "__main__":
    asyncio.run(main())
