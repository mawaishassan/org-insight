import asyncio
import sys
sys.path.insert(0, ".")
import datetime
from datetime import datetime

from app.core.database import AsyncSessionLocal
from app.core.models import User, UserRole, Organization, ReportTemplate, CustomReport, ReportAccessPermission, CustomReportAssignment
from app.reports.routes import generate_report as generate_standard_report_route
from app.reports.custom_routes import generate_report as generate_custom_report_route
from sqlalchemy import select

async def run_verification():
    print("Starting Route Fallback Verification when can_change_period is False...")
    async with AsyncSessionLocal() as db:
        # 1. Fetch organization
        org_res = await db.execute(select(Organization).limit(1))
        org = org_res.scalar_one_or_none()
        assert org is not None, "No organization found"
        print(f"Using Organization: {org.name} (ID: {org.id})")

        # 2. Fetch or create a test user
        user_res = await db.execute(select(User).where(User.username == "route_fallback_user"))
        user = user_res.scalar_one_or_none()
        if not user:
            user = User(
                username="route_fallback_user",
                email="route_fallback_user@example.com",
                full_name="Route Fallback User",
                hashed_password="hashedpassword123",
                role=UserRole.USER,
                organization_id=org.id,
                unique_user_key="KEY-FALLBACK-001"
            )
            db.add(user)
            await db.flush()
        print(f"Using User: {user.username} (Role: {user.role})")

        # 3. Create Standard Report Template with configured period
        template = ReportTemplate(
            name="Std Fallback Report",
            organization_id=org.id,
            fetch_data_with_date=True,
            date_fetching_config={
                "default_period_type": "Fiscal Year",
                "default_period": "2025/26",
                "custom_period_start_month": 7,
                "custom_period_display_format": "YYYY/YY",
                "custom_period_duration_months": 12
            }
        )
        db.add(template)
        await db.flush()
        print(f"Created Standard Template: {template.name} (ID: {template.id})")

        # 4. Create Custom Report with configured period
        custom_report = CustomReport(
            name="Custom Fallback Report",
            organization_id=org.id,
            fetch_data_with_date=True,
            date_fetching_config={
                "default_period_type": "Fiscal Year",
                "default_period": "2026/27",
                "custom_period_start_month": 7,
                "custom_period_display_format": "YYYY/YY",
                "custom_period_duration_months": 12
            }
        )
        db.add(custom_report)
        await db.flush()
        print(f"Created Custom Report: {custom_report.name} (ID: {custom_report.id})")

        # 5. Assign standard template with can_change_period=False
        std_perm = ReportAccessPermission(
            report_template_id=template.id,
            user_id=user.id,
            can_view=True,
            can_print=True,
            can_export=True,
            can_change_period=False
        )
        db.add(std_perm)

        # 6. Assign custom report with can_change_period=False
        custom_perm = CustomReportAssignment(
            custom_report_id=custom_report.id,
            user_id=user.id,
            can_view=True,
            can_print=True,
            can_export=True,
            can_change_period=False
        )
        db.add(custom_perm)
        await db.flush()

        # 7. Test Standard Route fallback.
        # Although we request year="2028/29", period_type="Fiscal Year", by_default=False,
        # the route should restrict us and fallback to "2025/26" of "Fiscal Year".
        print("Testing Standard Report Route Fallback...")
        res_std = await generate_standard_report_route(
            template_id=template.id,
            year="2028/29",
            format="json",
            organization_id=org.id,
            by_default=False,
            period_type="Fiscal Year",
            db=db,
            current_user=user
        )
        print(f"  Standard Route Resolved Period: {res_std['year']} (Keys: {list(res_std.keys())})")
        assert res_std["year"] == "2025/26", f"Expected year 2025/26, got {res_std['year']}"

        # 8. Test Custom Route fallback.
        # Although we request year="2028/29", period_type="Fiscal Year", by_default=False,
        # the route should restrict us and fallback to "2026/27" of "Fiscal Year".
        print("Testing Custom Report Route Fallback...")
        res_custom = await generate_custom_report_route(
            id=custom_report.id,
            year="2028/29",
            organization_id=org.id,
            by_default=False,
            period_type="Fiscal Year",
            db=db,
            current_user=user
        )
        print(f"  Custom Route Resolved Period: {res_custom['year']} (Type: {res_custom['period_type']})")
        assert res_custom["year"] == "2026/27", f"Expected year 2026/27, got {res_custom['year']}"
        assert res_custom["period_type"] == "Fiscal Year", f"Expected period_type Fiscal Year, got {res_custom['period_type']}"

        # 9. Create standard and custom reports WITHOUT configured periods
        template_unconfig = ReportTemplate(
            name="Std Unconfigured Report",
            organization_id=org.id,
            fetch_data_with_date=False,
            date_fetching_config=None
        )
        db.add(template_unconfig)
        
        custom_unconfig = CustomReport(
            name="Custom Unconfigured Report",
            organization_id=org.id,
            fetch_data_with_date=False,
            date_fetching_config=None
        )
        db.add(custom_unconfig)
        await db.flush()

        # Assign permission with can_change_period=False
        std_perm_unconfig = ReportAccessPermission(
            report_template_id=template_unconfig.id,
            user_id=user.id,
            can_view=True,
            can_print=True,
            can_export=True,
            can_change_period=False
        )
        db.add(std_perm_unconfig)

        custom_perm_unconfig = CustomReportAssignment(
            custom_report_id=custom_unconfig.id,
            user_id=user.id,
            can_view=True,
            can_print=True,
            can_export=True,
            can_change_period=False
        )
        db.add(custom_perm_unconfig)
        await db.flush()

        # 10. Test Standard Route fallback for unconfigured template (should fallback to current year Data Entry)
        print("Testing Standard Report Unconfigured Route Fallback...")
        res_std_un = await generate_standard_report_route(
            template_id=template_unconfig.id,
            year="2028/29",
            format="json",
            organization_id=org.id,
            by_default=False,
            period_type="Fiscal Year",
            db=db,
            current_user=user
        )
        current_year = str(datetime.now().year)
        print(f"  Unconfigured Standard Route Resolved Period: {res_std_un['year']} (Expected: {current_year})")
        assert str(res_std_un["year"]) == current_year, f"Expected year {current_year}, got {res_std_un['year']}"

        # 11. Test Custom Route fallback for unconfigured report (should fallback to current year Data Entry)
        print("Testing Custom Report Unconfigured Route Fallback...")
        res_custom_un = await generate_custom_report_route(
            id=custom_unconfig.id,
            year="2028/29",
            organization_id=org.id,
            by_default=False,
            period_type="Fiscal Year",
            db=db,
            current_user=user
        )
        print(f"  Unconfigured Custom Route Resolved Period: {res_custom_un['year']} (Type: {res_custom_un['period_type']}) (Expected: {current_year})")
        assert str(res_custom_un["year"]) == current_year, f"Expected year {current_year}, got {res_custom_un['year']}"
        assert res_custom_un["period_type"] == "Data Entry", f"Expected Data Entry, got {res_custom_un['period_type']}"

        print("\nALL FALLBACK ROUTE TESTS PASSED [SUCCESS]")
        await db.rollback()
        print("Database transaction rolled back successfully.")

if __name__ == "__main__":
    asyncio.run(run_verification())
