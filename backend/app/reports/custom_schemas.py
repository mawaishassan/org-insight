from datetime import datetime
from pydantic import BaseModel, Field


class CustomReportCreate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    group_id: int | None = None
    fetch_data_with_date: bool = False
    date_fetching_config: dict | None = None
    report_header_id: int | None = None
    show_report_name: bool = False
    branding_title: str | None = None
    show_odoo_button: bool = False
    odoo_sync_kpi_ids: list[int] | None = None  # KPI IDs selected by Super Admin to sync; None = none selected
    apply_further_processing_based_on_mli_filter: bool = False
    scalar_font_family: str = "Inter"
    mli_font_family: str = "Inter"





class CustomReportUpdate(BaseModel):
    name: str = Field(..., max_length=255)
    description: str | None = None
    group_id: int | None = None
    fetch_data_with_date: bool | None = None
    date_fetching_config: dict | None = None
    report_header_id: int | None = None
    show_report_name: bool | None = None
    branding_title: str | None = None
    show_odoo_button: bool | None = None
    odoo_sync_kpi_ids: list[int] | None = None
    scalar_font_family: str | None = None
    mli_font_family: str | None = None
    apply_further_processing_based_on_mli_filter: bool | None = None





class CustomReportAssignmentRequest(BaseModel):
    user_id: int
    can_view: bool = True
    can_print: bool = True
    can_export: bool = True
    can_change_period: bool = True


class CustomReportBulkAssignmentRequest(BaseModel):
    user_ids: list[int]
    can_view: bool = True
    can_print: bool = True
    can_export: bool = True
    can_change_period: bool = True


class ReportUserFilterConfigCreateUpdate(BaseModel):
    enabled: bool = False
    kpi_id: int | None = None
    mli_id: int | None = None
    field_id: int | None = None
    operator: str = "="
    dynamic_value_source: str = "CURRENT_USER_UNIQUE_KEY"


class ReportUserFilterConfigResponse(BaseModel):
    id: int
    report_id: int
    enabled: bool
    kpi_id: int | None = None
    mli_id: int | None = None
    field_id: int | None = None
    operator: str
    dynamic_value_source: str

    class Config:
        from_attributes = True


class CustomReportAssignmentResponse(BaseModel):
    id: int
    custom_report_id: int
    user_id: int
    can_view: bool
    can_print: bool
    can_export: bool
    can_change_period: bool
    created_at: datetime
    user_name: str | None = None
    user_role: str | None = None

    class Config:
        from_attributes = True


class CustomReportResponse(BaseModel):
    id: int
    organization_id: int
    group_id: int | None = None
    name: str
    description: str | None
    fetch_data_with_date: bool = False
    date_fetching_config: dict | None = None
    report_header_id: int | None = None
    show_report_name: bool = False
    branding_title: str | None = None
    show_odoo_button: bool = False
    odoo_sync_kpi_ids: list[int] | None = None
    apply_further_processing_based_on_mli_filter: bool = False

    scalar_bold: bool = True
    scalar_font_size: int = 11
    mli_font_size: int = 10
    scalar_font_family: str = "Inter"
    mli_font_family: str = "Inter"
    created_at: datetime
    updated_at: datetime
    can_view: bool = True
    can_print: bool = True
    can_export: bool = True
    can_change_period: bool = True

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
    apply_further_processing_based_on_mli_filter: bool | None = None
    scalar_font_family: str | None = None
    mli_font_family: str | None = None




