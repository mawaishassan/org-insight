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
    can_load_lms: bool = True,
    can_change_period: bool = True,
    can_use_unique_value: bool = False,
    filter_kpi_id: int | None = None,
    filter_mli_id: int | None = None,
    filter_sub_field_key: str | None = None,
    filter_column_configs: dict[str, str] | None = None,
    filter_operator: str = "=",
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
            dashboard_id=dashboard_id,
            user_id=user_id,
            can_view=can_view,
            can_edit=can_edit,
            can_load_lms=can_load_lms,
            can_change_period=can_change_period,
            can_use_unique_value=can_use_unique_value,
            filter_kpi_id=filter_kpi_id,
            filter_mli_id=filter_mli_id,
            filter_sub_field_key=filter_sub_field_key,
            filter_column_configs=filter_column_configs,
            filter_operator=filter_operator,
        )
        db.add(perm)
        await db.flush()
        return perm

    perm.can_view = bool(can_view)
    perm.can_edit = bool(can_edit)
    perm.can_load_lms = bool(can_load_lms)
    perm.can_change_period = bool(can_change_period)
    perm.can_use_unique_value = bool(can_use_unique_value)
    perm.filter_kpi_id = filter_kpi_id
    perm.filter_mli_id = filter_mli_id
    perm.filter_sub_field_key = filter_sub_field_key
    perm.filter_column_configs = filter_column_configs
    perm.filter_operator = filter_operator
    await db.flush()
    return perm


async def bulk_assign_dashboards_to_users(
    db: AsyncSession,
    org_id: int,
    dashboard_ids: list[int],
    user_ids: list[int],
    *,
    can_view: bool = True,
    can_edit: bool = False,
    can_load_lms: bool = True,
    can_change_period: bool = True,
    can_use_unique_value: bool = False,
    filter_kpi_id: int | None = None,
    filter_mli_id: int | None = None,
    filter_sub_field_key: str | None = None,
    filter_column_configs: dict[str, str] | None = None,
    filter_operator: str = "=",
) -> int:
    """Bulk create/update assignments for multiple dashboards & users. Returns total updated count."""
    count = 0
    for d_id in dashboard_ids:
        for u_id in user_ids:
            res = await assign_dashboard_to_user(
                db,
                d_id,
                org_id,
                u_id,
                can_view=can_view,
                can_edit=can_edit,
                can_load_lms=can_load_lms,
                can_change_period=can_change_period,
                can_use_unique_value=can_use_unique_value,
                filter_kpi_id=filter_kpi_id,
                filter_mli_id=filter_mli_id,
                filter_sub_field_key=filter_sub_field_key,
                filter_column_configs=filter_column_configs,
                filter_operator=filter_operator,
            )
            if res:
                count += 1
    return count


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
            "id": perm.id,
            "dashboard_id": perm.dashboard_id,
            "user_id": perm.user_id,
            "username": user.username,
            "email": user.email,
            "full_name": user.full_name,
            "unique_user_key": getattr(user, "unique_user_key", None),
            "can_view": perm.can_view,
            "can_edit": perm.can_edit,
            "can_load_lms": getattr(perm, "can_load_lms", True),
            "can_change_period": getattr(perm, "can_change_period", True),
            "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
            "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
            "filter_mli_id": getattr(perm, "filter_mli_id", None),
            "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
            "filter_column_configs": getattr(perm, "filter_column_configs", None),
            "filter_operator": getattr(perm, "filter_operator", "="),
        }
        for perm, user in rows
    ]


