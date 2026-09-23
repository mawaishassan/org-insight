import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import asyncio
from sqlalchemy import select
from app.core.database import AsyncSessionLocal
from app.reports.custom_service import generate_custom_report_data
from app.core.models import User

async def main():
    async with AsyncSessionLocal() as db:
        u_res = await db.execute(select(User).where(User.organization_id == 3, User.role == "ORG_ADMIN"))
        user = u_res.scalars().first()

        print(f"Generating Custom Report 37 for User: {user.username} (Role: {user.role})")
        data = await generate_custom_report_data(
            db, 37, 3, year=2026, include_drafts=False, current_user=user
        )
        
        print("\n=== GENERATED REPORT DATA ===")
        print(f"Template Name: {data.get('template_name')}")
        print(f"Year: {data.get('year')}")
        for sec in data.get("sections", []):
            print(f"\n--- Section: {sec.get('title')} ---")
            for f in sec.get("fields", []):
                print(f"  Field: {f.get('label')} (Type: {f.get('field_type')})")
                if f.get('field_type') == 'formula':
                    print(f"    Value: {f.get('value')}")
                elif f.get('field_type') == 'multi_line_items':
                    sub_fields = [sf.get('name') or sf.get('key') for sf in f.get('sub_fields', [])]
                    print(f"    SubFields: {sub_fields}")
                    rows = f.get('rows', [])
                    print(f"    Total MLI Rows returned in report: {len(rows)}")
                    for r in rows:
                        dept_n = r.get('department_name') or r.get('department')
                        if 'mechanical' in str(dept_n).lower():
                            print(f"      Row: Dept='{dept_n}' | Taught={r.get('total_faculty_taught__spring_2026')} | Avg={r.get('average_score__spring_2026')}")

if __name__ == '__main__':
    asyncio.run(main())
