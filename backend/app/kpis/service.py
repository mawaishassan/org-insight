"""KPI CRUD with tenant isolation via domain."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload

from app.core.models import KPI, User, KPIAssignment, Domain, Category, KPIDomain, KPICategory, KPIOrganizationTag, OrganizationTag
from app.kpis.schemas import KPICreate, KPIUpdate


async def _domain_org_id(db: AsyncSession, domain_id: int) -> int | None:
    """Return organization_id for domain or None."""
    result = await db.execute(select(Domain).where(Domain.id == domain_id))
    d = result.scalar_one_or_none()
    return d.organization_id if d else None


async def create_kpi(db: AsyncSession, org_id: int, data: KPICreate) -> KPI | None:
    """Create KPI in organization; domain is optional (can attach domains later)."""
    if data.domain_id is not None:
        if await _domain_org_id(db, data.domain_id) != org_id:
            return None
        kpi = KPI(
            organization_id=org_id,
            domain_id=data.domain_id,
            name=data.name,
            description=data.description,
            year=data.year,
            sort_order=data.sort_order,
        )
    else:
        kpi = KPI(
            organization_id=org_id,
            domain_id=None,
            name=data.name,
            description=data.description,
            year=data.year,
            sort_order=data.sort_order,
        )
    db.add(kpi)
    await db.flush()
    if data.domain_ids or data.category_ids:
        await _sync_kpi_domains(db, kpi.id, org_id, data.domain_ids)
        await _sync_kpi_categories(db, kpi.id, org_id, data.category_ids)
    if data.organization_tag_ids:
        await _sync_kpi_organization_tags(db, kpi.id, org_id, data.organization_tag_ids)
    return kpi


async def get_kpi(db: AsyncSession, kpi_id: int, org_id: int) -> KPI | None:
    """Get KPI by id; must belong to org."""
    result = await db.execute(
        select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id)
    )
    return result.scalar_one_or_none()


async def get_kpi_with_tags(db: AsyncSession, kpi_id: int, org_id: int) -> KPI | None:
    """Get KPI by id with domain, category tags, and assigned users loaded."""
    result = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id, KPI.organization_id == org_id)
        .options(
            selectinload(KPI.domain),
            selectinload(KPI.domain_tags).selectinload(KPIDomain.domain),
            selectinload(KPI.category_tags).selectinload(KPICategory.category).selectinload(Category.domain),
            selectinload(KPI.organization_tags).selectinload(KPIOrganizationTag.tag),
            selectinload(KPI.assignments).selectinload(KPIAssignment.user),
        )
    )
    return result.scalar_one_or_none()


async def list_kpis(
    db: AsyncSession,
    org_id: int,
    domain_id: int | None = None,
    category_id: int | None = None,
    organization_tag_id: int | None = None,
    year: int | None = None,
    name: str | None = None,
    with_tags: bool = True,
) -> list[KPI]:
    """List KPIs in organization, optionally by domain, category, organization tag, year, or name search."""
    q = select(KPI).where(KPI.organization_id == org_id)
    if domain_id is not None:
        # KPIs in domain: only those attached to at least one category in this domain (single source of truth)
        sub_category_in_domain = (
            select(KPICategory.kpi_id)
            .join(Category, Category.id == KPICategory.category_id)
            .where(Category.domain_id == domain_id)
            .distinct()
        )
        q = q.where(KPI.id.in_(sub_category_in_domain))
    if category_id is not None:
        q = q.join(KPICategory, KPI.id == KPICategory.kpi_id).where(KPICategory.category_id == category_id)
    if organization_tag_id is not None:
        q = q.join(KPIOrganizationTag, KPI.id == KPIOrganizationTag.kpi_id).where(
            KPIOrganizationTag.organization_tag_id == organization_tag_id
        )
    if year is not None:
        q = q.where(KPI.year == year)
    if name is not None and name.strip():
        q = q.where(KPI.name.ilike(f"%{name.strip()}%"))
    q = q.order_by(KPI.sort_order, KPI.name)
    if with_tags:
        q = q.options(
            selectinload(KPI.domain),
            selectinload(KPI.domain_tags).selectinload(KPIDomain.domain),
            selectinload(KPI.category_tags).selectinload(KPICategory.category).selectinload(Category.domain),
            selectinload(KPI.organization_tags).selectinload(KPIOrganizationTag.tag),
            selectinload(KPI.assignments).selectinload(KPIAssignment.user),
        )
    result = await db.execute(q)
    return list(result.unique().scalars().all())


async def _sync_kpi_domains(
    db: AsyncSession, kpi_id: int, org_id: int, domain_ids: list[int]
) -> None:
    """Set KPI domain tags to exactly domain_ids (first is primary, rest in KPIDomain)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return
    valid = []
    for d_id in domain_ids:
        if await _domain_org_id(db, d_id) != org_id:
            continue
        valid.append(d_id)
    kpi.domain_id = valid[0] if valid else None
    await db.execute(delete(KPIDomain).where(KPIDomain.kpi_id == kpi_id))
    await db.flush()
    for d_id in valid[1:]:
        link = KPIDomain(kpi_id=kpi_id, domain_id=d_id)
        db.add(link)
    await db.flush()


