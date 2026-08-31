import sys
import asyncio
sys.path.insert(0, "./backend")

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    UserRole,
    Organization,
    CustomReport,
    CustomReportAssignment,
    ReportAccessPermission,
    ReportTemplate
)
from app.reports.service import (
    assign_report_to_user,
    user_can_access_report,
    generate_report_data
)
from app.reports.custom_service import (
    assign_custom_report,
    generate_custom_report_data
)
from app.reports.custom_routes import check_custom_report_access
from sqlalchemy import select

async def run_verification():
    print("Starting Period Shifting Permission Verification...")
    async with AsyncSessionLocal() as db:
        # 1. Fetch or create a test Organization
        org_res = await db.execute(select(Organization).limit(1))
        org = org_res.scalar_one_or_none()
        if not org:
            org = Organization(name="Test Org")
            db.add(org)
            await db.flush()
        print(f"Using Organization: {org.name} (ID: {org.id})")

        # 2. Fetch or create test User
        user_res = await db.execute(select(User).where(User.username == "period_test_user"))
        user = user_res.scalar_one_or_none()
        if not user:
            user = User(
                username="period_test_user",
                email="period_user@example.com",
                full_name="Period User",
                hashed_password="hashedpassword123",
                role=UserRole.USER,
                organization_id=org.id,
                unique_user_key="KEY-PERIOD-001"
            )
            db.add(user)
            await db.flush()
        print(f"Using User: {user.username}")

        # 3. Create Standard Report Template
        template = ReportTemplate(
            name="Std Shifting Report",
            organization_id=org.id,
            fetch_data_with_date=True,
            date_fetching_config={
                "default_period": "2026/27",
                "custom_period_start_month": 7,
                "custom_period_display_format": "YYYY/YY",
                "custom_period_duration_months": 12
            }
        )
        db.add(template)
        await db.flush()
        print(f"Created standard template: {template.name} (ID: {template.id})")

        # 4. Create Custom Report Template
        custom_report = CustomReport(
            name="Custom Shifting Report",
            organization_id=org.id,
            fetch_data_with_date=True,
            date_fetching_config={
                "default_period": "2027/28",
                "custom_period_start_month": 1,
                "custom_period_display_format": "YYYY/YY",
                "custom_period_duration_months": 12
            }
        )
        db.add(custom_report)
        await db.flush()
        print(f"Created custom template: {custom_report.name} (ID: {custom_report.id})")

        # --- Test standard report permission ---
        print("\nTesting Standard Report Permissions...")
        # Assign report access with can_change_period=False
        perm = await assign_report_to_user(
            db, template.id, org.id, user.id,
            can_view=True, can_print=True, can_export=True,
            can_change_period=False
        )
        await db.flush()
        assert perm is not None, "Standard assignment failed"
        assert perm.can_change_period is False, "can_change_period should be False"
        print("  - assign_report_to_user with can_change_period=False [PASS]")

        can_shift_std = await user_can_access_report(db, user.id, template.id, "change_period")
        assert can_shift_std is False, "user should not be allowed to change period"
        print("  - user_can_access_report change_period check is False [PASS]")

        # Test period fallback (by_default=False / year=None should fallback to default_period)
        data_std = await generate_report_data(
            db, template.id, org.id, year=None, by_default=False, period_type="Fiscal Year"
        )
        assert data_std is not None
        assert data_std["year"] == "2026/27", f"Expected year to be 2026/27, got {data_std['year']}"
        print("  - generate_report_data default fallback [PASS]")

        # --- Test custom report permission ---
        print("\nTesting Custom Report Permissions...")
        # Assign custom report access with can_change_period=False
        custom_perm = await assign_custom_report(
            db, custom_report.id, user.id,
            can_view=True, can_print=True, can_export=True,
            can_change_period=False
        )
        await db.flush()
        assert custom_perm is not None, "Custom assignment failed"
        assert custom_perm.can_change_period is False, "custom can_change_period should be False"
        print("  - assign_custom_report with can_change_period=False [PASS]")

        can_shift_custom = await check_custom_report_access(db, user, custom_report.id, "change_period")
        assert can_shift_custom is False, "user should not be allowed to change period on custom report"
        print("  - check_custom_report_access change_period check is False [PASS]")

        # Test period fallback for custom reports
        data_custom = await generate_custom_report_data(
            db, custom_report.id, org.id, year=None, by_default=False, period_type="Fiscal Year"
        )
        assert data_custom is not None
        assert data_custom["year"] == "2027/28", f"Expected year to be 2027/28, got {data_custom['year']}"
        print("  - generate_custom_report_data default fallback [PASS]")

        print("\nALL PERIOD SHIFTING PERMISSION CHECKS PASSED [SUCCESS]")
        await db.rollback()
        print("Database transaction rolled back successfully.")

if __name__ == "__main__":
    asyncio.run(run_verification())
