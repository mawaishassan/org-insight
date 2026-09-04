"""Dashboard API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin, require_super_admin
from app.core.models import User, Dashboard, DashboardAccessPermission, DashboardLabelCustomization
from app.dashboards.schemas import (
    DashboardCreate,
    DashboardUpdate,
    DashboardResponse,
    DashboardDetailResponse,
    DashboardAccessAssign,
    DashboardBulkAssignRequest,
    DashboardAssignmentResponse,
    DashboardFilterColumnItem,
    DashboardLabelCustomizationResponse,
    DashboardLabelCustomizationUpsert,
)
from app.dashboards.service import (
    list_all_dashboards,
    list_dashboards,
    get_dashboard,
    create_dashboard,
    update_dashboard,
    delete_dashboard,
    assign_dashboard_to_user,
    bulk_assign_dashboards_to_users,
    unassign_dashboard_from_user,
    list_dashboard_assignments,
    get_dashboard_filterable_columns,
    user_can_access_dashboard,
)


router = APIRouter(prefix="/dashboards", tags=["dashboards"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


async def _org_id_for_dashboard(
    db: AsyncSession, user: User, dashboard_id: int, org_id_param: int | None
) -> int:
    """Resolve org for dashboard-scoped routes (mirrors reports behavior)."""
    if user.role.value == "SUPER_ADMIN" and org_id_param is None:
        d = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
        if not d:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
        return d.organization_id
    return _org_id(user, org_id_param)


@router.get("", response_model=list[DashboardResponse])
async def list_org_dashboards(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List dashboards (org admin: all org; others: only assigned). Super Admin with no org sees all dashboards."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        dashboards = await list_all_dashboards(db)
    else:
        org_id = _org_id(current_user, organization_id)
        dashboards = await list_dashboards(db, org_id)
    if current_user.role.value not in ("ORG_ADMIN", "SUPER_ADMIN"):
        allowed: set[int] = set()
        for d in dashboards:
            if await user_can_access_dashboard(db, current_user.id, d.id, "view"):
                allowed.add(d.id)
        dashboards = [d for d in dashboards if d.id in allowed]
    return [DashboardResponse.model_validate(d) for d in dashboards]


@router.post("", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def create_org_dashboard(
    body: DashboardCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create dashboard (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may create dashboards")
    org_id = _org_id(current_user, organization_id)
    d = await create_dashboard(
        db,
        org_id,
        name=body.name,
        description=body.description,
        layout=body.layout,
        fetch_data_with_date=body.fetch_data_with_date,
        date_fetching_config=body.date_fetching_config,
        fetch_data_with_column=body.fetch_data_with_column,
        column_fetching_config=body.column_fetching_config,
    )
    await db.commit()
    await db.refresh(d)
    return DashboardResponse.model_validate(d)


@router.get("/{dashboard_id}", response_model=DashboardDetailResponse)
async def get_one_dashboard(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    can = await user_can_access_dashboard(db, current_user.id, dashboard_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    return DashboardDetailResponse.model_validate(d)


@router.patch("/{dashboard_id}", response_model=DashboardResponse)
async def update_one_dashboard(
    dashboard_id: int,
    body: DashboardUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update dashboard (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may update dashboards")
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    d = await update_dashboard(
        db,
        dashboard_id,
        org_id,
        name=body.name,
        description=body.description,
        layout=body.layout,
        fetch_data_with_date=body.fetch_data_with_date,
        date_fetching_config=body.date_fetching_config,
        fetch_data_with_column=body.fetch_data_with_column,
        column_fetching_config=body.column_fetching_config,
    )
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    await db.commit()
    await db.refresh(d)
    from app.widget_data.service import invalidate_dashboard_cache
    invalidate_dashboard_cache(dashboard_id)
    return DashboardResponse.model_validate(d)


@router.get("/{dashboard_id}/column-values")
async def get_dashboard_column_values(
    dashboard_id: int,
    kpi_id: int | None = Query(None),
    source_field_key: str | None = Query(None),
    column_key: str | None = Query(None),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch distinct unique values for the configured column in a dashboard."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    can = await user_can_access_dashboard(db, current_user.id, dashboard_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")

    cfg = d.column_fetching_config or {}
    effective_kpi_id = kpi_id or cfg.get("kpi_id")
    effective_field_key = (source_field_key or cfg.get("source_field_key") or "").strip()
    effective_column_key = (column_key or cfg.get("column_key") or "").strip()

    if not effective_kpi_id or not effective_field_key or not effective_column_key:
        return {"column_key": effective_column_key, "values": []}

    from app.core.models import KPIField, KPIEntry, KPIFieldSubField, KpiMultiLineCell, KpiMultiLineRow
    from app.entries.multi_line_load import load_multi_line_row_dicts

    f_res = await db.execute(
        select(KPIField).where(
            KPIField.kpi_id == int(effective_kpi_id),
            KPIField.key == effective_field_key,
        )
    )
    field = f_res.scalar_one_or_none()
    if not field:
        return {"column_key": effective_column_key, "values": []}

    entries_res = await db.execute(
        select(KPIEntry.id).where(
            KPIEntry.kpi_id == int(effective_kpi_id),
            KPIEntry.organization_id == org_id,
            KPIEntry.is_draft == False,
        )
    )
    entry_ids = [r[0] for r in entries_res.all()]
    if not entry_ids:
        return {"column_key": effective_column_key, "values": []}

    is_org_admin = current_user.role.value in ("ORG_ADMIN", "SUPER_ADMIN") if current_user and getattr(current_user, "role", None) else False
    user_key = (getattr(current_user, "unique_user_key", None) or "").strip() if current_user else ""

    from app.entries.multi_line_load import _fetch_rules_for_field, load_multi_line_row_dicts
    rules = await _fetch_rules_for_field(db, field.id)
    if rules:
        try:
            row_tuples = await load_multi_line_row_dicts(
                db,
                entry_id=entry_ids,
                field=field,
                current_user_id=current_user.id if current_user else None
            )
            if not is_org_admin and user_key:
                u_key_lower = user_key.lower()
                row_tuples = [
                    (r_idx, rdict)
                    for r_idx, rdict in row_tuples
                    if isinstance(rdict, dict) and any(str(v).strip().lower() == u_key_lower for v in rdict.values() if v is not None)
                ]
            seen = set()
            values = []
            for _, rdict in row_tuples:
                if not isinstance(rdict, dict):
                    continue
                v = rdict.get(effective_column_key)
                if v is None:
                    continue
                if isinstance(v, dict):
                    v_str = str(v.get("label") or v.get("name") or v.get("value") or "").strip()
                else:
                    v_str = str(v).strip()
                if v_str and v_str != "(empty)" and v_str.lower() not in ("none", "null", "false", "undefined", "—") and v_str not in seen:
                    seen.add(v_str)
                    values.append(v_str)
            values.sort(key=lambda x: x.lower())
            return {
                "column_key": effective_column_key,
                "column_name": cfg.get("column_name") or cfg.get("column_label") or effective_column_key,
                "values": values,
            }
        except Exception:
            pass

    sf_res = await db.execute(
        select(KPIFieldSubField.id).where(
            KPIFieldSubField.field_id == field.id,
            KPIFieldSubField.key == effective_column_key,
        )
    )
    sub_field_id = sf_res.scalar_one_or_none()
    if sub_field_id:
        sql_stmt = (
            select(KpiMultiLineCell.value_text)
            .join(KpiMultiLineRow, KpiMultiLineRow.id == KpiMultiLineCell.row_id)
            .where(
                KpiMultiLineRow.entry_id.in_(entry_ids),
                KpiMultiLineCell.sub_field_id == sub_field_id,
                KpiMultiLineCell.value_text.isnot(None),
                KpiMultiLineCell.value_text != "",
            )
        )
        if not is_org_admin and user_key:
            from sqlalchemy import func
            scoped_rows = select(KpiMultiLineCell.row_id).where(
                func.trim(func.lower(KpiMultiLineCell.value_text)) == user_key.lower()
            )
            sql_stmt = sql_stmt.where(KpiMultiLineRow.id.in_(scoped_rows))

        sql_stmt = sql_stmt.distinct()
        c_res = await db.execute(sql_stmt)
        values = [r[0].strip() for r in c_res.all() if r[0] and r[0].strip() and r[0].strip() != "(empty)"]
        values = sorted(list(dict.fromkeys(values)), key=lambda x: x.lower())
        return {
            "column_key": effective_column_key,
            "column_name": cfg.get("column_name") or cfg.get("column_label") or effective_column_key,
            "values": values,
        }

    pairs = await load_multi_line_row_dicts(
        db,
        entry_id=entry_ids,
        field=field,
        current_user_id=current_user.id if current_user else None,
    )
    if not is_org_admin and user_key:
        u_key_lower = user_key.lower()
        pairs = [
            (r_idx, rdict)
            for r_idx, rdict in pairs
            if isinstance(rdict, dict) and any(str(v).strip().lower() == u_key_lower for v in rdict.values() if v is not None)
        ]

    seen = set()
    values = []
    for _idx, r in pairs:
        if not isinstance(r, dict):
            continue
        v = r.get(effective_column_key)
        if v is None:
            continue
        if isinstance(v, dict):
            v_str = str(v.get("label") or v.get("name") or v.get("value") or "").strip()
        else:
            v_str = str(v).strip()
        if v_str and v_str != "(empty)" and v_str not in seen:
            seen.add(v_str)
            values.append(v_str)

    values.sort(key=lambda x: x.lower())
    return {
        "column_key": effective_column_key,
        "column_name": cfg.get("column_name") or cfg.get("column_label") or effective_column_key,
        "values": values,
    }


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_one_dashboard(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete dashboard (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may delete dashboards")
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    ok = await delete_dashboard(db, dashboard_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    await db.commit()


@router.get("/{dashboard_id}/users", response_model=list[DashboardAssignmentResponse])
async def list_users_for_dashboard(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List dashboard assignments. ORG_ADMIN can manage within their org."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    assignments = await list_dashboard_assignments(db, dashboard_id, org_id)
    return [DashboardAssignmentResponse.model_validate(a) for a in assignments]


@router.post("/{dashboard_id}/assign", status_code=status.HTTP_201_CREATED)
async def assign_user_to_dashboard(
    dashboard_id: int,
    body: DashboardAccessAssign,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign dashboard to user (view/edit). ORG_ADMIN can assign within their org."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    perm = await assign_dashboard_to_user(
        db,
        dashboard_id,
        org_id,
        body.user_id,
        can_view=body.can_view,
        can_edit=body.can_edit,
    )
    if not perm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard or user not found")
    await db.commit()
    return {
        "user_id": perm.user_id,
        "dashboard_id": perm.dashboard_id,
        "can_view": perm.can_view,
        "can_edit": perm.can_edit,
    }


@router.delete("/{dashboard_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_from_dashboard(
    dashboard_id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove dashboard assignment from user. ORG_ADMIN can unassign within their org."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    ok = await unassign_dashboard_from_user(db, dashboard_id, org_id, user_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.get("/{dashboard_id}/odoo-sync-info")
async def get_dashboard_odoo_sync_info(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Check if dashboard has Odoo-integrated graph widgets and return sync targets.
    """
    from app.odoo.config_service import get_org_odoo_config, get_kpi_odoo_config
    from app.fields.service import list_kpi_field_definitions
    from app.core.models import KPIField, FieldType

    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    
    # Check dashboard access
    if not await user_can_access_dashboard(db, current_user.id, dashboard_id, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this dashboard")
        
    dashboard = await get_dashboard(db, dashboard_id, org_id)
    if not dashboard:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")

    layout = dashboard.layout or {}
    widgets = []
    if isinstance(layout, list):
        widgets = layout
    elif isinstance(layout, dict) and isinstance(layout.get("widgets"), list):
        widgets = layout["widgets"]

    has_odoo_graphs = False
    syncable_targets = []
    seen_targets = set()

    for w in widgets:
        if not isinstance(w, dict):
            continue
        w_type = w.get("type")
        is_graph = w_type in ("kpi_bar_chart", "kpi_trend")
        is_supported = w_type in ("kpi_bar_chart", "kpi_trend", "kpi_multi_line_table", "kpi_card_single_value")
        if not is_supported:
            continue

        kpi_id = w.get("kpi_id")
        if not kpi_id:
            continue
        kpi_id = int(kpi_id)

        if w_type == "kpi_bar_chart" and w.get("mode") != "multi_line_items":
            continue
        if w_type == "kpi_trend" and w.get("mode") != "multi_line_items":
            continue
        if w_type == "kpi_card_single_value" and w.get("source_mode") != "multi_line_agg":
            continue

        source_field_key = w.get("source_field_key")
        if not source_field_key:
            continue
        source_field_key = str(source_field_key).strip()

        years = []
        if w_type == "kpi_trend":
            start_year = w.get("start_year")
            end_year = w.get("end_year")
            if start_year and end_year:
                years = list(range(int(start_year), int(end_year) + 1))
        else:
            year = w.get("year")
            if year:
                years = [int(year)]

        if not years:
            continue

        period_key = (w.get("period_key") or "").strip()

        org_odoo = await get_org_odoo_config(db, org_id)
        if not org_odoo:
            continue

        kpi_fields = await list_kpi_field_definitions(db, kpi_id, org_id)
        field = next((f for f in kpi_fields if f.key == source_field_key and f.field_type == FieldType.multi_line_items), None)
        if not field:
            continue

        kpi_odoo = await get_kpi_odoo_config(db, kpi_id)
        config = field.config or {}
        channel = (config.get("multi_items_import_channel") or "").strip().lower()
        if not kpi_odoo and channel != "odoo":
            continue
        if not kpi_odoo:
            continue

        if is_graph:
            has_odoo_graphs = True

        for yr in years:
            target_key = (kpi_id, field.id, yr, period_key)
            if target_key not in seen_targets:
                seen_targets.add(target_key)
                syncable_targets.append({
                    "kpi_id": kpi_id,
                    "field_id": field.id,
                    "year": yr,
                    "period_key": period_key,
                })

    return {
        "has_odoo_graphs": has_odoo_graphs,
        "syncable_targets": syncable_targets,
    }


@router.post("/{dashboard_id}/sync-odoo")
async def sync_dashboard_odoo_data(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Sync all Odoo-integrated multi-line items on this dashboard.
    """
    from app.odoo.config_service import get_org_odoo_config, get_kpi_odoo_config
    from app.fields.service import list_kpi_field_definitions
    from app.odoo.service import (
        odoo_authenticate,
        odoo_fetch_items,
        apply_odoo_field_mappings,
        apply_odoo_sub_field_mappings,
        download_and_store_odoo_attachments,
        store_pre_downloaded_odoo_attachments,
        extract_odoo_attachment_ids,
    )
    from app.entries.service import (
        _is_multi_items_row_effectively_empty,
        mark_entry_modified,
        recompute_formula_fields_for_entry,
        _copy_entry_values,
        get_or_create_entry,
        propagate_formula_recalculations,
    )
    from app.core.models import KPIEntry, FieldType, KPIFieldValue, KpiMultiLineRowAccess, KpiFile, KpiMultiLineRow
    from app.entries.routes import _replace_multi_line_rows_from_dicts
    from sqlalchemy import delete
    from datetime import datetime

    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    
    # Check dashboard access
    if not await user_can_access_dashboard(db, current_user.id, dashboard_id, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this dashboard")
        
    dashboard = await get_dashboard(db, dashboard_id, org_id)
    if not dashboard:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")

    layout = dashboard.layout or {}
    widgets = []
    if isinstance(layout, list):
        widgets = layout
    elif isinstance(layout, dict) and isinstance(layout.get("widgets"), list):
        widgets = layout["widgets"]

    # Gather targets by kpi_id
    kpi_targets = {}
    from datetime import datetime
    current_yr = datetime.utcnow().year

    for w in widgets:
        if not isinstance(w, dict):
            continue
        kpi_id_raw = w.get("kpi_id")
        if not kpi_id_raw:
            continue
        try:
            kpi_id = int(kpi_id_raw)
        except (ValueError, TypeError):
            continue

        # Extract years from widget configuration
        years = []
        if w.get("start_year") and w.get("end_year"):
            try:
                years = list(range(int(w["start_year"]), int(w["end_year"]) + 1))
            except (ValueError, TypeError):
                pass
        elif w.get("year"):
            try:
                years = [int(w["year"])]
            except (ValueError, TypeError):
                pass
        if not years:
            years = [current_yr]

        period_key = (w.get("period_key") or "").strip()

        if kpi_id not in kpi_targets:
            kpi_targets[kpi_id] = {"years": set(), "period_keys": set()}
        kpi_targets[kpi_id]["years"].update(years)
        kpi_targets[kpi_id]["period_keys"].add(period_key)

    # Gather syncable targets
    syncable_fields = []
    seen_targets = set()

    for kpi_id, targets in kpi_targets.items():
        kpi_odoo = await get_kpi_odoo_config(db, kpi_id)
        if not kpi_odoo:
            continue

        org_odoo = await get_org_odoo_config(db, org_id)
        if not org_odoo:
            continue

        kpi_fields = await list_kpi_field_definitions(db, kpi_id, org_id)
        odoo_fields = [
            f for f in kpi_fields
            if f.field_type == FieldType.multi_line_items
            and (
                kpi_odoo is not None
                or (isinstance(f.config, dict) and (f.config.get("multi_items_import_channel") or "").strip().lower() == "odoo")
            )
        ]
        if not odoo_fields:
            continue

        for field in odoo_fields:
            for yr in targets["years"]:
                for pk in targets["period_keys"]:
                    target_key = (kpi_id, field.id, yr, pk)
                    if target_key not in seen_targets:
                        seen_targets.add(target_key)
                        syncable_fields.append((field, yr, pk, org_odoo, kpi_odoo))

    if not syncable_fields:
        return {"status": "success", "message": "No Odoo-integrated fields to sync", "synced_count": 0}

    # Authenticate with Odoo once per organization
    org_odoo = syncable_fields[0][3]
    from app.core.sync_progress import set_sync_stage
    set_sync_stage("dashboard", dashboard_id, "AUTHENTICATING_ODOO")
    try:
        session_id = await odoo_authenticate(org_odoo)
    except (ValueError, Exception) as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Odoo authentication failed: {e}")

    synced_count = 0
    errors = []
    total_imported = 0
    synced_entry_ids = set()

    for field, yr, period_key, org_odoo, kpi_odoo in syncable_fields:
        pk = period_key[:8]
        # 1. Look up or create the published entry
        from sqlalchemy import select
        from app.entries.service import user_can_edit_kpi
        pub_result = await db.execute(
            select(KPIEntry).where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == field.kpi_id,
                KPIEntry.year == yr,
                KPIEntry.period_key == pk,
                KPIEntry.is_draft == False,
            )
        )
        entry = pub_result.scalar_one_or_none()
        if not entry:
            can_edit = await user_can_edit_kpi(db, current_user.id, field.kpi_id, org_id)
            if not can_edit:
                errors.append(f"Not allowed to edit KPI {field.kpi_id} ({yr} {period_key})")
                continue
            # Look up if there is a draft entry we can rename to preserve ID
            draft_result = await db.execute(
                select(KPIEntry).where(
                    KPIEntry.organization_id == org_id,
                    KPIEntry.kpi_id == field.kpi_id,
                    KPIEntry.year == yr,
                    KPIEntry.period_key == pk,
                    KPIEntry.is_draft == True,
                )
            )
            draft_entry = draft_result.scalars().first()
            if draft_entry:
                entry = draft_entry
                entry.is_draft = False
                await db.flush()
            else:
                entry = KPIEntry(
                    organization_id=org_id,
                    kpi_id=field.kpi_id,
                    user_id=current_user.id,
                    year=yr,
                    period_key=pk,
                    is_draft=False,
                    is_modified_after_submission=False,
                )
                db.add(entry)
                await db.flush()

        if entry.is_locked:
            errors.append(f"Entry for KPI {field.kpi_id} ({yr} {period_key}) is locked and cannot be updated.")
            continue

        cfg = field.config or {}
        att_sub_keys = [
            s.key for s in (field.sub_fields or []) if getattr(s, "field_type", None) in (FieldType.attachment, "attachment")
        ]
        if att_sub_keys and not (org_odoo.attachment_url_template or "").strip():
            errors.append(f"Attachment URL Template not configured for Odoo attachments in KPI {field.kpi_id}.")
            continue

        try:
            context = {
                "year": entry.year,
                "kpi_id": field.kpi_id,
                "organization_id": org_id,
                "entry_id": entry.id,
                "field_id": field.id,
                "field_key": field.key,
            }
            set_sync_stage("dashboard", dashboard_id, f"FETCHING_FROM_ODOO (KPI {field.kpi_id})")
            raw_items = await odoo_fetch_items(org_odoo, kpi_odoo, session_id, context)

            sub_keys = {s.key for s in (field.sub_fields or [])}
            sub_mappings = cfg.get("odoo_sub_field_mappings") or {}
            if isinstance(sub_mappings, dict) and sub_mappings:
                item_dicts = apply_odoo_sub_field_mappings(raw_items, sub_mappings, sub_keys)
            else:
                mappings = cfg.get("odoo_field_mappings") or {}
                if not isinstance(mappings, dict):
                    mappings = {}
                list_indices_raw = cfg.get("odoo_field_list_indices") or {}
                list_indices: dict[str, int] = {}
                if isinstance(list_indices_raw, dict):
                    for odoo_key, idx in list_indices_raw.items():
                        if isinstance(idx, int):
                            list_indices[str(odoo_key)] = idx
                        elif isinstance(idx, str) and idx.isdigit():
                            list_indices[str(odoo_key)] = int(idx)
                item_dicts = apply_odoo_field_mappings(raw_items, mappings, sub_keys, list_indices)

            item_dicts = [
                dict(x)
                for x in item_dicts
                if isinstance(x, dict) and not _is_multi_items_row_effectively_empty(dict(x))
            ]

            # Generate on-demand attachment placeholders to avoid timeouts while retaining file viewing links.
            if att_sub_keys:
                from app.odoo.service import build_on_demand_attachment_placeholders
                for row in item_dicts:
                    for att_key in att_sub_keys:
                        raw_att_val = row.get(att_key)
                        row[att_key] = build_on_demand_attachment_placeholders(field.kpi_id, raw_att_val)

            set_sync_stage("dashboard", dashboard_id, f"SAVING_KPI_ENTRIES (KPI {field.kpi_id})")
            await _replace_multi_line_rows_from_dicts(db, entry_id=entry.id, field=field, rows=item_dicts)
            await mark_entry_modified(db, entry, current_user.id)
            await db.execute(
                delete(KPIEntry).where(
                    KPIEntry.organization_id == org_id,
                    KPIEntry.kpi_id == entry.kpi_id,
                    KPIEntry.year == entry.year,
                    KPIEntry.period_key == entry.period_key,
                    KPIEntry.is_draft == True,
                )
            )
            await db.flush()
            synced_entry_ids.add(entry.id)

            synced_count += 1
            total_imported += len(item_dicts)

        except Exception as e:
            errors.append(f"Failed to sync KPI {field.kpi_id} ({yr}): {e}")

    # Propagate formula recalculations for all synced entries
    for entry_id in synced_entry_ids:
        try:
            set_sync_stage("dashboard", dashboard_id, f"PROPAGATING_FORMULAS (KPI entry {entry_id})")
            await propagate_formula_recalculations(db, entry_id=entry_id, org_id=org_id)
            await db.flush()
        except Exception as e:
            errors.append(f"Failed to propagate formula recalculations for entry {entry_id}: {e}")

    set_sync_stage("dashboard", dashboard_id, "COMPLETED")
    await db.commit()

    return {
        "status": "success",
        "synced_count": synced_count,
        "total_imported_rows": total_imported,
        "errors": errors,
    }


@router.get("/{dashboard_id}/label-customizations", response_model=list[DashboardLabelCustomizationResponse])
async def list_dashboard_label_customizations(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get all label customizations for a dashboard."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    # Check view permission
    can = await user_can_access_dashboard(db, current_user.id, dashboard_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    res = await db.execute(
        select(DashboardLabelCustomization).where(
            DashboardLabelCustomization.dashboard_id == dashboard_id,
            DashboardLabelCustomization.organization_id == org_id,
        )
    )
    return [DashboardLabelCustomizationResponse.model_validate(c) for c in res.scalars().all()]


@router.post("/{dashboard_id}/label-customizations", response_model=DashboardLabelCustomizationResponse)
async def upsert_dashboard_label_customization(
    dashboard_id: int,
    body: DashboardLabelCustomizationUpsert,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Create or update a label customization for a dashboard (Super Admin only)."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    # Verify dashboard exists
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")

    # Look for existing customization
    stmt = select(DashboardLabelCustomization).where(
        DashboardLabelCustomization.dashboard_id == dashboard_id,
        DashboardLabelCustomization.original_label == body.original_label,
    )
    if body.widget_id:
        stmt = stmt.where(DashboardLabelCustomization.widget_id == body.widget_id)
    else:
        stmt = stmt.where(DashboardLabelCustomization.widget_id.is_(None))
    
    existing = (await db.execute(stmt)).scalar_one_or_none()
    
    if existing:
        existing.customized_label = body.customized_label
        cust = existing
    else:
        cust = DashboardLabelCustomization(
            organization_id=org_id,
            dashboard_id=dashboard_id,
            widget_id=body.widget_id,
            original_label=body.original_label,
            customized_label=body.customized_label,
        )
        db.add(cust)
    
    await db.flush()
    await db.commit()
    await db.refresh(cust)
    return DashboardLabelCustomizationResponse.model_validate(cust)


@router.delete("/{dashboard_id}/label-customizations", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dashboard_label_customization(
    dashboard_id: int,
    original_label: str = Query(...),
    widget_id: str | None = Query(None),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Delete a label customization for a dashboard (Super Admin only)."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    # Verify dashboard exists
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")

    stmt = select(DashboardLabelCustomization).where(
        DashboardLabelCustomization.dashboard_id == dashboard_id,
        DashboardLabelCustomization.original_label == original_label,
    )
    if widget_id:
        stmt = stmt.where(DashboardLabelCustomization.widget_id == widget_id)
    else:
        stmt = stmt.where(DashboardLabelCustomization.widget_id.is_(None))
        
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customization not found")
        
    await db.delete(existing)
    await db.flush()
    await db.commit()


@router.post("/bulk-assign", status_code=status.HTTP_200_OK)
async def bulk_assign_dashboards_route(
    body: DashboardBulkAssignRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Bulk assign multiple dashboards to multiple users with permission & filter configuration (Org Admin / Super Admin)."""
    org_id = _org_id(current_user, organization_id)
    count = await bulk_assign_dashboards_to_users(
        db,
        org_id,
        body.dashboard_ids,
        body.user_ids,
        can_view=body.can_view,
        can_edit=body.can_edit,
        can_load_lms=body.can_load_lms,
        can_change_period=body.can_change_period,
        can_use_unique_value=body.can_use_unique_value,
        filter_kpi_id=body.filter_kpi_id,
        filter_mli_id=body.filter_mli_id,
        filter_sub_field_key=body.filter_sub_field_key,
        filter_column_configs=body.filter_column_configs,
        filter_operator=body.filter_operator,
    )
    await db.commit()
    return {"message": f"Successfully created/updated {count} dashboard assignments", "assigned_count": count}


@router.get("/{dashboard_id}/assignments", response_model=list[DashboardAssignmentResponse])
async def list_dashboard_assignments_route(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List all user assignments for a dashboard (Org Admin / Super Admin)."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    return await list_dashboard_assignments(db, dashboard_id, org_id)


@router.post("/{dashboard_id}/assign", response_model=DashboardAssignmentResponse)
async def assign_dashboard_route(
    dashboard_id: int,
    body: DashboardAccessAssign,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign or update dashboard permission for a single user (Org Admin / Super Admin)."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    perm = await assign_dashboard_to_user(
        db,
        dashboard_id,
        org_id,
        body.user_id,
        can_view=body.can_view,
        can_edit=body.can_edit,
        can_load_lms=body.can_load_lms,
        can_change_period=body.can_change_period,
        can_use_unique_value=body.can_use_unique_value,
        filter_kpi_id=body.filter_kpi_id,
        filter_mli_id=body.filter_mli_id,
        filter_sub_field_key=body.filter_sub_field_key,
        filter_column_configs=body.filter_column_configs,
        filter_operator=body.filter_operator,
    )
    if not perm:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Dashboard or user not found in organization")
    await db.commit()

    assignments = await list_dashboard_assignments(db, dashboard_id, org_id)
    for a in assignments:
        if a["user_id"] == body.user_id:
            return a
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to fetch created assignment")


@router.delete("/{dashboard_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_dashboard_user_route(
    dashboard_id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove user access assignment from a dashboard (Org Admin / Super Admin)."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    ok = await unassign_dashboard_from_user(db, dashboard_id, org_id, user_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    await db.commit()


@router.get("/{dashboard_id}/filter-columns", response_model=list[DashboardFilterColumnItem])
async def get_dashboard_filter_columns_route(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Retrieve available MLI columns across all KPIs in a dashboard for user key filtering."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    return await get_dashboard_filterable_columns(db, dashboard_id, org_id)


@router.get("/{dashboard_id}/my-permissions")
async def get_my_dashboard_permissions_route(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve current user's effective permissions for a dashboard."""
    role_str = str(getattr(current_user.role, "value", current_user.role) or "").upper()
    if role_str in ("SUPER_ADMIN", "ORG_ADMIN"):
        return {
            "can_view": True,
            "can_edit": True,
            "can_load_lms": True,
            "can_change_period": True,
            "can_use_unique_value": True,
        }

    res = await db.execute(
        select(DashboardAccessPermission).where(
            DashboardAccessPermission.dashboard_id == dashboard_id,
            DashboardAccessPermission.user_id == current_user.id,
        )
    )
    perm = res.scalar_one_or_none()
    if not perm:
        return {
            "can_view": False,
            "can_edit": False,
            "can_load_lms": True,
            "can_change_period": True,
            "can_use_unique_value": False,
        }

    return {
        "can_view": perm.can_view,
        "can_edit": perm.can_edit,
        "can_load_lms": perm.can_load_lms,
        "can_change_period": perm.can_change_period,
        "can_use_unique_value": perm.can_use_unique_value,
    }



