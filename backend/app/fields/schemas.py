"""Pydantic schemas for KPI fields."""

from pydantic import BaseModel, Field
from typing import Any

from app.core.models import FieldType


class KPIFieldOptionCreate(BaseModel):
    """Option for dropdown-style field."""

    value: str = Field(..., max_length=255)
    label: str = Field(..., max_length=255)
    sort_order: int = 0


class KPIFieldCreate(BaseModel):
    """Create KPI field."""

    kpi_id: int = Field(...)
    name: str = Field(..., min_length=1, max_length=255)
    key: str = Field(..., min_length=1, max_length=100)
    field_type: FieldType = Field(...)
    formula_expression: str | None = None
    is_required: bool = False
    sort_order: int = 0
    config: dict[str, Any] | None = None
    options: list[KPIFieldOptionCreate] = Field(default_factory=list)


class KPIFieldUpdate(BaseModel):
    """Update KPI field."""

    name: str | None = Field(None, min_length=1, max_length=255)
    key: str | None = Field(None, min_length=1, max_length=100)
    field_type: FieldType | None = None
    formula_expression: str | None = None
    is_required: bool | None = None
    sort_order: int | None = None
    config: dict[str, Any] | None = None
    options: list[KPIFieldOptionCreate] | None = None


class KPIFieldOptionResponse(BaseModel):
    """Option in API response."""

    id: int
    value: str
    label: str
    sort_order: int

    class Config:
        from_attributes = True


class KPIFieldResponse(BaseModel):
    """KPI field in API response."""

    id: int
    kpi_id: int
    name: str
    key: str
    field_type: FieldType
    formula_expression: str | None
    is_required: bool
    sort_order: int
    config: dict[str, Any] | None
    options: list[KPIFieldOptionResponse] = []

    class Config:
        from_attributes = True
