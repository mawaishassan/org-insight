"""Pydantic schemas for users."""

from pydantic import BaseModel, Field

from app.core.models import UserRole


class UserKpiAssignment(BaseModel):
    """KPI assignment for a user: kpi_id and permission (view or data_entry)."""

    kpi_id: int = Field(..., description="KPI in same organization")
    permission: str = Field(default="data_entry", description="data_entry or view")


class UserKpiAssignmentResponse(BaseModel):
    """Single KPI assignment in GET response."""

    kpi_id: int
    permission: str  # "data_entry" | "view"


class UserCreate(BaseModel):
    """Create user (Org Admin)."""

    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=8)
    email: str | None = None
    full_name: str | None = None
    role: UserRole = UserRole.USER
    kpi_ids: list[int] = Field(default_factory=list, description="Legacy: assign as data_entry")
    kpi_assignments: list[UserKpiAssignment] | None = Field(
        default=None,
        description="KPI assignments with permission (overrides kpi_ids if provided)",
    )
    report_template_ids: list[int] = Field(default_factory=list)


class UserUpdate(BaseModel):
    """Update user."""

    username: str | None = Field(None, min_length=1, max_length=100)
    email: str | None = None
    full_name: str | None = None
    password: str | None = None
    role: UserRole | None = None
    is_active: bool | None = None
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

    class Config:
        from_attributes = True
