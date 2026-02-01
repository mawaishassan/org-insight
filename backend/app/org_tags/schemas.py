"""Pydantic schemas for organization tags."""

from pydantic import BaseModel, Field


class OrganizationTagCreate(BaseModel):
    """Create organization tag (single text)."""

    name: str = Field(..., min_length=1, max_length=255)


class OrganizationTagUpdate(BaseModel):
    """Update organization tag."""

    name: str = Field(..., min_length=1, max_length=255)


class OrganizationTagResponse(BaseModel):
    """Organization tag in API response."""

    id: int
    organization_id: int
    name: str

    class Config:
        from_attributes = True
