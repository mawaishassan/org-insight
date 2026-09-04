"""Pydantic schemas for users."""

from datetime import datetime
from pydantic import BaseModel, Field

from app.core.models import UserRole, KPIAssignmentType


class UserKpiAssignment(BaseModel):
    """KPI assignment for a user: kpi_id and permission (view or data_entry)."""

    kpi_id: int = Field(..., description="KPI in same organization")
    permission: str = Field(default="data_entry", description="data_entry or view")


class UserKpiAssignmentResponse(BaseModel):
    """Single KPI assignment in GET response."""

    kpi_id: int
    permission: str  # "data_entry" | "view"

    class Config:
        from_attributes = True


class UserCreate(BaseModel):
    """Create user (Org Admin)."""

    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8)
    email: str | None = None
    full_name: str | None = None
    role: UserRole = UserRole.USER
    unique_user_key: str | None = None
    kpi_ids: list[int] = Field(default_factory=list, description="Legacy: data_entry only")
    kpi_assignments: list[UserKpiAssignment] = Field(
        default_factory=list,
        description="KPIs with permission (DATA_ENTRY or VIEW_ONLY)",
    )
    report_template_ids: list[int] = Field(default_factory=list)


class ExternalUserCreate(BaseModel):
    """Create an external user (Org Admin) authenticated via XML-RPC (no internal password)."""

    username: str = Field(..., min_length=1, max_length=100)
    full_name: str | None = None
    description: str | None = None
    is_active: bool = True


class UserUpdate(BaseModel):
    """Update user."""

    username: str | None = Field(None, min_length=1, max_length=100)
    email: str | None = None
    full_name: str | None = None
    password: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
    unique_user_key: str | None = None
    force_password_reset: bool | None = None
    kpi_ids: list[int] | None = Field(None, description="Legacy: replace with data_entry")
    kpi_assignments: list[UserKpiAssignment] | None = Field(
        None,
        description="Replace KPI assignments with permission (overrides kpi_ids if provided)",
    )
    report_template_ids: list[int] | None = None


class UserResponse(BaseModel):
    """User in API response."""

    id: int
    username: str
    email: str | None
    full_name: str | None
    role: UserRole
    organization_id: int | None
    is_active: bool
    unique_user_key: str | None = None
    description: str | None = None
    is_external: bool = False
    force_password_reset: bool = False
    password_reset_requested_at: datetime | None = None
    password_reset_completed_at: datetime | None = None
    reset_status: str | None = None

    class Config:
        from_attributes = True
