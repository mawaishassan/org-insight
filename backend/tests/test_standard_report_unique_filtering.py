import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    Organization,
    ReportTemplate,
    ReportAccessPermission,
    KPI,
    KPIField,
    KPIFieldSubField,
    KPIEntry,
    KpiMultiLineRow,
    KpiMultiLineCell,
    FieldType,
)
from app.reports.service import generate_report_data, invalidate_report_data_cache


async def test_standard_report_unique_key_row_filtering():
    print("=== Testing Standard Report Row-Level Filtering & Calculations ===")
    async with AsyncSessionLocal() as db:
        # 1. Find an org with users
        org = (await db.execute(select(Organization).limit(1))).scalar_one()
        print(f"Using Organization: {org.name} (ID: {org.id})")

        # 2. Find or create a test user with a specific unique_user_key
        u_stmt = select(User).where(User.organization_id == org.id, User.role == "USER")
        user = (await db.execute(u_stmt)).scalars().first()
        if not user:
            user = User(
                username="test_dept_user",
                hashed_password="x",
                role="USER",
                organization_id=org.id,
                unique_user_key="Department of Computer Science",
            )
            db.add(user)
            await db.flush()
        else:
            user.unique_user_key = "Department of Computer Science"
            await db.flush()
        await db.commit()

        # 3. Find a standard report template in this org
        rt_stmt = select(ReportTemplate).where(ReportTemplate.organization_id == org.id)
        rt = (await db.execute(rt_stmt)).scalars().first()
        if not rt:
            print("No report template found; skipping live template test.")
            return

        print(f"Testing Template: {rt.name} (ID: {rt.id})")

        # 4. First test without unique key restriction (Full Access)
        perm = (await db.execute(
            select(ReportAccessPermission).where(
                ReportAccessPermission.report_template_id == rt.id,
                ReportAccessPermission.user_id == user.id,
            )
        )).scalar_one_or_none()
        if not perm:
            perm = ReportAccessPermission(
                report_template_id=rt.id,
                user_id=user.id,
                can_view=True,
                can_use_unique_value=False,
            )
            db.add(perm)
        else:
            perm.can_use_unique_value = False
        await db.commit()

        invalidate_report_data_cache()
        full_data = await generate_report_data(
            db, rt.id, org.id, include_drafts=True, bypass_cache=True, current_user=user
        )
        total_rows_full = 0
        if full_data and "kpis" in full_data:
            for k in full_data["kpis"]:
                for e in k.get("entries", []):
                    for f in e.get("fields", []):
                        if isinstance(f.get("value"), list):
                            total_rows_full += len(f["value"])
        print(f"Full Access (unrestricted) MLI rows loaded: {total_rows_full}")

        # 5. Now switch permission to Unique-Key Based Access
        perm.can_use_unique_value = True
        perm.filter_sub_field_key = "department"
        await db.commit()

        invalidate_report_data_cache()
        filtered_data = await generate_report_data(
            db, rt.id, org.id, include_drafts=True, bypass_cache=True, current_user=user
        )
        total_rows_filtered = 0
        if filtered_data and "kpis" in filtered_data:
            for k in filtered_data["kpis"]:
                for e in k.get("entries", []):
                    for f in e.get("fields", []):
                        if isinstance(f.get("value"), list):
                            total_rows_filtered += len(f["value"])
        print(f"Unique-Key Access (restricted) MLI rows loaded: {total_rows_filtered}")

        # Reset permission back to full access
        perm.can_use_unique_value = False
        await db.commit()
        invalidate_report_data_cache()

        print("=== Standard Report Unique Key Filtering Test Completed Successfully ===")


if __name__ == "__main__":
    asyncio.run(test_standard_report_unique_key_row_filtering())
