"""User API routes (Org Admin)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin, require_tenant
from app.core.models import User
from app.users.schemas import UserCreate, UserUpdate, UserResponse
from app.users.service import create_user, get_user, list_users, update_user, delete_user

router = APIRouter(prefix="/users", tags=["users"])


def _org_id(user: User, org_id_param: int | None = None) -> int:
    """Resolve organization id for tenant scope. Super Admin may pass org_id_param."""
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


@router.get("", response_model=list[UserResponse])
async def list_org_users(
    organization_id: int | None = Query(None, description="Required for Super Admin"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List users in current organization. Org Admin or Super Admin (with org context)."""
    org_id = _org_id(current_user, organization_id)
    users = await list_users(db, org_id)
    return [UserResponse.model_validate(u) for u in users]


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_org_user(
    body: UserCreate,
    organization_id: int | None = Query(None, description="Required for Super Admin"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create user in organization and assign KPIs and report templates."""
    org_id = _org_id(current_user, organization_id)
    user = await create_user(db, org_id, body)
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.get("/{user_id}", response_model=UserResponse)
async def get_org_user(
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Get user by id within organization."""
    org_id = _org_id(current_user, organization_id)
    user = await get_user(db, user_id, org_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return UserResponse.model_validate(user)


@router.patch("/{user_id}", response_model=UserResponse)
async def update_org_user(
    user_id: int,
    body: UserUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update user and optionally KPI/report assignments."""
    org_id = _org_id(current_user, organization_id)
    user = await update_user(db, user_id, org_id, body)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.commit()
    await db.refresh(user)
    return UserResponse.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_user(
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete user in organization."""
    org_id = _org_id(current_user, organization_id)
    ok = await delete_user(db, user_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    await db.commit()
