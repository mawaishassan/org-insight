import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import asyncio
from sqlalchemy import select, delete

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    Organization,
    CustomReport,
    CustomReportAssignment,
    ReportUserFilterConfiguration,
)
from app.access_management import (
    execute_bulk_assignment,
    update_individual_right,
    list_unified_rights,
    invalidate_all_access_and_report_caches,
)
from app.core.access_resolver import resolve_effective_user_access
from app.widget_data.service import _auth_cache, invalidate_auth_cache
from app.reports.service import REPORT_DATA_CACHE


async def test_custom_report_isolation_and_mode_switching():
    print("=== START: Multi-User Custom Report Access Isolation & Switching Test ===")
    async with AsyncSessionLocal() as db:
        # Setup Organization
        org_res = await db.execute(select(Organization).limit(1))
        org = org_res.scalars().first()
        assert org is not None, "Organization required"

        # Admin
        admin_res = await db.execute(select(User).where(User.role == "ORG_ADMIN", User.organization_id == org.id))
        admin = admin_res.scalars().first()
        if not admin:
            admin = User(username="admin_sync_test", hashed_password="pw", role="ORG_ADMIN", organization_id=org.id)
            db.add(admin)
            await db.flush()

        # User A (Full Access)
        uA_res = await db.execute(select(User).where(User.username == "sync_user_a", User.organization_id == org.id))
        user_a = uA_res.scalars().first()
        if not user_a:
            user_a = User(
                username="sync_user_a",
                full_name="User A Full",
                email="usera@test.com",
                hashed_password="pw",
                role="USER",
                organization_id=org.id,
                unique_user_key="Physics",
            )
            db.add(user_a)
            await db.flush()

        # User B (Key-Based Access)
        uB_res = await db.execute(select(User).where(User.username == "sync_user_b", User.organization_id == org.id))
        user_b = uB_res.scalars().first()
        if not user_b:
            user_b = User(
                username="sync_user_b",
                full_name="User B Key",
                email="userb@test.com",
                hashed_password="pw",
                role="USER",
                organization_id=org.id,
                unique_user_key="Chemistry",
            )
            db.add(user_b)
            await db.flush()

        await db.commit()

        # Custom Report
        cr_res = await db.execute(select(CustomReport).where(CustomReport.name == "MultiUser Isolation Test CR", CustomReport.organization_id == org.id))
        cr = cr_res.scalars().first()
        if not cr:
            cr = CustomReport(name="MultiUser Isolation Test CR", organization_id=org.id)
            db.add(cr)
            await db.flush()
        await db.commit()

        # TEST 1: Assign User A -> Full Mode
        print("\n--- Test 1: Assign User A to Full Mode on Custom Report ---")
        await execute_bulk_assignment(
            db,
            org.id,
            admin,
            user_ids=[user_a.id],
            dashboard_ids=[],
            custom_report_ids=[cr.id],
            report_template_ids=[],
            access_type="full",
            can_view=True,
        )
        await db.commit()

        # TEST 2: Assign User B -> Unique Key Mode on SAME Custom Report
        print("\n--- Test 2: Assign User B to Unique Key Mode on SAME Custom Report ---")
        await execute_bulk_assignment(
            db,
            org.id,
            admin,
            user_ids=[user_b.id],
            dashboard_ids=[],
            custom_report_ids=[cr.id],
            report_template_ids=[],
            access_type="unique_key",
            can_view=True,
            filter_sub_field_key="department",
        )
        await db.commit()

        # Verify Isolation: User A MUST still be Full, User B MUST be unique_key
        eff_a = await resolve_effective_user_access(db, user_a, "custom_report", cr.id)
        eff_b = await resolve_effective_user_access(db, user_b, "custom_report", cr.id)
        assert eff_a.access_type == "full", f"User A should have full access, got {eff_a.access_type}"
        assert eff_b.access_type == "unique_key", f"User B should have unique_key access, got {eff_b.access_type}"
        assert eff_b.filter_sub_field_key == "department", f"User B filter_sub_field_key should be department, got {eff_b.filter_sub_field_key}"
        print("[OK] Test 1 & 2 PASSED: Independent access modes verified on same custom report.")

        # TEST 3: Edit Mode - Switch User A from Full -> Unique Key via update_individual_right
        print("\n--- Test 3: Edit User A: Full -> Unique Key ---")
        assign_a_res = await db.execute(
            select(CustomReportAssignment).where(
                CustomReportAssignment.custom_report_id == cr.id,
                CustomReportAssignment.user_id == user_a.id,
            )
        )
        assign_a = assign_a_res.scalar_one()

        res_edit = await update_individual_right(
            db,
            org.id,
            admin,
            resource_type="custom_report",
            permission_id=assign_a.id,
            patch={
                "access_type": "unique_key",
                "filter_sub_field_key": "department",
            },
        )
        assert res_edit and res_edit.get("ok"), f"Update failed: {res_edit}"

        eff_a_edited = await resolve_effective_user_access(db, user_a, "custom_report", cr.id)
        assert eff_a_edited.access_type == "unique_key", f"User A should now have unique_key, got {eff_a_edited.access_type}"
        assert eff_a_edited.filter_sub_field_key == "department"
        print("[OK] Test 3 PASSED: Full -> Unique Key switch verified.")

        # TEST 4: Edit Mode - Switch User A from Unique Key -> Full Access
        print("\n--- Test 4: Edit User A: Unique Key -> Full Access ---")
        res_full = await update_individual_right(
            db,
            org.id,
            admin,
            resource_type="custom_report",
            permission_id=assign_a.id,
            patch={
                "access_type": "full",
            },
        )
        assert res_full and res_full.get("ok"), f"Update failed: {res_full}"

        eff_a_full = await resolve_effective_user_access(db, user_a, "custom_report", cr.id)
        assert eff_a_full.access_type == "full", f"User A should be full, got {eff_a_full.access_type}"
        # Filter fields must be reset
        assert eff_a_full.filter_sub_field_key is None, f"Filter sub field should be cleared, got {eff_a_full.filter_sub_field_key}"
        print("[OK] Test 4 PASSED: Unique Key -> Full Access switch cleared filters properly.")

        # TEST 5: Cache Invalidation Functionality
        print("\n--- Test 5: Cache Invalidation Verification ---")
        _auth_cache.set(("allowed_kpi", 999, org.id, 999, user_a.id), True)
        REPORT_DATA_CACHE["test_report_key"] = "test_data"
        assert len(_auth_cache._cache) > 0, "Auth cache should have entry"
        assert "test_report_key" in REPORT_DATA_CACHE, "REPORT_DATA_CACHE should have entry"

        invalidate_all_access_and_report_caches(db)

        assert len(_auth_cache._cache) == 0, f"Auth cache should be empty after invalidate, got {len(_auth_cache._cache)}"
        assert len(REPORT_DATA_CACHE) == 0, f"REPORT_DATA_CACHE should be empty after invalidate, got {len(REPORT_DATA_CACHE)}"
        print("[OK] Test 5 PASSED: _auth_cache and REPORT_DATA_CACHE invalidated cleanly.")

        # TEST 6: Unified Rights Listing
        print("\n--- Test 6: Unified Rights Listing Verification ---")
        items, total, counts = await list_unified_rights(db, org.id, resource_type="report", page_size=100)
        cr_items = [it for it in items if it["resource_type"] == "custom_report" and it["resource_id"] == cr.id]
        assert len(cr_items) >= 2, f"Expected at least 2 items for CR, got {len(cr_items)}"
        item_a = next(it for it in cr_items if it["user_id"] == user_a.id)
        item_b = next(it for it in cr_items if it["user_id"] == user_b.id)
        assert item_a["access_type"] == "full", f"Item A should be full, got {item_a['access_type']}"
        assert item_b["access_type"] == "unique_key", f"Item B should be unique_key, got {item_b['access_type']}"
        print("[OK] Test 6 PASSED: Unified Rights correctly reports distinct access modes per user.")

        print("\n=== ALL ISOLATION & SYNCHRONIZATION TESTS PASSED CLEANLY! ===")


if __name__ == "__main__":
    asyncio.run(test_custom_report_isolation_and_mode_switching())
