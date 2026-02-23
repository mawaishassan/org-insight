"""Pydantic schemas for report templates and access."""

from pydantic import BaseModel, Field


class ReportTemplateCreate(BaseModel):
    """Create report template."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    # Optional rich layout template text (Jinja2-style) used when rendering HTML.
    body_template: str | None = None
    year: int = Field(..., ge=2000, le=2100)


class ReportTemplateUpdate(BaseModel):
    """Update report template."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    body_template: str | None = None
    body_blocks: list[dict] | None = None
    year: int | None = Field(None, ge=2000, le=2100)


class ReportTemplateKPIAdd(BaseModel):
    """Add KPI to template with optional specific fields."""

    kpi_id: int = Field(...)
    include_all_fields: bool = True
    field_ids: list[int] = Field(default_factory=list)
    sort_order: int = 0


class ReportTemplateKPIRemove(BaseModel):
    """Remove KPI from template."""

    report_template_kpi_id: int = Field(...)


class ReportAccessAssign(BaseModel):
    """Assign report template to user with permissions."""

    user_id: int = Field(...)
    can_view: bool = True
    can_print: bool = True
    can_export: bool = True


class ReportTemplateResponse(BaseModel):
    """Report template in API response."""

    id: int
    organization_id: int
    name: str
    description: str | None
    year: int

    class Config:
        from_attributes = True


class ReportTemplateDetailResponse(ReportTemplateResponse):
    """Report template with KPIs and field selection (for builder)."""

    kpis: list[dict] = []  # id, kpi_id, include_all_fields, sort_order, field_ids


class ReportGenerateOptions(BaseModel):
    """Options for report generation."""

    format: str = Field(default="json", pattern="^(json|csv|pdf)$")
    year: int | None = None  # override template year if needed


class EvaluateSnippetRequest(BaseModel):
    """Request to evaluate a KPI value or formula snippet in report context."""

    type: str = Field(..., pattern="^(kpi_value|formula)$")
    organization_id: int = Field(...)
    year: int | None = None  # use template year if not provided
    # For kpi_value: which value to resolve
    kpi_id: int | None = None
    field_key: str | None = None
    sub_field_key: str | None = None
    sub_field_group_fn: str | None = None  # SUM_ITEMS, AVG_ITEMS, etc. when sub_field_key is set
    entry_index: int = 0
    # For formula
    expression: str | None = None
