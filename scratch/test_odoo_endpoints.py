"""Integration tests for Odoo Endpoints feature."""

import asyncio
import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.core.database import AsyncSessionLocal
from app.core.models import Organization, KPI, FieldType, OrganizationOdooConfig, KpiOdooConfig, OdooEndpoint
from app.odoo.endpoint_service import (
    get_org_odoo_endpoints,
    create_odoo_endpoint,
    update_odoo_endpoint,
    delete_odoo_endpoint,
    ensure_default_odoo_endpoint,
)
from app.odoo.config_service import upsert_kpi_odoo_config, get_kpi_odoo_config
from app.odoo.service import odoo_fetch_items
from types import SimpleNamespace


async def run_tests():
    print("=" * 60)
    print("RUNNING ODOO ENDPOINTS TEST SUITE")
    print("=" * 60)

    async with AsyncSessionLocal() as db:
        # Create test Organization
        org = Organization(name="Test University Org")
        db.add(org)
        await db.flush()
        await db.refresh(org)

        # 1. Create Organization Odoo Config (legacy single endpoint setup)
        org_cfg = OrganizationOdooConfig(
            organization_id=org.id,
            login_url="https://odoo.example.com/jsonrpc/login",
            data_fetch_url="https://odoo.example.com/jsonrpc/default_data",
            username="admin",
            password="secretpassword",
        )
        db.add(org_cfg)
        await db.flush()

        # Create test KPI
        kpi = KPI(organization_id=org.id, name="Total Students")
        db.add(kpi)
        await db.flush()

        # Create KPI Odoo Config
        kpi_cfg = await upsert_kpi_odoo_config(
            db, kpi.id, request_body={"params": {"model": "student.data"}}, response_items_path="result.records"
        )
        await db.flush()

        print("\n[Test 1] Auto Migration & Default Endpoint Creation")
        endpoints = await get_org_odoo_endpoints(db, org.id)
        assert len(endpoints) == 1, f"Expected 1 auto-migrated endpoint, got {len(endpoints)}"
        default_ep = endpoints[0]
        assert default_ep.name == "Default Odoo API"
        assert default_ep.url == "https://odoo.example.com/jsonrpc/default_data"
        print(f"  Auto-created Endpoint: '{default_ep.name}' ({default_ep.url})")

        # Verify existing KPI was linked to default endpoint
        kpi_cfg_reloaded = await get_kpi_odoo_config(db, kpi.id)
        assert kpi_cfg_reloaded.odoo_endpoint_id == default_ep.id
        assert kpi_cfg_reloaded.endpoint.name == "Default Odoo API"
        print(f"  Existing KPI linked to Endpoint ID: {kpi_cfg_reloaded.odoo_endpoint_id}")

        print("\n[Test 2] Create Multiple Odoo Endpoints for Super Admin")
        ep_students = await create_odoo_endpoint(
            db, org.id, name="Student Data API", url="https://odoo.example.com/api/students", description="Student records"
        )
        ep_faculty = await create_odoo_endpoint(
            db, org.id, name="Faculty Data API", url="https://odoo.example.com/api/faculty", description="Faculty records"
        )
        ep_research = await create_odoo_endpoint(
            db, org.id, name="Research Grants API", url="https://odoo.example.com/api/research", is_active=False
        )
        await db.flush()

        all_eps = await get_org_odoo_endpoints(db, org.id)
        assert len(all_eps) == 4, f"Expected 4 endpoints total, got {len(all_eps)}"

        active_eps = await get_org_odoo_endpoints(db, org.id, active_only=True)
        assert len(active_eps) == 3, f"Expected 3 active endpoints, got {len(active_eps)}"
        print(f"  Total Endpoints: {len(all_eps)}, Active Endpoints: {len(active_eps)}")
        for ep in active_eps:
            print(f"   - {ep.name}: {ep.url}")

        print("\n[Test 3] KPI Configuration - Link KPI to Specific Endpoint")
        # Update KPI to point to Student Data API endpoint
        updated_kpi_cfg = await upsert_kpi_odoo_config(
            db, kpi.id, request_body={"model": "student.record"}, response_items_path="data", odoo_endpoint_id=ep_students.id
        )
        await db.flush()
        kpi_cfg_reloaded = await get_kpi_odoo_config(db, kpi.id)
        assert kpi_cfg_reloaded.odoo_endpoint_id == ep_students.id
        assert kpi_cfg_reloaded.endpoint.url == "https://odoo.example.com/api/students"
        print(f"  KPI '{kpi.name}' successfully associated with Endpoint: '{kpi_cfg_reloaded.endpoint.name}'")

        print("\n[Test 4] Deletion Protection for Endpoints in Use")
        try:
            await delete_odoo_endpoint(db, ep_students)
            assert False, "Should have raised ValueError due to deletion protection"
        except ValueError as err:
            print(f"  Deletion protection working correctly! Raised error:\n  '{err}'")

        # Deleting an unreferenced endpoint should succeed
        await delete_odoo_endpoint(db, ep_faculty)
        print("  Unreferenced endpoint 'Faculty Data API' deleted successfully.")

        print("\n[Test 5] Inactive Endpoint Handling")
        # Link KPI to inactive endpoint
        await upsert_kpi_odoo_config(
            db, kpi.id, request_body={"model": "grant.record"}, response_items_path=None, odoo_endpoint_id=ep_research.id
        )
        await db.flush()
        kpi_cfg_reloaded = await get_kpi_odoo_config(db, kpi.id)
        assert kpi_cfg_reloaded.endpoint.is_active is False

        try:
            # Attempt to fetch items using inactive endpoint
            await odoo_fetch_items(org_cfg, kpi_cfg_reloaded, "session_123", {"kpi_id": kpi.id})
            assert False, "Should have raised error for inactive endpoint"
        except ValueError as err:
            assert "currently inactive" in str(err)
            print(f"  Inactive endpoint check working correctly! Raised expected error:\n  '{err}'")

        # Rollback test changes to keep clean database
        await db.rollback()

    print("\n" + "=" * 60)
    print("ALL 5 ODOO ENDPOINTS TEST CASES PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_tests())
