"""Chat request/response schemas."""

from pydantic import BaseModel, Field


class ChatMessageRequest(BaseModel):
    """Single user message for the chat endpoint."""

    message: str = Field(..., min_length=1, max_length=4000)


class ChatSource(BaseModel):
    """Link to the KPI entry detail page: /dashboard/entries/kpi/{kpi_id}?year={year}&organization_id={organization_id}."""

    kpi_id: int
    kpi_name: str
    year: int
    organization_id: int


class ChatMessageResponse(BaseModel):
    """Response for one chat turn: NLP text, optional chart (e.g. year comparison), and source links."""

    text: str = Field(..., description="Natural language reply to show the user")
    sources: list[ChatSource] | None = Field(
        None,
        description="Links to KPI entry pages: /dashboard/entries/{kpi_id}/{year}",
    )
    chart: dict | None = Field(
        None,
        description="Optional chart for year-over-year comparison: { type, labels, series }",
    )
    not_entered: list[dict] | None = Field(
        None,
        description="KPIs with no data: [{ kpi_name, assigned_user_names }]",
    )
    not_collected: bool = Field(
        False,
        description="True if the question referred to KPIs/fields not in the system",
    )