async def _sync_kpi_categories(
    db: AsyncSession, kpi_id: int, org_id: int, category_ids: list[int]
) -> None:
    """Set KPI category tags to exactly category_ids (one per domain rule applied per add)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return
    await db.execute(delete(KPICategory).where(KPICategory.kpi_id == kpi_id))
    await db.flush()
    for cat_id in category_ids:
        await add_kpi_category(db, kpi_id, cat_id, org_id)


async def _sync_kpi_organization_tags(
    db: AsyncSession, kpi_id: int, org_id: int, tag_ids: list[int]
) -> None:
    """Set KPI organization tags to exactly tag_ids (tags must belong to org)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return
    await db.execute(delete(KPIOrganizationTag).where(KPIOrganizationTag.kpi_id == kpi_id))
    await db.flush()
    for tag_id in tag_ids:
        result = await db.execute(
            select(OrganizationTag).where(
                OrganizationTag.id == tag_id,
                OrganizationTag.organization_id == org_id,
            )
        )
        if result.scalar_one_or_none():
            link = KPIOrganizationTag(kpi_id=kpi_id, organization_tag_id=tag_id)
            db.add(link)
    await db.flush()


async def update_kpi(
    db: AsyncSession, kpi_id: int, org_id: int, data: KPIUpdate
) -> KPI | None:
    """Update KPI (optionally sync domain/category tags)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return None
    if data.name is not None:
        kpi.name = data.name
    if data.description is not None:
        kpi.description = data.description
    if data.year is not None:
        kpi.year = data.year
    if data.sort_order is not None:
        kpi.sort_order = data.sort_order
    await db.flush()
    if data.domain_ids is not None:
        await _sync_kpi_domains(db, kpi_id, org_id, data.domain_ids)
    if data.category_ids is not None:
        await _sync_kpi_categories(db, kpi_id, org_id, data.category_ids)
    if data.organization_tag_ids is not None:
        await _sync_kpi_organization_tags(db, kpi_id, org_id, data.organization_tag_ids)
    return kpi


async def delete_kpi(db: AsyncSession, kpi_id: int, org_id: int) -> bool:
    """Delete KPI."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    await db.delete(kpi)
    await db.flush()
    return True


async def add_kpi_domain(db: AsyncSession, kpi_id: int, domain_id: int, org_id: int) -> bool:
    """Associate KPI with domain. KPI must belong to org; domain must belong to org."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(select(Domain).where(Domain.id == domain_id, Domain.organization_id == org_id))
    domain = result.scalar_one_or_none()
    if not domain:
        return False
    if kpi.domain_id == domain_id:
        return True  # already primary
    existing = await db.execute(
        select(KPIDomain).where(KPIDomain.kpi_id == kpi_id, KPIDomain.domain_id == domain_id)
    )
    if existing.scalar_one_or_none():
        return True  # already linked
    link = KPIDomain(kpi_id=kpi_id, domain_id=domain_id)
    db.add(link)
    await db.flush()
    return True


async def remove_kpi_domain(db: AsyncSession, kpi_id: int, domain_id: int, org_id: int) -> bool:
    """Remove KPI-domain association (not primary domain; no primary if domain_id is null)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    if kpi.domain_id is not None and kpi.domain_id == domain_id:
        return False  # cannot remove primary
    result = await db.execute(
        select(KPIDomain).where(KPIDomain.kpi_id == kpi_id, KPIDomain.domain_id == domain_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        return True  # already not linked
    await db.delete(link)
    await db.flush()
    return True


async def add_kpi_category(db: AsyncSession, kpi_id: int, category_id: int, org_id: int) -> bool:
    """Associate KPI with category. KPI and category must belong to org.
    A KPI can only be in one category per domain; attaching to this category
    removes any existing attachment to other categories in the same domain.
    """
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(
        select(Category)
        .join(Category.domain)
        .where(Category.id == category_id, Domain.organization_id == org_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        return False
    # One category per domain: remove any existing KPI-category link in this domain
    await db.execute(
        delete(KPICategory).where(
            KPICategory.kpi_id == kpi_id,
            KPICategory.category_id.in_(select(Category.id).where(Category.domain_id == category.domain_id)),
        )
    )
    await db.flush()
    link = KPICategory(kpi_id=kpi_id, category_id=category_id)
    db.add(link)
    await db.flush()
    return True


async def remove_kpi_category(db: AsyncSession, kpi_id: int, category_id: int, org_id: int) -> bool:
    """Remove KPI-category association."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(
        select(KPICategory).where(KPICategory.kpi_id == kpi_id, KPICategory.category_id == category_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        return True
    await db.delete(link)
    await db.flush()
    return True


async def list_kpi_assignments(db: AsyncSession, kpi_id: int, org_id: int) -> list[User]:
    """List users assigned to this KPI (for data entry)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return []
    result = await db.execute(
        select(User)
        .join(KPIAssignment, KPIAssignment.user_id == User.id)
        .where(KPIAssignment.kpi_id == kpi_id, User.organization_id == org_id)
        .order_by(User.username)
    )
    return list(result.scalars().unique().all())


async def assign_user_to_kpi(db: AsyncSession, kpi_id: int, user_id: int, org_id: int) -> bool:
    """Assign a user to KPI so they can add data. Only one user per KPI; assigning replaces any existing."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(select(User).where(User.id == user_id, User.organization_id == org_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    # Remove any existing assignments for this KPI (only one user allowed)
    await db.execute(delete(KPIAssignment).where(KPIAssignment.kpi_id == kpi_id))
    db.add(KPIAssignment(kpi_id=kpi_id, user_id=user_id))
    await db.flush()
    return True


async def unassign_user_from_kpi(db: AsyncSession, kpi_id: int, user_id: int, org_id: int) -> bool:
    """Remove user assignment from KPI."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(
        select(KPIAssignment).where(KPIAssignment.kpi_id == kpi_id, KPIAssignment.user_id == user_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        return True
    await db.delete(link)
    await db.flush()
    return True
