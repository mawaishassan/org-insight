"""KPI API routes (Org Admin)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import require_org_admin
from app.core.models import User
from app.kpis.schemas import (
    KPICreate,
    KPIUpdate,
    KPIResponse,
    KPIChildDataSummary,
    KPIAssignUserBody,
    DomainTagRef,
    CategoryTagRef,
    OrganizationTagRef,
    AssignedUserRef,
)
from app.kpis.service import (
    create_kpi,
    get_kpi,
    get_kpi_with_tags,
    get_kpi_with_tags_by_id,
    list_kpis,
    update_kpi,
    delete_kpi,
    get_kpi_child_data_summary,
    add_kpi_domain,
    remove_kpi_domain,
    add_kpi_category,
    remove_kpi_category,
    list_kpi_assignments,
    assign_user_to_kpi,
    unassign_user_from_kpi,
)
from app.users.schemas import UserResponse

router = APIRouter(prefix="/kpis", tags=["kpis"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


def _kpi_to_response(k):
    """Build KPIResponse. Domain tags come only from categories (single source: attach KPI to category)."""
    category_tags = []
    domain_tags = []
    seen_domain_ids = set()
    for kc in getattr(k, "category_tags", []) or []:
        if kc.category:
            cat = kc.category
            domain_id = getattr(cat, "domain_id", None) or (cat.domain.id if getattr(cat, "domain", None) else None)
            domain_name = (cat.domain.name if getattr(cat, "domain", None) else None)
            category_tags.append(
                CategoryTagRef(id=cat.id, name=cat.name, domain_id=domain_id, domain_name=domain_name)
            )
            if domain_id is not None and domain_id not in seen_domain_ids:
                seen_domain_ids.add(domain_id)
                domain_tags.append(DomainTagRef(id=domain_id, name=domain_name or f"Domain {domain_id}"))
    organization_tags = []
    for kot in getattr(k, "organization_tags", []) or []:
        if getattr(kot, "tag", None):
            organization_tags.append(OrganizationTagRef(id=kot.tag.id, name=kot.tag.name))
    assigned_users = []
    for ka in getattr(k, "assignments", []) or []:
        if getattr(ka, "user", None):
            u = ka.user
            assigned_users.append(AssignedUserRef(id=u.id, username=u.username, full_name=u.full_name))
    return KPIResponse(
        id=k.id,
        organization_id=k.organization_id,
        domain_id=k.domain_id,
        name=k.name,
        description=k.description,
        year=k.year,
        sort_order=k.sort_order,
        card_display_field_ids=getattr(k, "card_display_field_ids", None) or None,
        domain_tags=domain_tags,
        category_tags=category_tags,
        organization_tags=organization_tags,
        assigned_users=assigned_users,
    )


@router.get("", response_model=list[KPIResponse])
async def list_org_kpis(
    organization_id: int | None = Query(None),
    domain_id: int | None = Query(None),
    category_id: int | None = Query(None),
    organization_tag_id: int | None = Query(None, description="Filter KPIs by organization tag"),
    year: int | None = Query(None),
    name: str | None = Query(None, description="Filter KPIs by name (partial match)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List KPIs in organization. Filter by domain_id, category_id, organization_tag_id, year, or name."""
    org_id = _org_id(current_user, organization_id)
    kpis = await list_kpis(
        db, org_id, domain_id=domain_id, category_id=category_id, organization_tag_id=organization_tag_id, year=year, name=name
    )
    return [_kpi_to_response(k) for k in kpis]


@router.post("", response_model=KPIResponse, status_code=status.HTTP_201_CREATED)
async def create_org_kpi(
    body: KPICreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create KPI in domain."""
    org_id = _org_id(current_user, organization_id)
    kpi = await create_kpi(db, org_id, body)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Domain not in organization")
    await db.commit()
    k = await get_kpi_with_tags(db, kpi.id, org_id)
    return _kpi_to_response(k)


@router.get("/{kpi_id}", response_model=KPIResponse)
async def get_org_kpi(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Get KPI by id with domain and category tags. Super admin without organization_id gets KPI by id (org resolved from KPI)."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        kpi = await get_kpi_with_tags_by_id(db, kpi_id)
    else:
        org_id = _org_id(current_user, organization_id)
        kpi = await get_kpi_with_tags(db, kpi_id, org_id)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return _kpi_to_response(kpi)


@router.patch("/{kpi_id}", response_model=KPIResponse)
async def update_org_kpi(
    kpi_id: int,
    body: KPIUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update KPI."""
    # Only SUPER_ADMIN may control which fields show on domain KPI cards
    if body.card_display_field_ids is not None and current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin may set KPI card display fields",
        )
    org_id = _org_id(current_user, organization_id)
    kpi = await update_kpi(db, kpi_id, org_id, body)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    await db.commit()
    k = await get_kpi_with_tags(db, kpi_id, org_id)
    return _kpi_to_response(k)


@router.get("/{kpi_id}/child_data_summary", response_model=KPIChildDataSummary)
async def get_kpi_child_data(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return counts of child records (assignments, entries, fields, etc.) for delete confirmation."""
    org_id = _org_id(current_user, organization_id)
    summary = await get_kpi_child_data_summary(db, kpi_id, org_id)
    if summary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return KPIChildDataSummary(**summary)


@router.delete("/{kpi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_kpi(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete KPI and all child records (assignments, entries, fields, stored values, report refs)."""
    org_id = _org_id(current_user, organization_id)
    ok = await delete_kpi(db, kpi_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    await db.commit()


@router.post("/{kpi_id}/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_domain_tag(
    kpi_id: int,
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Associate KPI with an additional domain (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await add_kpi_domain(db, kpi_id, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or domain not found")
    await db.commit()


@router.delete("/{kpi_id}/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_domain_tag(
    kpi_id: int,
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove KPI-domain association (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await remove_kpi_domain(db, kpi_id, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cannot remove or not found")
    await db.commit()


@router.post("/{kpi_id}/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_category_tag(
    kpi_id: int,
    category_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Associate KPI with a category (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await add_kpi_category(db, kpi_id, category_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or category not found")
    await db.commit()


@router.delete("/{kpi_id}/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_category_tag(
    kpi_id: int,
    category_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove KPI-category association (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await remove_kpi_category(db, kpi_id, category_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.get("/{kpi_id}/assignments", response_model=list[UserResponse])
async def list_kpi_assignments_route(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List users assigned to this KPI (can add data)."""
    org_id = _org_id(current_user, organization_id)
    users = await list_kpi_assignments(db, kpi_id, org_id)
    return [UserResponse.model_validate(u) for u in users]


@router.post("/{kpi_id}/assignments", status_code=status.HTTP_201_CREATED)
async def assign_user_to_kpi_route(
    kpi_id: int,
    body: KPIAssignUserBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign a user to this KPI so they can add data."""
    org_id = _org_id(current_user, organization_id)
    ok = await assign_user_to_kpi(db, kpi_id, body.user_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or user not found")
    await db.commit()


@router.delete("/{kpi_id}/assignments/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_from_kpi_route(
    kpi_id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove user assignment from this KPI."""
    org_id = _org_id(current_user, organization_id)
    ok = await unassign_user_from_kpi(db, kpi_id, user_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()
