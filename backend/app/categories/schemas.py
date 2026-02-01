"""Pydantic schemas for categories."""

from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    """Create category."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    sort_order: int = 0


class CategoryUpdate(BaseModel):
    """Update category."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    sort_order: int | None = None


class CategoryResponse(BaseModel):
    """Category in API response."""

    id: int
    domain_id: int
    name: str
    description: str | None
    sort_order: int
    domain_name: str | None = None  # optional, for list-all response
    kpi_count: int = 0  # number of KPIs attached to this category

    class Config:
        from_attributes = True
