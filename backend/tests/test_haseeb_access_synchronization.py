"""
Integration test for immediate and complete access synchronization for user Haseeb Shafique.
Verifies that updating access mode from Full Mode to Unique Key-Based Mode invalidates caches
and immediately enforces strict fail-closed row-level security across Dashboards and Reports.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from sqlalchemy import select, delete

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    Organization,
    Dashboard,
    DashboardAccessPermission,
    CustomReport,
    CustomReportAssignment,
    ReportUserFilterConfiguration,
    ReportAccessPermission,
    ReportTemplate,
)
from app.access_management import execute_bulk_assignment, update_individual_right, invalidate_all_access_and_report_caches
from app.core.access_resolver import resolve_effective_user_access
from app.widget_data.service import _get_dashboard_user_filter_and_permissions


async def test_haseeb_access_synchronization_flow():
    print("=== START: Testing Haseeb Shafique Access Synchronization & Security ===")
    async with AsyncSessionLocal() as db:
        # 1. Setup Organization
        org_res = await db.execute(select(Organization).limit(1))
        org = org_res.scalars().first()
        if not org:
            org = Organization(name="Test Org", code="TESTORG")
            db.add(org)
            await db.flush()

        # 2. Setup User Haseeb Shafique
        u_res = await db.execute(select(User).where(User.username == "haseeb_shafique", User.organization_id == org.id))
        haseeb = u_res.scalars().first()
        if not haseeb:
            haseeb = User(
                username="haseeb_shafique",
                full_name="Haseeb Shafique",
                email="haseeb@example.com",
                hashed_password="dummy_hash",
                role="USER",
                organization_id=org.id,
                unique_user_key="Computer Science",
            )
            db.add(haseeb)
            await db.flush()
        else:
            haseeb.role = "USER"
            haseeb.unique_user_key = "Computer Science"
            await db.flush()

        # Admin user for performing access changes
        admin_res = await db.execute(select(User).where(User.role == "ORG_ADMIN", User.organization_id == org.id))
        admin = admin_res.scalars().first()
        if not admin:
            admin = User(
                username="org_admin_test",
                hashed_password="dummy_hash",
                role="ORG_ADMIN",
                organization_id=org.id,
            )
            db.add(admin)
            await db.flush()
        await db.commit()

        # 3. Setup Test Dashboard and Custom Report
        d_res = await db.execute(select(Dashboard).where(Dashboard.organization_id == org.id))
        dash = d_res.scalars().first()
        if not dash:
            dash = Dashboard(name="Haseeb Test Dashboard", organization_id=org.id)
            db.add(dash)
            await db.flush()

        cr_res = await db.execute(select(CustomReport).where(CustomReport.organization_id == org.id))
        c_report = cr_res.scalars().first()
        if not c_report:
            c_report = CustomReport(name="Haseeb Test Custom Report", organization_id=org.id)
            db.add(c_report)
            await db.flush()
        await db.commit()

        # ----------------------------------------------------------------------
        # PHASE 1: Set Initial Access to Full Mode
        # ----------------------------------------------------------------------
        print("\n--- PHASE 1: Assigning Full Access Mode to Haseeb ---")
        await execute_bulk_assignment(
            db,
            org.id,
            admin,
            user_ids=[haseeb.id],
            dashboard_ids=[dash.id],
            custom_report_ids=[c_report.id],
            report_template_ids=[],
            access_type="full",
            can_view=True,
        )
        await db.commit()

        eff_dash_p1 = await resolve_effective_user_access(db, haseeb, "dashboard", dash.id)
        assert eff_dash_p1.access_type == "full", f"Expected access_type full, got {eff_dash_p1.access_type}"
        assert eff_dash_p1.can_view is True, "Haseeb should have view access"

        filters_p1, perms_p1 = await _get_dashboard_user_filter_and_permissions(db, haseeb, dash.id)
        assert perms_p1["can_use_unique_value"] is False, "Full mode must have can_use_unique_value=False"
        assert filters_p1 == {}, f"Full mode should return empty filters dict, got {filters_p1}"
        print("[OK] Phase 1 PASSED: Full Access Mode configured and verified.")

        # ----------------------------------------------------------------------
        # PHASE 2: Org Admin Reassigns Access to Unique Key-Based Mode
        # ----------------------------------------------------------------------
        print("\n--- PHASE 2: Reassigning Access to Unique Key-Based Mode ---")
        await execute_bulk_assignment(
            db,
            org.id,
            admin,
            user_ids=[haseeb.id],
            dashboard_ids=[dash.id],
            custom_report_ids=[c_report.id],
            report_template_ids=[],
            access_type="unique_key",
            can_view=True,
            filter_sub_field_key="department",
        )
        await db.commit()

        eff_dash_p2 = await resolve_effective_user_access(db, haseeb, "dashboard", dash.id)
        assert eff_dash_p2.access_type == "unique_key", f"Expected access_type unique_key, got {eff_dash_p2.access_type}"

        eff_cr_p2 = await resolve_effective_user_access(db, haseeb, "custom_report", c_report.id)
        assert eff_cr_p2.access_type == "unique_key", f"Expected custom report access_type unique_key, got {eff_cr_p2.access_type}"

        filters_p2, perms_p2 = await _get_dashboard_user_filter_and_permissions(db, haseeb, dash.id)
        assert perms_p2["can_use_unique_value"] is True, "Unique Key mode must have can_use_unique_value=True"
        assert "department" in filters_p2, f"Expected 'department' filter key in {filters_p2}"
        assert filters_p2["department"] == ["Computer Science"], f"Expected ['Computer Science'], got {filters_p2['department']}"
        print("[OK] Phase 2 PASSED: Immediate synchronization to Unique Key-Based Mode verified.")

        # ----------------------------------------------------------------------
        # PHASE 3: Fail-Closed Verification (Missing Unique Key)
        # ----------------------------------------------------------------------
        print("\n--- PHASE 3: Testing Fail-Closed Security (Unset/Empty Unique Key) ---")
        haseeb.unique_user_key = ""
        await db.flush()
        invalidate_all_access_and_report_caches(db)

        eff_dash_p3 = await resolve_effective_user_access(db, haseeb, "dashboard", dash.id)
        assert eff_dash_p3.is_satisfiable is False, "Empty key under unique_key mode must mark is_satisfiable=False"

        filters_p3, perms_p3 = await _get_dashboard_user_filter_and_permissions(db, haseeb, dash.id)
        assert "__IMPOSSIBLE_KEY__" in filters_p3, f"Fail-closed must return sentinel __IMPOSSIBLE_KEY__, got {filters_p3}"
        assert filters_p3["__IMPOSSIBLE_KEY__"] == ["__DENIED__"], "Fail-closed filter must be __DENIED__"
        print("[OK] Phase 3 PASSED: Strict fail-closed security verified.")

        # Reset Haseeb key
        haseeb.unique_user_key = "Computer Science"
        await db.commit()

        print("\n=== ALL HASEEB ACCESS SYNCHRONIZATION TESTS PASSED CLEANLY! ===")


if __name__ == "__main__":
    asyncio.run(test_haseeb_access_synchronization_flow())
