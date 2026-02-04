"""Pydantic schemas for KPIs."""

from pydantic import BaseModel, Field


class KPICreate(BaseModel):
    """Create KPI (domain optional; can attach domain/category/org tags on create). sort_order is auto-set to next in org."""

    domain_id: int | None = None
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    year: int = Field(..., ge=2000, le=2100)
    sort_order: int | None = None  # ignored on create; set automatically to next in organization
    domain_ids: list[int] = Field(default_factory=list, description="Domain tags to attach")
    category_ids: list[int] = Field(default_factory=list, description="Category tags to attach (one per domain)")
    organization_tag_ids: list[int] = Field(default_factory=list, description="Organization tags for search")


class KPIAssignUserBody(BaseModel):
    """Assign a user to KPI for data entry."""

    user_id: int = Field(..., description="User to assign (must be in same organization)")


class KPIUpdate(BaseModel):
    """Update KPI (optionally replace domain/category/org tags, card display fields)."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    year: int | None = Field(None, ge=2000, le=2100)
    sort_order: int | None = None
    domain_ids: list[int] | None = Field(None, description="Replace domain tags with this list")
    category_ids: list[int] | None = Field(None, description="Replace category tags with this list")
    organization_tag_ids: list[int] | None = Field(None, description="Replace organization tags for search")
    card_display_field_ids: list[int] | None = Field(None, description="Field IDs to show on domain KPI card (order preserved)")


class DomainTagRef(BaseModel):
    """Domain tag for KPI card."""

    id: int
    name: str


class CategoryTagRef(BaseModel):
    """Category tag for KPI card (includes domain for display)."""

    id: int
    name: str
    domain_id: int | None = None
    domain_name: str | None = None


class OrganizationTagRef(BaseModel):
    """Organization tag on KPI (for search)."""

    id: int
    name: str


class AssignedUserRef(BaseModel):
    """User assigned to KPI for data entry."""

    id: int
    username: str
    full_name: str | None = None


class KPIResponse(BaseModel):
    """KPI in API response."""

    id: int
    organization_id: int
    domain_id: int | None = None
    name: str
    description: str | None
    year: int
    sort_order: int
    card_display_field_ids: list[int] | None = None
    domain_tags: list[DomainTagRef] = []
    category_tags: list[CategoryTagRef] = []
    organization_tags: list[OrganizationTagRef] = []
    assigned_users: list[AssignedUserRef] = []

    class Config:
        from_attributes = True


class KPIChildDataSummary(BaseModel):
    """Summary of child records for a KPI (for delete confirmation)."""

    assignments_count: int = 0
    entries_count: int = 0
    fields_count: int = 0
    field_values_count: int = 0
    report_template_kpis_count: int = 0
    has_child_data: bool = False
