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


class ExportTokenCreate(BaseModel):
    """Request body to generate a long-lived export API token."""

    valid_hours: int = Field(..., ge=1, le=8760, description="Token validity in hours (1 to 8760 = 1 year)")


class ExportTokenResponse(BaseModel):
    """Response after generating an export API token (token shown once)."""

    token: str = Field(..., description="Bearer token to use for data-export API")
    expires_at: str = Field(..., description="ISO datetime when the token expires")


# --- Storage config (Super Admin) ---

STORAGE_TYPES = ("local", "gcs", "ftp", "s3", "onedrive")

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