async def get_dashboard_filterable_columns(db: AsyncSession, dashboard_id: int, org_id: int) -> list[dict]:
    """Inspect dashboard layout and return available MLI columns strictly for MLIs used in the dashboard."""
    from app.core.models import KPIField, KPIFieldSubField
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        return []

    layout = d.layout or {}
    widgets = []
    if isinstance(layout, list):
        widgets = layout
    elif isinstance(layout, dict) and isinstance(layout.get("widgets"), list):
        widgets = layout["widgets"]

    kpi_ids = set()
    used_mli_pairs: set[tuple[int, str]] = set()  # (kpi_id, source_field_key)
    used_field_ids: set[int] = set()

    for w in widgets:
        if not isinstance(w, dict):
            continue
        k_id = w.get("kpi_id")
        if k_id:
            try:
                k_int = int(k_id)
                kpi_ids.add(k_int)

                src_key = w.get("source_field_key")
                if src_key and str(src_key).strip():
                    used_mli_pairs.add((k_int, str(src_key).strip()))

                src_id = w.get("source_field_id")
                if src_id:
                    try:
                        used_field_ids.add(int(src_id))
                    except (ValueError, TypeError):
                        pass

                joins = w.get("joins")
                if isinstance(joins, list):
                    for j in joins:
                        if isinstance(j, dict):
                            jk = j.get("kpi_id")
                            jsk = j.get("source_field_key")
                            if jk and jsk:
                                try:
                                    used_mli_pairs.add((int(jk), str(jsk).strip()))
                                    kpi_ids.add(int(jk))
                                except (ValueError, TypeError):
                                    pass
            except (ValueError, TypeError):
                pass

    if not kpi_ids:
        return []

    res = await db.execute(
        select(KPI, KPIField, KPIFieldSubField)
        .join(KPIField, KPIField.kpi_id == KPI.id)
        .join(KPIFieldSubField, KPIFieldSubField.field_id == KPIField.id)
        .where(
            KPI.id.in_(list(kpi_ids)),
            KPI.organization_id == org_id,
            KPIField.field_type == FieldType.multi_line_items,
        )
        .order_by(KPI.id, KPIField.id, KPIFieldSubField.id)
    )
    rows = res.all()

    items = []
    seen = set()
    for kpi_obj, field_obj, sub_obj in rows:
        # If specific MLIs were used in widgets, only include those MLIs!
        if used_mli_pairs or used_field_ids:
            is_matched = (kpi_obj.id, field_obj.key) in used_mli_pairs or field_obj.id in used_field_ids
            if not is_matched:
                continue

        key_tuple = (kpi_obj.id, field_obj.id, sub_obj.key)
        if key_tuple in seen:
            continue
        seen.add(key_tuple)
        items.append({
            "kpi_id": kpi_obj.id,
            "kpi_title": kpi_obj.name or f"KPI #{kpi_obj.id}",
            "mli_id": field_obj.id,
            "mli_title": field_obj.name or field_obj.key,
            "sub_field_id": sub_obj.id,
            "sub_field_key": sub_obj.key,
            "label": f"{kpi_obj.name} -> {field_obj.name} -> {sub_obj.name or sub_obj.key} ({sub_obj.key})",
        })

    # For any joined KPI, ensure any additional columns defined in joined_config mappings are also included
    joined_kpis_res = await db.execute(
        select(KPI).where(KPI.id.in_(list(kpi_ids)), KPI.is_joined == True)
    )
    for jkpi in joined_kpis_res.scalars().all():
        cfg = getattr(jkpi, "joined_config", None) or {}
        mappings = cfg.get("mappings") or []
        for m in mappings:
            f_key = m.get("joined_field_key")
            if not f_key:
                continue
            if (used_mli_pairs or used_field_ids) and (jkpi.id, f_key) not in used_mli_pairs:
                continue

            fld_res = await db.execute(
                select(KPIField).where(KPIField.kpi_id == jkpi.id, KPIField.key == f_key)
            )
            fld = fld_res.scalar_one_or_none()
            if not fld:
                continue

            existing_sub_keys = {item["sub_field_key"] for item in items if item["kpi_id"] == jkpi.id and item["mli_id"] == fld.id}
            
            # Primary subfields
            for sk in (m.get("primary_sub_field_keys") or []):
                if sk and sk not in existing_sub_keys:
                    key_tuple = (jkpi.id, fld.id, sk)
                    if key_tuple not in seen:
                        seen.add(key_tuple)
                        items.append({
                            "kpi_id": jkpi.id,
                            "kpi_title": jkpi.name or f"KPI #{jkpi.id}",
                            "mli_id": fld.id,
                            "mli_title": fld.name or fld.key,
                            "sub_field_id": 0,
                            "sub_field_key": sk,
                            "label": f"{jkpi.name} -> {fld.name} -> {sk} ({sk})",
                        })

            # Joined subfields
            for j in (m.get("joins") or []):
                for sk in (j.get("sub_field_keys") or []):
                    if sk and sk not in existing_sub_keys:
                        key_tuple = (jkpi.id, fld.id, sk)
                        if key_tuple not in seen:
                            seen.add(key_tuple)
                            items.append({
                                "kpi_id": jkpi.id,
                                "kpi_title": jkpi.name or f"KPI #{jkpi.id}",
                                "mli_id": fld.id,
                                "mli_title": fld.name or fld.key,
                                "sub_field_id": 0,
                                "sub_field_key": sk,
                                "label": f"{jkpi.name} -> {fld.name} -> {sk} ({sk})",
                            })

    return items


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
    """
    if not user or user.id is None or kpi_id <= 0:
        return False
    uid = int(user.id)
    cache_key = ("allowed_kpi", int(dashboard_id), int(org_id), int(kpi_id), uid)
    if cache_key in db.info:
        return db.info[cache_key]

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
        return False
    role_str = str(getattr(user.role, "value", user.role) or "").upper()
    if role_str == "SUPER_ADMIN":
        db.info[cache_key] = True
        return True
    if role_str == "ORG_ADMIN":
        allowed = user.organization_id == org_id
        db.info[cache_key] = allowed
        return allowed
    perm = (
        await db.execute(
            select(DashboardAccessPermission.can_view).where(
                DashboardAccessPermission.dashboard_id == dashboard_id,
                DashboardAccessPermission.user_id == uid,
            ).limit(1)
        )
    ).scalar_one_or_none()
    allowed = bool(perm)
    db.info[cache_key] = allowed
    return allowed


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
    role_str = str(getattr(user.role, "value", user.role) or "").upper()
    if role_str == "SUPER_ADMIN":
        ok = (await db.execute(select(Dashboard.id).where(Dashboard.id == dashboard_id).limit(1))).scalar_one_or_none()
        return ok is not None
    if role_str == "ORG_ADMIN" and user.organization_id:
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

