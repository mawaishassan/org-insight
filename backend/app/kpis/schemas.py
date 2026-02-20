"""Pydantic schemas for KPIs."""

from pydantic import BaseModel, Field


class KPICreate(BaseModel):
    """Create KPI (domain optional; can attach domain/category/org tags on create). sort_order is auto-set to next in org."""

    domain_id: int | None = None
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    year: int = Field(..., ge=2000, le=2100)
    sort_order: int | None = None  # ignored on create; set automatically to next in organization
    entry_mode: str = Field(default="manual", description="manual or api")
    api_endpoint_url: str | None = Field(None, max_length=2048, description="When entry_mode=api, URL we call to fetch entry data")
    domain_ids: list[int] = Field(default_factory=list, description="Domain tags to attach")
    category_ids: list[int] = Field(default_factory=list, description="Category tags to attach (one per domain)")
    organization_tag_ids: list[int] = Field(default_factory=list, description="Organization tags for search")


class KPIAssignUserBody(BaseModel):
    """Assign a user to KPI for data entry."""

    user_id: int = Field(..., description="User to assign (must be in same organization)")


class KPIAssignmentItem(BaseModel):
    """One assignment: user and permission (view or data_entry)."""

    user_id: int = Field(..., description="User in same organization")
    permission: str = Field(default="data_entry", description="data_entry (can edit) or view (read-only)")


class KPIReplaceAssignmentsBody(BaseModel):
    """Replace all user assignments for a KPI (each with permission: data_entry or view)."""

    assignments: list[KPIAssignmentItem] | None = Field(
        default=None,
        description="List of {user_id, permission}; permission is 'data_entry' or 'view'",
    )
    user_ids: list[int] | None = Field(
        default=None,
        description="Legacy: if assignments not provided, treat as data_entry for these user IDs",
    )


class KPIUpdate(BaseModel):
    """Update KPI (optionally replace domain/category/org tags, card display fields)."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    year: int | None = Field(None, ge=2000, le=2100)
    sort_order: int | None = None
    entry_mode: str | None = Field(None, description="manual or api")
    api_endpoint_url: str | None = Field(None, max_length=2048, description="When entry_mode=api, URL we call to fetch entry data")
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
    """User assigned to KPI with permission (data_entry or view)."""

    id: int
    username: str
    full_name: str | None = None
    permission: str = Field(default="data_entry", description="data_entry (can edit) or view (read-only)")


class KPIResponse(BaseModel):
    """KPI in API response."""

    id: int
    organization_id: int
    domain_id: int | None = None
    name: str
    description: str | None
    year: int
    sort_order: int
    entry_mode: str = "manual"
    api_endpoint_url: str | None = None
    card_display_field_ids: list[int] | None = None
    fields_count: int = 0
    domain_tags: list[DomainTagRef] = []
    category_tags: list[CategoryTagRef] = []
    organization_tags: list[OrganizationTagRef] = []
    assigned_users: list[AssignedUserRef] = []

    class Config:
        from_attributes = True


class KPIApiContractField(BaseModel):
    """One KPI field with key, type, and example value for the API contract."""

    key: str = Field(..., description="Field key – use this in response values")
    name: str = Field(..., description="Display name of the field")
    field_type: str = Field(..., description="single_line_text, multi_line_text, number, date, boolean, multi_line_items (formula omitted)")
    sub_field_keys: list[str] = Field(default_factory=list, description="For multi_line_items: keys for each row object")
    example_value: str | int | float | bool | list[dict] | None = Field(
        None, description="Concrete example to return in response values"
    )
    accepted_value_hint: str | None = Field(
        None, description="Optional hint for API: e.g. 'true, false, 1, or 0' for boolean"
    )


class KPIApiContract(BaseModel):
    """Operation contract for KPI API entry mode: what we send and what we expect in response."""

    description: str = "When entry_mode is 'api', the system calls your endpoint to fetch KPI entry data."
    request_method: str = "POST"
    request_url: str = "Your configured API endpoint URL"
    request_headers: dict = Field(default_factory=lambda: {"Content-Type": "application/json"})
    request_body_schema: dict = Field(
        default_factory=lambda: {
            "year": "int – calendar year (e.g. 2025)",
            "kpi_id": "int – this KPI’s id",
            "organization_id": "int – organization id",
        }
    )
    example_request_body: dict = Field(
        default_factory=lambda: {"year": 2025, "kpi_id": 1, "organization_id": 1}
    )
    response_required: dict = Field(
        default_factory=lambda: {
            "year": "int – same year as requested",
            "values": "object – map of field_key to value; keys and types per 'fields' below",
        }
    )
    fields: list[KPIApiContractField] = Field(
        default_factory=list,
        description="All KPI fields in same order as data entry form. Use each non-formula key in response values; formula fields are computed server-side – omit from response.",
    )
    example_response: dict = Field(
        default_factory=lambda: {
            "year": 2025,
            "values": {},
        }
    )


class KPIChildDataSummary(BaseModel):
    """Summary of child records for a KPI (for delete confirmation)."""

    assignments_count: int = 0
    entries_count: int = 0
    fields_count: int = 0
    field_values_count: int = 0
    report_template_kpis_count: int = 0
    has_child_data: bool = False


class KpiFileResponse(BaseModel):
    """KPI file attachment in list/download response."""

    id: int
    original_filename: str
    size: int
    content_type: str | None
    created_at: str
    download_url: str | None = None  # relative path for download endpoint
