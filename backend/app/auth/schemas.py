"""Pydantic schemas for auth."""

from pydantic import BaseModel, Field

from app.core.models import UserRole


class LoginRequest(BaseModel):
    """Login request body."""

    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    """JWT token response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class RefreshRequest(BaseModel):
    """Refresh token request."""

    refresh_token: str


class UserInResponse(BaseModel):
    """User summary in API responses."""

    id: int
    username: str
    email: str | None
    full_name: str | None
    role: UserRole
    organization_id: int | None
    is_active: bool

    class Config:
        from_attributes = True
