"""Organization CRUD and tenant isolation."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.core.models import Organization, User, Domain, KPI
from app.core.models import UserRole
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


async def list_organizations(db: AsyncSession, active_only: bool = False):
    """List all organizations."""
    q = select(Organization).order_by(Organization.name)
    if active_only:
        q = q.where(Organization.is_active == True)
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
