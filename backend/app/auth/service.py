"""Auth service: login, refresh, user resolution."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.models import User
from app.core.security import (
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
)
from app.core.config import get_settings

settings = get_settings()


async def authenticate_user(db: AsyncSession, username: str, password: str) -> User | None:
    """
    Authenticate by username and password.
    Super admin is looked up with organization_id IS NULL; org users by username + org.
    """
    result = await db.execute(
        select(User).where(User.username == username).order_by(User.organization_id.desc().nulls_last())
    )
    users = result.scalars().all()
    for user in users:
        if verify_password(password, user.hashed_password) and user.is_active:
            return user
    return None


def create_tokens_for_user(user: User) -> tuple[str, str, int]:
    """Create access and refresh tokens; return (access, refresh, expires_in_seconds)."""
    extra = {
        "role": user.role.value,
        "organization_id": user.organization_id,
    }
    access = create_access_token(user.id, extra=extra)
    refresh = create_refresh_token(user.id)
    expires_in = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    return access, refresh, expires_in


async def get_user_by_id(db: AsyncSession, user_id: int) -> User | None:
    """Fetch user by id."""
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def refresh_tokens(db: AsyncSession, refresh_token: str) -> tuple[str, str, int] | None:
    """Validate refresh token and return new access, refresh, expires_in or None."""
    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    user = await get_user_by_id(db, int(user_id))
    if not user or not user.is_active:
        return None
    return create_tokens_for_user(user)
