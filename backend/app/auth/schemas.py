"""Pydantic schemas for auth."""

from pydantic import BaseModel, Field

from app.core.models import UserRole


class LoginRequest(BaseModel):
    """Login request body."""

    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    captcha_id: str = Field(..., min_length=1)
    captcha_answer: str = Field(..., min_length=1)



class TokenResponse(BaseModel):
    """JWT token response."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    force_password_reset: bool = False


class RefreshRequest(BaseModel):
    """Refresh token request."""

    refresh_token: str


class UserInResponse(BaseModel):
    """User summary in API responses."""

    id: int
    username: str
    email: str | None = None
    full_name: str | None = None
    role: UserRole | str
    organization_id: int | None = None
    is_active: bool = True
    force_password_reset: bool = False
    default_dashboard_id: int | None = None
    unique_user_key: str | None = None
    organization_name: str | None = None

    class Config:
        from_attributes = True
        use_enum_values = True


class ResetForcedPasswordRequest(BaseModel):
    """Payload to reset password when forced by admin."""

    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)
    confirm_password: str = Field(..., min_length=8)


class ExternalAuthConfigUpdate(BaseModel):
    """Update external login URL + db used in JSON-RPC."""
    login_url: str = Field(..., min_length=1, max_length=2048)
    db: str = Field(..., min_length=1, max_length=255)
