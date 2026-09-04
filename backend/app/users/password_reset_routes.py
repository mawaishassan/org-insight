"""API routes for Force Password Reset and audit tracking.

Kept in a dedicated separate file for straightforward tracking, extension, and debugging.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin
from app.core.models import User
from app.users.password_reset_schemas import (
    BulkForcePasswordResetRequest,
    PasswordResetTrackingItem,
    PasswordResetAuditResponse,
    ResetForcedPasswordPayload,
    ResetForcedPasswordResponse,
)
from app.users.password_reset_service import (
    force_password_reset_for_users,
    get_password_reset_tracking_list,
    get_user_password_reset_history,
    execute_forced_password_reset,
)

router = APIRouter(tags=["password-reset"])


def _resolve_org_id(user: User, org_id_param: int | None = None) -> int | None:
    """Resolve organization id for tenant isolation. Super Admins can query globally if no org_id specified."""
    role_str = getattr(user.role, "value", str(user.role))
    if role_str == "SUPER_ADMIN":
        return org_id_param if org_id_param is not None else user.organization_id
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Organization context is required for this operation.",
    )


@router.get("/users/password-resets", response_model=list[PasswordResetTrackingItem])
async def list_password_reset_tracking(
    status: str | None = Query(None, description="Filter by status: ALL, PENDING, COMPLETED, NOT_REQUIRED, ALL_USERS"),
    search: str | None = Query(None, description="Search by username, email, or full name"),
    organization_id: int | None = Query(None, description="Required for Super Admin"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """
    List users in current organization with forced password reset tracking metrics:
    - User Name
    - Email / Username
    - Reset Required (Yes/No)
    - Reset Status (Pending / Completed / Not Required)
    - Reset Requested On
    - Reset Completed On
    - Initiated By Admin
    """
    org_id = _resolve_org_id(current_user, organization_id)
    return await get_password_reset_tracking_list(
        db=db,
        org_id=org_id,
        status_filter=status,
        search=search,
    )


@router.post("/users/force-password-reset")
async def force_password_reset(
    body: BulkForcePasswordResetRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """
    Force or cancel password reset for one or multiple users in bulk.
    Accessible to Organizational Admin and Super Admin.
    """
    org_id = _resolve_org_id(current_user, body.organization_id)
    result = await force_password_reset_for_users(
        db=db,
        org_id=org_id,
        admin_user=current_user,
        user_ids=body.user_ids,
        force=body.force,
    )
    action_str = "enforced" if body.force else "cancelled"
    return {
        "ok": True,
        "message": f"Successfully {action_str} password reset requirement for {result['updated_count']} user(s).",
        **result,
    }


@router.get(
    "/users/{user_id}/password-reset-history",
    response_model=list[PasswordResetAuditResponse],
)
async def get_user_reset_history(
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """
    Retrieve complete audit trail of forced password resets for a specific user:
    - User
    - Admin who initiated
    - Enforced date & time
    - Completed date & time
    - Current status
    """
    org_id = _resolve_org_id(current_user, organization_id)
    return await get_user_password_reset_history(
        db=db,
        org_id=org_id,
        user_id=user_id,
    )


@router.post(
    "/auth/reset-forced-password",
    response_model=ResetForcedPasswordResponse,
)
async def reset_forced_password(
    body: ResetForcedPasswordPayload,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    End-user endpoint to reset password when forced by an Organizational Admin.
    Validates current password and new password according to password policy.
    Clears mandatory reset flag, logs audit completion, and returns fresh tokens.
    """
    access, refresh, expires_in = await execute_forced_password_reset(
        db=db,
        user=current_user,
        payload=body,
    )
    return ResetForcedPasswordResponse(
        ok=True,
        message="Password updated successfully. You now have full access to the system.",
        access_token=access,
        refresh_token=refresh,
        expires_in=expires_in,
    )
