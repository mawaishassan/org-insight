"""Request/response models for POST /api/widget-data (v1)."""

from typing import Any

from pydantic import BaseModel, Field


class WidgetDataRequestV1(BaseModel):
    """
    v1: `widget` is the same JSON object as stored in dashboard `layout` (id, type, options).
    Use `overrides` for runtime values without mutating stored layout, e.g.:
    { "year": 2024, "period_key": "H1" } (bar, table, card),
    { "selected_years": [2024, 2023] } (trend, multi-year line).
    """

    version: int = Field(1, ge=1, le=1, description="API version")
    organization_id: int
    widget: dict[str, Any]
    overrides: dict[str, Any] | None = None


class WidgetDataResponseV1(BaseModel):
    version: int = 1
    widget_type: str
    meta: dict[str, Any] = Field(default_factory=dict)
    data: dict[str, Any] = Field(default_factory=dict)
    etag: str | None = None
    # Optional cache keying / revision (use with If-None-Match on client)
    entry_revision: str | None = None


class ChartWidgetDataRequestV1(BaseModel):
    """
    Fast path for bar/pie widgets when the caller is viewing a specific dashboard.
    Authorizes via dashboard view only (no KPI field-level permission queries).
    """

    version: int = Field(1, ge=1, le=1)
    organization_id: int
    dashboard_id: int = Field(..., ge=1, description="Dashboard the widget is rendered on")
    widget: dict[str, Any]
    overrides: dict[str, Any] | None = None


class DashboardWidgetDataRequestV1(BaseModel):
    """
    Fast path for widgets when the caller is viewing a specific dashboard.
    Authorizes via dashboard view only (no KPI field-level permission queries).
    """

    version: int = Field(1, ge=1, le=1)
    organization_id: int
    dashboard_id: int = Field(..., ge=1, description="Dashboard the widget is rendered on")
    widget: dict[str, Any]
    overrides: dict[str, Any] | None = None


class DashboardChartBatchRequestV1(BaseModel):
    """Batch fast path for multiple `kpi_bar_chart` widgets on one dashboard."""

    version: int = Field(1, ge=1, le=1)
    organization_id: int
    dashboard_id: int = Field(..., ge=1)
    items: list[dict[str, Any]] = Field(default_factory=list)


class DashboardCardBatchRequestV1(BaseModel):
    """Batch fast path for multiple `kpi_card_single_value` widgets on one dashboard."""

    version: int = Field(1, ge=1, le=1)
    organization_id: int
    dashboard_id: int = Field(..., ge=1)
    items: list[dict[str, Any]] = Field(default_factory=list)


class DashboardMultiLineTableRowsRequestV1(BaseModel):
    """Paged rows for `kpi_multi_line_table` widgets on a dashboard view (fast path)."""

    version: int = Field(1, ge=1, le=1)
    organization_id: int
    dashboard_id: int = Field(..., ge=1)
    widget: dict[str, Any]
    overrides: dict[str, Any] | None = None
    page: int = Field(1, ge=1)
    page_size: int = Field(50, ge=1, le=200)
    search: str | None = None
    sort_by: str | None = None
    sort_dir: str = Field("asc", pattern="^(asc|desc)$")
