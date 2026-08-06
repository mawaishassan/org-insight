from datetime import datetime
from pydantic import BaseModel, Field


class CustomReportCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None


class CustomReportUpdate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None


class CustomReportAssignmentRequest(BaseModel):
    user_id: int
    can_view: bool = True
    can_print: bool = True
    can_export: bool = True


class CustomReportAssignmentResponse(BaseModel):
    id: int
    custom_report_id: int
    user_id: int
    can_view: bool
    can_print: bool
    can_export: bool
    created_at: datetime
    user_name: str | None = None
    user_role: str | None = None

    class Config:
        from_attributes = True


class CustomReportResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CustomReportFieldLayout(BaseModel):
    kpi_field_id: int
    sort_order: int
    config: dict | None = None


class CustomReportSectionLayout(BaseModel):
    kpi_id: int
    custom_header: str | None = None
    sort_order: int
    fields: list[CustomReportFieldLayout] = []


class CustomReportLayoutSave(BaseModel):
    sections: list[CustomReportSectionLayout]
