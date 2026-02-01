"""Pydantic schemas for domains."""

from pydantic import BaseModel, Field


class DomainCreate(BaseModel):
    """Create domain."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    sort_order: int = 0


class DomainUpdate(BaseModel):
    """Update domain."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    sort_order: int | None = None


class DomainResponse(BaseModel):
    """Domain in API response."""

    id: int
    organization_id: int
    name: str
    description: str | None
    sort_order: int

    class Config:
        from_attributes = True


class DomainSummary(BaseModel):
    """Summary counts for a domain. Entry counts are for current user and given year when requested."""

    category_count: int
    kpi_count: int
    entries_submitted: int = 0
    entries_draft: int = 0
    entries_not_entered: int = 0


class DomainWithSummary(DomainResponse):
    """Domain with summary counts (for list cards)."""

    summary: DomainSummary
