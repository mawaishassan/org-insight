"""Pydantic schemas for Force Password Reset feature."""

from datetime import datetime
from pydantic import BaseModel, Field


class BulkForcePasswordResetRequest(BaseModel):
    """Payload to force or cancel password reset for one or multiple users."""

    user_ids: list[int] = Field(..., min_length=1)
    force: bool = Field(True, description="True to force reset, False to cancel reset")
    organization_id: int | None = Field(None, description="Required for Super Admin when operating on an organization")


class PasswordResetTrackingItem(BaseModel):
    """Row item in the Password Reset Management tracking table."""

    user_id: int
    username: str
    email: str | None = None
    full_name: str | None = None
    role: str
    is_active: bool
    force_password_reset: bool
    reset_required: bool
    reset_status: str  # "Pending", "Completed", "Not Required"
    requested_at: datetime | None = None
    completed_at: datetime | None = None
    requested_by_admin_name: str | None = None
    requested_by_admin_id: int | None = None

    class Config:
        from_attributes = True


class PasswordResetAuditResponse(BaseModel):
    """Audit log item representing an enforced password reset lifecycle."""

    id: int
    user_id: int
    username: str
    admin_id: int | None = None
    admin_name: str | None = None
    status: str  # PENDING, COMPLETED, CANCELLED
    requested_at: datetime
    completed_at: datetime | None = None
    cancelled_at: datetime | None = None

    class Config:
        from_attributes = True


class ResetForcedPasswordPayload(BaseModel):
    """Payload submitted by end-user to change their password when forced."""

    current_password: str = Field(..., min_length=1, description="Existing current password")
    new_password: str = Field(..., min_length=8, description="New password matching policy")
    confirm_password: str = Field(..., min_length=8, description="Confirm new password")


class ResetForcedPasswordResponse(BaseModel):
    """Response returned upon successful forced password reset."""

    ok: bool = True
    message: str
    access_token: str
    refresh_token: str
    expires_in: int
