import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath('.'))

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User, CustomReport, CustomReportAssignment, ReportUserFilterConfiguration,
    KPIEntry, KpiMultiLineRow, KpiMultiLineCell, KPIField
)
from app.reports.custom_service import generate_custom_report_data
from sqlalchemy import select

async def main():
    async with AsyncSessionLocal() as db:
        print("=== Report User Filter Configurations ===")
        filters = (await db.execute(select(ReportUserFilterConfiguration))).scalars().all()
        print(f"Total ReportUserFilterConfiguration count: {len(filters)}")
        for f in filters:
            print(f"Filter ID {f.id}: report_id={getattr(f, 'report_id', None)}, user_id={getattr(f, 'user_id', None)}, kpi_id={getattr(f, 'kpi_id', None)}, filters={getattr(f, 'filters', None)}")

        print("User columns:", User.__table__.columns.keys())
        users = (await db.execute(
            select(User).where((User.email.ilike("%haseeb%")) | (User.email.ilike("%mech%")))
        )).scalars().all()
        for u in users:
            print(f"User {u.id}: email='{u.email}', role='{u.role}'")

        print("\n=== Check generate_custom_report_data for Haseeb or filter users ===")
        for u in users:
            for r_id in [36, 37]:
                data = await generate_custom_report_data(db, r_id, u.organization_id or 3, year="2026", current_user=u, by_default=True)
                if not data:
                    print(f"User {u.id} Report {r_id}: No data")
                    continue
                sec_list = data.get("sections", [])
                for sec in sec_list:
                    for field in sec.get("fields", []):
                        if field.get("field_type") == "multi_line_items":
                            rows = field.get("value_items") or []
                            print(f"User {u.id} Report {r_id} total_rows={len(rows)}")
                            for r in rows:
                                dept_name = r.get("Department Name") or r.get("department_name")
                                fall_t = r.get("total_faculty_taught_fall_2025")
                                spring_t = r.get("total_faculty_taught__spring_2026")
                                spring_a = r.get("average_score__spring_2026")
                                fall_a = r.get("average_score_fall_2025")
                                print(f"   Row: dept='{dept_name}', fall_taught={fall_t}, spring_taught={spring_t}, spring_avg={spring_a}, fall_avg={fall_a}")
                        elif field.get("field_type") == "formula":
                            print(f"User {u.id} Report {r_id} Formula field '{field.get('field_name')}': {field.get('value')}")

if __name__ == "__main__":
    asyncio.run(main())
