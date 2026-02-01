"""Domain API routes (Org Admin)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import require_org_admin
from app.core.models import User
from app.domains.schemas import (
    DomainCreate,
    DomainUpdate,
    DomainResponse,
    DomainWithSummary,
    DomainSummary,
)
from app.domains.service import (
    create_domain,
    get_domain,
    list_domains,
    get_domain_summary,
    update_domain,
    delete_domain,
)

router = APIRouter(prefix="/domains", tags=["domains"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


def _default_domain_summary() -> DomainSummary:
    return DomainSummary(
        category_count=0,
        kpi_count=0,
        entries_submitted=0,
        entries_draft=0,
        entries_not_entered=0,
    )


@router.get("", response_model=list[DomainResponse] | list[DomainWithSummary])
async def list_org_domains(
    organization_id: int | None = Query(None),
    with_summary: bool = False,
    year: int | None = Query(None, ge=2000, le=2100, description="Year for data entry summary (default: current)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List domains in organization. Optionally include summary (category_count, kpi_count, data entry counts)."""
    org_id = _org_id(current_user, organization_id)
    domains = await list_domains(db, org_id)
    if not with_summary:
        return [DomainResponse.model_validate(d) for d in domains]
    from datetime import date
    summary_year = year if year is not None else date.today().year
    result = []
    for d in domains:
        summary = await get_domain_summary(
            db, d.id, org_id, user_id=current_user.id, year=summary_year
        )
        result.append(
            DomainWithSummary(
                id=d.id,
                organization_id=d.organization_id,
                name=d.name,
                description=d.description,
                sort_order=d.sort_order,
                summary=summary or _default_domain_summary(),
            )
        )
    return result


@router.post("", response_model=DomainResponse, status_code=status.HTTP_201_CREATED)
async def create_org_domain(
    body: DomainCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create domain."""
    org_id = _org_id(current_user, organization_id)
    domain = await create_domain(db, org_id, body)
    await db.commit()
    await db.refresh(domain)
    return DomainResponse.model_validate(domain)


@router.get("/{domain_id}", response_model=DomainResponse)
async def get_org_domain(
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Get domain by id."""
    org_id = _org_id(current_user, organization_id)
    domain = await get_domain(db, domain_id, org_id)
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    return DomainResponse.model_validate(domain)


@router.patch("/{domain_id}", response_model=DomainResponse)
async def update_org_domain(
    domain_id: int,
    body: DomainUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update domain."""
    org_id = _org_id(current_user, organization_id)
    domain = await update_domain(db, domain_id, org_id, body)
    if not domain:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    await db.commit()
    await db.refresh(domain)
    return DomainResponse.model_validate(domain)


@router.delete("/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_domain(
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete domain."""
    org_id = _org_id(current_user, organization_id)
    ok = await delete_domain(db, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Domain not found")
    await db.commit()
