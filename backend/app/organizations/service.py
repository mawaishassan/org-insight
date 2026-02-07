"""Organization CRUD and tenant isolation."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, exists
from app.core.models import Organization, User, Domain, KPI, Category, OrganizationTag
from app.core.models import UserRole


async def get_organization_filter_options(db: AsyncSession) -> dict:
    """Return dropdown options for filtering organizations (Super Admin): domains, kpis, categories, tags."""
    domains_r = await db.execute(select(Domain.id, Domain.name).order_by(Domain.name))
    kpis_r = await db.execute(select(KPI.id, KPI.name).order_by(KPI.name))
    categories_r = await db.execute(select(Category.id, Category.name).order_by(Category.name))
    tags_r = await db.execute(select(OrganizationTag.id, OrganizationTag.name).order_by(OrganizationTag.name))
    return {
        "domains": [{"id": r[0], "name": r[1]} for r in domains_r.all()],
        "kpis": [{"id": r[0], "name": r[1]} for r in kpis_r.all()],
        "categories": [{"id": r[0], "name": r[1]} for r in categories_r.all()],
        "tags": [{"id": r[0], "name": r[1]} for r in tags_r.all()],
    }
from app.core.security import get_password_hash
from app.organizations.schemas import OrganizationCreate, OrganizationUpdate, OrganizationSummary


async def create_organization(db: AsyncSession, data: OrganizationCreate) -> Organization:
    """Create organization and its admin user."""
    org = Organization(
        name=data.name,
        description=data.description,
        is_active=True,
    )
    db.add(org)
    await db.flush()
    admin = User(
        organization_id=org.id,
        username=data.admin_username,
        email=data.admin_email,
        full_name=data.admin_full_name,
        hashed_password=get_password_hash(data.admin_password),
        role=UserRole.ORG_ADMIN,
        is_active=True,
    )
    db.add(admin)
    await db.flush()
    return org


async def get_organization(db: AsyncSession, org_id: int) -> Organization | None:
    """Get organization by id."""
    result = await db.execute(select(Organization).where(Organization.id == org_id))
    return result.scalar_one_or_none()


async def list_organizations(
    db: AsyncSession,
    active_only: bool = False,
    name: str | None = None,
    is_active: bool | None = None,
    domain_id: int | None = None,
    kpi_id: int | None = None,
    category_id: int | None = None,
    organization_tag_id: int | None = None,
):
    """List organizations with optional filters."""
    q = select(Organization).order_by(Organization.name)
    if active_only:
        q = q.where(Organization.is_active == True)
    if is_active is not None:
        q = q.where(Organization.is_active == is_active)
    if name is not None and name.strip():
        q = q.where(Organization.name.ilike(f"%{name.strip()}%"))
    if domain_id is not None:
        q = q.where(
            exists(select(1).where(Domain.id == domain_id, Domain.organization_id == Organization.id))
        )
    if kpi_id is not None:
        q = q.where(
            exists(select(1).where(KPI.id == kpi_id, KPI.organization_id == Organization.id))
        )
    if category_id is not None:
        q = q.where(
            exists(
                select(1)
                .select_from(Category)
                .join(Domain, Domain.id == Category.domain_id)
                .where(Category.id == category_id, Domain.organization_id == Organization.id)
            )
        )
    if organization_tag_id is not None:
        q = q.where(
            exists(
                select(1).where(
                    OrganizationTag.id == organization_tag_id,
                    OrganizationTag.organization_id == Organization.id,
                )
            )
        )
    result = await db.execute(q)
    return result.scalars().all()


async def get_organization_summary(db: AsyncSession, org_id: int) -> OrganizationSummary | None:
    """Get user, domain, and KPI counts for an organization."""
    org = await get_organization(db, org_id)
    if not org:
        return None
    users_q = select(func.count(User.id)).where(User.organization_id == org_id)
    domains_q = select(func.count(Domain.id)).where(Domain.organization_id == org_id)
    kpis_q = (
        select(func.count(KPI.id))
        .select_from(KPI)
        .join(Domain, KPI.domain_id == Domain.id)
        .where(Domain.organization_id == org_id)
    )
    users_r = await db.execute(users_q)
    domains_r = await db.execute(domains_q)
    kpis_r = await db.execute(kpis_q)
    return OrganizationSummary(
        user_count=users_r.scalar() or 0,
        domain_count=domains_r.scalar() or 0,
        kpi_count=kpis_r.scalar() or 0,
    )


async def update_organization(
    db: AsyncSession, org_id: int, data: OrganizationUpdate
) -> Organization | None:
    """Update organization."""
    org = await get_organization(db, org_id)
    if not org:
        return None
    if data.name is not None:
        org.name = data.name
    if data.description is not None:
        org.description = data.description
    if data.is_active is not None:
        org.is_active = data.is_active
    await db.flush()
    return org
