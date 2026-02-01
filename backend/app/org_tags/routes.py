"""Organization tags API (Super Admin)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import require_super_admin, get_current_user
from app.core.models import User
from app.core.models import UserRole
from app.org_tags.schemas import (
    OrganizationTagCreate,
    OrganizationTagUpdate,
    OrganizationTagResponse,
)
from app.org_tags.service import (
    list_org_tags,
    get_org_tag,
    create_org_tag,
    update_org_tag,
    delete_org_tag,
)

router = APIRouter(tags=["organization-tags"])


@router.get("/{org_id}/tags", response_model=list[OrganizationTagResponse])
async def list_tags(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all tags for an organization. Super Admin: any org; Org Admin: own org only (read-only for filters)."""
    if current_user.role != UserRole.SUPER_ADMIN and (current_user.organization_id is None or current_user.organization_id != org_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to list tags for this organization")
    tags = await list_org_tags(db, org_id)
    return [OrganizationTagResponse.model_validate(t) for t in tags]


@router.post("/{org_id}/tags", response_model=OrganizationTagResponse, status_code=status.HTTP_201_CREATED)
async def create_tag(
    org_id: int,
    body: OrganizationTagCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Create organization tag (Super Admin only)."""
    tag = await create_org_tag(db, org_id, body)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    await db.commit()
    await db.refresh(tag)
    return OrganizationTagResponse.model_validate(tag)


@router.get("/{org_id}/tags/{tag_id}", response_model=OrganizationTagResponse)
async def get_tag(
    org_id: int,
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Get organization tag by id."""
    tag = await get_org_tag(db, org_id, tag_id)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return OrganizationTagResponse.model_validate(tag)


@router.patch("/{org_id}/tags/{tag_id}", response_model=OrganizationTagResponse)
async def update_tag(
    org_id: int,
    tag_id: int,
    body: OrganizationTagUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Update organization tag."""
    tag = await update_org_tag(db, org_id, tag_id, body)
    if not tag:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    await db.commit()
    await db.refresh(tag)
    return OrganizationTagResponse.model_validate(tag)


@router.delete("/{org_id}/tags/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tag(
    org_id: int,
    tag_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Delete organization tag."""
    ok = await delete_org_tag(db, org_id, tag_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tag not found")
    await db.commit()
