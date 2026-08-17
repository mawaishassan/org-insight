from datetime import datetime
from pydantic import BaseModel, Field


class CustomReportCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    fetch_data_with_date: bool = False
    date_fetching_config: dict | None = None


class CustomReportUpdate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    fetch_data_with_date: bool | None = None
    date_fetching_config: dict | None = None


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
    fetch_data_with_date: bool = False
    date_fetching_config: dict | None = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class CustomReportFieldLayout(BaseModel):
    kpi_field_id: int
    sort_order: int
    config: dict | None = None


class CustomReportSectionLayout(BaseModel):
    kpi_id: int | None = None
    custom_header: str | None = None
    sort_order: int
    fields: list[CustomReportFieldLayout] = []


class CustomReportAttachmentLayout(BaseModel):
    kpi_id: int
    kpi_field_id: int
    title: str
    selected_columns: list[str] = []
    filters: dict | None = None
    sort_order: int


class CustomReportLayoutSave(BaseModel):
    sections: list[CustomReportSectionLayout]
    attachments: list[CustomReportAttachmentLayout] = []
    fetch_data_with_date: bool | None = None
    date_fetching_config: dict | None = None

