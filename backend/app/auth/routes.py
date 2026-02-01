"""Auth API routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.schemas import LoginRequest, TokenResponse, RefreshRequest, UserInResponse
from app.auth.service import authenticate_user, create_tokens_for_user, refresh_tokens
from app.auth.dependencies import get_current_user
from app.core.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
):
    """Login with username and password; returns JWT tokens."""
    user = await authenticate_user(db, body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    access, refresh, expires_in = create_tokens_for_user(user)
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=expires_in,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
):
    """Issue new access and refresh tokens using a valid refresh token."""
    result = await refresh_tokens(db, body.refresh_token)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    access, refresh, expires_in = result
    return TokenResponse(
        access_token=access,
        refresh_token=refresh,
        expires_in=expires_in,
    )


@router.get("/me", response_model=UserInResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Return current authenticated user."""
    return UserInResponse(
        id=current_user.id,
        username=current_user.username,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        organization_id=current_user.organization_id,
        is_active=current_user.is_active,
    )
