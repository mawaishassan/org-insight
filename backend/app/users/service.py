"""User CRUD with tenant isolation and KPI/report assignments."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.core.models import User, UserRole, KPIAssignment, ReportAccessPermission
from app.core.security import get_password_hash
from app.users.schemas import UserCreate, UserUpdate


def _tenant_filter(q, org_id: int | None, super_admin: bool):
    """Apply tenant filter: org users must match org_id; super admin can list any org."""
    if super_admin and org_id is not None:
        return q.where(User.organization_id == org_id)
    if not super_admin and org_id is not None:
        return q.where(User.organization_id == org_id)
    return q


async def create_user(
    db: AsyncSession,
    org_id: int,
    data: UserCreate,
) -> User:
    """Create user in organization and assign KPIs and report templates."""
    user = User(
        organization_id=org_id,
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        is_active=True,
    )
    db.add(user)
    await db.flush()
    for kpi_id in data.kpi_ids:
        db.add(KPIAssignment(user_id=user.id, kpi_id=kpi_id))
    for rt_id in data.report_template_ids:
        db.add(
            ReportAccessPermission(
                report_template_id=rt_id,
                user_id=user.id,
                can_view=True,
                can_print=True,
                can_export=True,
            )
        )
    await db.flush()
    return user


async def get_user(db: AsyncSession, user_id: int, org_id: int | None = None) -> User | None:
    """Get user by id; optionally enforce org."""
    q = select(User).where(User.id == user_id)
    if org_id is not None:
        q = q.where(User.organization_id == org_id)
    result = await db.execute(q)
    return result.scalar_one_or_none()


async def list_users(
    db: AsyncSession,
    org_id: int,
) -> list[User]:
    """List users in organization (exclude super admin)."""
    result = await db.execute(
        select(User)
        .where(User.organization_id == org_id)
        .order_by(User.username)
    )
    return list(result.scalars().all())


async def update_user(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    data: UserUpdate,
) -> User | None:
    """Update user and optionally KPI/report assignments."""
    user = await get_user(db, user_id, org_id)
    if not user:
        return None
    if data.username is not None:
        user.username = data.username
    if data.email is not None:
        user.email = data.email
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.password is not None:
        user.hashed_password = get_password_hash(data.password)
    if data.role is not None:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.kpi_ids is not None:
        await db.execute(delete(KPIAssignment).where(KPIAssignment.user_id == user_id))
        for kpi_id in data.kpi_ids:
            db.add(KPIAssignment(user_id=user_id, kpi_id=kpi_id))
    if data.report_template_ids is not None:
        await db.execute(
            delete(ReportAccessPermission).where(ReportAccessPermission.user_id == user_id)
        )
        for rt_id in data.report_template_ids:
            db.add(
                ReportAccessPermission(
                    report_template_id=rt_id,
                    user_id=user_id,
                    can_view=True,
                    can_print=True,
                    can_export=True,
                )
            )
    await db.flush()
    return user


async def delete_user(db: AsyncSession, user_id: int, org_id: int) -> bool:
    """Delete user (cascade will remove assignments)."""
    user = await get_user(db, user_id, org_id)
    if not user:
        return False
    if user.role == UserRole.ORG_ADMIN:
        return False  # Prevent deleting org admin via this endpoint if desired
    await db.delete(user)
    await db.flush()
    return True
