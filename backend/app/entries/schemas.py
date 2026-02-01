"""Pydantic schemas for KPI entries."""

from datetime import datetime
from pydantic import BaseModel, Field
from typing import Any


class FieldValueInput(BaseModel):
    """Single field value for entry."""

    field_id: int = Field(...)
    value_text: str | None = None
    value_number: float | int | None = None
    value_json: list[Any] | dict[str, Any] | None = None
    value_boolean: bool | None = None
    value_date: datetime | str | None = None


class EntryCreate(BaseModel):
    """Create or update KPI entry (draft)."""

    kpi_id: int = Field(...)
    year: int = Field(..., ge=2000, le=2100)
    is_draft: bool = True
    values: list[FieldValueInput] = Field(default_factory=list)


class EntrySubmit(BaseModel):
    """Submit entry (no longer draft)."""

    entry_id: int = Field(...)


class EntryLock(BaseModel):
    """Lock/unlock entry (admin)."""

    entry_id: int = Field(...)
    is_locked: bool = Field(...)


class FieldValueResponse(BaseModel):
    """Stored field value in response."""

    field_id: int
    value_text: str | None
    value_number: float | None
    value_json: list[Any] | dict[str, Any] | None
    value_boolean: bool | None
    value_date: datetime | None


class EntryResponse(BaseModel):
    """KPI entry in API response."""

    id: int
    kpi_id: int
    user_id: int
    year: int
    is_draft: bool
    is_locked: bool
    submitted_at: datetime | None
    values: list[FieldValueResponse] = []

    class Config:
        from_attributes = True
