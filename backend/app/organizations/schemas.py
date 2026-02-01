"""Pydantic schemas for organizations."""

from pydantic import BaseModel, Field


class OrganizationCreate(BaseModel):
    """Create organization and admin user."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    admin_username: str = Field(..., min_length=1, max_length=100)
    admin_password: str = Field(..., min_length=8)
    admin_email: str | None = None
    admin_full_name: str | None = None


class OrganizationUpdate(BaseModel):
    """Update organization."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    is_active: bool | None = None


class OrganizationResponse(BaseModel):
    """Organization in API response."""

    id: int
    name: str
    description: str | None
    is_active: bool

    class Config:
        from_attributes = True


class OrganizationSummary(BaseModel):
    """Summary counts for an organization."""

    user_count: int
    domain_count: int
    kpi_count: int


class OrganizationWithSummary(OrganizationResponse):
    """Organization with summary counts (for list cards)."""

    summary: OrganizationSummary
