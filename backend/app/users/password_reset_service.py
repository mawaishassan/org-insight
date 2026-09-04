"""Business logic service for Force Password Reset and audit tracking.

Kept in a separate, dedicated module for easy future maintenance and debugging.
"""

from datetime import datetime
import re
from typing import Sequence

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_

from app.core.models import User, PasswordResetAudit
from app.core.security import verify_password, get_password_hash
from app.auth.service import create_tokens_for_user
from app.users.password_reset_schemas import (
    PasswordResetTrackingItem,
    PasswordResetAuditResponse,
    ResetForcedPasswordPayload,
)


def validate_password_policy(password: str) -> None:
    """
    Validate that password adheres to security policy:
    - Minimum 8 characters
    - At least 1 uppercase letter
    - At least 1 lowercase letter
    - At least 1 digit
    """
    if len(password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long.",
        )
    if not re.search(r"[A-Z]", password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one uppercase letter.",
        )
    if not re.search(r"[a-z]", password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one lowercase letter.",
        )
    if not re.search(r"\d", password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must contain at least one number.",
        )


async def force_password_reset_for_users(
    db: AsyncSession,
    org_id: int | None,
    admin_user: User,
    user_ids: list[int],
    force: bool = True,
) -> dict:
    """
    Mark or unmark users as force_password_reset = True/False.
    Records audit entry in password_reset_audits.
    """
    if not user_ids:
        return {"updated_count": 0, "users": []}

    stmt = select(User).where(User.id.in_(user_ids))
    if org_id is not None:
        stmt = stmt.where(User.organization_id == org_id)
    res = await db.execute(stmt)
    users = res.scalars().all()

    now = datetime.utcnow()
    updated_users = []

    for u in users:
        if force:
            u.force_password_reset = True
            u.password_reset_requested_at = now
            u.password_reset_requested_by_id = admin_user.id

            # Create an audit entry for this action
            audit = PasswordResetAudit(
                organization_id=org_id,
                user_id=u.id,
                admin_id=admin_user.id,
                status="PENDING",
                requested_at=now,
            )
            db.add(audit)
        else:
            u.force_password_reset = False
            # Cancel any existing pending audit records for this user
            audit_stmt = (
                select(PasswordResetAudit)
                .where(
                    PasswordResetAudit.user_id == u.id,
                    PasswordResetAudit.status == "PENDING",
                )
            )
            audit_res = await db.execute(audit_stmt)
            pending_audits = audit_res.scalars().all()
            for pa in pending_audits:
                pa.status = "CANCELLED"
                pa.cancelled_at = now

        updated_users.append({
            "id": u.id,
            "username": u.username,
            "force_password_reset": u.force_password_reset,
        })

    await db.commit()
    for u in users:
        await db.refresh(u)

    return {
        "updated_count": len(updated_users),
        "force": force,
        "users": updated_users,
    }


async def get_password_reset_tracking_list(
    db: AsyncSession,
    org_id: int | None = None,
    status_filter: str | None = None,
    search: str | None = None,
) -> list[PasswordResetTrackingItem]:
    """
    Fetch all users with their computed reset status (filtered by org_id if specified).
    """
    query = select(User)
    if org_id is not None:
        query = query.where(User.organization_id == org_id)

    if search:
        s = f"%{search.strip()}%"
        query = query.where(
            or_(
                User.username.ilike(s),
                User.email.ilike(s),
                User.full_name.ilike(s),
            )
        )

    res = await db.execute(query.order_by(User.username.asc()))
    users = res.scalars().all()

    # Pre-fetch admin names if any users have password_reset_requested_by_id
    admin_ids = {u.password_reset_requested_by_id for u in users if u.password_reset_requested_by_id}
    admin_map: dict[int, str] = {}
    if admin_ids:
        admin_res = await db.execute(select(User).where(User.id.in_(admin_ids)))
        for a in admin_res.scalars().all():
            admin_map[a.id] = a.full_name or a.username

    items: list[PasswordResetTrackingItem] = []
    for u in users:
        is_pending = bool(u.force_password_reset)
        has_completed = not is_pending and (u.password_reset_completed_at is not None)

        if is_pending:
            reset_status = "Pending"
        elif has_completed:
            reset_status = "Completed"
        else:
            reset_status = "Not Required"

        # Filter by status:
        # ALL / ALL_REQUESTS: Only users with history (Pending or Completed)
        # ALL_USERS: Everyone
        # PENDING: Only Pending
        # COMPLETED: Only Completed
        # NOT_REQUIRED: Only Not Required
        if status_filter:
            sf = status_filter.upper()
            if sf in ("ALL", "ALL_REQUESTS"):
                if reset_status == "Not Required":
                    continue
            elif sf == "PENDING" and reset_status != "Pending":
                continue
            elif sf == "COMPLETED" and reset_status != "Completed":
                continue
            elif sf == "NOT_REQUIRED" and reset_status != "Not Required":
                continue

        admin_name = admin_map.get(u.password_reset_requested_by_id) if u.password_reset_requested_by_id else None

        items.append(
            PasswordResetTrackingItem(
                user_id=u.id,
                username=u.username,
                email=u.email,
                full_name=u.full_name,
                role=u.role.value if hasattr(u.role, "value") else str(u.role),
                is_active=u.is_active,
                force_password_reset=bool(u.force_password_reset),
                reset_required=bool(u.force_password_reset),
                reset_status=reset_status,
                requested_at=u.password_reset_requested_at,
                completed_at=u.password_reset_completed_at,
                requested_by_admin_name=admin_name,
                requested_by_admin_id=u.password_reset_requested_by_id,
            )
        )

    return items


