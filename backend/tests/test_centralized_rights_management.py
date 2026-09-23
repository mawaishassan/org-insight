import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    Organization,
    Dashboard,
    DashboardAccessPermission,
    CustomReport,
    CustomReportAssignment,
    ReportTemplate,
    ReportAccessPermission,
    AccessManagementAudit,
)
from app.access_management.service import (
    list_unified_rights,
    preview_bulk_assignment,
    execute_bulk_assignment,
    update_individual_right,
    bulk_update_rights,
    revoke_right,
    get_user_rights_summary,
    get_resource_rights_summary,
)
from app.access_management.audit import list_rights_audit_logs


async def run_tests():
    print("=== Testing Centralized Rights Management Module ===")
    async with AsyncSessionLocal() as db:
        # 1. Fetch organization and admin user
        org_res = await db.execute(select(Organization).limit(1))
        org = org_res.scalar_one_or_none()
        assert org is not None, "Organization not found"
        print(f"Organization: {org.name} (ID: {org.id})")

        admin_res = await db.execute(
            select(User).where(User.organization_id == org.id, User.role.in_(["ORG_ADMIN", "SUPER_ADMIN"])).limit(1)
        )
        admin = admin_res.scalar_one_or_none()
        if not admin:
            admin_res = await db.execute(select(User).limit(1))
            admin = admin_res.scalar_one_or_none()
        assert admin is not None, "Admin user not found"
        print(f"Admin User: {admin.username} (ID: {admin.id})")

        # 2. Fetch or create sample users
        users_res = await db.execute(
            select(User).where(User.organization_id == org.id).limit(3)
        )
        test_users = list(users_res.scalars().all())
        assert len(test_users) > 0, "No test users found"
        user_ids = [u.id for u in test_users]
        print(f"Test Users: {[u.username for u in test_users]}")

        # 3. Fetch or create sample dashboard & custom report
        d_res = await db.execute(select(Dashboard).where(Dashboard.organization_id == org.id).limit(1))
        dash = d_res.scalar_one_or_none()
        if not dash:
            dash = Dashboard(name="Test Rights Dashboard", organization_id=org.id)
            db.add(dash)
            await db.flush()

        cr_res = await db.execute(select(CustomReport).where(CustomReport.organization_id == org.id).limit(1))
        cr = cr_res.scalar_one_or_none()
        if not cr:
            cr = CustomReport(name="Test Rights Custom Report", organization_id=org.id)
            db.add(cr)
            await db.flush()

        rt_res = await db.execute(select(ReportTemplate).where(ReportTemplate.organization_id == org.id).limit(1))
        rt = rt_res.scalar_one_or_none()
        if not rt:
            rt = ReportTemplate(name="Test Standard Report", organization_id=org.id, template_mode="designer")
            db.add(rt)
            await db.flush()

        d_ids = [dash.id]
        cr_ids = [cr.id]
        rt_ids = [rt.id]
        print(f"Test Targets - Dashboards: {d_ids}, Custom Reports: {cr_ids}, Standard Reports: {rt_ids}")

        # 4. Test Preview Bulk Assignment
        print("\n--- 4. Testing Bulk Assign Preview ---")
        preview = await preview_bulk_assignment(
            db,
            org.id,
            user_ids=user_ids,
            dashboard_ids=d_ids,
            custom_report_ids=cr_ids,
            report_template_ids=rt_ids,
            access_type="unique_key",
            filter_sub_field_key="department",
        )
        print("Preview Result:", preview)
        assert preview["users_count"] == len(user_ids)

        # 5. Test Execute Bulk Assignment
        print("\n--- 5. Testing Bulk Assign Execution ---")
        result = await execute_bulk_assignment(
            db,
            org.id,
            admin,
            user_ids=user_ids,
            dashboard_ids=d_ids,
            custom_report_ids=cr_ids,
            report_template_ids=rt_ids,
            access_type="unique_key",
            can_view=True,
            filter_sub_field_key="department",
        )
        print("Execution Result:", result)
        assert result["created_count"] + result["updated_count"] + result["unchanged_count"] > 0

        # Verify ReportAccessPermission has can_use_unique_value == True
        rt_perm_res = await db.execute(
            select(ReportAccessPermission).where(
                ReportAccessPermission.report_template_id == rt.id,
                ReportAccessPermission.user_id.in_(user_ids),
            )
        )
        rt_perms = rt_perm_res.scalars().all()
        assert len(rt_perms) > 0
        for p in rt_perms:
            assert p.can_use_unique_value is True, f"Expected can_use_unique_value=True on standard report permission, got {p.can_use_unique_value}"
            assert p.filter_sub_field_key == "department"
        print("ReportAccessPermission unique key verification: OK")

        # 6. Test Listing Unified Rights with Filters
        print("\n--- 6. Testing Listing Unified Rights ---")
        items, total, counts = await list_unified_rights(
            db,
            org.id,
            page=1,
            page_size=10,
            user_type="all",
            resource_type="all",
            access_type="all",
            status="all",
        )
        print(f"Total Rights: {total}, Counts: {counts}")
        print(f"Sample Item: {items[0] if items else 'None'}")
        assert total > 0

        # 7. Test User-Centric and Resource-Centric Summaries
        print("\n--- 7. Testing User & Resource Centric Views ---")
        u_summary = await get_user_rights_summary(db, org.id, user_ids[0])
        print(f"User Summary for {test_users[0].username}: {len(u_summary['dashboards'])} dashboards, {len(u_summary['reports'])} reports")

        if d_ids:
            r_summary = await get_resource_rights_summary(db, org.id, "dashboard", d_ids[0])
            print(f"Resource Summary for Dashboard #{d_ids[0]}: {len(r_summary['assigned_users'])} assigned users")

        # 8. Test Individual Update (Deactivate / Activate)
        print("\n--- 8. Testing Individual Right Update ---")
        first_item = items[0]
        update_res = await update_individual_right(
            db,
            org.id,
            admin,
            first_item["resource_type"],
            first_item["id"],
            {"is_active": False},
        )
        assert update_res and update_res.get("ok"), "Update failed"
        print("Individual Right deactivation: OK")

        # Re-activate
        update_res2 = await update_individual_right(
            db,
            org.id,
            admin,
            first_item["resource_type"],
            first_item["id"],
            {"is_active": True},
        )
        assert update_res2 and update_res2.get("ok"), "Re-activation failed"
        print("Individual Right re-activation: OK")

        # 10. Test Preview Sync on Config Change & Resource Assigned User Schema
        print("\n--- 10. Testing Preview Sync on Config Change & Schema Integrity ---")
        # Test switching custom report from unique_key to full
        preview_switch = await preview_bulk_assignment(
            db,
            org.id,
            user_ids=user_ids,
            dashboard_ids=[],
            custom_report_ids=cr_ids,
            report_template_ids=[],
            access_type="full",
        )
        print("Preview Switch Result:", preview_switch)
        # Since it was previously unique_key, switching to full must register as an update!
        assert preview_switch["rights_to_update_count"] > 0, "Preview should detect config change from unique_key to full"

        # Check resource summary has new fields
        res_summary = await get_resource_rights_summary(db, "dashboard", d_ids[0], org.id)
        assert res_summary is not None
        if res_summary["assigned_users"]:
            first_u = res_summary["assigned_users"][0]
            assert "can_download_widget_pdf" in first_u
            assert "can_view_drilldown" in first_u
            assert "can_download_word" in first_u
        print("Resource Summary Schema check: OK")

        print("\n=== ALL CENTRALIZED RIGHTS MANAGEMENT BACKEND TESTS PASSED [SUCCESS] ===")


if __name__ == "__main__":
    asyncio.run(run_tests())

