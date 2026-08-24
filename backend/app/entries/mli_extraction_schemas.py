"""Pydantic schemas for MLI text extraction symbols and rules."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator


# ---------------------------------------------------------------------------
# Symbols
# ---------------------------------------------------------------------------

class SymbolCreate(BaseModel):
    label: str
    value: str
    sort_order: int = 0
    is_active: bool = True


class SymbolUpdate(BaseModel):
    label: Optional[str] = None
    value: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class SymbolOut(BaseModel):
    id: int
    label: str
    value: str
    sort_order: int
    is_active: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

ExtractionMethod = Literal["between_symbols", "remove_only", "full_cell_format"]
OccurrenceType = Literal["first", "last", "all"]
TargetAction = Literal["replace", "append", "populate_if_empty"]
WrapMode = Literal["none", "prefix", "suffix", "wrap", "pattern"]


class RuleCreate(BaseModel):
    name: str
    is_active: bool = True
    sort_order: int = 0
    source_sub_field_key: str
    target_sub_field_key: Optional[str] = None
    extraction_method: ExtractionMethod = "between_symbols"
    start_symbol: Optional[str] = "("
    end_symbol: Optional[str] = ")"
    remove_delimiters_too: bool = True
    occurrence: OccurrenceType = "first"
    all_separator: Optional[str] = None
    target_action: Optional[TargetAction] = None
    remove_from_source: bool = False
    wrap_mode: Optional[WrapMode] = "none"
    wrap_symbol: Optional[str] = None
    wrap_end_symbol: Optional[str] = None
    output_pattern: Optional[str] = None

    @model_validator(mode="after")
    def check_target_required_for_extract(self) -> "RuleCreate":
        if self.extraction_method in ("between_symbols", "full_cell_format"):
            if not self.target_sub_field_key:
                # Default target cell to source cell if not explicitly set
                self.target_sub_field_key = self.source_sub_field_key
            if not self.target_action:
                self.target_action = "replace"
        return self


class RuleUpdate(RuleCreate):
    """Same validation rules as Create — all fields are editable."""
    pass


class RuleOut(BaseModel):
    id: int
    field_id: int
    name: str
    is_active: bool
    sort_order: int
    source_sub_field_key: str
    target_sub_field_key: Optional[str] = None
    extraction_method: str
    start_symbol: Optional[str] = ""
    end_symbol: Optional[str] = ""
    remove_delimiters_too: bool
    occurrence: str
    all_separator: Optional[str] = None
    target_action: Optional[str] = None
    remove_from_source: bool
    wrap_mode: Optional[str] = "none"
    wrap_symbol: Optional[str] = None
    wrap_end_symbol: Optional[str] = None
    output_pattern: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class RuleReorder(BaseModel):
    """Array of rule IDs in the desired new order."""
    ids: list[int]


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

class RulePreviewRequest(BaseModel):
    """Preview extraction on sample rows without saving anything."""
    rows: list[dict]
    rules: list[RuleCreate]


class RulePreviewResponse(BaseModel):
    result_rows: list[dict]
    error: Optional[str] = None
