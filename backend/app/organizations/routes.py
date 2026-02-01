"""Organization API routes (Super Admin)."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import require_super_admin
from app.core.models import User
from app.organizations.schemas import (
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationResponse,
    OrganizationWithSummary,
    OrganizationSummary,
)
from app.organizations.service import (
    create_organization,
    get_organization,
    list_organizations,
    get_organization_summary,
    update_organization,
)

router = APIRouter(prefix="/organizations", tags=["organizations"])


@router.get("", response_model=list[OrganizationResponse] | list[OrganizationWithSummary])
async def list_orgs(
    with_summary: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """List all organizations (Super Admin only). Optionally include summary counts."""
    orgs = await list_organizations(db)
    if not with_summary:
        return [OrganizationResponse.model_validate(o) for o in orgs]
    result = []
    for o in orgs:
        summary = await get_organization_summary(db, o.id)
        result.append(
            OrganizationWithSummary(
                id=o.id,
                name=o.name,
                description=o.description,
                is_active=o.is_active,
                summary=summary or _default_summary(),
            )
        )
    return result


def _default_summary() -> OrganizationSummary:
    return OrganizationSummary(user_count=0, domain_count=0, kpi_count=0)


@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_org(
    body: OrganizationCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Create organization and admin user (Super Admin only)."""
    org = await create_organization(db, body)
    await db.commit()
    await db.refresh(org)
    return OrganizationResponse.model_validate(org)


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_org(
    org_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Get organization by id."""
    org = await get_organization(db, org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return OrganizationResponse.model_validate(org)


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_org(
    org_id: int,
    body: OrganizationUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Update organization (activate/deactivate)."""
    org = await update_organization(db, org_id, body)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    await db.commit()
    await db.refresh(org)
    return OrganizationResponse.model_validate(org)
