"""Domain CRUD with tenant isolation."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.models import Domain, Category, KPI, KPICategory, KPIEntry
from app.domains.schemas import DomainCreate, DomainUpdate, DomainSummary


async def create_domain(db: AsyncSession, org_id: int, data: DomainCreate) -> Domain:
    """Create domain in organization."""
    domain = Domain(
        organization_id=org_id,
        name=data.name,
        description=data.description,
        sort_order=data.sort_order,
    )
    db.add(domain)
    await db.flush()
    return domain


async def get_domain(db: AsyncSession, domain_id: int, org_id: int) -> Domain | None:
    """Get domain by id within organization."""
    result = await db.execute(
        select(Domain).where(Domain.id == domain_id, Domain.organization_id == org_id)
    )
    return result.scalar_one_or_none()


async def list_domains(db: AsyncSession, org_id: int) -> list[Domain]:
    """List domains in organization."""
    result = await db.execute(
        select(Domain)
        .where(Domain.organization_id == org_id)
        .order_by(Domain.sort_order, Domain.name)
    )
    return list(result.scalars().all())


async def get_domain_summary(
    db: AsyncSession,
    domain_id: int,
    org_id: int,
    user_id: int | None = None,
    year: int | None = None,
) -> DomainSummary | None:
    """Get category and KPI counts for a domain. Optionally include data entry summary for user/year."""
    domain = await get_domain(db, domain_id, org_id)
    if not domain:
        return None
    cat_q = select(func.count(Category.id)).where(Category.domain_id == domain_id)
    # Count distinct KPIs linked to at least one category in this domain (via KPICategory)
    kpi_ids_subq = (
        select(KPICategory.kpi_id)
        .join(Category, Category.id == KPICategory.category_id)
        .where(Category.domain_id == domain_id)
        .distinct()
        .subquery()
    )
    kpi_q = select(func.count()).select_from(kpi_ids_subq)
    cat_r = await db.execute(cat_q)
    kpi_r = await db.execute(kpi_q)
    category_count = cat_r.scalar() or 0
    kpi_count = kpi_r.scalar() or 0

    entries_submitted = 0
    entries_draft = 0
    entries_not_entered = kpi_count

    if year is not None and kpi_count > 0:
        # Count entries for this org/year in domain KPIs: draft vs submitted (one entry per KPI)
        draft_q = (
            select(func.count(KPIEntry.id))
            .select_from(KPIEntry)
            .where(
                KPIEntry.organization_id == org_id,
                KPIEntry.year == year,
                KPIEntry.is_draft.is_(True),
                KPIEntry.kpi_id.in_(select(kpi_ids_subq.c.kpi_id)),
            )
        )
        submitted_q = (
            select(func.count(KPIEntry.id))
            .select_from(KPIEntry)
            .where(
                KPIEntry.organization_id == org_id,
                KPIEntry.year == year,
                KPIEntry.is_draft.is_(False),
                KPIEntry.kpi_id.in_(select(kpi_ids_subq.c.kpi_id)),
            )
        )
        draft_r = await db.execute(draft_q)
        submitted_r = await db.execute(submitted_q)
        entries_draft = draft_r.scalar() or 0
        entries_submitted = submitted_r.scalar() or 0
        entries_not_entered = max(0, kpi_count - entries_draft - entries_submitted)

    return DomainSummary(
        category_count=category_count,
        kpi_count=kpi_count,
        entries_submitted=entries_submitted,
        entries_draft=entries_draft,
        entries_not_entered=entries_not_entered,
    )


async def update_domain(
    db: AsyncSession, domain_id: int, org_id: int, data: DomainUpdate
) -> Domain | None:
    """Update domain."""
    domain = await get_domain(db, domain_id, org_id)
    if not domain:
        return None
    if data.name is not None:
        domain.name = data.name
    if data.description is not None:
        domain.description = data.description
    if data.sort_order is not None:
        domain.sort_order = data.sort_order
    await db.flush()
    return domain


async def delete_domain(db: AsyncSession, domain_id: int, org_id: int) -> bool:
    """Delete domain (cascade KPIs)."""
    domain = await get_domain(db, domain_id, org_id)
    if not domain:
        return False
    await db.delete(domain)
    await db.flush()
    return True
