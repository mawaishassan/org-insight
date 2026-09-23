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
        admin = (await db.execute(select(User).where(User.id == 1))).scalar_one_or_none()
        org_admin = (await db.execute(select(User).where(User.id == 7))).scalar_one_or_none()
        u110 = (await db.execute(select(User).where(User.id == 110))).scalar_one_or_none()

        print(f"Admin User 1: role='{admin.role}', key='{admin.unique_user_key}'")
        print(f"OrgAdmin User 7: role='{org_admin.role}', key='{org_admin.unique_user_key}'")
        print(f"User 110: role='{u110.role}', key='{u110.unique_user_key}'")

        # Create a copy of u110 but set its role to ORG_ADMIN
        u110_as_admin = User(
            id=u110.id, organization_id=u110.organization_id, role="ORG_ADMIN", unique_user_key=u110.unique_user_key
        )
        
        # Test 1: User 110 as USER
        d1 = await generate_custom_report_data(db, 36, 3, year="2026", by_default=True, current_user=u110)
        # Test 2: User 110 as ORG_ADMIN
        d2 = await generate_custom_report_data(db, 36, 3, year="2026", by_default=True, current_user=u110_as_admin)

        print("\nTest 1 (User 110 as USER):")
        for sec in d1.get("sections", []):
            for f in sec.get("fields", []):
                if f.get("field_type") == "multi_line_items":
                    for r in f.get("value_items") or []:
                        if r.get("department_name") == "Mechanical Engineering":
                            print(f"   {r}")

        print("\nTest 2 (User 110 as ORG_ADMIN):")
        for sec in d2.get("sections", []):
            for f in sec.get("fields", []):
                if f.get("field_type") == "multi_line_items":
                    for r in f.get("value_items") or []:
                        if r.get("department_name") == "Mechanical Engineering":
                            print(f"   {r}")

if __name__ == "__main__":
    asyncio.run(main())
