from datetime import datetime
from pydantic import BaseModel, Field


class CustomReportCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    fetch_data_with_date: bool = False
    date_fetching_config: dict | None = None
    report_header_id: int | None = None
    show_report_name: bool = True
    branding_title: str | None = None
    show_odoo_button: bool = False
    odoo_sync_kpi_ids: list[int] | None = None  # KPI IDs selected by Super Admin to sync; None = none selected





class CustomReportUpdate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    fetch_data_with_date: bool | None = None
    date_fetching_config: dict | None = None
    report_header_id: int | None = None
    show_report_name: bool | None = None
    branding_title: str | None = None
    show_odoo_button: bool | None = None
    odoo_sync_kpi_ids: list[int] | None = None





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
    report_header_id: int | None = None
    show_report_name: bool = True
    branding_title: str | None = None
    show_odoo_button: bool = False
    odoo_sync_kpi_ids: list[int] | None = None

    scalar_bold: bool = True
    scalar_font_size: int = 11
    mli_font_size: int = 10
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
    report_header_id: int | None = None
    show_report_name: bool | None = None
    branding_title: str | None = None
    scalar_bold: bool | None = None
    scalar_font_size: int | None = None
    mli_font_size: int | None = None
    show_odoo_button: bool | None = None
    odoo_sync_kpi_ids: list[int] | None = None




