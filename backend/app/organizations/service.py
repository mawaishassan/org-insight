"""Organization CRUD and tenant isolation."""

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, exists, delete

from app.core.models import (
    Organization,
    User,
    Domain,
    KPI,
    Category,
    OrganizationTag,
    ExportAPIToken,
    OrganizationRole,
    UserOrganizationRole,
    UserRole,
)


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
    kpis_q = select(func.count(KPI.id)).where(KPI.organization_id == org_id)
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
    if data.time_dimension is not None and data.time_dimension.strip() in ("yearly", "half_yearly", "quarterly", "monthly"):
        org.time_dimension = data.time_dimension.strip()
    await db.flush()
    return org


async def create_export_api_token(
    db: AsyncSession, organization_id: int, valid_hours: int, created_by_user_id: int | None
) -> tuple[str, datetime]:
    """Create a long-lived export API token. Returns (plain_token, expires_at). Token is shown once."""
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = datetime.utcnow() + timedelta(hours=valid_hours)
    record = ExportAPIToken(
        organization_id=organization_id,
        token_hash=token_hash,
        expires_at=expires_at,
        created_by_user_id=created_by_user_id,
    )
    db.add(record)
    await db.flush()
    return token, expires_at


# --- Organization roles (Org Admin) ---


async def list_roles(db: AsyncSession, organization_id: int) -> list[OrganizationRole]:
    """List all roles for an organization."""
    result = await db.execute(
        select(OrganizationRole).where(OrganizationRole.organization_id == organization_id).order_by(OrganizationRole.name)
    )
    return list(result.scalars().all())


async def get_role(db: AsyncSession, role_id: int, organization_id: int) -> OrganizationRole | None:
    """Get role by id if it belongs to the organization."""
    result = await db.execute(
        select(OrganizationRole).where(
            OrganizationRole.id == role_id,
            OrganizationRole.organization_id == organization_id,
        )
    )
    return result.scalar_one_or_none()


async def create_role(
    db: AsyncSession, organization_id: int, name: str, description: str | None = None
) -> OrganizationRole:
    """Create a role in the organization."""
    role = OrganizationRole(organization_id=organization_id, name=name, description=description)
    db.add(role)
    await db.flush()
    return role


async def update_role(
    db: AsyncSession, role_id: int, organization_id: int, name: str | None = None, description: str | None = None
) -> OrganizationRole | None:
    """Update role name/description."""
    role = await get_role(db, role_id, organization_id)
    if not role:
        return None
    if name is not None:
        role.name = name
    if description is not None:
        role.description = description
    await db.flush()
    return role


async def delete_role(db: AsyncSession, role_id: int, organization_id: int) -> bool:
    """Delete role and its user assignments. Returns True if deleted."""
    role = await get_role(db, role_id, organization_id)
    if not role:
        return False
    await db.execute(delete(UserOrganizationRole).where(UserOrganizationRole.organization_role_id == role_id))
    await db.delete(role)
    await db.flush()
    return True


async def list_users_in_role(db: AsyncSession, role_id: int, organization_id: int) -> list[User]:
    """List users assigned to this role (role must belong to org)."""
    role = await get_role(db, role_id, organization_id)
    if not role:
        return []
    result = await db.execute(
        select(User)
        .join(UserOrganizationRole, UserOrganizationRole.user_id == User.id)
        .where(
            UserOrganizationRole.organization_role_id == role_id,
            User.organization_id == organization_id,
        )
    )
    return list(result.scalars().unique().all())


async def set_users_in_role(
    db: AsyncSession, role_id: int, organization_id: int, user_ids: list[int]
) -> bool:
    """Replace users in role with the given list. Only users in the org are added. Returns True if role exists."""
    role = await get_role(db, role_id, organization_id)
    if not role:
        return False
    # Only allow user_ids that belong to this org
    if user_ids:
        users_result = await db.execute(
            select(User.id).where(User.id.in_(user_ids), User.organization_id == organization_id)
        )
        allowed_ids = [r[0] for r in users_result.all()]
    else:
        allowed_ids = []
    await db.execute(delete(UserOrganizationRole).where(UserOrganizationRole.organization_role_id == role_id))
    for uid in allowed_ids:
        db.add(UserOrganizationRole(user_id=uid, organization_role_id=role_id))
    await db.flush()
    return True
