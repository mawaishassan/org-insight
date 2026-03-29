"""KPI API routes (Org Admin)."""

import re
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.auth.dependencies import require_org_admin, get_current_user, get_data_export_auth, DataExportAuth
from app.core.models import User, KPI, KpiFile
from app.entries.service import user_can_view_kpi, user_can_edit_kpi, parse_upsert_match_keys_json
from app.kpis.schemas import (
    KPICreate,
    KPIUpdate,
    KPIResponse,
    KPIChildDataSummary,
    KPIApiContract,
    KPIApiContractField,
    KPIAssignUserBody,
    KPIReplaceAssignmentsBody,
    KpiRoleAssignmentItem,
    KpiReplaceRoleAssignmentsBody,
    KPIAssignmentItem,
    KPIReplaceFieldAccessBody,
    KPIReplaceFieldAccessByRoleBody,
    KPIFieldAccessItem,
    KPIReplaceAddRowUsersBody,
    KPIReplaceRowAccessBody,
    KpiRowAccessItem,
    DomainTagRef,
    CategoryTagRef,
    OrganizationTagRef,
    AssignedUserRef,
    AssignedRoleRef,
    UsedInReportRef,
    KpiFileResponse,
)
from app.kpis.service import (
    create_kpi,
    get_kpi,
    get_kpi_with_tags,
    get_kpi_with_tags_by_id,
    list_kpis,
    list_kpis_for_formula_refs,
    list_kpi_data_for_export,
    update_kpi,
    delete_kpi,
    get_kpi_child_data_summary,
    add_kpi_domain,
    remove_kpi_domain,
    add_kpi_category,
    remove_kpi_category,
    list_kpi_assignments,
    assign_user_to_kpi,
    unassign_user_from_kpi,
    replace_kpi_assignments,
    list_kpi_role_assignments,
    replace_kpi_role_assignments,
    get_field_access_for_user,
    replace_field_access,
    get_field_access_for_role,
    replace_field_access_for_role,
    get_add_row_users_for_field,
    replace_add_row_users_for_field,
    get_row_access_for_user,
    replace_row_access,
    get_row_access_by_entry,
    get_full_row_access_users,
    sync_kpi_entry_from_api,
)
from app.users.schemas import UserResponse
from app.fields.service import list_fields as list_kpi_fields
from app.core.models import FieldType
from app.storage.service import upload_file as storage_upload_file, delete_file as storage_delete_file, get_file_stream as storage_get_file_stream