async def get_user_password_reset_history(
    db: AsyncSession,
    org_id: int | None,
    user_id: int,
) -> list[PasswordResetAuditResponse]:
    """Retrieve the full timestamped audit log of forced password reset requests for a user."""
    stmt = select(PasswordResetAudit).where(PasswordResetAudit.user_id == user_id)
    if org_id is not None:
        stmt = stmt.where(PasswordResetAudit.organization_id == org_id)
    stmt = stmt.order_by(PasswordResetAudit.requested_at.desc())
    res = await db.execute(stmt)
    audits = res.scalars().all()

    # Pre-fetch admin names & usernames
    admin_ids = {a.admin_id for a in audits if a.admin_id}
    admin_map: dict[int, str] = {}
    if admin_ids:
        admin_res = await db.execute(select(User).where(User.id.in_(admin_ids)))
        for a in admin_res.scalars().all():
            admin_map[a.id] = a.full_name or a.username

    # Fetch user username
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    username = user.username if user else "Unknown"

    out: list[PasswordResetAuditResponse] = []
    for a in audits:
        out.append(
            PasswordResetAuditResponse(
                id=a.id,
                user_id=a.user_id,
                username=username,
                admin_id=a.admin_id,
                admin_name=admin_map.get(a.admin_id) if a.admin_id else None,
                status=a.status,
                requested_at=a.requested_at,
                completed_at=a.completed_at,
                cancelled_at=a.cancelled_at,
            )
        )
    return out


async def execute_forced_password_reset(
    db: AsyncSession,
    user: User,
    payload: ResetForcedPasswordPayload,
) -> tuple[str, str, int]:
    """
    Validate and execute forced password reset for current user.
    Removes forced flag, records completion timestamp, updates audit record,
    and returns fresh JWT tokens.
    """
    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password and confirm password do not match.",
        )

    # Need user with hashed_password loaded
    u_res = await db.execute(select(User).where(User.id == user.id))
    db_user = u_res.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    if not verify_password(payload.current_password, db_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password cannot be the same as your current password.",
        )

    # Validate policy
    validate_password_policy(payload.new_password)

    now = datetime.utcnow()
    db_user.hashed_password = get_password_hash(payload.new_password)
    db_user.force_password_reset = False
    db_user.password_reset_completed_at = now

    # Update latest PENDING audit record for this user
    audit_stmt = (
        select(PasswordResetAudit)
        .where(
            PasswordResetAudit.user_id == db_user.id,
            PasswordResetAudit.status == "PENDING",
        )
        .order_by(PasswordResetAudit.requested_at.desc())
    )
    audit_res = await db.execute(audit_stmt)
    pending_audit = audit_res.scalars().first()
    if pending_audit:
        pending_audit.status = "COMPLETED"
        pending_audit.completed_at = now

    await db.commit()
    await db.refresh(db_user)

    # Generate fresh tokens without force_password_reset
    access, refresh, expires_in, _ = create_tokens_for_user(db_user)
    return access, refresh, expires_in
