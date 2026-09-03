"""Pydantic schemas for dashboards and access."""

from pydantic import BaseModel, Field


class DashboardCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    layout: dict | list | None = None
    fetch_data_with_date: bool = False
    date_fetching_config: dict | None = None
    fetch_data_with_column: bool = False
    column_fetching_config: dict | None = None


class DashboardUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    layout: dict | list | None = None
    fetch_data_with_date: bool | None = None
    date_fetching_config: dict | None = None
    fetch_data_with_column: bool | None = None
    column_fetching_config: dict | None = None


class DashboardAccessAssign(BaseModel):
    user_id: int = Field(...)
    can_view: bool = True
    can_edit: bool = False
    can_load_lms: bool = True
    can_change_period: bool = True
    can_use_unique_value: bool = False
    filter_kpi_id: int | None = None
    filter_mli_id: int | None = None
    filter_sub_field_key: str | None = None
    filter_column_configs: dict[str, str] | None = None
    filter_operator: str = "="


class DashboardBulkAssignRequest(BaseModel):
    dashboard_ids: list[int] = Field(..., min_items=1)
    user_ids: list[int] = Field(..., min_items=1)
    can_view: bool = True
    can_edit: bool = False
    can_load_lms: bool = True
    can_change_period: bool = True
    can_use_unique_value: bool = False
    filter_kpi_id: int | None = None
    filter_mli_id: int | None = None
    filter_sub_field_key: str | None = None
    filter_column_configs: dict[str, str] | None = None
    filter_operator: str = "="


class DashboardAssignmentResponse(BaseModel):
    id: int | None = None
    dashboard_id: int | None = None
    user_id: int
    username: str | None = None
    email: str | None = None
    full_name: str | None = None
    unique_user_key: str | None = None
    can_view: bool = True
    can_edit: bool = False
    can_load_lms: bool = True
    can_change_period: bool = True
    can_use_unique_value: bool = False
    filter_kpi_id: int | None = None
    filter_mli_id: int | None = None
    filter_sub_field_key: str | None = None
    filter_column_configs: dict[str, str] | None = None
    filter_operator: str = "="


class DashboardFilterColumnItem(BaseModel):
    kpi_id: int
    kpi_title: str
    mli_id: int
    mli_title: str
    sub_field_id: int
    sub_field_key: str
    label: str


class DashboardResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    description: str | None
    fetch_data_with_date: bool = False
    date_fetching_config: dict | None = None
    fetch_data_with_column: bool = False
    column_fetching_config: dict | None = None

    class Config:
        from_attributes = True


class DashboardDetailResponse(DashboardResponse):
    layout: dict | list | None = None


class DashboardLabelCustomizationResponse(BaseModel):
    id: int
    organization_id: int
    dashboard_id: int
    widget_id: str | None = None
    original_label: str
    customized_label: str

    class Config:
        from_attributes = True


class DashboardLabelCustomizationUpsert(BaseModel):
    widget_id: str | None = None
    original_label: str = Field(..., min_length=1)
    customized_label: str = Field(..., min_length=1)


