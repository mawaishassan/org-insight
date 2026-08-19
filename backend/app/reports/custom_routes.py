import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin
from app.core.models import User, CustomReport, CustomReportAssignment
from app.reports.custom_schemas import (
    CustomReportCreate,
    CustomReportUpdate,
    CustomReportResponse,
    CustomReportLayoutSave,
    CustomReportAssignmentRequest,
    CustomReportAssignmentResponse
)
from app.reports.custom_service import (
    create_custom_report,
    get_custom_report,
    list_custom_reports,
    update_custom_report,
    delete_custom_report,
    duplicate_custom_report,
    save_custom_report_layout,
    assign_custom_report,
    unassign_custom_report,
    list_custom_report_assignments,
    generate_custom_report_data,
    render_custom_report_html,
    CUSTOM_REPORT_CACHE,
    REPORT_TASKS,
    run_background_generation_task,
    stream_custom_report_data
)

router = APIRouter(prefix="/custom-reports", tags=["custom-reports"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


async def check_custom_report_access(db: AsyncSession, user: User, custom_report_id: int, action: str) -> bool:
    if user.role.value == "SUPER_ADMIN":
        return True

    report = (await db.execute(select(CustomReport).where(CustomReport.id == custom_report_id))).scalar_one_or_none()
    if not report:
        return False

    if user.organization_id != report.organization_id:
        return False

    if user.role.value == "ORG_ADMIN":
        if action in ("view", "assign", "generate", "print", "export"):
            return True
        return False

    # Other roles (USER / REPORT_VIEWER): check assignment
    assignment = (
        await db.execute(
            select(CustomReportAssignment)
            .where(CustomReportAssignment.custom_report_id == custom_report_id, CustomReportAssignment.user_id == user.id)
        )
    ).scalar_one_or_none()

    if not assignment:
        return False

    if action in ("view", "generate"):
        return assignment.can_view
    elif action == "print":
        return assignment.can_print
    elif action == "export":
        return assignment.can_export

    return False


@router.get("", response_model=list[CustomReportResponse])
async def list_reports(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List custom reports."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        # Super Admin sees all reports
        result = await db.execute(select(CustomReport).order_by(CustomReport.name))
        return list(result.scalars().all())

    org_id = _org_id(current_user, organization_id)
    reports = await list_custom_reports(db, org_id)

    # Filter for non-admin roles based on assignments
    if current_user.role.value not in ("ORG_ADMIN", "SUPER_ADMIN"):
        allowed = []
        for r in reports:
            if await check_custom_report_access(db, current_user, r.id, "view"):
                allowed.append(r)
        reports = allowed

    return reports


@router.post("", response_model=CustomReportResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: CustomReportCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may create custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    report = await create_custom_report(db, org_id, body)
    await db.commit()
    await db.refresh(report)
    return report



@router.get("/odoo-configured-kpis")
async def get_odoo_configured_kpis(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return all KPIs in the org that have an Odoo config (for Super Admin designer selection)."""
    from app.core.models import KPI, KpiOdooConfig

    org_id = _org_id(current_user, organization_id)

    result = await db.execute(
        select(KPI)
        .join(KpiOdooConfig, KpiOdooConfig.kpi_id == KPI.id)
        .where(KPI.organization_id == org_id)
        .order_by(KPI.name)
    )
    kpis = list(result.scalars().all())
    return [{"id": k.id, "name": k.name} for k in kpis]


@router.get("/{id}", response_model=CustomReportResponse)
async def get_report_metadata(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get custom report metadata."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    report = await get_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return report


@router.get("/{id}/detail")
async def get_report_details(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get custom report with sections and fields (for builder)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    report = await get_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    # Serialize sections and fields
    sections_data = []
    for sec in report.sections:
        fields_data = []
        for f in sec.fields:
            fields_data.append({
                "id": f.id,
                "custom_report_section_id": f.custom_report_section_id,
                "kpi_field_id": f.kpi_field_id,
                "field_key": f.kpi_field.key,
                "field_name": f.kpi_field.name,
                "field_type": f.kpi_field.field_type.value if hasattr(f.kpi_field.field_type, "value") else str(f.kpi_field.field_type),
                "sort_order": f.sort_order,
                "kpi_id": f.kpi_field.kpi_id,
                "config": f.config
            })
        sections_data.append({
            "id": sec.id,
            "kpi_id": sec.kpi_id,
            "kpi_name": sec.kpi.name if sec.kpi else (f"KPI #{sec.kpi_id}" if sec.kpi_id is not None else "Custom Section"),
            "custom_header": sec.custom_header,
            "sort_order": sec.sort_order,
            "fields": fields_data
        })

    # Serialize attachments
    attachments_data = []
    for att in report.attachments:
        attachments_data.append({
            "id": att.id,
            "kpi_id": att.kpi_id,
            "kpi_field_id": att.kpi_field_id,
            "title": att.title,
            "selected_columns": att.selected_columns,
            "filters": att.filters,
            "sort_order": att.sort_order,
            "kpi_name": att.kpi.name if att.kpi else f"KPI #{att.kpi_id}",
            "field_name": att.kpi_field.name if att.kpi_field else f"Field #{att.kpi_field_id}"
        })

    return {
        "id": report.id,
        "organization_id": report.organization_id,
        "name": report.name,
        "description": report.description,
        "report_header_id": report.report_header_id,
        "show_report_name": report.show_report_name,
        "branding_title": report.branding_title,
        "show_odoo_button": report.show_odoo_button,
        "odoo_sync_kpi_ids": report.odoo_sync_kpi_ids or [],
        "sections": sections_data,
        "attachments": attachments_data
    }




@router.patch("/{id}", response_model=CustomReportResponse)
async def update_report_metadata(
    id: int,
    body: CustomReportUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may update custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    report = await update_custom_report(db, id, org_id, body)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    await db.commit()
    await db.refresh(report)
    return report


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may delete custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    ok = await delete_custom_report(db, id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    await db.commit()


@router.post("/{id}/duplicate", response_model=CustomReportResponse)
async def duplicate_report_route(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Duplicate custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may duplicate custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    report = await duplicate_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    await db.commit()
    return report


@router.put("/{id}/layout", status_code=status.HTTP_204_NO_CONTENT)
async def save_layout(
    id: int,
    body: CustomReportLayoutSave,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Save custom report layout (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may edit custom report layouts"
        )
    org_id = _org_id(current_user, organization_id)
    ok = await save_custom_report_layout(
        db, id, org_id, body.sections, body.attachments,
        fetch_data_with_date=body.fetch_data_with_date,
        date_fetching_config=body.date_fetching_config,
        report_header_id=body.report_header_id,
        show_report_name=body.show_report_name,
        branding_title=body.branding_title,
        scalar_bold=body.scalar_bold,
        scalar_font_size=body.scalar_font_size,
        mli_font_size=body.mli_font_size,
        show_odoo_button=body.show_odoo_button,
        odoo_sync_kpi_ids=body.odoo_sync_kpi_ids,
    )

    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    CUSTOM_REPORT_CACHE.invalidate_report(id)
    await db.commit()



async def sync_odoo_data_for_report_internal(
    db: AsyncSession,
    report: CustomReport,
    org_id: int,
    year: int,
    user_id: int,
) -> dict:
    """Internal helper to sync Odoo/LMS data for configured KPIs in a custom report."""
    from app.odoo.config_service import get_org_odoo_config, get_kpi_odoo_config
    from app.odoo.service import (
        odoo_authenticate,
        odoo_fetch_items,
        apply_odoo_field_mappings,
        apply_odoo_sub_field_mappings,
        extract_odoo_attachment_ids,
        store_pre_downloaded_odoo_attachments,
    )
    from app.entries.service import (
        get_or_create_entry,
        mark_entry_modified,
        propagate_formula_recalculations,
    )
    from app.core.models import KPIField, KPI, FieldType
    from sqlalchemy.orm import selectinload

    # 1. Use Super Admin's explicitly configured KPI IDs for sync
    configured_kpi_ids = report.odoo_sync_kpi_ids or []
    if not configured_kpi_ids:
        return {"synced_kpis": 0, "status": "no_kpis"}

    kpi_ids = set(int(k) for k in configured_kpi_ids)

    # 2. Check Odoo org config
    org_odoo = await get_org_odoo_config(db, org_id)
    if not org_odoo:
        return {"synced_kpis": 0, "status": "no_config"}

    synced_kpis = []
    errors = []
    all_synced_entry_ids = set()

    for kpi_id in kpi_ids:
        kpi_odoo = await get_kpi_odoo_config(db, kpi_id)
        if not kpi_odoo:
            continue  # Skip KPIs without Odoo config

        # Load multi_line_items fields for this KPI
        fields_res = await db.execute(
            select(KPIField)
            .join(KPI, KPI.id == KPIField.kpi_id)
            .where(
                KPIField.kpi_id == kpi_id,
                KPI.organization_id == org_id,
                KPIField.field_type == FieldType.multi_line_items,
            )
            .options(selectinload(KPIField.sub_fields))
        )
        ml_fields = list(fields_res.scalars().all())

        odoo_fields = []
        for f in ml_fields:
            cfg = getattr(f, "config", None) or {}
            channel = (cfg.get("multi_items_import_channel") or "").strip().lower()
            if channel == "odoo":
                odoo_fields.append(f)

        if not odoo_fields:
            continue

        # Get or create entry for this KPI/year
        entry, _ = await get_or_create_entry(db, user_id, org_id, kpi_id, year, "")
        if not entry:
            errors.append(f"Could not get/create entry for KPI {kpi_id}")
            continue

        # Authenticate with Odoo (once per KPI)
        try:
            session_id = await odoo_authenticate(org_odoo)
        except ValueError as e:
            errors.append(f"Odoo auth failed for KPI {kpi_id}: {str(e)}")
            continue

        for field in odoo_fields:
            try:
                cfg = getattr(field, "config", None) or {}
                context = {
                    "year": year,
                    "kpi_id": kpi_id,
                    "organization_id": org_id,
                    "entry_id": entry.id,
                    "field_id": field.id,
                    "field_key": field.key,
                }
                raw_items = await odoo_fetch_items(org_odoo, kpi_odoo, session_id, context)

                sub_keys = {s.key for s in (field.sub_fields or [])}
                att_sub_keys = [
                    s.key for s in (field.sub_fields or [])
                    if getattr(s, "field_type", None) in (FieldType.attachment, "attachment")
                ]

                sub_mappings = cfg.get("odoo_sub_field_mappings") or {}
                if isinstance(sub_mappings, dict) and sub_mappings:
                    item_dicts = apply_odoo_sub_field_mappings(raw_items, sub_mappings, sub_keys)
                else:
                    mappings = cfg.get("odoo_field_mappings") or {}
                    if not isinstance(mappings, dict):
                        mappings = {}
                    list_indices_raw = cfg.get("odoo_field_list_indices") or {}
                    list_indices = {}
                    if isinstance(list_indices_raw, dict):
                        for odoo_key, idx in list_indices_raw.items():
                            if isinstance(idx, int):
                                list_indices[str(odoo_key)] = idx
                            elif isinstance(idx, str) and idx.isdigit():
                                list_indices[str(odoo_key)] = int(idx)
                    item_dicts = apply_odoo_field_mappings(raw_items, mappings, sub_keys, list_indices)

                # Filter empty rows
                item_dicts = [
                    dict(x) for x in item_dicts
                    if isinstance(x, dict) and any(
                        v is not None and v != "" and v != 0
                        for k, v in dict(x).items()
                    )
                ]

                # Handle attachments if present
                if att_sub_keys and (org_odoo.attachment_url_template or "").strip():
                    att_template = org_odoo.attachment_url_template.strip()
                    all_att_ids = []
                    for row in item_dicts:
                        for att_key in att_sub_keys:
                            raw_att_val = row.get(att_key)
                            if raw_att_val is not None and raw_att_val != "":
                                all_att_ids.extend(extract_odoo_attachment_ids(raw_att_val))

                    unique_att_ids = list(set(all_att_ids))
                    downloaded_data = {}
                    if unique_att_ids:
                        import httpx
                        import asyncio
                        sem = asyncio.Semaphore(5)
                        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                            async def fetch_one(att_id):
                                async with sem:
                                    target_url = (
                                        att_template.replace("{ATTACHMENT_ID}", str(att_id))
                                        .replace("{attachment_id}", str(att_id))
                                        .replace("__ATTACHMENT_ID__", str(att_id))
                                        .replace("{SESSION_ID}", session_id)
                                        .replace("{session_id}", session_id)
                                        .replace("__SESSION_ID__", session_id)
                                    )
                                    try:
                                        resp = await client.get(target_url, cookies={"session_id": session_id})
                                        if resp.status_code < 200 or resp.status_code >= 300:
                                            return Exception(f"HTTP {resp.status_code}")
                                        return att_id, resp.content, dict(resp.headers)
                                    except Exception as ex:
                                        return Exception(f"Download failed: {ex}")

                            tasks = [fetch_one(aid) for aid in unique_att_ids]
                            results = await asyncio.gather(*tasks, return_exceptions=True)
                            for aid, res in zip(unique_att_ids, results):
                                if isinstance(res, tuple) and len(res) == 3:
                                    downloaded_data[aid] = (res[1], res[2])

                    for row in item_dicts:
                        for att_key in att_sub_keys:
                            raw_att_val = row.get(att_key)
                            if raw_att_val is not None and raw_att_val != "":
                                converted, _ = await store_pre_downloaded_odoo_attachments(
                                    db,
                                    org_id=org_id,
                                    kpi_id=kpi_id,
                                    entry_id=entry.id,
                                    year=year,
                                    user_id=user_id,
                                    raw_attachment_val=raw_att_val,
                                    downloaded_data=downloaded_data,
                                )
                                row[att_key] = converted

                # Replace rows using the entries routes helper
                from app.entries.routes import _replace_multi_line_rows_from_dicts
                await _replace_multi_line_rows_from_dicts(db, entry_id=entry.id, field=field, rows=item_dicts)
                await mark_entry_modified(db, entry, user_id)
                all_synced_entry_ids.add(entry.id)

            except Exception as e:
                import traceback
                traceback.print_exc()
                errors.append(f"Sync failed for KPI {kpi_id} field {field.id}: {str(e)}")

        synced_kpis.append(kpi_id)

    # 5. Propagate formula recalculations for all synced entries
    for entry_id in all_synced_entry_ids:
        await propagate_formula_recalculations(db, entry_id=entry_id, org_id=org_id)

    await db.flush()
    await db.commit()

    # 6. Invalidate report cache
    CUSTOM_REPORT_CACHE.invalidate_report(report.id)

    result = {
        "synced_kpis": len(synced_kpis),
        "synced_kpi_ids": synced_kpis,
        "status": "success",
        "message": "LMS sync completed successfully" if not errors else "LMS sync completed with some errors",
    }
    if errors:
        result["errors"] = errors
    return result


# In-memory dictionary to track the last successful Odoo/LMS sync timestamp per (report_id, year)
# This prevents deadlocks and multiple parallel writes/calls during concurrent page loads/refreshes.
REPORT_LAST_SYNC_TIMES = {}


@router.get("/{id}/generate")
async def generate_report(
    id: int,
    year: str | int | None = Query(None),
    organization_id: int | None = Query(None),
    preview: bool = Query(True),
    include_attachments: bool = Query(True),
    _t: str | None = Query(None),  # cache-buster: when present, skip cache
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate custom report data (with optional preview capping and cache support)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "generate"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    # Fetch report metadata to check show_odoo_button config
    report = await get_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")


    cache_key = (id, org_id, year or "current", "preview" if preview else "full", include_attachments)

    # Skip cache when _t (cache-buster) is present — used after LMS/Odoo sync
    if _t is None:
        cached = CUSTOM_REPORT_CACHE.get(cache_key)
        if cached:
            return cached

    data = await generate_custom_report_data(
        db, id, org_id, year=year, include_drafts=False, preview=preview, include_attachments=include_attachments
    )
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    # Render HTML and attach
    html = await render_custom_report_html(
        db, id, org_id, year=year, include_drafts=False, report_data=data
    )
    if html is not None:
        data["rendered_html"] = html

    CUSTOM_REPORT_CACHE.set(cache_key, data)
    return data




@router.get("/{id}/users", response_model=list[CustomReportAssignmentResponse])
async def list_assignments(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List user assignments (Org Admin / Super Admin)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "assign"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    assignments = await list_custom_report_assignments(db, id)

    out = []
    for a in assignments:
        out.append(
            CustomReportAssignmentResponse(
                id=a.id,
                custom_report_id=a.custom_report_id,
                user_id=a.user_id,
                can_view=a.can_view,
                can_print=a.can_print,
                can_export=a.can_export,
                created_at=a.created_at,
                user_name=a.user.full_name or a.user.username if a.user else None,
                user_role=a.user.role.value if a.user else None,
            )
        )
    return out


@router.post("/{id}/assign", response_model=CustomReportAssignmentResponse)
async def assign_user(
    id: int,
    body: CustomReportAssignmentRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign custom report to user (Org Admin / Super Admin)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "assign"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    perm = await assign_custom_report(
        db, id, body.user_id, can_view=body.can_view, can_print=body.can_print, can_export=body.can_export
    )
    await db.commit()
    await db.refresh(perm)

    # Fetch user for details
    from app.core.models import User
    user = await db.get(User, perm.user_id)

    return CustomReportAssignmentResponse(
        id=perm.id,
        custom_report_id=perm.custom_report_id,
        user_id=perm.user_id,
        can_view=perm.can_view,
        can_print=perm.can_print,
        can_export=perm.can_export,
        created_at=perm.created_at,
        user_name=user.full_name or user.username if user else None,
        user_role=user.role.value if user else None,
    )


@router.delete("/{id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_route(
    id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Unassign custom report from user (Org Admin / Super Admin)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "assign"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    ok = await unassign_custom_report(db, id, user_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    await db.commit()


@router.get("/{id}/export")
async def export_custom_report(
    id: int,
    year: str | int = Query(...),
    format: str = Query("pdf"), # "pdf" | "docx" | "xlsx"
    organization_id: int | None = Query(None),
    attachment_ids: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export custom report as PDF, DOCX, or XLSX (or ZIP for multiple attachments)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "export"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    parsed_att_ids = None
    if attachment_ids:
        parsed_att_ids = [int(x.strip()) for x in attachment_ids.split(",") if x.strip().isdigit()]

    try:
        if parsed_att_ids:
            from app.reports.custom_service import export_custom_report_attachments
            file_bytes, filename, content_type = await export_custom_report_attachments(
                db, id, org_id, year, format, attachment_ids=parsed_att_ids
            )
        else:
            from app.reports.custom_service import export_custom_report_file
            file_bytes, filename, content_type = await export_custom_report_file(
                db, id, org_id, year, format
            )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export report: {str(e)}"
        )

    from fastapi.responses import StreamingResponse
    import io
    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@router.post("/{id}/sync-odoo")

async def sync_odoo_for_custom_report(
    id: int,
    year: int = Query(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Sync Odoo data for all Odoo-configured KPIs in this custom report."""
    from app.odoo.config_service import get_org_odoo_config, get_kpi_odoo_config
    from app.odoo.service import (
        odoo_authenticate,
        odoo_fetch_items,
        apply_odoo_field_mappings,
        apply_odoo_sub_field_mappings,
        extract_odoo_attachment_ids,
        store_pre_downloaded_odoo_attachments,
    )
    from app.entries.service import (
        get_or_create_entry,
        mark_entry_modified,
        propagate_formula_recalculations,
    )
    from app.core.models import KPIField, KPI, KPIEntry, KpiOdooConfig, FieldType
    from sqlalchemy.orm import selectinload
    from sqlalchemy import delete

    org_id = _org_id(current_user, organization_id)

    # 1. Access check
    if not await check_custom_report_access(db, current_user, id, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this custom report")

    report = await get_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    if not report.show_odoo_button:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Odoo sync is not enabled for this report")

    # 2. Sync Odoo data internally
    res = await sync_odoo_data_for_report_internal(db, report, org_id, year, current_user.id)
    if res.get("status") == "no_kpis":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No KPIs configured for Odoo sync. Super Admin must select KPIs in the report designer."
        )
    elif res.get("status") == "no_config":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Odoo/LMS is not configured for this organization"
        )

    # Update last sync time upon manual sync trigger to respect the cooldown
    import time
    REPORT_LAST_SYNC_TIMES[(id, year)] = time.time()

    # Return result
    return {
        "synced_kpis": res["synced_kpis"],
        "synced_kpi_ids": res.get("synced_kpi_ids") or [],
        "message": res["message"],
        "errors": res.get("errors") or []
    }


