"""Pydantic schemas for report templates and access."""

from pydantic import BaseModel, Field


class ReportTemplateCreate(BaseModel):
    """Create report template (general; year is passed at generate/print time)."""

    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    # Optional rich layout template text (Jinja2-style) used when rendering HTML.
    body_template: str | None = None


class ReportTemplateUpdate(BaseModel):
    """Update report template."""

    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    template_mode: str | None = Field(None, pattern="^(designer|code)$")
    body_template: str | None = None
    body_blocks: list[dict] | None = None


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


class ReportAssignmentResponse(BaseModel):
    """One user assignment for a report template."""

    user_id: int
    email: str | None
    full_name: str | None
    can_view: bool
    can_print: bool
    can_export: bool


class ReportTemplateResponse(BaseModel):
    """Report template in API response (general; year passed at generate time)."""

    id: int
    organization_id: int
    name: str
    description: str | None

    class Config:
        from_attributes = True


class ReportTemplateDetailResponse(ReportTemplateResponse):
    """Report template with KPIs and field selection (for builder)."""

    kpis: list[dict] = []  # id, kpi_id, include_all_fields, sort_order, field_ids


class ReportGenerateOptions(BaseModel):
    """Options for report generation."""

    format: str = Field(default="json", pattern="^(json|csv|pdf)$")
    year: int | None = None  # year for data; required at generate/print time


class ReportPreviewRequest(BaseModel):
    """Request body for live report preview (designer)."""

    body_template: str = Field(..., description="Jinja2/HTML template string to render with current report data")


class EvaluateSnippetRequest(BaseModel):
    """Request to evaluate a KPI value or formula snippet in report context."""

    type: str = Field(..., pattern="^(kpi_value|formula)$")
    organization_id: int = Field(...)
    year: int | None = None  # year for report data (required for correct context)
    # For kpi_value: which value to resolve
    kpi_id: int | None = None
    field_key: str | None = None
    sub_field_key: str | None = None
    sub_field_group_fn: str | None = None  # SUM_ITEMS, AVG_ITEMS, etc. when sub_field_key is set
    entry_index: int = 0
    # For formula
    expression: str | None = None
