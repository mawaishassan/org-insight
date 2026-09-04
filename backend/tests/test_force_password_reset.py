"""Integration tests for Force Password Reset feature."""

import asyncio
import os
import sys
from datetime import datetime
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from httpx import AsyncClient, ASGITransport
from sqlalchemy import select

from app.main import app
from app.core.database import AsyncSessionLocal
from app.core.models import User, Organization, UserRole
from app.core.security import get_password_hash


async def run_tests():
    print("Starting Force Password Reset Integration Tests...")
    transport = ASGITransport(app=app)

    async with AsyncSessionLocal() as session:
        # 1. Create or get test organization
        org_name = f"Test Org {uuid4().hex[:6]}"
        org = Organization(name=org_name)
        session.add(org)
        await session.flush()

        # 2. Create Org Admin
        admin_uname = f"orgadmin_{uuid4().hex[:6]}"
        admin_pass = "AdminPass123"
        admin = User(
            organization_id=org.id,
            username=admin_uname,
            email=f"{admin_uname}@example.com",
            full_name="Org Admin Test",
            hashed_password=get_password_hash(admin_pass),
            role=UserRole.ORG_ADMIN,
            is_active=True,
        )
        session.add(admin)

        # 3. Create regular User
        user_uname = f"user_{uuid4().hex[:6]}"
        user_pass = "UserPass123"
        user = User(
            organization_id=org.id,
            username=user_uname,
            email=f"{user_uname}@example.com",
            full_name="Regular User Test",
            hashed_password=get_password_hash(user_pass),
            role=UserRole.USER,
            is_active=True,
        )
        session.add(user)
        await session.commit()
        await session.refresh(org)
        await session.refresh(admin)
        await session.refresh(user)

        user_id = user.id
        admin_id = admin.id
        org_id = org.id

    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # Step A: Admin login (bypass captcha in test by directly issuing token or authenticating via login)
        from app.auth.service import create_tokens_for_user
        admin_token, _, _, _ = create_tokens_for_user(admin)
        admin_headers = {"Authorization": f"Bearer {admin_token}"}

        # Step B: Admin checks tracking list -> user reset_status should be "Not Required"
        r = await client.get("/api/users/password-resets", headers=admin_headers)
        assert r.status_code == 200, f"Tracking list failed: {r.text}"
        data = r.json()
        target = next((item for item in data if item["user_id"] == user_id), None)
        assert target is not None, "Target user not in tracking list"
        assert target["reset_status"] == "Not Required"
        assert target["reset_required"] is False
        print("PASS: Initial status is 'Not Required'")

        # Step C: Admin enforces password reset for the user
        r = await client.post(
            "/api/users/force-password-reset",
            json={"user_ids": [user_id], "force": True},
            headers=admin_headers,
        )
        assert r.status_code == 200, f"Force reset failed: {r.text}"
        print("PASS: Admin forced password reset successfully")

        # Step D: Admin checks tracking list -> user reset_status should be "Pending"
        r = await client.get("/api/users/password-resets", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        target = next(item for item in data if item["user_id"] == user_id)
        assert target["reset_status"] == "Pending"
        assert target["reset_required"] is True
        assert target["requested_at"] is not None
        assert target["requested_by_admin_name"] == admin.full_name
        print("PASS: User status changed to 'Pending'")

        # Step E: Filter by status=PENDING
        r = await client.get("/api/users/password-resets?status=PENDING", headers=admin_headers)
        assert r.status_code == 200
        pending_items = r.json()
        assert any(item["user_id"] == user_id for item in pending_items)
        print("PASS: Filter by status=PENDING works")

        # Step F: User logs in (token generated with force_password_reset=True)
        async with AsyncSessionLocal() as session:
            u_res = await session.execute(select(User).where(User.id == user_id))
            refreshed_user = u_res.scalar_one()
        user_token, _, _, is_forced = create_tokens_for_user(refreshed_user)
        assert is_forced is True
        user_headers = {"Authorization": f"Bearer {user_token}"}

        # Step G: User tries to access protected endpoint (/api/entries/available-kpis) -> MUST GET 403 FORBIDDEN!
        r = await client.get("/api/entries/available-kpis", headers=user_headers)
        assert r.status_code == 403, f"Expected 403 Forbidden, got {r.status_code}: {r.text}"
        assert "Password reset required" in r.json()["detail"]
        print("PASS: Protected endpoint blocked with 403 Forbidden")

        # Step H: User accesses /api/auth/me -> ALLOWED
        r = await client.get("/api/auth/me", headers=user_headers)
        assert r.status_code == 200
        me_data = r.json()
        assert me_data["force_password_reset"] is True
        print("PASS: User can access /api/auth/me while forced reset is pending")

        # Step I: User attempts reset with invalid password (policy violation - all numbers or no uppercase)
        r = await client.post(
            "/api/auth/reset-forced-password",
            json={
                "current_password": user_pass,
                "new_password": "alllowercase123",
                "confirm_password": "alllowercase123",
            },
            headers=user_headers,
        )
        assert r.status_code == 400
        assert "uppercase" in r.json()["detail"].lower()
        print("PASS: Password policy validation successfully rejected weak password")

        # Step J: User attempts reset with incorrect current password
        r = await client.post(
            "/api/auth/reset-forced-password",
            json={
                "current_password": "WrongPassword999",
                "new_password": "ValidNewPassword123",
                "confirm_password": "ValidNewPassword123",
            },
            headers=user_headers,
        )
        assert r.status_code == 400
        assert "Current password is incorrect" in r.json()["detail"]
        print("PASS: Incorrect current password rejected")

        # Step K: User successfully resets password with valid new password
        new_valid_pass = "BrandNewValidPass456"
        r = await client.post(
            "/api/auth/reset-forced-password",
            json={
                "current_password": user_pass,
                "new_password": new_valid_pass,
                "confirm_password": new_valid_pass,
            },
            headers=user_headers,
        )
        assert r.status_code == 200, f"Reset password failed: {r.text}"
        reset_res = r.json()
        assert reset_res["ok"] is True
        fresh_user_token = reset_res["access_token"]
        print("PASS: Password reset succeeded")

        # Step L: User accesses protected endpoint (/api/entries/available-kpis) with fresh token -> ALLOWED (200 OK)
        fresh_headers = {"Authorization": f"Bearer {fresh_user_token}"}
        r = await client.get("/api/entries/available-kpis", headers=fresh_headers)
        assert r.status_code == 200, f"Expected 200 OK with fresh token, got {r.status_code}: {r.text}"
        print("PASS: User now has normal access to protected system functionality")

        # Step M: Admin checks tracking list -> user reset_status should be "Completed"
        r = await client.get("/api/users/password-resets", headers=admin_headers)
        assert r.status_code == 200
        data = r.json()
        target = next(item for item in data if item["user_id"] == user_id)
        assert target["reset_status"] == "Completed"
        assert target["reset_required"] is False
        assert target["completed_at"] is not None
        print("PASS: Admin tracking list shows 'Completed' status with timestamp")

        # Step N: Admin checks audit history for user
        r = await client.get(f"/api/users/{user_id}/password-reset-history", headers=admin_headers)
        assert r.status_code == 200
        history = r.json()
        assert len(history) >= 1
        assert history[0]["status"] == "COMPLETED"
        assert history[0]["admin_name"] == admin.full_name
        assert history[0]["completed_at"] is not None
        print("PASS: Audit history contains complete log of the event")

        # Step O: Admin can force password reset again (Recommended action 6)
        r = await client.post(
            "/api/users/force-password-reset",
            json={"user_ids": [user_id], "force": True},
            headers=admin_headers,
        )
        assert r.status_code == 200
        r = await client.get("/api/users/password-resets", headers=admin_headers)
        target = next(item for item in r.json() if item["user_id"] == user_id)
        assert target["reset_status"] == "Pending"
        print("PASS: Admin can force password reset again for a user who had completed it")

        # Step P: Admin cancels mandatory password reset before user logs in (Recommended action 6)
        r = await client.post(
            "/api/users/force-password-reset",
            json={"user_ids": [user_id], "force": False},
            headers=admin_headers,
        )
        assert r.status_code == 200
        r = await client.get(f"/api/users/{user_id}/password-reset-history", headers=admin_headers)
        history = r.json()
        cancelled_entry = next((h for h in history if h["status"] == "CANCELLED"), None)
        assert cancelled_entry is not None
        print("PASS: Admin can cancel mandatory password reset and audit log records 'CANCELLED'")

        # Clean up test data
        async with AsyncSessionLocal() as session:
            db_org = await session.get(Organization, org_id)
            if db_org:
                await session.delete(db_org)
                await session.commit()

    print("\nALL FORCE PASSWORD RESET TESTS PASSED SUCCESSFULLY! [SUCCESS]")


if __name__ == "__main__":
    asyncio.run(run_tests())
