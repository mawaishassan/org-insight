"""Pydantic schemas for dashboards and access."""

from pydantic import BaseModel, Field


class DashboardCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str | None = None
    layout: dict | list | None = None


class DashboardUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    layout: dict | list | None = None


class DashboardAccessAssign(BaseModel):
    user_id: int = Field(...)
    can_view: bool = True
    can_edit: bool = False


class DashboardAssignmentResponse(BaseModel):
    user_id: int
    email: str | None
    full_name: str | None
    can_view: bool
    can_edit: bool


class DashboardResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    description: str | None

    class Config:
        from_attributes = True


class DashboardDetailResponse(DashboardResponse):
    layout: dict | list | None = None

