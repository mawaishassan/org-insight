from datetime import datetime
from pydantic import BaseModel, Field

class CustomReportGroupCreate(BaseModel):
    name: str = Field(..., max_length=255)
    sort_order: int = 0

class CustomReportGroupUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    sort_order: int | None = None

class CustomReportGroupResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    sort_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
