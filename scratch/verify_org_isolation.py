import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
import asyncio
from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    UserRole,
    Organization,
    Dashboard,
    CustomReport,
    ReportTemplate,
)
from app.core.access_resolver import resolve_effective_user_access
from app.dashboards.service import user_can_access_dashboard
from app.reports.service import user_can_access_report
from app.reports.custom_routes import check_custom_report_access
from app.access_management.service import preview_bulk_assignment, execute_bulk_assignment


async def run_isolation_tests():
    print("=== STARTING MULTI-TENANT ISOLATION & ACCESS ENFORCEMENT VERIFICATION ===")
    
    async with AsyncSessionLocal() as db:
        # 1. Fetch available organizations
        orgs_res = await db.execute(select(Organization).order_by(Organization.id))
        orgs = orgs_res.scalars().all()
        if len(orgs) < 2:
            print("[WARN] Need at least 2 organizations to test cross-tenant isolation. Creating Org 2...")
            org2 = Organization(name="Test Isolation Org 2", code="TEST_ORG_2")
            db.add(org2)
            await db.commit()
            await db.refresh(org2)
            orgs.append(org2)
        
        org1 = orgs[0]
        org2 = orgs[1]
        print(f"Organization 1: {org1.name} (ID: {org1.id})")
        print(f"Organization 2: {org2.name} (ID: {org2.id})")

        # 2. Get or create test users
        # Super Admin
        super_admin_res = await db.execute(select(User).where(User.role == UserRole.SUPER_ADMIN))
        super_admin = super_admin_res.scalars().first()
        
        # Org 1 Admin
        org1_admin_res = await db.execute(
            select(User).where(User.organization_id == org1.id, User.role == UserRole.ORG_ADMIN)
        )
        org1_admin = org1_admin_res.scalars().first()
        if not org1_admin:
            org1_admin = User(
                username=f"admin_test_org1_{org1.id}",
                email=f"admin_org1_{org1.id}@example.com",
                role=UserRole.ORG_ADMIN,
                organization_id=org1.id,
                hashed_password="fake",
            )
            db.add(org1_admin)
            await db.commit()
            await db.refresh(org1_admin)

        # Org 1 Regular User
        org1_user_res = await db.execute(
            select(User).where(User.organization_id == org1.id, User.role == UserRole.USER)
        )
        org1_user = org1_user_res.scalars().first()
        if not org1_user:
            org1_user = User(
                username=f"user_test_org1_{org1.id}",
                email=f"user_org1_{org1.id}@example.com",
                role=UserRole.USER,
                organization_id=org1.id,
                hashed_password="fake",
            )
            db.add(org1_user)
            await db.commit()
            await db.refresh(org1_user)

        # Ensure Org 2 has a dashboard, standard report, and custom report
        dash2_res = await db.execute(select(Dashboard).where(Dashboard.organization_id == org2.id))
        dash2 = dash2_res.scalars().first()
        if not dash2:
            dash2 = Dashboard(name="Org 2 Secret Dashboard", organization_id=org2.id, is_active=True)
            db.add(dash2)
            await db.commit()
            await db.refresh(dash2)

        rep2_res = await db.execute(select(ReportTemplate).where(ReportTemplate.organization_id == org2.id))
        rep2 = rep2_res.scalars().first()
        if not rep2:
            rep2 = ReportTemplate(name="Org 2 Secret Template", organization_id=org2.id)
            db.add(rep2)
            await db.commit()
            await db.refresh(rep2)

        custom2_res = await db.execute(select(CustomReport).where(CustomReport.organization_id == org2.id))
        custom2 = custom2_res.scalars().first()
        if not custom2:
            custom2 = CustomReport(name="Org 2 Secret Custom Report", organization_id=org2.id)
            db.add(custom2)
            await db.commit()
            await db.refresh(custom2)

        print("\n--- TEST 1: access_resolver.py Multi-Tenant Isolation ---")
        # Org 1 user querying Org 2 dashboard
        res_d = await resolve_effective_user_access(db, org1_user, "dashboard", dash2.id, organization_id=org1.id)
        assert not res_d.can_view, f"Expected can_view=False, got {res_d.can_view}"
        assert not res_d.is_satisfiable, f"Expected is_satisfiable=False, got {res_d.is_satisfiable}"
        print(f"[OK] Org 1 regular user blocked from Org 2 Dashboard: can_view={res_d.can_view}")

        # Org 1 admin querying Org 2 dashboard
        res_da = await resolve_effective_user_access(db, org1_admin, "dashboard", dash2.id, organization_id=org1.id)
        assert not res_da.can_view, f"Expected can_view=False for Org 1 Admin on Org 2 resource, got {res_da.can_view}"
        print(f"[OK] Org 1 admin blocked from Org 2 Dashboard: can_view={res_da.can_view}")

        # Super admin scoped to Org 1 querying Org 2 dashboard
        if super_admin:
            res_sa = await resolve_effective_user_access(db, super_admin, "dashboard", dash2.id, organization_id=org1.id)
            assert not res_sa.can_view, f"Expected Super Admin scoped to Org 1 to be blocked from Org 2 Dashboard"
            print(f"[OK] Super Admin scoped to Org 1 blocked from Org 2 Dashboard: can_view={res_sa.can_view}")

        # Org 1 user querying Org 2 Standard Report
        res_r = await resolve_effective_user_access(db, org1_user, "report", rep2.id, organization_id=org1.id)
        assert not res_r.can_view, f"Expected can_view=False, got {res_r.can_view}"
        print(f"[OK] Org 1 user blocked from Org 2 Standard Report: can_view={res_r.can_view}")

        # Org 1 user querying Org 2 Custom Report
        res_cr = await resolve_effective_user_access(db, org1_user, "custom_report", custom2.id, organization_id=org1.id)
        assert not res_cr.can_view, f"Expected can_view=False, got {res_cr.can_view}"
        print(f"[OK] Org 1 user blocked from Org 2 Custom Report: can_view={res_cr.can_view}")

        print("\n--- TEST 2: dashboards.service user_can_access_dashboard Isolation ---")
        can_acc_u = await user_can_access_dashboard(db, org1_user.id, dash2.id, org_id=org1.id)
        assert not can_acc_u, "user_can_access_dashboard allowed Org 1 user on Org 2 dashboard!"
        can_acc_a = await user_can_access_dashboard(db, org1_admin.id, dash2.id, org_id=org1.id)
        assert not can_acc_a, "user_can_access_dashboard allowed Org 1 admin on Org 2 dashboard!"
        if super_admin:
            can_acc_s = await user_can_access_dashboard(db, super_admin.id, dash2.id, org_id=org1.id)
            assert not can_acc_s, "user_can_access_dashboard allowed scoped Super Admin on mismatched Org 2 dashboard!"
        print("[OK] user_can_access_dashboard strictly enforces organization boundaries.")

        print("\n--- TEST 3: reports.service user_can_access_report Isolation ---")
        can_rep_u = await user_can_access_report(db, org1_user.id, rep2.id, org_id=org1.id)
        assert not can_rep_u, "user_can_access_report allowed Org 1 user on Org 2 report!"
        can_rep_a = await user_can_access_report(db, org1_admin.id, rep2.id, org_id=org1.id)
        assert not can_rep_a, "user_can_access_report allowed Org 1 admin on Org 2 report!"
        if super_admin:
            can_rep_s = await user_can_access_report(db, super_admin.id, rep2.id, org_id=org1.id)
            assert not can_rep_s, "user_can_access_report allowed scoped Super Admin on mismatched Org 2 report!"
        print("[OK] user_can_access_report strictly enforces organization boundaries.")

        print("\n--- TEST 4: reports.custom_routes check_custom_report_access Isolation ---")
        can_cr_u = await check_custom_report_access(db, org1_user, custom2.id, "view", org_id=org1.id)
        assert not can_cr_u, "check_custom_report_access allowed Org 1 user on Org 2 custom report!"
        can_cr_a = await check_custom_report_access(db, org1_admin, custom2.id, "view", org_id=org1.id)
        assert not can_cr_a, "check_custom_report_access allowed Org 1 admin on Org 2 custom report!"
        if super_admin:
            can_cr_s = await check_custom_report_access(db, super_admin, custom2.id, "view", org_id=org1.id)
            assert not can_cr_s, "check_custom_report_access allowed scoped Super Admin on mismatched Org 2 custom report!"
        print("[OK] check_custom_report_access strictly enforces organization boundaries.")

        print("\n--- TEST 5: Centralized Rights Bulk Assignment Cross-Org Rejection ---")
        # Attempt to assign Org 2 dashboard to Org 1 user in Org 1 context
        try:
            prev = await preview_bulk_assignment(
                db,
                organization_id=org1.id,
                user_ids=[org1_user.id],
                dashboard_ids=[dash2.id],
                custom_report_ids=[],
                report_template_ids=[],
                access_type="full",
            )
            print(f"Preview cross-org result: targets={prev.get('total_targets')}")
            assert prev.get("total_targets", 0) == 0, f"Expected 0 targets in preview for cross-org, got {prev.get('total_targets')}"
        except Exception as e:
            print(f"[OK] Preview rejected cross-org resource: {e}")

        exec_res = await execute_bulk_assignment(
            db,
            organization_id=org1.id,
            admin_user=org1_admin,
            user_ids=[org1_user.id],
            dashboard_ids=[dash2.id],
            custom_report_ids=[],
            report_template_ids=[],
            access_type="full",
        )
        print(f"Execution cross-org result: created={exec_res.get('created_count')}, failed={exec_res.get('failed_count')}")
        assert exec_res.get("created_count", 0) == 0, f"Expected 0 created for cross-org assignment, got {exec_res.get('created_count')}"
        assert exec_res.get("failed_count", 0) > 0, f"Expected failed_count > 0 for cross-org assignment, got {exec_res.get('failed_count')}"
        print("[OK] execute_bulk_assignment strictly rejects cross-org resource assignments.")

    print("\n=== ALL MULTI-TENANT ISOLATION & ACCESS ENFORCEMENT VERIFICATIONS PASSED [SUCCESS] ===")


if __name__ == "__main__":
    asyncio.run(run_isolation_tests())
