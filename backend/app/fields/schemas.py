"""Pydantic schemas for KPI fields."""

from pydantic import BaseModel, Field
from typing import Any

from app.core.models import FieldType


# Allowed sub-field types for multi_line_items (one column type per sub-field)
SUB_FIELD_TYPES = (FieldType.single_line_text, FieldType.number, FieldType.date, FieldType.boolean)


class KPIFieldSubFieldCreate(BaseModel):
    """Sub-field for multi_line_items (column definition)."""

    name: str = Field(..., min_length=1, max_length=255)
    key: str = Field(..., min_length=1, max_length=100)
    field_type: FieldType = Field(...)  # single_line_text, number, date, boolean recommended
    is_required: bool = False
    sort_order: int = 0


class KPIFieldSubFieldResponse(BaseModel):
    """Sub-field in API response."""

    id: int
    field_id: int
    name: str
    key: str
    field_type: FieldType
    is_required: bool
    sort_order: int

    class Config:
        from_attributes = True


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
    sub_fields: list[KPIFieldSubFieldCreate] = Field(default_factory=list, description="For multi_line_items: column definitions")


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
    sub_fields: list[KPIFieldSubFieldCreate] | None = Field(None, description="For multi_line_items: replace column definitions")


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
    sub_fields: list[KPIFieldSubFieldResponse] = []

    class Config:
        from_attributes = True


class KPIFieldChildDataSummary(BaseModel):
    """Summary of child records for a KPI field (for delete confirmation)."""

    field_values_count: int = 0
    report_template_fields_count: int = 0
    has_child_data: bool = False
