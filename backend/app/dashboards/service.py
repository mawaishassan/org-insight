"""Dashboard services: CRUD and access checks."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Dashboard, DashboardAccessPermission, KPI, User, FieldType


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


async def create_dashboard(
    db: AsyncSession,
    org_id: int,
    *,
    name: str,
    description: str | None,
    layout,
    fetch_data_with_date: bool = False,
    date_fetching_config: dict | None = None,
    fetch_data_with_column: bool = False,
    column_fetching_config: dict | None = None,
):
    d = Dashboard(
        organization_id=org_id,
        name=name,
        description=description,
        layout=layout,
        fetch_data_with_date=fetch_data_with_date,
        date_fetching_config=date_fetching_config,
        fetch_data_with_column=fetch_data_with_column,
        column_fetching_config=column_fetching_config,
    )
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
    fetch_data_with_date: bool | None = None,
    date_fetching_config: dict | None = None,
    fetch_data_with_column: bool | None = None,
    column_fetching_config: dict | None = None,
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
    if fetch_data_with_date is not None:
        d.fetch_data_with_date = fetch_data_with_date
    if date_fetching_config is not None:
        d.date_fetching_config = date_fetching_config
    if fetch_data_with_column is not None:
        d.fetch_data_with_column = fetch_data_with_column
    if column_fetching_config is not None:
        d.column_fetching_config = column_fetching_config
    await db.flush()
    try:
        from app.widget_data.service import invalidate_dashboard_cache
        invalidate_dashboard_cache(dashboard_id)
    except Exception:
        pass
    return d


async def delete_dashboard(db: AsyncSession, dashboard_id: int, org_id: int) -> bool:
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        return False
    await db.delete(d)
    await db.flush()
    try:
        from app.widget_data.service import invalidate_dashboard_cache
        invalidate_dashboard_cache(dashboard_id)
    except Exception:
        pass
    return True


async def duplicate_dashboard(db: AsyncSession, dashboard_id: int, org_id: int) -> Dashboard | None:
    """Duplicate an existing dashboard with all its layout, widgets, configs, and customizations."""
    orig = await get_dashboard(db, dashboard_id, org_id)
    if not orig:
        return None

    import copy
    from app.core.models import DashboardLabelCustomization

    copied_layout = copy.deepcopy(orig.layout) if orig.layout is not None else None
    copied_date_config = copy.deepcopy(orig.date_fetching_config) if orig.date_fetching_config is not None else None
    copied_column_config = copy.deepcopy(orig.column_fetching_config) if orig.column_fetching_config is not None else None

    new_dash = Dashboard(
        organization_id=org_id,
        name=f"Copy of {orig.name}",
        description=orig.description,
        layout=copied_layout,
        fetch_data_with_date=orig.fetch_data_with_date,
        date_fetching_config=copied_date_config,
        fetch_data_with_column=orig.fetch_data_with_column,
        column_fetching_config=copied_column_config,
    )
    db.add(new_dash)
    await db.flush()

    # Also duplicate widget label customizations
    labels_res = await db.execute(
        select(DashboardLabelCustomization).where(
            DashboardLabelCustomization.dashboard_id == dashboard_id,
            DashboardLabelCustomization.organization_id == org_id,
        )
    )
    for lbl in labels_res.scalars().all():
        db.add(
            DashboardLabelCustomization(
                organization_id=org_id,
                dashboard_id=new_dash.id,
                widget_id=lbl.widget_id,
                original_label=lbl.original_label,
                customized_label=lbl.customized_label,
            )
        )

    await db.flush()
    return new_dash


# Re-export centralized rights functions for backward compatibility
from app.access_management.service import (
    assign_dashboard_to_user,
    bulk_assign_dashboards_to_users,
    unassign_dashboard_from_user,
    list_dashboard_assignments,
    get_dashboard_filterable_columns,
)



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
    role_str = str(getattr(user.role, "value", user.role) or "").upper()
    if role_str == "SUPER_ADMIN":
        return True
    if role_str == "ORG_ADMIN":
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

    Uses two-tier cache:
      1. Process-level _auth_cache (30s TTL) — shared across all requests/users.
         Safe because auth membership is read-only org-level data.
      2. db.info — per-request fallback within the same session.
    """
    if not user or user.id is None or kpi_id <= 0:
        return False
    uid = int(user.id)
    cache_key = ("allowed_kpi", int(dashboard_id), int(org_id), int(kpi_id), uid)

    # 1. Check db.info (within this request's session — zero cost)
    if cache_key in db.info:
        return db.info[cache_key]

    # 2. Check process-level auth cache (shared across requests — avoids repeat DB hits)
    try:
        from app.widget_data.service import _auth_cache, _MISS
        cached = _auth_cache.get(cache_key)
        if cached is not _MISS:
            db.info[cache_key] = cached
            return cached
    except ImportError:
        pass

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
        db.info[cache_key] = False
        try:
            _auth_cache.set(cache_key, False)
        except Exception:
            pass
        return False
    role_str = str(getattr(user.role, "value", user.role) or "").upper()
    if role_str == "SUPER_ADMIN":
        db.info[cache_key] = True
        try:
            _auth_cache.set(cache_key, True)
        except Exception:
            pass
        return True
    if role_str == "ORG_ADMIN":
        allowed = user.organization_id == org_id
        db.info[cache_key] = allowed
        try:
            _auth_cache.set(cache_key, allowed)
        except Exception:
            pass
        return allowed
    if user.organization_id != org_id:
        db.info[cache_key] = False
        try:
            _auth_cache.set(cache_key, False)
        except Exception:
            pass
        return False
    perm = (
        await db.execute(
            select(DashboardAccessPermission.can_view).where(
                DashboardAccessPermission.dashboard_id == dashboard_id,
                DashboardAccessPermission.user_id == uid,
                DashboardAccessPermission.is_active == True,
            ).limit(1)
        )
    ).scalar_one_or_none()
    allowed = bool(perm)
    db.info[cache_key] = allowed
    try:
        _auth_cache.set(cache_key, allowed)
    except Exception:
        pass
    return allowed



async def user_can_access_dashboard(
    db: AsyncSession, user_id: int, dashboard_id: int, action: str = "view", org_id: int | None = None
) -> bool:
    """Access rules:
    - Organization Boundary: Dashboard must exist and match target_org_id.
    - SUPER_ADMIN: any dashboard within target_org_id (or any if no org context)
    - ORG_ADMIN: any dashboard within their org
    - Others: must belong to the same org AND be explicitly assigned with active permission
    """
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        return False
    role_str = str(getattr(user.role, "value", user.role) or "").upper()

    if role_str == "SUPER_ADMIN":
        target_org_id = org_id if org_id is not None else user.organization_id
    else:
        target_org_id = user.organization_id

    # Verify dashboard existence and strict organization matching
    d = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
    if not d:
        return False
    if target_org_id is not None and d.organization_id != target_org_id:
        return False

    if role_str in ("SUPER_ADMIN", "ORG_ADMIN"):
        return True

    perm = (
        await db.execute(
            select(DashboardAccessPermission).where(
                DashboardAccessPermission.dashboard_id == dashboard_id,
                DashboardAccessPermission.user_id == user_id,
                DashboardAccessPermission.is_active == True,
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

