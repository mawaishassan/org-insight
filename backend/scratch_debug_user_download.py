import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import User, CustomReport, ReportUserFilterConfiguration
from app.reports.custom_service import generate_custom_report_data
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(User))).scalars().all()
        print(f"Total Users: {len(users)}")
        
        for u in users:
            # Check if this user gets 28 or 29 for Report 36
            data36 = await generate_custom_report_data(
                db, 36, u.organization_id or 3, year="2026", by_default=True, current_user=u
            )
            data37 = await generate_custom_report_data(
                db, 37, u.organization_id or 3, year="2026", by_default=True, current_user=u
            )
            
            val36 = None
            if data36:
                for sec in data36.get("sections", []):
                    for f in sec.get("fields", []):
                        if f.get("field_type") == "multi_line_items":
                            rows = f.get("value_items") or []
                            mech = [r for r in rows if (r.get("Department Name") == "Mechanical Engineering" or r.get("department_name") == "Mechanical Engineering" or str(r.get("Department ID")) in ("120", "120.0"))]
                            if mech:
                                val36 = (mech[0].get("Department Name") or mech[0].get("department_name"), mech[0].get("total_faculty_taught_fall_2025"), mech[0].get("average_score_fall_2025"))
            
            val37 = None
            if data37:
                for sec in data37.get("sections", []):
                    for f in sec.get("fields", []):
                        if f.get("field_type") == "multi_line_items":
                            rows = f.get("value_items") or []
                            mech = [r for r in rows if (r.get("Department Name") == "Mechanical Engineering" or r.get("department_name") == "Mechanical Engineering" or str(r.get("Department ID")) in ("120", "120.0"))]
                            if mech:
                                val37 = (mech[0].get("Department Name") or mech[0].get("department_name"), mech[0].get("total_faculty_taught__spring_2026"), mech[0].get("average_score__spring_2026"))
            
            if val36 or val37:
                print(f"User ID {u.id} (email='{u.email}', role='{u.role}', key='{u.unique_user_key}'):")
                print(f"   Report 36 (Fall): {val36}")
                print(f"   Report 37 (Spring): {val37}")

if __name__ == "__main__":
    asyncio.run(main())
