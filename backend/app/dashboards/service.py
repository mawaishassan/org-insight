"""Dashboard services: CRUD and access checks."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Dashboard, DashboardAccessPermission, KPI, User


async def list_all_dashboards(db: AsyncSession) -> list[Dashboard]:
    res = await db.execute(select(Dashboard).order_by(Dashboard.id.desc()))
    return list(res.scalars().all())


async def list_dashboards(db: AsyncSession, org_id: int) -> list[Dashboard]:
    res = await db.execute(
        select(Dashboard).where(Dashboard.organization_id == org_id).order_by(Dashboard.id.desc())
    )
    return list(res.scalars().all())


async def get_dashboard(db: AsyncSession, dashboard_id: int, org_id: int) -> Dashboard | None:
    res = await db.execute(
        select(Dashboard).where(Dashboard.id == dashboard_id, Dashboard.organization_id == org_id)
    )
    return res.scalar_one_or_none()


async def create_dashboard(db: AsyncSession, org_id: int, *, name: str, description: str | None, layout):
    d = Dashboard(organization_id=org_id, name=name, description=description, layout=layout)
    db.add(d)
    await db.flush()
    return d


async def update_dashboard(
    db: AsyncSession,
    dashboard_id: int,
    org_id: int,
    *,
    name: str | None = None,
    description: str | None = None,
    layout=None,
) -> Dashboard | None:
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        return None
    if name is not None:
        d.name = name
    if description is not None:
        d.description = description
    if layout is not None:
        d.layout = layout
    await db.flush()
    return d


async def delete_dashboard(db: AsyncSession, dashboard_id: int, org_id: int) -> bool:
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        return False
    await db.delete(d)
    await db.flush()
    return True


async def assign_dashboard_to_user(
    db: AsyncSession,
    dashboard_id: int,
    org_id: int,
    user_id: int,
    *,
    can_view: bool = True,
    can_edit: bool = False,
) -> DashboardAccessPermission | None:
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        return None
    u = (await db.execute(select(User).where(User.id == user_id, User.organization_id == org_id))).scalar_one_or_none()
    if not u:
        return None
    res = await db.execute(
        select(DashboardAccessPermission).where(
            DashboardAccessPermission.dashboard_id == dashboard_id,
            DashboardAccessPermission.user_id == user_id,
        )
    )
    perm = res.scalar_one_or_none()
    if not perm:
        perm = DashboardAccessPermission(
            dashboard_id=dashboard_id, user_id=user_id, can_view=can_view, can_edit=can_edit
        )
        db.add(perm)
        await db.flush()
        return perm
    perm.can_view = bool(can_view)
    perm.can_edit = bool(can_edit)
    await db.flush()
    return perm


async def unassign_dashboard_from_user(
    db: AsyncSession, dashboard_id: int, org_id: int, user_id: int
) -> bool:
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        return False
    res = await db.execute(
        select(DashboardAccessPermission).where(
            DashboardAccessPermission.dashboard_id == dashboard_id,
            DashboardAccessPermission.user_id == user_id,
        )
    )
    perm = res.scalar_one_or_none()
    if not perm:
        return False
    await db.delete(perm)
    await db.flush()
    return True


async def list_dashboard_assignments(db: AsyncSession, dashboard_id: int, org_id: int) -> list[dict]:
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        return []
    res = await db.execute(
        select(DashboardAccessPermission, User)
        .join(User, DashboardAccessPermission.user_id == User.id)
        .where(DashboardAccessPermission.dashboard_id == dashboard_id)
    )
    rows = res.all()
    return [
        {
            "user_id": perm.user_id,
            "email": user.email,
            "full_name": user.full_name,
            "can_view": perm.can_view,
            "can_edit": perm.can_edit,
        }
        for perm, user in rows
    ]


async def can_view_dashboard_for_user(
    db: AsyncSession, user: User, dashboard_id: int, org_id: int
) -> bool:
    """
    True if `dashboard_id` belongs to `org_id` and the user may view that dashboard.
    Uses the already-loaded User (no extra SELECT on users). Skips KPI/field-level checks.
    """
    if not user or user.id is None:
        return False
    uid = int(user.id)
    dash = (
        await db.execute(
            select(Dashboard.id).where(
                Dashboard.id == dashboard_id,
                Dashboard.organization_id == org_id,
            ).limit(1)
        )
    ).scalar_one_or_none()
    if dash is None:
        return False
    if user.role.value == "SUPER_ADMIN":
        return True
    if user.role.value == "ORG_ADMIN":
        return user.organization_id == org_id
    perm = (
        await db.execute(
            select(DashboardAccessPermission.can_view).where(
                DashboardAccessPermission.dashboard_id == dashboard_id,
                DashboardAccessPermission.user_id == uid,
            ).limit(1)
        )
    ).scalar_one_or_none()
    return bool(perm)


async def can_view_dashboard_for_kpi_chart(
    db: AsyncSession, user: User, dashboard_id: int, org_id: int, kpi_id: int
) -> bool:
    """
    One indexed round-trip: dashboard in org + KPI in same org (tenant-safe).
    Then role/assignment checks (same rules as can_view_dashboard_for_user).
    """
    if not user or user.id is None or kpi_id <= 0:
        return False
    uid = int(user.id)
    ok = (
        await db.execute(
            select(Dashboard.id)
            .join(KPI, KPI.organization_id == Dashboard.organization_id)
            .where(
                Dashboard.id == dashboard_id,
                Dashboard.organization_id == org_id,
                KPI.id == int(kpi_id),
                KPI.organization_id == org_id,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if ok is None:
        return False
    if user.role.value == "SUPER_ADMIN":
        return True
    if user.role.value == "ORG_ADMIN":
        return user.organization_id == org_id
    perm = (
        await db.execute(
            select(DashboardAccessPermission.can_view).where(
                DashboardAccessPermission.dashboard_id == dashboard_id,
                DashboardAccessPermission.user_id == uid,
            ).limit(1)
        )
    ).scalar_one_or_none()
    return bool(perm)


async def user_can_access_dashboard(
    db: AsyncSession, user_id: int, dashboard_id: int, action: str = "view"
) -> bool:
    """Access rules:
    - SUPER_ADMIN: any dashboard
    - ORG_ADMIN: any dashboard within their org
    - Others: must be explicitly assigned
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        return False
    if user.role.value == "SUPER_ADMIN":
        ok = (await db.execute(select(Dashboard.id).where(Dashboard.id == dashboard_id).limit(1))).scalar_one_or_none()
        return ok is not None
    if user.role.value == "ORG_ADMIN" and user.organization_id:
        ok = (
            await db.execute(
                select(Dashboard.id).where(
                    Dashboard.id == dashboard_id, Dashboard.organization_id == user.organization_id
                ).limit(1)
            )
        ).scalar_one_or_none()
        return ok is not None
    perm = (
        await db.execute(
            select(DashboardAccessPermission).where(
                DashboardAccessPermission.dashboard_id == dashboard_id,
                DashboardAccessPermission.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not perm:
        return False
    if action == "view":
        return perm.can_view
    if action == "edit":
        return perm.can_edit
    return False

