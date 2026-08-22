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
            attachment_url_template="https://odoo.example.com/web/content/{ATTACHMENT_ID}?download=true",
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

        print("\n[Test 6] Null request_body (optional JSON body GET/POST routing)")
        # 1. Update KPI Odoo Config to have request_body=None
        kpi_cfg_null_body = await upsert_kpi_odoo_config(
            db, kpi.id, request_body=None, response_items_path="result.records", odoo_endpoint_id=default_ep.id
        )
        await db.flush()

        kpi_cfg_reloaded = await get_kpi_odoo_config(db, kpi.id)
        assert kpi_cfg_reloaded.request_body is None, "Expected request_body to be None"
        print("  Successfully upserted and loaded KPI config with null request_body")

        # 2. Verify odoo_fetch_items behavior by mocking httpx.AsyncClient.post
        import httpx
        from unittest.mock import AsyncMock, patch

        mock_response = httpx.Response(200, json={"result": {"records": [{"name": "Student A"}]}})

        with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
            mock_post.return_value = mock_response

            # Fetch items
            items = await odoo_fetch_items(org_cfg, kpi_cfg_reloaded, "session_123", {"kpi_id": kpi.id})

            # Assert items returned correctly
            assert len(items) == 1
            assert items[0]["name"] == "Student A"
            print("  Successfully fetched items when request_body is None")

            # Assert mock_post was called with target_url, headers, cookies, and NO json/payload parameter
            mock_post.assert_called_once()
            called_args, called_kwargs = mock_post.call_args
            print("DEBUG: called_kwargs =", called_kwargs)
            assert called_kwargs.get("json") is None, "Expected no json payload to be sent"
            assert "json" not in called_kwargs or called_kwargs["json"] is None, "Expected 'json' not to be passed to POST"
            assert called_kwargs.get("cookies") == {"session_id": "session_123"}
            print("  Successfully verified that POST was made without JSON payload")

        # [Test 7] On-demand Odoo Attachment Downloading & Placeholders
        print("\n[Test 7] On-demand Odoo Attachment Downloading & Placeholders")
        from app.odoo.service import build_on_demand_attachment_placeholders
        
        # Test placeholder builder helper
        res_none = build_on_demand_attachment_placeholders(kpi.id, None)
        assert res_none is None
        
        res_single = build_on_demand_attachment_placeholders(kpi.id, 12345)
        assert isinstance(res_single, dict)
        assert res_single["url"] == f"/api/kpis/{kpi.id}/files/odoo/12345"
        assert res_single["filename"] == "Proof.pdf"
        
        res_multi = build_on_demand_attachment_placeholders(kpi.id, "12345, 67890")
        assert isinstance(res_multi, list)
        assert len(res_multi) == 2
        assert res_multi[0]["url"] == f"/api/kpis/{kpi.id}/files/odoo/12345"
        assert res_multi[1]["url"] == f"/api/kpis/{kpi.id}/files/odoo/67890"
        
        print("  Placeholder generation functions verified successfully.")

        # Fetch an active user from DB to use their ID for authentication
        from app.core.models import User, KpiFile, UserRole
        from sqlalchemy import select
        from app.core.config import get_settings
        print("DATABASE_URL in test:", get_settings().DATABASE_URL)
        user_res = await db.execute(select(User).where(User.is_active == True))
        test_user = user_res.scalars().first()

        if not test_user:
            from app.core.security import get_password_hash
            test_user = User(
                username="test_auth_user",
                email="test_auth@example.com",
                hashed_password=get_password_hash("testpass"),
                role=UserRole.SUPER_ADMIN,
                organization_id=org.id,
                is_active=True,
            )
            db.add(test_user)
            await db.flush()
        else:
            test_user.organization_id = org.id
            db.add(test_user)
            await db.flush()

        # Test API Endpoint using test client
        # Commit test entities to make them visible to the TestClient's API transaction
        await db.commit()

        # Test API Endpoint using test client
        from app.main import app
        from httpx import AsyncClient as TestClient
        from unittest.mock import patch, MagicMock
        
        mock_file_content = b"PDF_CONTENT_MOCK_DATA"
        
        with patch("app.core.security.decode_token", return_value={"sub": str(test_user.id), "type": "access"}), \
             patch("app.kpis.routes.user_can_view_kpi", return_value=True), \
             patch("app.odoo.service.odoo_authenticate", return_value="mock_session_456"), \
             patch("app.storage.service.upload_file", return_value="org_1/kpi_1/odoo_att_12345_unique"), \
             patch("app.storage.service.get_file_stream", return_value=mock_file_content):
                 
            # We mock the Odoo server GET request returning file
            mock_odoo_resp = httpx.Response(
                200, 
                content=mock_file_content,
                headers={"Content-Disposition": "attachment; filename=test_evidence.pdf", "Content-Type": "application/pdf"}
            )
            
            odoo_requested = False
            original_get = httpx.AsyncClient.get
            async def mock_get_func(self, url, *args, **kwargs):
                nonlocal odoo_requested
                url_str = str(url)
                if url_str.startswith("/") or "http://testserver" in url_str:
                    return await original_get(self, url, *args, **kwargs)
                odoo_requested = True
                return mock_odoo_resp
            
            with patch("httpx.AsyncClient.get", new=mock_get_func):
                async with TestClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
                    # Request the endpoint
                    headers = {"Authorization": "Bearer mocktoken"}
                    response = await client.get(f"/api/kpis/{kpi.id}/files/odoo/12345", headers=headers)
                    
                    # Verify response
                    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
                    assert response.content == mock_file_content
                    assert "test_evidence.pdf" in response.headers.get("Content-Disposition", "")
                    assert odoo_requested is True, "Expected Odoo sync fetch to be triggered on cache miss"
                    # Commit/refresh test session transaction to see external commits from client
                    await db.commit()

                    cache_res = await db.execute(
                        select(KpiFile).where(KpiFile.kpi_id == kpi.id, KpiFile.stored_path.like("%odoo_att_12345%"))
                    )
                    kf_record = cache_res.scalar_one_or_none()
                    assert kf_record is not None, "Expected KpiFile record to be saved in DB"
                    assert kf_record.original_filename == "test_evidence.pdf"
                    assert kf_record.size == len(mock_file_content)
                    print("  DB Cache entry created successfully.")
                    
                    # Request again (cache hit) via suffix route
                    # Reset odoo_requested flag
                    odoo_requested = False
                    
                    response_hit = await client.get(f"/api/kpis/{kpi.id}/files/odoo_12345/download", headers=headers)
                    assert response_hit.status_code == 200
                    assert response_hit.content == mock_file_content
                    assert odoo_requested is False, "Should not make external HTTP request to Odoo on cache hit"
                    print("  On-demand endpoint download (cache hit) successful via suffix route.")

        # Cleanup test changes at the end
        from sqlalchemy import delete
        await db.execute(delete(Organization).where(Organization.id == org.id))
        await db.commit()

    print("\n" + "=" * 60)
    print("ALL 7 ODOO ENDPOINTS TEST CASES PASSED SUCCESSFULLY!")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(run_tests())
