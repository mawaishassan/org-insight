"""Auth dependencies: current user, tenant resolution, role checks."""

import hashlib
from datetime import datetime
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials, OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.models import User, UserRole, ExportAPIToken
from app.core.security import decode_token

security = HTTPBearer(auto_error=False)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


class DataExportAuth:
    """Result of data-export auth: either logged-in user or valid export token (org_id)."""

    def __init__(self, user: User | None = None, export_org_id: int | None = None):
        self.user = user
        self.export_org_id = export_org_id


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """Resolve current user from JWT. Raises 401 if invalid or missing."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User inactive")
    return user


async def get_current_user_optional(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User | None:
    """Optional current user (for routes that work with or without auth)."""
    if not credentials:
        return None
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        return None
    return user


def require_roles(*allowed_roles: UserRole):
    """Dependency factory: require current user to have one of the given roles."""

    async def _require(current_user: Annotated[User, Depends(get_current_user)]) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return current_user

    return _require


def require_super_admin(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Require SUPER_ADMIN role."""
    if current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Super admin required")
    return current_user


def require_org_admin(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Require ORG_ADMIN (or SUPER_ADMIN)."""
    if current_user.role not in (UserRole.SUPER_ADMIN, UserRole.ORG_ADMIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Org admin required")
    return current_user


def require_tenant(current_user: Annotated[User, Depends(get_current_user)]) -> User:
    """Require user to belong to an organization (tenant). Super admin may have null org."""
    if current_user.organization_id is None and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No organization")
    return current_user


async def require_org_admin_for_org(
    org_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
) -> User:
    """Require current user to be Super Admin or Org Admin of the given org (org_id from path)."""
    if current_user.role == UserRole.SUPER_ADMIN:
        return current_user
    if current_user.role != UserRole.ORG_ADMIN:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Org admin or super admin required")
    if current_user.organization_id != org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized for this organization")
    return current_user


async def get_data_export_auth(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> DataExportAuth:
    """
    Accept either (1) JWT access token -> return user, or (2) long-lived export API token -> return export_org_id.
    Used by GET /kpis/data-export so external systems can use a non-expiring (until hours set) token.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )
    raw = credentials.credentials
    payload = decode_token(raw)
    if payload and payload.get("type") == "access":
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if not user or not user.is_active:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
        return DataExportAuth(user=user, export_org_id=None)
    token_hash = hashlib.sha256(raw.encode()).hexdigest()
    result = await db.execute(
        select(ExportAPIToken)
        .where(ExportAPIToken.token_hash == token_hash, ExportAPIToken.expires_at > datetime.utcnow())
    )
    record = result.scalar_one_or_none()
    if not record:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired export token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return DataExportAuth(user=None, export_org_id=record.organization_id)
