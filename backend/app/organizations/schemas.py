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
    time_dimension: str | None = Field(None, description="yearly, half_yearly, quarterly, monthly")
    custom_period_name: str | None = None
    custom_period_start_month: int | None = Field(None, ge=1, le=12)
    custom_period_start_day: int | None = Field(None, ge=1, le=31)
    custom_period_duration_months: int | None = Field(None, ge=1)
    custom_period_display_format: str | None = None
    custom_period_prefix: str | None = None
    custom_period_suffix: str | None = None
    custom_periods: list[dict] | None = None


class OrganizationResponse(BaseModel):
    """Organization in API response."""

    id: int
    name: str
    description: str | None
    is_active: bool
    time_dimension: str = "yearly"
    custom_period_name: str | None = None
    custom_period_start_month: int = 1
    custom_period_start_day: int = 1
    custom_period_duration_months: int = 12
    custom_period_display_format: str = "YYYY"
    custom_period_prefix: str = ""
    custom_period_suffix: str = ""
    custom_periods: list[dict] | None = None

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


class ExportTokenCreate(BaseModel):
    """Request body to generate a long-lived export API token."""

    valid_hours: int = Field(..., ge=1, le=8760, description="Token validity in hours (1 to 8760 = 1 year)")


class ExportTokenResponse(BaseModel):
    """Response after generating an export API token (token shown once)."""

    token: str = Field(..., description="Bearer token to use for data-export API")
    expires_at: str = Field(..., description="ISO datetime when the token expires")


# --- Storage config (Super Admin) ---

STORAGE_TYPES = ("local", "gcs", "ftp", "s3", "onedrive")

# --- Odoo config (Super Admin, per organization) ---


class OdooConfigUpdate(BaseModel):
    """Create or update organization Odoo connection."""

    login_url: str = Field(..., min_length=1, max_length=2048)
    data_fetch_url: str = Field(..., min_length=1, max_length=2048)
    attachment_url_template: str | None = Field(
        None, max_length=2048, description="Optional static template URL for downloading Odoo attachments (supports {ATTACHMENT_ID})"
    )
    odoo_db: str | None = Field(None, max_length=255, description="Odoo database name for login")
    username: str = Field(..., min_length=1, max_length=255)
    password: str | None = Field(
        None,
        max_length=512,
        description="Required on first save. Omit or send *** on update to keep existing password.",
    )


class OdooConfigResponse(BaseModel):
    """Odoo config (password masked)."""

    organization_id: int
    configured: bool
    login_url: str | None = None
    data_fetch_url: str | None = None
    attachment_url_template: str | None = None
    odoo_db: str | None = None
    username: str | None = None
    password: str = Field(default="***", description="Masked")
    created_at: str | None = None
    updated_at: str | None = None


class OdooEndpointCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    url: str = Field(..., min_length=1, max_length=2048)
    description: str | None = Field(None, max_length=1024)
    is_active: bool = True


class OdooEndpointUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    url: str | None = Field(None, min_length=1, max_length=2048)
    description: str | None = Field(None, max_length=1024)
    is_active: bool | None = None


class OdooEndpointResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    url: str
    description: str | None = None
    is_active: bool
    created_at: str | None = None
    updated_at: str | None = None


class OdooEndpointTestRequest(BaseModel):
    url: str = Field(..., min_length=1, max_length=2048)


# Keys that must be masked in API responses (never log or return raw)
STORAGE_SECRET_KEYS = frozenset(
    {"password", "secret", "credentials_path", "secret_access_key", "access_key_id", "token", "credentials"}
)


def mask_storage_params(params: dict | None) -> dict:
    """Return a copy of params with secret values replaced by '***'."""
    if not params:
        return {}
    out = {}
    for k, v in params.items():
        key_lower = k.lower()
        if key_lower in STORAGE_SECRET_KEYS or "secret" in key_lower or "password" in key_lower or "key" in key_lower or "token" in key_lower or "credential" in key_lower:
            out[k] = "***"
        elif isinstance(v, dict):
            out[k] = mask_storage_params(v)
        else:
            out[k] = v
    return out


class StorageConfigUpdate(BaseModel):
    """Create or update organization storage config. Params are type-specific."""

    storage_type: str = Field(..., description="One of: local, gcs, ftp, s3, onedrive")
    params: dict | None = Field(default_factory=dict, description="Type-specific config (paths, bucket, keys, etc.)")


class StorageConfigResponse(BaseModel):
    """Storage config returned by GET (secrets masked)."""

    organization_id: int
    storage_type: str
    params: dict = Field(default_factory=dict, description="Type-specific params with secrets masked")
    created_at: str | None = None
    updated_at: str | None = None

    class Config:
        from_attributes = True


# --- Organization roles (Org Admin: create roles, assign users) ---


class OrganizationRoleCreate(BaseModel):
    """Create a custom role in the organization."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None


class OrganizationRoleUpdate(BaseModel):
    """Update role name/description."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None


class OrganizationRoleResponse(BaseModel):
    """Role in API response."""

    id: int
    organization_id: int
    name: str
    description: str | None
    created_at: str | None = None
    updated_at: str | None = None

    class Config:
        from_attributes = True


class RoleUsersPut(BaseModel):
    """Set users in a role (replace existing)."""

    user_ids: list[int] = Field(default_factory=list, description="User IDs to assign to this role (must belong to org)")