router = APIRouter(prefix="/kpis", tags=["kpis"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


def _kpi_to_response(k):
    """Build KPIResponse. Domain tags come only from categories (single source: attach KPI to category)."""
    category_tags = []
    domain_tags = []
    seen_domain_ids = set()
    for kc in getattr(k, "category_tags", []) or []:
        if kc.category:
            cat = kc.category
            domain_id = getattr(cat, "domain_id", None) or (cat.domain.id if getattr(cat, "domain", None) else None)
            domain_name = (cat.domain.name if getattr(cat, "domain", None) else None)
            category_tags.append(
                CategoryTagRef(id=cat.id, name=cat.name, domain_id=domain_id, domain_name=domain_name)
            )
            if domain_id is not None and domain_id not in seen_domain_ids:
                seen_domain_ids.add(domain_id)
                domain_tags.append(DomainTagRef(id=domain_id, name=domain_name or f"Domain {domain_id}"))
    organization_tags = []
    for kot in getattr(k, "organization_tags", []) or []:
        if getattr(kot, "tag", None):
            organization_tags.append(OrganizationTagRef(id=kot.tag.id, name=kot.tag.name))
    assigned_users = []
    for ka in getattr(k, "assignments", []) or []:
        if getattr(ka, "user", None):
            u = ka.user
            perm = getattr(ka, "assignment_type", None) or "data_entry"
            perm = perm.value if hasattr(perm, "value") else str(perm)
            if perm not in ("data_entry", "view"):
                perm = "data_entry"
            assigned_users.append(
                AssignedUserRef(id=u.id, username=u.username, full_name=u.full_name, permission=perm)
            )
    assigned_roles = []
    for kra in getattr(k, "role_assignments", []) or []:
        role = getattr(kra, "organization_role", None)
        if role is not None:
            perm = getattr(kra, "assignment_type", None) or "data_entry"
            perm = perm.value if hasattr(perm, "value") else str(perm)
            if perm not in ("data_entry", "view"):
                perm = "data_entry"
            assigned_roles.append(
                AssignedRoleRef(id=role.id, name=role.name, permission=perm)
            )
    fields_count = len(getattr(k, "fields", []) or [])
    used_in_reports = []
    for rtk in getattr(k, "report_template_kpis", []) or []:
        rt = getattr(rtk, "report_template", None)
        if rt is not None:
            used_in_reports.append(
                UsedInReportRef(
                    report_id=rt.id,
                    report_name=rt.name,
                    organization_id=rt.organization_id,
                )
            )
    return KPIResponse(
        id=k.id,
        organization_id=k.organization_id,
        domain_id=k.domain_id,
        name=k.name,
        description=k.description,
        year=getattr(k, "year", None),
        sort_order=k.sort_order,
        entry_mode=getattr(k, "entry_mode", None) or "manual",
        api_endpoint_url=getattr(k, "api_endpoint_url", None),
        time_dimension=getattr(k, "time_dimension", None),
        carry_forward_data=getattr(k, "carry_forward_data", False),
        card_display_field_ids=getattr(k, "card_display_field_ids", None) or None,
        fields_count=fields_count,
        domain_tags=domain_tags,
        category_tags=category_tags,
        organization_tags=organization_tags,
        assigned_users=assigned_users,
        assigned_roles=assigned_roles,
        used_in_reports=used_in_reports,
    )


@router.get("/formula-refs")
async def list_kpis_for_formula_refs_api(
    organization_id: int | None = Query(None),
    exclude_kpi_id: int | None = Query(None, description="Exclude this KPI (e.g. current KPI when building formula)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List KPIs in organization with numeric fields only, for KPI_FIELD(kpi_id, field_key) formula references."""
    org_id = _org_id(current_user, organization_id)
    items = await list_kpis_for_formula_refs(db, org_id, exclude_kpi_id=exclude_kpi_id)
    return items


@router.get("", response_model=list[KPIResponse])
async def list_org_kpis(
    organization_id: int | None = Query(None),
    domain_id: int | None = Query(None),
    category_id: int | None = Query(None),
    organization_tag_id: int | None = Query(None, description="Filter KPIs by organization tag"),
    name: str | None = Query(None, description="Filter KPIs by name (partial match)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List KPIs in organization. Filter by domain_id, category_id, organization_tag_id, or name. Data is scoped by year at entry level."""
    org_id = _org_id(current_user, organization_id)
    kpis = await list_kpis(
        db, org_id, domain_id=domain_id, category_id=category_id, organization_tag_id=organization_tag_id, name=name
    )
    return [_kpi_to_response(k) for k in kpis]


@router.get("/data-export")
async def export_kpis_json(
    organization_id: int | None = Query(None),
    year: int | None = Query(None, ge=2000, le=2100),
    db: AsyncSession = Depends(get_db),
    auth: DataExportAuth = Depends(get_data_export_auth),
):
    """
    Export KPI data (definition + fields + values) in JSON format.
    Accepts either (1) JWT Bearer (org admin) or (2) long-lived export API token (organization_id query required).
    """
    if auth.user is not None:
        org_id = _org_id(auth.user, organization_id)
    else:
        if organization_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="organization_id query parameter is required when using an export API token",
            )
        if organization_id != auth.export_org_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Export token is not valid for this organization",
            )
        org_id = organization_id
    items = await list_kpi_data_for_export(db, org_id, year=year)
    return items


@router.post("", response_model=KPIResponse, status_code=status.HTTP_201_CREATED)
async def create_org_kpi(
    body: KPICreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create KPI in domain."""
    org_id = _org_id(current_user, organization_id)
    kpi = await create_kpi(db, org_id, body)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Domain not in organization")
    await db.commit()
    k = await get_kpi_with_tags(db, kpi.id, org_id)
    return _kpi_to_response(k)


@router.get("/{kpi_id}", response_model=KPIResponse)
async def get_org_kpi(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get KPI by id with domain and category tags. Super admin without organization_id gets KPI by id (org resolved from KPI).
    Org admin: full access. Data entry and view users: allowed if they have view or data_entry permission on this KPI (so period bar etc. work on entry page)."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        kpi = await get_kpi_with_tags_by_id(db, kpi_id)
    else:
        org_id = _org_id(current_user, organization_id)
        if current_user.role.value not in ("SUPER_ADMIN", "ORG_ADMIN"):
            can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
            if not can_view:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
        kpi = await get_kpi_with_tags(db, kpi_id, org_id)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return _kpi_to_response(kpi)


@router.patch("/{kpi_id}", response_model=KPIResponse)
async def update_org_kpi(
    kpi_id: int,
    body: KPIUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update KPI."""
    # Only SUPER_ADMIN may control which fields show on domain KPI cards
    if body.card_display_field_ids is not None and current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Super Admin may set KPI card display fields",
        )
    org_id = _org_id(current_user, organization_id)
    kpi = await update_kpi(db, kpi_id, org_id, body)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    await db.commit()
    k = await get_kpi_with_tags(db, kpi_id, org_id)
    return _kpi_to_response(k)


@router.get("/{kpi_id}/child_data_summary", response_model=KPIChildDataSummary)
async def get_kpi_child_data(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return counts of child records (assignments, entries, fields, etc.) for delete confirmation."""
    org_id = _org_id(current_user, organization_id)
    summary = await get_kpi_child_data_summary(db, kpi_id, org_id)
    if summary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return KPIChildDataSummary(**summary)


@router.delete("/{kpi_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_org_kpi(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete KPI and all child records (assignments, entries, fields, stored values, report refs)."""
    org_id = _org_id(current_user, organization_id)
    ok = await delete_kpi(db, kpi_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    await db.commit()


@router.post("/{kpi_id}/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_domain_tag(
    kpi_id: int,
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Associate KPI with an additional domain (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await add_kpi_domain(db, kpi_id, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or domain not found")
    await db.commit()


@router.delete("/{kpi_id}/domains/{domain_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_domain_tag(
    kpi_id: int,
    domain_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove KPI-domain association (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await remove_kpi_domain(db, kpi_id, domain_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cannot remove or not found")
    await db.commit()


@router.post("/{kpi_id}/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def add_category_tag(
    kpi_id: int,
    category_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Associate KPI with a category (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await add_kpi_category(db, kpi_id, category_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or category not found")
    await db.commit()


@router.delete("/{kpi_id}/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_category_tag(
    kpi_id: int,
    category_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove KPI-category association (tag)."""
    org_id = _org_id(current_user, organization_id)
    ok = await remove_kpi_category(db, kpi_id, category_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.get("/{kpi_id}/assignments")
async def list_kpi_assignments_route(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List users assigned to this KPI with permission (data_entry or view). Any user who can view this KPI (assigned or org admin) may list assignments."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
    pairs = await list_kpi_assignments(db, kpi_id, org_id)
    return [
        {"id": u.id, "username": u.username, "full_name": u.full_name, "permission": perm}
        for u, perm in pairs
    ]


@router.post("/{kpi_id}/assignments", status_code=status.HTTP_201_CREATED)
async def assign_user_to_kpi_route(
    kpi_id: int,
    body: KPIAssignUserBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign a user to this KPI so they can add data."""
    org_id = _org_id(current_user, organization_id)
    ok = await assign_user_to_kpi(db, kpi_id, body.user_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or user not found")
    await db.commit()


@router.put("/{kpi_id}/assignments", status_code=status.HTTP_200_OK)
async def replace_kpi_assignments_route(
    kpi_id: int,
    body: KPIReplaceAssignmentsBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Replace all user assignments for this KPI (each with permission: data_entry or view)."""
    org_id = _org_id(current_user, organization_id)
    if body.assignments is not None:
        assignments = [(a.user_id, a.permission) for a in body.assignments]
    elif body.user_ids is not None:
        assignments = [(uid, "data_entry") for uid in body.user_ids]
    else:
        assignments = []
    ok = await replace_kpi_assignments(db, kpi_id, assignments, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or user not found")
    await db.commit()


@router.delete("/{kpi_id}/assignments/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_from_kpi_route(
    kpi_id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove user assignment from this KPI."""
    org_id = _org_id(current_user, organization_id)
    ok = await unassign_user_from_kpi(db, kpi_id, user_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.get("/{kpi_id}/assignments-by-role")
async def list_kpi_assignments_by_role_route(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List roles assigned to this KPI with permission (data_entry or view)."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
    pairs = await list_kpi_role_assignments(db, kpi_id, org_id)
    return [
        {"id": r.id, "name": r.name, "description": getattr(r, "description", None), "permission": perm}
        for r, perm in pairs
    ]


@router.put("/{kpi_id}/assignments-by-role", status_code=status.HTTP_200_OK)
async def replace_kpi_assignments_by_role_route(
    kpi_id: int,
    body: KpiReplaceRoleAssignmentsBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Replace all role assignments for this KPI (each with permission: data_entry or view)."""
    org_id = _org_id(current_user, organization_id)
    assignments = [(a.role_id, a.permission) for a in body.assignments]
    ok = await replace_kpi_role_assignments(db, kpi_id, assignments, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or role not found")
    await db.commit()


@router.get("/{kpi_id}/field-access")
async def get_kpi_field_access_route(
    kpi_id: int,
    user_id: int = Query(..., description="User to get field access for"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List field-level access for a user on this KPI. Org admin or anyone who can view this KPI may call."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
    items = await get_field_access_for_user(db, kpi_id, user_id, org_id)
    return [{"field_id": i["field_id"], "sub_field_id": i["sub_field_id"], "access_type": i["access_type"]} for i in items]


@router.put("/{kpi_id}/field-access", status_code=status.HTTP_200_OK)
async def replace_kpi_field_access_route(
    kpi_id: int,
    body: KPIReplaceFieldAccessBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Replace field-level access for a user on this KPI. When set, user only sees/edits these fields (and sub_fields)."""
    org_id = _org_id(current_user, organization_id)
    accesses = [(a.field_id, a.sub_field_id, a.access_type) for a in body.accesses]
    ok = await replace_field_access(db, kpi_id, body.user_id, org_id, accesses)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or user not found")
    await db.commit()


@router.get("/{kpi_id}/field-access-by-role")
async def get_kpi_field_access_by_role_route(
    kpi_id: int,
    role_id: int = Query(..., description="Organization role to get field access for"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List field-level access for a role on this KPI (multi-line column access). Org admin only."""
    org_id = _org_id(current_user, organization_id)
    items = await get_field_access_for_role(db, kpi_id, role_id, org_id)
    return [{"field_id": i["field_id"], "sub_field_id": i["sub_field_id"], "access_type": i["access_type"]} for i in items]


@router.put("/{kpi_id}/field-access-by-role", status_code=status.HTTP_200_OK)
async def replace_kpi_field_access_by_role_route(
    kpi_id: int,
    body: KPIReplaceFieldAccessByRoleBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Replace field-level access for a role on this KPI. Used for column-level access on multi-line fields. Org admin only."""
    org_id = _org_id(current_user, organization_id)
    accesses = [(a.field_id, a.sub_field_id, a.access_type) for a in body.accesses]
    ok = await replace_field_access_for_role(db, kpi_id, body.role_id, org_id, accesses)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI or role not found")
    await db.commit()


@router.get("/{kpi_id}/add-row-users")
async def get_kpi_add_row_users_route(
    kpi_id: int,
    field_id: int = Query(..., description="Multi-line items field ID"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List users who can add rows for this multi-line field. Org admin only."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
    return await get_add_row_users_for_field(db, kpi_id, field_id, org_id)


@router.put("/{kpi_id}/add-row-users", status_code=status.HTTP_200_OK)
async def replace_kpi_add_row_users_route(
    kpi_id: int,
    body: KPIReplaceAddRowUsersBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Replace add_row users list for a multi-line field. Org admin only."""
    org_id = _org_id(current_user, organization_id)
    ok = await replace_add_row_users_for_field(db, kpi_id, body.field_id, body.user_ids, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI, field, or users not found")
    await db.commit()


@router.get("/{kpi_id}/row-access-by-entry")
async def get_kpi_row_access_by_entry_route(
    kpi_id: int,
    entry_id: int = Query(..., description="Entry (year/period)"),
    field_id: int = Query(..., description="Multi-line items field ID"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List row-level access grouped by row for an entry+field. Returns actual rows with preview and users assigned to each."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
    items = await get_row_access_by_entry(db, entry_id, field_id, org_id)
    return items


@router.get("/{kpi_id}/row-access")
async def get_kpi_row_access_route(
    kpi_id: int,
    user_id: int = Query(..., description="User to get row access for"),
    entry_id: int = Query(..., description="Entry (year/period)"),
    field_id: int = Query(..., description="Multi-line items field ID"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List record-level access for a user on an entry+field (multi_line_items)."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
    items = await get_row_access_for_user(db, user_id, entry_id, field_id)
    return [{"row_index": i["row_index"], "can_edit": i["can_edit"], "can_delete": i["can_delete"]} for i in items]


@router.put("/{kpi_id}/row-access", status_code=status.HTTP_200_OK)
async def replace_kpi_row_access_route(
    kpi_id: int,
    body: KPIReplaceRowAccessBody,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Replace record-level access for a user on an entry+field (multi_line_items)."""
    org_id = _org_id(current_user, organization_id)
    rows = [(r.row_index, r.can_edit, r.can_delete) for r in body.rows]
    ok = await replace_row_access(db, body.user_id, body.entry_id, body.field_id, org_id, rows)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="KPI, entry, field (multi_line_items), or user not found",
        )
    await db.commit()


@router.get("/{kpi_id}/row-access-full-users")
async def get_kpi_row_access_full_users_route(
    kpi_id: int,
    entry_id: int = Query(..., description="Entry (year/period)"),
    field_id: int = Query(..., description="Multi-line items field ID"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List users who currently have full access to all rows for an entry+multi-line field."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this KPI")
    return await get_full_row_access_users(db, entry_id, field_id, org_id)


def _field_type_str(f) -> str:
    """Normalize field type to lowercase string for consistent comparison."""
    ft = getattr(f, "field_type", None)
    if hasattr(ft, "value"):
        ft = ft.value if ft else "single_line_text"
    else:
        ft = str(ft) if ft else "single_line_text"
    return (ft or "single_line_text").lower()


def _example_value_for_field(f) -> str | int | float | bool | list[dict] | None:
    """Return a concrete example value for API contract by field type. f is KPIField."""
    ft = _field_type_str(f)
    if ft == "formula":
        return None
    if ft == "number":
        return 100
    if ft == "boolean":
        return 1  # API may send 1 or 0
    if ft == "date":
        return "2025-01-15"
    if ft == "multi_line_items":
        sub_fields = getattr(f, "sub_fields", None) or []
        sub_keys = [getattr(s, "key", f"col_{i}") for i, s in enumerate(sub_fields)]
        if not sub_keys:
            sub_keys = ["item_name", "quantity"]
        # Example: list of row objects; each row has all sub_keys with sample values
        numeric_types = {"number"}
        sub_types = {}
        for s in sub_fields:
            st = getattr(getattr(s, "field_type", None), "value", None) or str(getattr(s, "field_type", "single_line_text"))
            sub_types[getattr(s, "key", "")] = st in numeric_types
        rows = []
        for row_idx in range(2):
            row = {}
            for k in sub_keys:
                if sub_types.get(k, False):
                    row[k] = 85 + row_idx * 5
                else:
                    row[k] = ("Alice", "Bob")[row_idx]
            rows.append(row)
        return rows
    # single_line_text, multi_line_text
    return "Example text" if ft == "single_line_text" else "First paragraph.\n\nSecond paragraph."


@router.get("/{kpi_id}/api-contract", response_model=KPIApiContract)
async def get_kpi_api_contract(
    kpi_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return the operation contract for API entry mode: request we send and response we expect."""
    org_id = _org_id(current_user, organization_id)
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    fields_orm = await list_kpi_fields(db, kpi_id, org_id)
    contract_fields: list[KPIApiContractField] = []
    example_values: dict = {}
    for f in fields_orm:
        ft_str = _field_type_str(f)
        sub_keys = []
        if ft_str == "multi_line_items":
            for s in getattr(f, "sub_fields", None) or []:
                sub_keys.append(getattr(s, "key", ""))
        ex = _example_value_for_field(f)  # None for formula
        accepted_hint = "true, false, 1, or 0" if ft_str == "boolean" else None
        contract_fields.append(
            KPIApiContractField(
                key=f.key,
                name=f.name,
                field_type=ft_str,
                sub_field_keys=sub_keys,
                example_value=ex,
                accepted_value_hint=accepted_hint,
            )
        )
        # Only non-formula fields go in response values (API must not send formula; we compute it)
        if ft_str != "formula":
            example_values[f.key] = ex
    example_year = 2025
    return KPIApiContract(
        example_request_body={
            "year": example_year,
            "kpi_id": kpi_id,
            "organization_id": org_id,
        },
        fields=contract_fields,
        example_response={
            "year": example_year,
            "values": example_values,
        },
    )


@router.post("/{kpi_id}/sync-from-api")
async def sync_kpi_from_api_route(
    kpi_id: int,
    year: int = Query(..., ge=2000, le=2100),
    organization_id: int | None = Query(None),
    sync_mode: str = Query(
        "override",
        description="override = replace multi-line rows; append = append rows; upsert = merge by upsert_match_keys",
        pattern="^(override|append|upsert)$",
    ),
    upsert_match_keys: str | None = Query(
        None,
        description="JSON: multi_line field key -> sub_field key (required for each multi-line table when sync_mode=upsert)",
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Call the KPI's API endpoint to fetch entry data for the given year and apply it. UI sync_mode wins; API override_existing is ignored."""
    org_id = _org_id(current_user, organization_id)
    parsed = parse_upsert_match_keys_json(upsert_match_keys)
    result = await sync_kpi_entry_from_api(
        db,
        kpi_id,
        org_id,
        year,
        current_user.id,
        sync_mode=sync_mode,
        upsert_match_keys=parsed,
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="KPI not found, not in API mode, API endpoint not set, or API call failed",
        )
    await db.commit()
    return result


def _safe_filename(name: str) -> str:
    """Keep only safe chars and avoid path traversal."""
    name = re.sub(r"[^\w.\- ]", "_", name).strip() or "file"
    return name[:200]


@router.get("/{kpi_id}/files", response_model=list[KpiFileResponse])
async def list_kpi_files(
    kpi_id: int,
    year: int | None = Query(None, description="Filter by year"),
    entry_id: int | None = Query(None, description="Filter by entry"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List file attachments for a KPI. Auth: Org Admin or user with view/data_entry for this KPI."""
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this KPI")
    res = await db.execute(select(KPI).where(KPI.id == kpi_id))
    kpi = res.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    org_id = kpi.organization_id
    q = select(KpiFile).where(KpiFile.kpi_id == kpi_id, KpiFile.organization_id == org_id)
    if year is not None:
        q = q.where(KpiFile.year == year)
    # When entry_id is provided, return files specifically tied to that entry (row- or entry-level).
    # When entry_id is not provided, only return KPI-level attachments (entry_id IS NULL) so
    # row-level uploads (like multi-line sub-field attachments) are not shown in the KPI-level list.
    if entry_id is not None:
        q = q.where(KpiFile.entry_id == entry_id)
    else:
        q = q.where(KpiFile.entry_id.is_(None))
    q = q.order_by(KpiFile.created_at.desc())
    result = await db.execute(q)
    files = result.scalars().all()
    return [
        KpiFileResponse(
            id=f.id,
            original_filename=f.original_filename,
            size=f.size,
            content_type=f.content_type,
            created_at=f.created_at.isoformat() + "Z" if f.created_at else "",
            download_url=f"/api/kpis/{kpi_id}/files/{f.id}/download",
        )
        for f in files
    ]


@router.post("/{kpi_id}/files", response_model=list[KpiFileResponse], status_code=status.HTTP_201_CREATED)
async def upload_kpi_files(
    kpi_id: int,
    files: list[UploadFile] = File(...),
    year: int | None = Form(None, ge=2000, le=2100),
    entry_id: int | None = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload one or more files for a KPI. Auth: Org Admin or data_entry for this KPI."""
    can_edit = await user_can_edit_kpi(db, current_user.id, kpi_id)
    if not can_edit:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No edit access to this KPI")
    res = await db.execute(select(KPI).where(KPI.id == kpi_id))
    kpi = res.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    org_id = kpi.organization_id
    year_val = year if year is not None else getattr(kpi, "year", None)
    if year_val is None:
        year_val = datetime.utcnow().year
    stored: list[KpiFile] = []
    for uf in files:
        if not uf.filename:
            continue
        content = await uf.read()
        content_type = uf.content_type or "application/octet-stream"
        base_name = _safe_filename(uf.filename)
        unique = f"{base_name}_{uuid.uuid4().hex[:8]}"
        relative_path = f"org_{org_id}/kpi_{kpi_id}/year_{year_val}/{unique}"
        try:
            stored_path = await storage_upload_file(db, org_id, relative_path, content, content_type)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Storage error: {e!s}",
            )
        kf = KpiFile(
            kpi_id=kpi_id,
            organization_id=org_id,
            year=year_val,
            entry_id=entry_id,
            original_filename=uf.filename[:512],
            stored_path=stored_path,
            content_type=content_type[:255] if content_type else None,
            size=len(content),
            uploaded_by_user_id=current_user.id,
        )
        db.add(kf)
        await db.flush()
        stored.append(kf)
    await db.commit()
    return [
        KpiFileResponse(
            id=f.id,
            original_filename=f.original_filename,
            size=f.size,
            content_type=f.content_type,
            created_at=f.created_at.isoformat() + "Z" if f.created_at else "",
            download_url=f"/api/kpis/{kpi_id}/files/{f.id}/download",
        )
        for f in stored
    ]


@router.get("/{kpi_id}/files/{file_id}/download")
async def download_kpi_file(
    kpi_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream file content. Auth: Org Admin or user with view/data_entry for this KPI."""
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this KPI")
    res = await db.execute(
        select(KpiFile).where(KpiFile.id == file_id, KpiFile.kpi_id == kpi_id)
    )
    kf = res.scalar_one_or_none()
    if not kf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    try:
        data = await storage_get_file_stream(db, kf.organization_id, kf.stored_path)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found in storage")
    return StreamingResponse(
        iter([data]),
        media_type=kf.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{kf.original_filename}"'},
    )


@router.delete("/{kpi_id}/files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_kpi_file(
    kpi_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a KPI file. Auth: Org Admin or uploader (or data_entry for this KPI)."""
    can_edit = await user_can_edit_kpi(db, current_user.id, kpi_id)
    res = await db.execute(
        select(KpiFile).where(KpiFile.id == file_id, KpiFile.kpi_id == kpi_id)
    )
    kf = res.scalar_one_or_none()
    if not kf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")
    if not can_edit and current_user.id != kf.uploaded_by_user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No permission to delete this file")
    try:
        await storage_delete_file(db, kf.organization_id, kf.stored_path)
    except Exception:
        pass
    await db.delete(kf)
    await db.commit()
