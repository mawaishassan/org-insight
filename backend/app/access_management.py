from __future__ import annotations

import sys
import logging
from datetime import datetime
from typing import Any, Literal
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, and_, or_, desc, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, aliased

from app.core.database import get_db
from app.core.models import (
    User,
    ExternalUser,
    Organization,
    Dashboard,
    DashboardAccessPermission,
    CustomReport,
    CustomReportSection,
    CustomReportField,
    CustomReportAssignment,
    ReportUserFilterConfiguration,
    ReportTemplate,
    ReportTemplateKPI,
    ReportAccessPermission,
    KPI,
    KPIField,
    KPIFieldSubField,
    FieldType,
    AccessManagementAudit,
)
from app.auth.dependencies import require_org_admin, get_current_user

logger = logging.getLogger(__name__)


def invalidate_all_access_and_report_caches(db: AsyncSession | None = None) -> None:
    """Invalidate all server-side caches for widget data, custom reports, and DB session info.

    Must be called AFTER db.commit() so caches are not repopulated from the old DB state
    by concurrent requests in the window between cache clear and commit.
    """
    # 1. Widget (dashboard) data cache
    try:
        from app.widget_data.service import invalidate_all_widget_caches
        invalidate_all_widget_caches()
    except Exception as e:
        logger.warning(f"Failed to invalidate widget caches: {e}")

    # 2. Auth LRU cache (30-second TTL — must be cleared so new permission takes effect immediately)
    try:
        from app.widget_data.service import invalidate_auth_cache
        invalidate_auth_cache()
    except Exception as e:
        logger.warning(f"Failed to invalidate auth cache: {e}")

    # 3. Custom report data cache
    try:
        from app.reports.custom_service import CUSTOM_REPORT_CACHE
        CUSTOM_REPORT_CACHE.invalidate_all()
    except Exception as e:
        logger.warning(f"Failed to invalidate custom report cache: {e}")

    # 4. Standard report data cache
    try:
        from app.reports.service import REPORT_DATA_CACHE
        REPORT_DATA_CACHE.clear()
    except Exception as e:
        logger.warning(f"Failed to invalidate standard report cache: {e}")

    # 5. Per-request DB session cache
    if db is not None and hasattr(db, "info"):
        try:
            db.info.clear()
        except Exception:
            pass



# ===========================================================================
# SECTION 1: SCHEMAS & TYPE DEFINITIONS
# ===========================================================================

ResourceType = Literal["dashboard", "report", "custom_report"]
AccessType = Literal["full", "unique_key"]
UserTypeFilter = Literal["all", "internal", "external"]
ResourceTypeFilter = Literal["all", "dashboard", "report"]
AccessTypeFilter = Literal["all", "full", "unique_key"]
StatusFilter = Literal["all", "active", "inactive"]


class RightItemResponse(BaseModel):
    id: int
    resource_type: ResourceType
    resource_id: int
    resource_name: str
    user_id: int
    user_name: str
    username: str
    user_email: str | None = None
    user_type: Literal["internal", "external"]
    user_unique_key: str | None = None
    access_type: AccessType
    restriction_summary: str
    is_active: bool
    can_view: bool = True
    can_edit: bool = False
    can_print: bool = False
    can_export: bool = False
    can_download_word: bool = False
    can_change_period: bool = False
    can_load_lms: bool = False
    can_download_widget_pdf: bool = True
    can_view_drilldown: bool = True
    filter_column_configs: dict[str, Any] | None = None
    filter_sub_field_key: str | None = None
    filter_kpi_id: int | None = None
    filter_mli_id: int | None = None
    created_at: datetime | None = None


class RightsListResponse(BaseModel):
    items: list[RightItemResponse]
    total: int
    page: int
    page_size: int
    total_pages: int
    active_count: int
    inactive_count: int
    full_access_count: int
    unique_key_count: int


class BulkAssignRequest(BaseModel):
    user_ids: list[int]
    dashboard_ids: list[int] = Field(default_factory=list)
    custom_report_ids: list[int] = Field(default_factory=list)
    report_template_ids: list[int] = Field(default_factory=list)
    access_type: AccessType = "full"
    can_view: bool = True
    can_edit: bool = False
    can_print: bool = False
    can_export: bool = False
    can_download_word: bool = False
    can_change_period: bool = False
    can_change_period_dashboards: bool | None = None
    can_change_period_reports: bool | None = None
    can_load_lms: bool = False
    can_download_widget_pdf: bool = True
    can_view_drilldown: bool = True
    filter_kpi_id: int | None = None
    filter_mli_id: int | None = None
    filter_sub_field_key: str | None = None
    filter_column_configs: dict[str, str] | None = None
    filter_operator: str = "="


class BulkAssignPreviewResponse(BaseModel):
    users_count: int
    dashboards_count: int
    reports_count: int
    total_targets: int
    new_assignments_count: int
    existing_assignments_count: int
    rights_to_update_count: int
    no_changes_count: int
    access_type: AccessType
    restriction_preview: str | None = None


class BulkAssignResultResponse(BaseModel):
    message: str
    created_count: int
    updated_count: int
    unchanged_count: int
    failed_count: int
    failed_items: list[dict[str, Any]] = Field(default_factory=list)


class RightUpdatePayload(BaseModel):
    access_type: AccessType | None = None
    is_active: bool | None = None
    can_view: bool | None = None
    can_edit: bool | None = None
    can_print: bool | None = None
    can_export: bool | None = None
    can_download_word: bool | None = None
    can_change_period: bool | None = None
    can_load_lms: bool | None = None
    can_download_widget_pdf: bool | None = None
    can_view_drilldown: bool | None = None
    filter_kpi_id: int | None = None
    filter_mli_id: int | None = None
    filter_sub_field_key: str | None = None
    filter_column_configs: dict[str, str] | None = None
    filter_operator: str | None = None


class BulkTargetItem(BaseModel):
    permission_id: int
    resource_type: ResourceType
    user_id: int
    resource_id: int


class BulkUpdateRightsRequest(BaseModel):
    items: list[BulkTargetItem]
    action: Literal["set_full_access", "set_unique_key", "activate", "deactivate"]
    filter_column_configs: dict[str, str] | None = None
    filter_sub_field_key: str | None = None


class BulkRevokeRightsRequest(BaseModel):
    items: list[BulkTargetItem]


class UserAssignedResource(BaseModel):
    permission_id: int
    resource_type: ResourceType
    resource_id: int
    resource_name: str
    access_type: AccessType
    restriction_summary: str
    is_active: bool
    can_view: bool
    can_edit: bool
    can_print: bool
    can_export: bool
    can_download_word: bool
    can_change_period: bool
    can_load_lms: bool
    can_download_widget_pdf: bool = True
    can_view_drilldown: bool = True
    is_default: bool = False


class UserRightsSummaryResponse(BaseModel):
    user_id: int
    username: str
    full_name: str | None = None
    email: str | None = None
    role: str
    is_external: bool
    unique_user_key: str | None = None
    dashboards: list[UserAssignedResource] = Field(default_factory=list)
    reports: list[UserAssignedResource] = Field(default_factory=list)
    default_dashboard_id: int | None = None


class SetUserDefaultDashboardRequest(BaseModel):
    dashboard_id: int | None = None


class ResourceAssignedUser(BaseModel):
    permission_id: int
    user_id: int
    username: str
    full_name: str | None = None
    email: str | None = None
    role: str
    is_external: bool
    unique_user_key: str | None = None
    access_type: AccessType
    restriction_summary: str
    is_active: bool
    can_view: bool
    can_edit: bool
    can_print: bool
    can_export: bool
    can_change_period: bool
    can_load_lms: bool
    can_download_word: bool = False
    can_download_widget_pdf: bool = True
    can_view_drilldown: bool = True


class ResourceRightsSummaryResponse(BaseModel):
    resource_type: ResourceType
    resource_id: int
    resource_name: str
    assigned_users: list[ResourceAssignedUser] = Field(default_factory=list)


class FilterableColumnItem(BaseModel):
    kpi_id: int
    kpi_title: str
    mli_id: int
    mli_title: str
    sub_field_id: int
    sub_field_key: str
    label: str
    column_name: str | None = None


class AuditLogItemResponse(BaseModel):
    id: int
    organization_id: int
    user_id: int
    username: str
    user_full_name: str | None = None
    resource_type: str
    resource_id: int
    resource_name: str | None = None
    action: str
    previous_access: dict[str, Any] | None = None
    new_access: dict[str, Any] | None = None
    previous_config: dict[str, Any] | None = None
    new_config: dict[str, Any] | None = None
    changed_by_id: int | None = None
    changed_by_name: str | None = None
    created_at: datetime


class AuditLogListResponse(BaseModel):
    items: list[AuditLogItemResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# ===========================================================================
# SECTION 2: AUDIT HELPERS
# ===========================================================================

async def record_rights_audit(
    db: AsyncSession,
    *,
    organization_id: int,
    user_id: int,
    resource_type: str,
    resource_id: int,
    resource_name: str | None = None,
    action: str,
    previous_access: dict[str, Any] | None = None,
    new_access: dict[str, Any] | None = None,
    previous_config: dict[str, Any] | None = None,
    new_config: dict[str, Any] | None = None,
    changed_by_id: int | None = None,
) -> AccessManagementAudit:
    """Record an audit trail event for rights creation, modification, or revocation."""
    audit_entry = AccessManagementAudit(
        organization_id=organization_id,
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        resource_name=resource_name,
        action=action.upper(),
        previous_access=previous_access,
        new_access=new_access,
        previous_config=previous_config,
        new_config=new_config,
        changed_by_id=changed_by_id,
    )
    db.add(audit_entry)
    await db.flush()
    return audit_entry


async def list_rights_audit_logs(
    db: AsyncSession,
    organization_id: int,
    *,
    page: int = 1,
    page_size: int = 25,
    user_id: int | None = None,
    resource_type: str | None = None,
    resource_id: int | None = None,
    action: str | None = None,
    search: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    """Query audit logs with joins and filters."""
    TargetUser = User
    AdminUser = aliased(User)

    stmt = (
        select(AccessManagementAudit, TargetUser, AdminUser)
        .join(TargetUser, AccessManagementAudit.user_id == TargetUser.id)
        .outerjoin(AdminUser, AccessManagementAudit.changed_by_id == AdminUser.id)
        .where(AccessManagementAudit.organization_id == organization_id)
    )

    if user_id:
        stmt = stmt.where(AccessManagementAudit.user_id == user_id)
    if resource_type and resource_type != "all":
        stmt = stmt.where(AccessManagementAudit.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AccessManagementAudit.resource_id == resource_id)
    if action and action != "all":
        act = action.strip().upper()
        action_mapping = {
            "ASSIGNED": ["ASSIGNED"],
            "ASSIGN": ["ASSIGNED"],
            "BULK_ASSIGN": ["ASSIGNED"],
            "UPDATED": ["UPDATED"],
            "UPDATE": ["UPDATED"],
            "BULK_UPDATE": ["UPDATED"],
            "REVOKED": ["REVOKED"],
            "REVOKE": ["REVOKED"],
            "BULK_REVOKE": ["REVOKED"],
            "ACTIVATED": ["ACTIVATED"],
            "ACTIVATE": ["ACTIVATED"],
            "DEACTIVATED": ["DEACTIVATED"],
            "DEACTIVATE": ["DEACTIVATED"],
        }
        target_actions = action_mapping.get(act, [act])
        stmt = stmt.where(AccessManagementAudit.action.in_(target_actions))

    if search:
        q = f"%{search.strip().lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(TargetUser.username).like(q),
                func.lower(func.coalesce(TargetUser.full_name, "")).like(q),
                func.lower(func.coalesce(AdminUser.username, "")).like(q),
                func.lower(func.coalesce(AdminUser.full_name, "")).like(q),
                func.lower(func.coalesce(AccessManagementAudit.resource_name, "")).like(q),
                func.lower(AccessManagementAudit.action).like(q),
            )
        )

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar() or 0

    offset = max(0, (page - 1) * page_size)
    stmt = stmt.order_by(desc(AccessManagementAudit.created_at)).offset(offset).limit(page_size)

    rows = (await db.execute(stmt)).all()
    results = []
    for audit, target_u, admin_u in rows:
        results.append(
            {
                "id": audit.id,
                "organization_id": audit.organization_id,
                "user_id": audit.user_id,
                "username": target_u.username,
                "user_full_name": target_u.full_name,
                "resource_type": audit.resource_type,
                "resource_id": audit.resource_id,
                "resource_name": audit.resource_name,
                "action": audit.action,
                "previous_access": audit.previous_access,
                "new_access": audit.new_access,
                "previous_config": audit.previous_config,
                "new_config": audit.new_config,
                "changed_by_id": audit.changed_by_id,
                "changed_by_name": admin_u.full_name or admin_u.username if admin_u else None,
                "created_at": audit.created_at,
            }
        )

    return results, total


# ===========================================================================
# SECTION 3: PERMISSION RESOLUTION HELPERS
# ===========================================================================

def is_permission_active(perm: Any) -> bool:
    """Check if a permission record is explicitly active."""
    return getattr(perm, "is_active", True) is not False


def resolve_effective_access_label(
    access_type: str,
    filter_sub_field_key: str | None = None,
    filter_column_configs: dict[str, Any] | None = None,
    user_unique_key: str | None = None,
) -> str:
    """Return a human-readable effective access description for the Admin."""
    if access_type != "unique_key":
        return "Full Access"

    columns = []
    if filter_column_configs and isinstance(filter_column_configs, dict):
        for _grp, col_name in filter_column_configs.items():
            if col_name and str(col_name).strip():
                clean_col = str(col_name).strip()
                if clean_col not in columns:
                    columns.append(clean_col)

    if filter_sub_field_key and str(filter_sub_field_key).strip():
        k = str(filter_sub_field_key).strip()
        if k not in columns:
            columns.append(k)

    if not columns:
        return "Unique-Key Restricted"

    cols_str = ", ".join(columns)
    if user_unique_key:
        return f"Unique-Key ({cols_str} = '{user_unique_key}')"
    return f"Unique-Key ({cols_str})"


# ===========================================================================
# SECTION 4: CORE RIGHTS SERVICE OPERATIONS
# ===========================================================================

async def list_unified_rights(
    db: AsyncSession,
    organization_id: int,
    *,
    page: int = 1,
    page_size: int = 25,
    user_type: str = "all",
    resource_type: str = "all",
    access_type: str = "all",
    status: str = "all",
    search: str | None = None,
    user_id: int | None = None,
    resource_id: int | None = None,
) -> tuple[list[dict[str, Any]], int, dict[str, int]]:
    """Retrieve all rights across Dashboards and Reports with unified schema."""
    items: list[dict[str, Any]] = []

    ext_user_ids = set((await db.execute(select(ExternalUser.user_id))).scalars().all())

    # 1. Dashboards Permissions
    if resource_type in ("all", "dashboard"):
        stmt_d = (
            select(DashboardAccessPermission, Dashboard, User)
            .join(Dashboard, DashboardAccessPermission.dashboard_id == Dashboard.id)
            .join(User, DashboardAccessPermission.user_id == User.id)
            .where(Dashboard.organization_id == organization_id, User.organization_id == organization_id)
        )
        if user_id:
            stmt_d = stmt_d.where(DashboardAccessPermission.user_id == user_id)
        if resource_id and resource_type == "dashboard":
            stmt_d = stmt_d.where(DashboardAccessPermission.dashboard_id == resource_id)

        d_rows = (await db.execute(stmt_d)).all()
        for perm, dash, user in d_rows:
            is_ext = user.id in ext_user_ids or bool(getattr(user, "is_external", False))
            u_key = getattr(user, "unique_user_key", None)
            is_unique = bool(getattr(perm, "can_use_unique_value", False))
            acc_type = "unique_key" if is_unique else "full"
            active = getattr(perm, "is_active", True) is not False

            items.append(
                {
                    "id": perm.id,
                    "resource_type": "dashboard",
                    "resource_id": dash.id,
                    "resource_name": dash.name,
                    "user_id": user.id,
                    "user_name": user.full_name or user.username,
                    "username": user.username,
                    "user_email": user.email,
                    "user_type": "external" if is_ext else "internal",
                    "user_unique_key": u_key,
                    "access_type": acc_type,
                    "restriction_summary": resolve_effective_access_label(
                        acc_type,
                        getattr(perm, "filter_sub_field_key", None),
                        getattr(perm, "filter_column_configs", None),
                        u_key,
                    ),
                    "is_active": active,
                    "can_view": perm.can_view,
                    "can_edit": perm.can_edit,
                    "can_print": False,
                    "can_export": False,
                    "can_download_word": False,
                    "can_change_period": getattr(perm, "can_change_period", False),
                    "can_load_lms": getattr(perm, "can_load_lms", False),
                    "can_download_widget_pdf": getattr(perm, "can_download_widget_pdf", True),
                    "can_view_drilldown": getattr(perm, "can_view_drilldown", True),
                    "filter_column_configs": getattr(perm, "filter_column_configs", None),
                    "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
                    "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
                    "filter_mli_id": getattr(perm, "filter_mli_id", None),
                    "created_at": perm.created_at,
                }
            )

    # 2. Custom Reports Permissions
    if resource_type in ("all", "report"):
        stmt_cr = (
            select(CustomReportAssignment, CustomReport, User)
            .join(CustomReport, CustomReportAssignment.custom_report_id == CustomReport.id)
            .join(User, CustomReportAssignment.user_id == User.id)
            .where(CustomReport.organization_id == organization_id, User.organization_id == organization_id)
        )
        if user_id:
            stmt_cr = stmt_cr.where(CustomReportAssignment.user_id == user_id)
        if resource_id and resource_type == "report":
            stmt_cr = stmt_cr.where(CustomReportAssignment.custom_report_id == resource_id)

        cr_rows = (await db.execute(stmt_cr)).all()
        cr_ids = {cr.id for _, cr, _ in cr_rows}
        filter_cfg_by_report: dict[int, ReportUserFilterConfiguration] = {}
        if cr_ids:
            cfg_res = await db.execute(
                select(ReportUserFilterConfiguration)
                .options(selectinload(ReportUserFilterConfiguration.sub_field))
                .where(
                    ReportUserFilterConfiguration.report_id.in_(cr_ids),
                    ReportUserFilterConfiguration.enabled == True,
                )
            )
            for c in cfg_res.scalars().all():
                filter_cfg_by_report[c.report_id] = c

        for perm, cr, user in cr_rows:
            is_ext = user.id in ext_user_ids or bool(getattr(user, "is_external", False))
            u_key = getattr(user, "unique_user_key", None)
            is_unique = bool(getattr(perm, "can_use_unique_value", False))
            f_cfg = filter_cfg_by_report.get(cr.id)

            acc_type = "unique_key" if is_unique else "full"
            active = getattr(perm, "is_active", True) is not False

            sub_k = getattr(perm, "filter_sub_field_key", None) if is_unique else None
            sub_k_key = sub_k
            filter_cfg_dict = getattr(perm, "filter_column_configs", None) if is_unique else None
            perm_filter_kpi_id = getattr(perm, "filter_kpi_id", None) if is_unique else None
            perm_filter_mli_id = getattr(perm, "filter_mli_id", None) if is_unique else None

            if is_unique:
                if not sub_k and f_cfg:
                    if f_cfg.sub_field:
                        sub_k = (f_cfg.sub_field.name or f_cfg.sub_field.key).strip()
                        sub_k_key = f_cfg.sub_field.key or sub_k
                    elif f_cfg.field_id:
                        sub_k = f"Field #{f_cfg.field_id}"
                        sub_k_key = sub_k

                if not filter_cfg_dict and f_cfg and f_cfg.enabled and f_cfg.kpi_id and f_cfg.mli_id and (sub_k_key or sub_k):
                    filter_cfg_dict = {f"{f_cfg.kpi_id}_{f_cfg.mli_id}": sub_k_key or sub_k}

                if perm_filter_kpi_id is None and f_cfg:
                    perm_filter_kpi_id = getattr(f_cfg, "kpi_id", None)
                if perm_filter_mli_id is None and f_cfg:
                    perm_filter_mli_id = getattr(f_cfg, "mli_id", None)

            items.append(
                {
                    "id": perm.id,
                    "resource_type": "custom_report",
                    "resource_id": cr.id,
                    "resource_name": cr.name,
                    "user_id": user.id,
                    "user_name": user.full_name or user.username,
                    "username": user.username,
                    "user_email": user.email,
                    "user_type": "external" if is_ext else "internal",
                    "user_unique_key": u_key,
                    "access_type": acc_type,
                    "restriction_summary": resolve_effective_access_label(
                        acc_type, sub_k, filter_cfg_dict, u_key
                    ),
                    "is_active": active,
                    "can_view": perm.can_view,
                    "can_edit": False,
                    "can_print": getattr(perm, "can_print", False),
                    "can_export": getattr(perm, "can_export", False),
                    "can_download_word": getattr(perm, "can_download_word", False),
                    "can_change_period": getattr(perm, "can_change_period", False),
                    "can_load_lms": getattr(perm, "can_load_lms", False),
                    "filter_column_configs": filter_cfg_dict,
                    "filter_sub_field_key": sub_k_key or sub_k,
                    "filter_kpi_id": perm_filter_kpi_id,
                    "filter_mli_id": perm_filter_mli_id,
                    "created_at": perm.created_at,
                }
            )

    # 3. Standard Reports
    if resource_type in ("all", "report"):
        stmt_rt = (
            select(ReportAccessPermission, ReportTemplate, User)
            .join(ReportTemplate, ReportAccessPermission.report_template_id == ReportTemplate.id)
            .join(User, ReportAccessPermission.user_id == User.id)
            .where(ReportTemplate.organization_id == organization_id, User.organization_id == organization_id)
        )
        if user_id:
            stmt_rt = stmt_rt.where(ReportAccessPermission.user_id == user_id)
        if resource_id and resource_type == "report":
            stmt_rt = stmt_rt.where(ReportAccessPermission.report_template_id == resource_id)

        rt_rows = (await db.execute(stmt_rt)).all()
        for perm, rt, user in rt_rows:
            is_ext = user.id in ext_user_ids or bool(getattr(user, "is_external", False))
            u_key = getattr(user, "unique_user_key", None)
            active = getattr(perm, "is_active", True) is not False
            is_unique = bool(getattr(perm, "can_use_unique_value", False))
            acc_type = "unique_key" if is_unique else "full"
            sub_k = getattr(perm, "filter_sub_field_key", None)
            cfg_dict = getattr(perm, "filter_column_configs", None)

            items.append(
                {
                    "id": perm.id,
                    "resource_type": "report",
                    "resource_id": rt.id,
                    "resource_name": rt.name,
                    "user_id": user.id,
                    "user_name": user.full_name or user.username,
                    "username": user.username,
                    "user_email": user.email,
                    "user_type": "external" if is_ext else "internal",
                    "user_unique_key": u_key,
                    "access_type": acc_type,
                    "restriction_summary": resolve_effective_access_label(
                        acc_type, sub_k, cfg_dict, u_key
                    ),
                    "is_active": active,
                    "can_view": perm.can_view,
                    "can_edit": False,
                    "can_print": getattr(perm, "can_print", False),
                    "can_export": getattr(perm, "can_export", False),
                    "can_download_word": getattr(perm, "can_download_word", False),
                    "can_change_period": getattr(perm, "can_change_period", False),
                    "can_load_lms": getattr(perm, "can_load_lms", False),
                    "filter_column_configs": cfg_dict,
                    "filter_sub_field_key": sub_k,
                    "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
                    "filter_mli_id": getattr(perm, "filter_mli_id", None),
                    "created_at": perm.created_at,
                }
            )

    if user_type == "internal":
        items = [x for x in items if x["user_type"] == "internal"]
    elif user_type == "external":
        items = [x for x in items if x["user_type"] == "external"]

    if access_type != "all":
        items = [x for x in items if x["access_type"] == access_type]

    if status == "active":
        items = [x for x in items if x["is_active"] is True]
    elif status == "inactive":
        items = [x for x in items if x["is_active"] is False]

    if search:
        tokens = [t.strip().lower() for t in search.strip().split() if t.strip()]
        if tokens:
            def matches(x: dict[str, Any]) -> bool:
                text = " ".join([
                    str(x.get("user_name") or ""),
                    str(x.get("username") or ""),
                    str(x.get("user_email") or ""),
                    str(x.get("resource_name") or ""),
                    str(x.get("user_unique_key") or ""),
                    str(x.get("restriction_summary") or ""),
                    str(x.get("user_type") or ""),
                    str(x.get("resource_type") or ""),
                    str(x.get("access_type") or ""),
                ]).lower()
                return all(tok in text for tok in tokens)

            items = [x for x in items if matches(x)]

    active_count = sum(1 for x in items if x["is_active"])
    inactive_count = sum(1 for x in items if not x["is_active"])
    full_count = sum(1 for x in items if x["access_type"] == "full")
    unique_count = sum(1 for x in items if x["access_type"] == "unique_key")
    total = len(items)

    items.sort(key=lambda x: (x["resource_name"].lower(), x["user_name"].lower()))
    offset = max(0, (page - 1) * page_size)
    paginated = items[offset : offset + page_size]

    counts = {
        "active_count": active_count,
        "inactive_count": inactive_count,
        "full_access_count": full_count,
        "unique_key_count": unique_count,
    }
    return paginated, total, counts


async def preview_bulk_assignment(
    db: AsyncSession,
    organization_id: int,
    *,
    user_ids: list[int],
    dashboard_ids: list[int],
    custom_report_ids: list[int],
    report_template_ids: list[int],
    access_type: str = "full",
    can_view: bool = True,
    can_edit: bool = False,
    can_print: bool = False,
    can_export: bool = False,
    can_download_word: bool = False,
    can_change_period: bool = False,
    can_change_period_dashboards: bool | None = None,
    can_change_period_reports: bool | None = None,
    can_load_lms: bool = False,
    can_download_widget_pdf: bool = True,
    can_view_drilldown: bool = True,
    filter_kpi_id: int | None = None,
    filter_mli_id: int | None = None,
    filter_sub_field_key: str | None = None,
    filter_column_configs: dict[str, str] | None = None,
    filter_operator: str = "=",
) -> dict[str, Any]:
    # Enforce strict organization boundary on users and resources
    valid_users_res = await db.execute(
        select(User.id).where(User.id.in_(user_ids), User.organization_id == organization_id)
    )
    filtered_user_ids = list(valid_users_res.scalars().all())

    filtered_dashboard_ids: list[int] = []
    if dashboard_ids:
        valid_d_res = await db.execute(
            select(Dashboard.id).where(Dashboard.id.in_(dashboard_ids), Dashboard.organization_id == organization_id)
        )
        filtered_dashboard_ids = list(valid_d_res.scalars().all())

    filtered_custom_report_ids: list[int] = []
    if custom_report_ids:
        valid_cr_res = await db.execute(
            select(CustomReport.id).where(CustomReport.id.in_(custom_report_ids), CustomReport.organization_id == organization_id)
        )
        filtered_custom_report_ids = list(valid_cr_res.scalars().all())

    filtered_report_template_ids: list[int] = []
    if report_template_ids:
        valid_rt_res = await db.execute(
            select(ReportTemplate.id).where(ReportTemplate.id.in_(report_template_ids), ReportTemplate.organization_id == organization_id)
        )
        filtered_report_template_ids = list(valid_rt_res.scalars().all())

    u_count = len(filtered_user_ids)
    d_count = len(filtered_dashboard_ids)
    r_count = len(filtered_custom_report_ids) + len(filtered_report_template_ids)
    total_targets = u_count * (d_count + r_count)

    new_count = 0
    existing_count = 0
    update_count = 0
    unchanged_count = 0

    if total_targets == 0:
        return {
            "users_count": u_count,
            "dashboards_count": d_count,
            "reports_count": r_count,
            "total_targets": 0,
            "new_assignments_count": 0,
            "existing_assignments_count": 0,
            "rights_to_update_count": 0,
            "no_changes_count": 0,
            "access_type": access_type,
            "restriction_preview": None,
        }

    user_ids = filtered_user_ids
    dashboard_ids = filtered_dashboard_ids
    custom_report_ids = filtered_custom_report_ids
    report_template_ids = filtered_report_template_ids

    target_unique = access_type == "unique_key"
    dash_can_change_period = (
        can_change_period_dashboards
        if can_change_period_dashboards is not None
        else can_change_period
    )
    report_can_change_period = (
        can_change_period_reports
        if can_change_period_reports is not None
        else can_change_period
    )

    effective_filter_kpi_id = filter_kpi_id if target_unique else None
    effective_filter_mli_id = filter_mli_id if target_unique else None
    effective_filter_sub_field_key = filter_sub_field_key if target_unique else None
    effective_filter_column_configs = filter_column_configs if target_unique else None
    effective_filter_operator = filter_operator if target_unique else "="

    if dashboard_ids and user_ids:
        d_res = await db.execute(
            select(DashboardAccessPermission).where(
                DashboardAccessPermission.dashboard_id.in_(dashboard_ids),
                DashboardAccessPermission.user_id.in_(user_ids),
            )
        )
        existing_d_perms = d_res.scalars().all()
        existing_d_map = {(p.dashboard_id, p.user_id): p for p in existing_d_perms}

        for did in dashboard_ids:
            for uid in user_ids:
                perm = existing_d_map.get((did, uid))
                if not perm:
                    new_count += 1
                else:
                    existing_count += 1
                    prev_acc_dict = {
                        "can_view": perm.can_view,
                        "can_edit": perm.can_edit,
                        "can_load_lms": perm.can_load_lms,
                        "can_change_period": perm.can_change_period,
                        "can_download_widget_pdf": getattr(perm, "can_download_widget_pdf", True),
                        "can_view_drilldown": getattr(perm, "can_view_drilldown", True),
                        "can_use_unique_value": perm.can_use_unique_value,
                        "is_active": getattr(perm, "is_active", True),
                    }
                    prev_cfg_dict = {
                        "filter_kpi_id": perm.filter_kpi_id,
                        "filter_mli_id": perm.filter_mli_id,
                        "filter_sub_field_key": perm.filter_sub_field_key,
                        "filter_column_configs": perm.filter_column_configs,
                        "filter_operator": perm.filter_operator,
                    }
                    new_acc_dict = {
                        "can_view": can_view,
                        "can_edit": can_edit,
                        "can_load_lms": can_load_lms,
                        "can_change_period": dash_can_change_period,
                        "can_download_widget_pdf": can_download_widget_pdf,
                        "can_view_drilldown": can_view_drilldown,
                        "can_use_unique_value": target_unique,
                        "is_active": True,
                    }
                    new_cfg_dict = {
                        "filter_kpi_id": effective_filter_kpi_id,
                        "filter_mli_id": effective_filter_mli_id,
                        "filter_sub_field_key": effective_filter_sub_field_key,
                        "filter_column_configs": effective_filter_column_configs,
                        "filter_operator": effective_filter_operator,
                    }
                    if prev_acc_dict != new_acc_dict or prev_cfg_dict != new_cfg_dict:
                        update_count += 1
                    else:
                        unchanged_count += 1

    if custom_report_ids and user_ids:
        cr_res = await db.execute(
            select(CustomReportAssignment).where(
                CustomReportAssignment.custom_report_id.in_(custom_report_ids),
                CustomReportAssignment.user_id.in_(user_ids),
            )
        )
        existing_cr_perms = cr_res.scalars().all()
        existing_cr_map = {(p.custom_report_id, p.user_id): p for p in existing_cr_perms}

        for crid in custom_report_ids:
            for uid in user_ids:
                perm = existing_cr_map.get((crid, uid))
                if not perm:
                    new_count += 1
                else:
                    existing_count += 1
                    prev_acc = {
                        "can_view": perm.can_view,
                        "can_print": perm.can_print,
                        "can_export": perm.can_export,
                        "can_download_word": getattr(perm, "can_download_word", False),
                        "can_change_period": perm.can_change_period,
                        "can_load_lms": getattr(perm, "can_load_lms", False),
                        "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
                        "is_active": getattr(perm, "is_active", True),
                    }
                    prev_cfg = {
                        "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
                        "filter_mli_id": getattr(perm, "filter_mli_id", None),
                        "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
                        "filter_column_configs": getattr(perm, "filter_column_configs", None),
                        "filter_operator": getattr(perm, "filter_operator", "="),
                    }
                    new_acc = {
                        "can_view": can_view,
                        "can_print": can_print,
                        "can_export": can_export,
                        "can_download_word": can_download_word,
                        "can_change_period": report_can_change_period,
                        "can_load_lms": can_load_lms,
                        "can_use_unique_value": target_unique,
                        "is_active": True,
                    }
                    new_cfg = {
                        "filter_kpi_id": effective_filter_kpi_id,
                        "filter_mli_id": effective_filter_mli_id,
                        "filter_sub_field_key": effective_filter_sub_field_key,
                        "filter_column_configs": effective_filter_column_configs,
                        "filter_operator": effective_filter_operator,
                    }
                    if prev_acc != new_acc or prev_cfg != new_cfg:
                        update_count += 1
                    else:
                        unchanged_count += 1

    if report_template_ids and user_ids:
        rt_res = await db.execute(
            select(ReportAccessPermission).where(
                ReportAccessPermission.report_template_id.in_(report_template_ids),
                ReportAccessPermission.user_id.in_(user_ids),
            )
        )
        existing_rt_perms = rt_res.scalars().all()
        existing_rt_map = {(p.report_template_id, p.user_id): p for p in existing_rt_perms}

        for rtid in report_template_ids:
            for uid in user_ids:
                perm = existing_rt_map.get((rtid, uid))
                if not perm:
                    new_count += 1
                else:
                    existing_count += 1
                    prev_acc_dict = {
                        "can_view": perm.can_view,
                        "can_print": perm.can_print,
                        "can_export": perm.can_export,
                        "can_download_word": getattr(perm, "can_download_word", False),
                        "can_change_period": perm.can_change_period,
                        "can_load_lms": getattr(perm, "can_load_lms", False),
                        "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
                        "is_active": getattr(perm, "is_active", True),
                    }
                    prev_cfg_dict = {
                        "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
                        "filter_mli_id": getattr(perm, "filter_mli_id", None),
                        "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
                        "filter_column_configs": getattr(perm, "filter_column_configs", None),
                        "filter_operator": getattr(perm, "filter_operator", "="),
                    }
                    new_acc_dict = {
                        "can_view": can_view,
                        "can_print": can_print,
                        "can_export": can_export,
                        "can_download_word": can_download_word,
                        "can_change_period": report_can_change_period,
                        "can_load_lms": can_load_lms,
                        "can_use_unique_value": target_unique,
                        "is_active": True,
                    }
                    new_cfg_dict = {
                        "filter_kpi_id": effective_filter_kpi_id,
                        "filter_mli_id": effective_filter_mli_id,
                        "filter_sub_field_key": effective_filter_sub_field_key,
                        "filter_column_configs": effective_filter_column_configs,
                        "filter_operator": effective_filter_operator,
                    }
                    if prev_acc_dict != new_acc_dict or prev_cfg_dict != new_cfg_dict:
                        update_count += 1
                    else:
                        unchanged_count += 1

    restriction_preview = resolve_effective_access_label(
        access_type, filter_sub_field_key, filter_column_configs
    )

    return {
        "users_count": u_count,
        "dashboards_count": d_count,
        "reports_count": r_count,
        "total_targets": total_targets,
        "new_assignments_count": new_count,
        "existing_assignments_count": existing_count,
        "rights_to_update_count": update_count,
        "no_changes_count": unchanged_count,
        "access_type": access_type,
        "restriction_preview": restriction_preview,
    }



async def execute_bulk_assignment(
    db: AsyncSession,
    organization_id: int,
    admin_user: User,
    *,
    user_ids: list[int],
    dashboard_ids: list[int],
    custom_report_ids: list[int],
    report_template_ids: list[int],
    access_type: str = "full",
    can_view: bool = True,
    can_edit: bool = False,
    can_print: bool = False,
    can_export: bool = False,
    can_download_word: bool = False,
    can_change_period: bool = False,
    can_change_period_dashboards: bool | None = None,
    can_change_period_reports: bool | None = None,
    can_load_lms: bool = False,
    can_download_widget_pdf: bool = True,
    can_view_drilldown: bool = True,
    filter_kpi_id: int | None = None,
    filter_mli_id: int | None = None,
    filter_sub_field_key: str | None = None,
    filter_column_configs: dict[str, str] | None = None,
    filter_operator: str = "=",
) -> dict[str, Any]:
    """Execute bulk assignment with UPSERT and audit trail."""
    created_count = 0
    updated_count = 0
    unchanged_count = 0
    failed_count = 0
    failed_items: list[dict[str, Any]] = []

    target_unique = access_type == "unique_key"
    dash_can_change_period = can_change_period_dashboards if can_change_period_dashboards is not None else can_change_period
    report_can_change_period = can_change_period_reports if can_change_period_reports is not None else can_change_period

    effective_filter_kpi_id = filter_kpi_id if target_unique else None
    effective_filter_mli_id = filter_mli_id if target_unique else None
    effective_filter_sub_field_key = filter_sub_field_key if target_unique else None
    effective_filter_column_configs = filter_column_configs if target_unique else None
    effective_filter_operator = filter_operator if target_unique else "="

    valid_users_res = await db.execute(
        select(User).where(User.id.in_(user_ids), User.organization_id == organization_id)
    )
    valid_users = {u.id: u for u in valid_users_res.scalars().all()}

    # 1. Dashboards
    if dashboard_ids:
        d_res = await db.execute(
            select(Dashboard).where(
                Dashboard.id.in_(dashboard_ids), Dashboard.organization_id == organization_id
            )
        )
        dashboards_map = {d.id: d for d in d_res.scalars().all()}

        for d_id in dashboard_ids:
            dash = dashboards_map.get(d_id)
            if not dash:
                failed_count += len(user_ids)
                failed_items.append({"resource_type": "dashboard", "resource_id": d_id, "error": "Dashboard not found"})
                continue

            for u_id in user_ids:
                u = valid_users.get(u_id)
                if not u:
                    failed_count += 1
                    continue

                res = await db.execute(
                    select(DashboardAccessPermission).where(
                        DashboardAccessPermission.dashboard_id == d_id,
                        DashboardAccessPermission.user_id == u_id,
                    )
                )
                perm = res.scalar_one_or_none()

                new_acc_dict = {
                    "can_view": can_view,
                    "can_edit": can_edit,
                    "can_load_lms": can_load_lms,
                    "can_change_period": dash_can_change_period,
                    "can_download_widget_pdf": can_download_widget_pdf,
                    "can_view_drilldown": can_view_drilldown,
                    "can_use_unique_value": target_unique,
                    "is_active": True,
                }
                new_cfg_dict = {
                    "filter_kpi_id": effective_filter_kpi_id,
                    "filter_mli_id": effective_filter_mli_id,
                    "filter_sub_field_key": effective_filter_sub_field_key,
                    "filter_column_configs": effective_filter_column_configs,
                    "filter_operator": effective_filter_operator,
                }

                if not perm:
                    perm = DashboardAccessPermission(
                        dashboard_id=d_id,
                        user_id=u_id,
                        can_view=can_view,
                        can_edit=can_edit,
                        can_load_lms=can_load_lms,
                        can_change_period=dash_can_change_period,
                        can_download_widget_pdf=can_download_widget_pdf,
                        can_view_drilldown=can_view_drilldown,
                        can_use_unique_value=target_unique,
                        filter_kpi_id=effective_filter_kpi_id,
                        filter_mli_id=effective_filter_mli_id,
                        filter_sub_field_key=effective_filter_sub_field_key,
                        filter_column_configs=effective_filter_column_configs,
                        filter_operator=effective_filter_operator,
                        is_active=True,
                    )
                    db.add(perm)
                    await db.flush()
                    created_count += 1

                    await record_rights_audit(
                        db,
                        organization_id=organization_id,
                        user_id=u_id,
                        resource_type="dashboard",
                        resource_id=d_id,
                        resource_name=dash.name,
                        action="ASSIGNED",
                        previous_access=None,
                        new_access=new_acc_dict,
                        previous_config=None,
                        new_config=new_cfg_dict,
                        changed_by_id=admin_user.id,
                    )
                else:
                    prev_acc_dict = {
                        "can_view": perm.can_view,
                        "can_edit": perm.can_edit,
                        "can_load_lms": perm.can_load_lms,
                        "can_change_period": perm.can_change_period,
                        "can_download_widget_pdf": getattr(perm, "can_download_widget_pdf", True),
                        "can_view_drilldown": getattr(perm, "can_view_drilldown", True),
                        "can_use_unique_value": perm.can_use_unique_value,
                        "is_active": getattr(perm, "is_active", True),
                    }
                    prev_cfg_dict = {
                        "filter_kpi_id": perm.filter_kpi_id,
                        "filter_mli_id": perm.filter_mli_id,
                        "filter_sub_field_key": perm.filter_sub_field_key,
                        "filter_column_configs": perm.filter_column_configs,
                        "filter_operator": perm.filter_operator,
                    }

                    changed = (
                        prev_acc_dict != new_acc_dict or
                        prev_cfg_dict != new_cfg_dict
                    )
                    if changed:
                        perm.can_view = can_view
                        perm.can_edit = can_edit
                        perm.can_load_lms = can_load_lms
                        perm.can_change_period = dash_can_change_period
                        perm.can_download_widget_pdf = can_download_widget_pdf
                        perm.can_view_drilldown = can_view_drilldown
                        perm.can_use_unique_value = target_unique
                        perm.filter_kpi_id = effective_filter_kpi_id
                        perm.filter_mli_id = effective_filter_mli_id
                        perm.filter_sub_field_key = effective_filter_sub_field_key
                        perm.filter_column_configs = effective_filter_column_configs
                        perm.filter_operator = effective_filter_operator
                        perm.is_active = True
                        await db.flush()
                        updated_count += 1

                        await record_rights_audit(
                            db,
                            organization_id=organization_id,
                            user_id=u_id,
                            resource_type="dashboard",
                            resource_id=d_id,
                            resource_name=dash.name,
                            action="UPDATED",
                            previous_access=prev_acc_dict,
                            new_access=new_acc_dict,
                            previous_config=prev_cfg_dict,
                            new_config=new_cfg_dict,
                            changed_by_id=admin_user.id,
                        )
                    else:
                        unchanged_count += 1

    # 2. Custom Reports
    if custom_report_ids:
        cr_res = await db.execute(
            select(CustomReport).where(
                CustomReport.id.in_(custom_report_ids), CustomReport.organization_id == organization_id
            )
        )
        cr_map = {c.id: c for c in cr_res.scalars().all()}

        for cr_id in custom_report_ids:
            cr = cr_map.get(cr_id)
            if not cr:
                failed_count += len(user_ids)
                failed_items.append({"resource_type": "custom_report", "resource_id": cr_id, "error": "Custom report not found"})
                continue

            cr_filter_kpi_id = effective_filter_kpi_id
            cr_filter_mli_id = effective_filter_mli_id
            cr_filter_sub_field_key = effective_filter_sub_field_key

            if target_unique and effective_filter_column_configs and isinstance(effective_filter_column_configs, dict):
                try:
                    cr_cols = await get_custom_report_filterable_columns(db, cr_id, organization_id)
                    matched = False
                    for col in cr_cols:
                        grp = f"{col['kpi_id']}_{col['mli_id']}"
                        if grp in effective_filter_column_configs and effective_filter_column_configs[grp]:
                            cr_filter_kpi_id = col['kpi_id']
                            cr_filter_mli_id = col['mli_id']
                            cr_filter_sub_field_key = effective_filter_column_configs[grp]
                            matched = True
                            break
                    if not matched and cr_cols:
                        if not any(col['kpi_id'] == cr_filter_kpi_id and col['mli_id'] == cr_filter_mli_id for col in cr_cols):
                            cr_filter_kpi_id = None
                            cr_filter_mli_id = None
                except Exception:
                    pass

            for u_id in user_ids:
                u = valid_users.get(u_id)
                if not u:
                    failed_count += 1
                    continue

                res = await db.execute(
                    select(CustomReportAssignment).where(
                        CustomReportAssignment.custom_report_id == cr_id,
                        CustomReportAssignment.user_id == u_id,
                    )
                )
                perm = res.scalar_one_or_none()

                new_acc = {
                    "can_view": can_view,
                    "can_print": can_print,
                    "can_export": can_export,
                    "can_download_word": can_download_word,
                    "can_change_period": report_can_change_period,
                    "can_load_lms": can_load_lms,
                    "can_use_unique_value": target_unique,
                    "is_active": True,
                }
                new_cfg_dict = {
                    "filter_kpi_id": cr_filter_kpi_id,
                    "filter_mli_id": cr_filter_mli_id,
                    "filter_sub_field_key": cr_filter_sub_field_key,
                    "filter_column_configs": effective_filter_column_configs,
                    "filter_operator": effective_filter_operator,
                }

                if not perm:
                    perm = CustomReportAssignment(
                        custom_report_id=cr_id,
                        user_id=u_id,
                        can_view=can_view,
                        can_print=can_print,
                        can_export=can_export,
                        can_download_word=can_download_word,
                        can_change_period=report_can_change_period,
                        can_load_lms=can_load_lms,
                        can_use_unique_value=target_unique,
                        filter_kpi_id=cr_filter_kpi_id,
                        filter_mli_id=cr_filter_mli_id,
                        filter_sub_field_key=cr_filter_sub_field_key,
                        filter_column_configs=effective_filter_column_configs,
                        filter_operator=effective_filter_operator,
                        is_active=True,
                    )
                    db.add(perm)
                    await db.flush()
                    created_count += 1

                    await record_rights_audit(
                        db,
                        organization_id=organization_id,
                        user_id=u_id,
                        resource_type="custom_report",
                        resource_id=cr_id,
                        resource_name=cr.name,
                        action="ASSIGNED",
                        previous_access=None,
                        new_access=new_acc,
                        previous_config=None,
                        new_config=new_cfg_dict,
                        changed_by_id=admin_user.id,
                    )
                else:
                    prev_acc = {
                        "can_view": perm.can_view,
                        "can_print": perm.can_print,
                        "can_export": perm.can_export,
                        "can_download_word": getattr(perm, "can_download_word", False),
                        "can_change_period": perm.can_change_period,
                        "can_load_lms": getattr(perm, "can_load_lms", False),
                        "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
                        "is_active": getattr(perm, "is_active", True),
                    }
                    prev_cfg_dict = {
                        "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
                        "filter_mli_id": getattr(perm, "filter_mli_id", None),
                        "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
                        "filter_column_configs": getattr(perm, "filter_column_configs", None),
                        "filter_operator": getattr(perm, "filter_operator", "="),
                    }
                    changed = (prev_acc != new_acc or prev_cfg_dict != new_cfg_dict)
                    if changed:
                        perm.can_view = can_view
                        perm.can_print = can_print
                        perm.can_export = can_export
                        perm.can_download_word = can_download_word
                        perm.can_change_period = report_can_change_period
                        perm.can_load_lms = can_load_lms
                        perm.can_use_unique_value = target_unique
                        perm.filter_kpi_id = cr_filter_kpi_id
                        perm.filter_mli_id = cr_filter_mli_id
                        perm.filter_sub_field_key = cr_filter_sub_field_key
                        perm.filter_column_configs = effective_filter_column_configs
                        perm.filter_operator = effective_filter_operator
                        perm.is_active = True
                        await db.flush()
                        updated_count += 1

                        await record_rights_audit(
                            db,
                            organization_id=organization_id,
                            user_id=u_id,
                            resource_type="custom_report",
                            resource_id=cr_id,
                            resource_name=cr.name,
                            action="UPDATED",
                            previous_access=prev_acc,
                            new_access=new_acc,
                            previous_config=prev_cfg_dict,
                            new_config=new_cfg_dict,
                            changed_by_id=admin_user.id,
                        )
                    else:
                        unchanged_count += 1

    # 3. Standard Reports
    if report_template_ids:
        rt_res = await db.execute(
            select(ReportTemplate).where(
                ReportTemplate.id.in_(report_template_ids), ReportTemplate.organization_id == organization_id
            )
        )
        rt_map = {r.id: r for r in rt_res.scalars().all()}

        for rt_id in report_template_ids:
            rt = rt_map.get(rt_id)
            if not rt:
                failed_count += len(user_ids)
                continue

            rt_filter_kpi_id = effective_filter_kpi_id
            rt_filter_mli_id = effective_filter_mli_id
            rt_filter_sub_field_key = effective_filter_sub_field_key

            if target_unique and effective_filter_column_configs and isinstance(effective_filter_column_configs, dict):
                try:
                    rt_cols = await get_report_template_filterable_columns(db, rt_id, organization_id)
                    matched = False
                    for col in rt_cols:
                        grp = f"{col['kpi_id']}_{col['mli_id']}"
                        if grp in effective_filter_column_configs and effective_filter_column_configs[grp]:
                            rt_filter_kpi_id = col['kpi_id']
                            rt_filter_mli_id = col['mli_id']
                            rt_filter_sub_field_key = effective_filter_column_configs[grp]
                            matched = True
                            break
                    if not matched and rt_cols:
                        if not any(col['kpi_id'] == rt_filter_kpi_id and col['mli_id'] == rt_filter_mli_id for col in rt_cols):
                            rt_filter_kpi_id = None
                            rt_filter_mli_id = None
                except Exception:
                    pass

            for u_id in user_ids:
                u = valid_users.get(u_id)
                if not u:
                    failed_count += 1
                    continue

                res = await db.execute(
                    select(ReportAccessPermission).where(
                        ReportAccessPermission.report_template_id == rt_id,
                        ReportAccessPermission.user_id == u_id,
                    )
                )
                perm = res.scalar_one_or_none()
                new_acc_dict = {
                    "can_view": can_view,
                    "can_print": can_print,
                    "can_export": can_export,
                    "can_download_word": can_download_word,
                    "can_change_period": report_can_change_period,
                    "can_load_lms": can_load_lms,
                    "can_use_unique_value": target_unique,
                    "is_active": True,
                }
                new_cfg_dict = {
                    "filter_kpi_id": rt_filter_kpi_id,
                    "filter_mli_id": rt_filter_mli_id,
                    "filter_sub_field_key": rt_filter_sub_field_key,
                    "filter_column_configs": effective_filter_column_configs,
                    "filter_operator": effective_filter_operator,
                }

                if not perm:
                    perm = ReportAccessPermission(
                        report_template_id=rt_id,
                        user_id=u_id,
                        can_view=can_view,
                        can_print=can_print,
                        can_export=can_export,
                        can_download_word=can_download_word,
                        can_change_period=report_can_change_period,
                        can_load_lms=can_load_lms,
                        can_use_unique_value=target_unique,
                        filter_kpi_id=rt_filter_kpi_id,
                        filter_mli_id=rt_filter_mli_id,
                        filter_sub_field_key=rt_filter_sub_field_key,
                        filter_column_configs=effective_filter_column_configs,
                        filter_operator=effective_filter_operator,
                        is_active=True,
                    )
                    db.add(perm)
                    await db.flush()
                    created_count += 1

                    await record_rights_audit(
                        db,
                        organization_id=organization_id,
                        user_id=u_id,
                        resource_type="report",
                        resource_id=rt_id,
                        resource_name=rt.name,
                        action="ASSIGNED",
                        previous_access=None,
                        new_access=new_acc_dict,
                        previous_config=None,
                        new_config=new_cfg_dict,
                        changed_by_id=admin_user.id,
                    )
                else:
                    prev_acc_dict = {
                        "can_view": perm.can_view,
                        "can_print": perm.can_print,
                        "can_export": perm.can_export,
                        "can_download_word": getattr(perm, "can_download_word", False),
                        "can_change_period": perm.can_change_period,
                        "can_load_lms": getattr(perm, "can_load_lms", False),
                        "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
                        "is_active": getattr(perm, "is_active", True),
                    }
                    prev_cfg_dict = {
                        "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
                        "filter_mli_id": getattr(perm, "filter_mli_id", None),
                        "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
                        "filter_column_configs": getattr(perm, "filter_column_configs", None),
                        "filter_operator": getattr(perm, "filter_operator", "="),
                    }
                    if prev_acc_dict != new_acc_dict or prev_cfg_dict != new_cfg_dict:
                        perm.can_view = can_view
                        perm.can_print = can_print
                        perm.can_export = can_export
                        perm.can_download_word = can_download_word
                        perm.can_change_period = report_can_change_period
                        perm.can_load_lms = can_load_lms
                        perm.can_use_unique_value = target_unique
                        perm.filter_kpi_id = effective_filter_kpi_id
                        perm.filter_mli_id = effective_filter_mli_id
                        perm.filter_sub_field_key = effective_filter_sub_field_key
                        perm.filter_column_configs = effective_filter_column_configs
                        perm.filter_operator = effective_filter_operator
                        perm.is_active = True
                        await db.flush()
                        updated_count += 1

                        await record_rights_audit(
                            db,
                            organization_id=organization_id,
                            user_id=u_id,
                            resource_type="report",
                            resource_id=rt_id,
                            resource_name=rt.name,
                            action="UPDATED",
                            previous_access=prev_acc_dict,
                            new_access=new_acc_dict,
                            changed_by_id=admin_user.id,
                        )
                    else:
                        unchanged_count += 1

    await db.commit()
    # Invalidate caches AFTER commit so concurrent requests see the new state immediately
    invalidate_all_access_and_report_caches(db)

    return {
        "message": f"Rights operation completed: {created_count} created, {updated_count} updated, {unchanged_count} unchanged, {failed_count} failed",
        "created_count": created_count,
        "updated_count": updated_count,
        "unchanged_count": unchanged_count,
        "failed_count": failed_count,
        "failed_items": failed_items,
    }


async def update_individual_right(
    db: AsyncSession,
    organization_id: int,
    admin_user: User,
    resource_type: str,
    permission_id: int,
    patch: dict[str, Any],
) -> dict[str, Any] | None:
    """Update an individual permission record and record an audit log."""
    is_super_admin = getattr(admin_user.role, "value", admin_user.role) == "SUPER_ADMIN"
    if resource_type == "dashboard":
        perm = await db.get(DashboardAccessPermission, permission_id)
        if not perm:
            return None
        dash = await db.get(Dashboard, perm.dashboard_id)
        if not dash or dash.organization_id != organization_id:
            return None

        prev_acc = {
            "can_view": perm.can_view,
            "can_edit": perm.can_edit,
            "can_load_lms": perm.can_load_lms,
            "can_change_period": perm.can_change_period,
            "can_download_widget_pdf": getattr(perm, "can_download_widget_pdf", True),
            "can_view_drilldown": getattr(perm, "can_view_drilldown", True),
            "can_use_unique_value": perm.can_use_unique_value,
            "is_active": getattr(perm, "is_active", True),
        }
        prev_cfg = {
            "filter_kpi_id": perm.filter_kpi_id,
            "filter_mli_id": perm.filter_mli_id,
            "filter_sub_field_key": perm.filter_sub_field_key,
            "filter_column_configs": perm.filter_column_configs,
        }

        if "is_active" in patch and patch["is_active"] is not None:
            perm.is_active = bool(patch["is_active"])
        if "can_view" in patch and patch["can_view"] is not None:
            perm.can_view = bool(patch["can_view"])
        if "can_edit" in patch and patch["can_edit"] is not None:
            perm.can_edit = bool(patch["can_edit"])
        if "can_load_lms" in patch and patch["can_load_lms"] is not None:
            perm.can_load_lms = bool(patch["can_load_lms"])
        if "can_change_period" in patch and patch["can_change_period"] is not None:
            perm.can_change_period = bool(patch["can_change_period"])
        if "can_download_widget_pdf" in patch and patch["can_download_widget_pdf"] is not None:
            perm.can_download_widget_pdf = bool(patch["can_download_widget_pdf"])
        if "can_view_drilldown" in patch and patch["can_view_drilldown"] is not None:
            perm.can_view_drilldown = bool(patch["can_view_drilldown"])
        if "access_type" in patch and patch["access_type"] is not None:
            perm.can_use_unique_value = patch["access_type"] == "unique_key"
            if patch["access_type"] == "full":
                perm.filter_sub_field_key = None
                perm.filter_column_configs = None
                perm.filter_kpi_id = None
                perm.filter_mli_id = None

        if "filter_sub_field_key" in patch and patch.get("access_type") != "full":
            perm.filter_sub_field_key = patch["filter_sub_field_key"]
        if "filter_column_configs" in patch and patch.get("access_type") != "full":
            perm.filter_column_configs = patch["filter_column_configs"]
        if "filter_kpi_id" in patch and patch.get("access_type") != "full":
            perm.filter_kpi_id = patch["filter_kpi_id"]
        if "filter_mli_id" in patch and patch.get("access_type") != "full":
            perm.filter_mli_id = patch["filter_mli_id"]

        await db.flush()
        new_acc = {
            "can_view": perm.can_view,
            "can_edit": perm.can_edit,
            "can_load_lms": perm.can_load_lms,
            "can_change_period": perm.can_change_period,
            "can_download_widget_pdf": perm.can_download_widget_pdf,
            "can_view_drilldown": perm.can_view_drilldown,
            "can_use_unique_value": perm.can_use_unique_value,
            "is_active": perm.is_active,
        }
        new_cfg = {
            "filter_kpi_id": perm.filter_kpi_id,
            "filter_mli_id": perm.filter_mli_id,
            "filter_sub_field_key": perm.filter_sub_field_key,
            "filter_column_configs": perm.filter_column_configs,
        }

        action = "UPDATED"
        if prev_acc.get("is_active") != new_acc.get("is_active"):
            action = "ACTIVATED" if new_acc.get("is_active") else "DEACTIVATED"

        if not perm.is_active or not perm.can_view:
            target_u = await db.get(User, perm.user_id)
            if target_u and target_u.default_dashboard_id == dash.id:
                target_u.default_dashboard_id = None

        await record_rights_audit(
            db,
            organization_id=organization_id,
            user_id=perm.user_id,
            resource_type="dashboard",
            resource_id=dash.id,
            resource_name=dash.name,
            action=action,
            previous_access=prev_acc,
            new_access=new_acc,
            previous_config=prev_cfg,
            new_config=new_cfg,
            changed_by_id=admin_user.id,
        )
        await db.commit()
        invalidate_all_access_and_report_caches(db)
        return {"ok": True, "id": perm.id}

    elif resource_type in ("custom_report", "report"):
        is_custom = resource_type == "custom_report"
        ModelClass = CustomReportAssignment if is_custom else ReportAccessPermission
        ParentClass = CustomReport if is_custom else ReportTemplate
        perm = await db.get(ModelClass, permission_id)
        if not perm:
            return None
        parent_id = perm.custom_report_id if is_custom else perm.report_template_id
        parent = await db.get(ParentClass, parent_id)
        if not parent or parent.organization_id != organization_id:
            return None

        prev_acc = {
            "can_view": perm.can_view,
            "can_print": perm.can_print,
            "can_export": perm.can_export,
            "can_download_word": getattr(perm, "can_download_word", False),
            "can_change_period": perm.can_change_period,
            "can_load_lms": getattr(perm, "can_load_lms", False),
            "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
            "is_active": getattr(perm, "is_active", True),
        }
        prev_cfg = {
            "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
            "filter_mli_id": getattr(perm, "filter_mli_id", None),
            "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
            "filter_column_configs": getattr(perm, "filter_column_configs", None),
            "filter_operator": getattr(perm, "filter_operator", "="),
        }

        if "is_active" in patch and patch["is_active"] is not None:
            perm.is_active = bool(patch["is_active"])
        if "can_view" in patch and patch["can_view"] is not None:
            perm.can_view = bool(patch["can_view"])
        if "can_print" in patch and patch["can_print"] is not None:
            perm.can_print = bool(patch["can_print"])
        if "can_export" in patch and patch["can_export"] is not None:
            perm.can_export = bool(patch["can_export"])
        if "can_download_word" in patch and patch["can_download_word"] is not None:
            perm.can_download_word = bool(patch["can_download_word"])
        if "can_change_period" in patch and patch["can_change_period"] is not None:
            perm.can_change_period = bool(patch["can_change_period"])
        if "can_load_lms" in patch and patch["can_load_lms"] is not None:
            perm.can_load_lms = bool(patch["can_load_lms"])

        if "access_type" in patch and patch["access_type"] is not None:
            acc_t = patch.get("access_type")
            if acc_t == "unique_key":
                perm.can_use_unique_value = True
                if "filter_kpi_id" in patch:
                    perm.filter_kpi_id = patch.get("filter_kpi_id")
                if "filter_mli_id" in patch:
                    perm.filter_mli_id = patch.get("filter_mli_id")
                if "filter_sub_field_key" in patch:
                    perm.filter_sub_field_key = patch.get("filter_sub_field_key")
                if "filter_column_configs" in patch:
                    perm.filter_column_configs = patch.get("filter_column_configs")
                if "filter_operator" in patch and patch["filter_operator"]:
                    perm.filter_operator = patch.get("filter_operator")
            else:
                # Switching to Full Access: clear unique key mode and filter fields
                perm.can_use_unique_value = False
                perm.filter_kpi_id = None
                perm.filter_mli_id = None
                perm.filter_sub_field_key = None
                perm.filter_column_configs = None
                perm.filter_operator = "="
        else:
            if "filter_kpi_id" in patch:
                perm.filter_kpi_id = patch.get("filter_kpi_id")
            if "filter_mli_id" in patch:
                perm.filter_mli_id = patch.get("filter_mli_id")
            if "filter_sub_field_key" in patch:
                perm.filter_sub_field_key = patch.get("filter_sub_field_key")
            if "filter_column_configs" in patch:
                perm.filter_column_configs = patch.get("filter_column_configs")
            if "filter_operator" in patch and patch["filter_operator"]:
                perm.filter_operator = patch.get("filter_operator")

        if getattr(perm, "can_use_unique_value", False) and perm.filter_column_configs:
            # Auto-reconcile report-specific filter_kpi_id, filter_mli_id, filter_sub_field_key
            matched = False
            if is_custom and parent:
                stmt_sec = select(CustomReportSection.kpi_id).where(CustomReportSection.custom_report_id == parent.id)
                res_sec = await db.execute(stmt_sec)
                report_kpi_ids = {r[0] for r in res_sec.all() if r[0]}
                for col_k, col_v in perm.filter_column_configs.items():
                    if "_" in col_k:
                        parts = col_k.split("_", 1)
                        if parts[0].isdigit() and int(parts[0]) in report_kpi_ids and parts[1].isdigit():
                            perm.filter_kpi_id = int(parts[0])
                            perm.filter_mli_id = int(parts[1])
                            perm.filter_sub_field_key = col_v
                            matched = True
                            break
            elif not is_custom and parent:
                stmt_fc = select(ReportUserFilterConfiguration).where(
                    ReportUserFilterConfiguration.report_template_id == parent_id,
                    ReportUserFilterConfiguration.is_active == True,
                )
                res_fc = await db.execute(stmt_fc)
                fc_list = res_fc.scalars().all()
                for fc in fc_list:
                    grp_k = f"{fc.kpi_id}_{fc.mli_id}" if fc.mli_id else str(fc.kpi_id)
                    if grp_k in perm.filter_column_configs:
                        perm.filter_kpi_id = fc.kpi_id
                        perm.filter_mli_id = fc.mli_id
                        perm.filter_sub_field_key = perm.filter_column_configs[grp_k]
                        matched = True
                        break
            if not matched and len(perm.filter_column_configs) == 1:
                single_k, single_v = next(iter(perm.filter_column_configs.items()))
                if "_" in single_k:
                    parts = single_k.split("_", 1)
                    if parts[0].isdigit() and parts[1].isdigit():
                        perm.filter_kpi_id = int(parts[0])
                        perm.filter_mli_id = int(parts[1])
                        perm.filter_sub_field_key = single_v

        await db.flush()
        new_acc = {
            "can_view": perm.can_view,
            "can_print": perm.can_print,
            "can_export": perm.can_export,
            "can_download_word": perm.can_download_word,
            "can_change_period": perm.can_change_period,
            "can_load_lms": perm.can_load_lms,
            "can_use_unique_value": getattr(perm, "can_use_unique_value", False),
            "is_active": perm.is_active,
        }
        new_cfg = {
            "filter_kpi_id": getattr(perm, "filter_kpi_id", None),
            "filter_mli_id": getattr(perm, "filter_mli_id", None),
            "filter_sub_field_key": getattr(perm, "filter_sub_field_key", None),
            "filter_column_configs": getattr(perm, "filter_column_configs", None),
            "filter_operator": getattr(perm, "filter_operator", "="),
        }

        action = "UPDATED"
        if prev_acc.get("is_active") != new_acc.get("is_active"):
            action = "ACTIVATED" if new_acc.get("is_active") else "DEACTIVATED"

        await record_rights_audit(
            db,
            organization_id=organization_id,
            user_id=perm.user_id,
            resource_type=resource_type,
            resource_id=parent_id,
            resource_name=parent.name,
            action=action,
            previous_access=prev_acc,
            new_access=new_acc,
            previous_config=prev_cfg,
            new_config=new_cfg,
            changed_by_id=admin_user.id,
        )
        await db.commit()
        invalidate_all_access_and_report_caches(db)
        return {"ok": True, "id": perm.id}

    return None


async def bulk_update_rights(
    db: AsyncSession,
    organization_id: int,
    admin_user: User,
    items: list[dict[str, Any]],
    action: str,
    *,
    filter_column_configs: dict[str, str] | None = None,
    filter_sub_field_key: str | None = None,
) -> int:
    """Apply bulk action to multiple selected permission records."""
    updated = 0
    for it in items:
        rtype = it.get("resource_type")
        pid = it.get("permission_id")
        if not rtype or not pid:
            continue

        patch: dict[str, Any] = {}
        if action == "activate":
            patch["is_active"] = True
        elif action == "deactivate":
            patch["is_active"] = False
        elif action == "set_full_access":
            patch["access_type"] = "full"
            patch["can_view"] = True
        elif action == "set_unique_key":
            patch["access_type"] = "unique_key"
            patch["can_view"] = True
            if filter_sub_field_key:
                patch["filter_sub_field_key"] = filter_sub_field_key
            if filter_column_configs:
                patch["filter_column_configs"] = filter_column_configs

        res = await update_individual_right(db, organization_id, admin_user, rtype, pid, patch)
        if res and res.get("ok"):
            updated += 1

    return updated


async def revoke_right(
    db: AsyncSession,
    organization_id: int,
    admin_user: User,
    resource_type: str,
    permission_id: int,
) -> bool:
    """Revoke (delete) permission and record an audit log entry."""
    is_super_admin = getattr(admin_user.role, "value", admin_user.role) == "SUPER_ADMIN"
    if resource_type == "dashboard":
        perm = await db.get(DashboardAccessPermission, permission_id)
        if not perm:
            return False
        dash = await db.get(Dashboard, perm.dashboard_id)
        if not dash or dash.organization_id != organization_id:
            return False

        u_id = perm.user_id
        d_id = perm.dashboard_id
        name = dash.name
        await db.delete(perm)
        target_u = await db.get(User, u_id)
        if target_u and target_u.default_dashboard_id == d_id:
            target_u.default_dashboard_id = None
        await db.flush()

        await record_rights_audit(
            db,
            organization_id=organization_id,
            user_id=u_id,
            resource_type="dashboard",
            resource_id=d_id,
            resource_name=name,
            action="REVOKED",
            changed_by_id=admin_user.id,
        )
        await db.commit()
        invalidate_all_access_and_report_caches(db)
        return True

    elif resource_type in ("custom_report", "report"):
        is_custom = resource_type == "custom_report"
        ModelClass = CustomReportAssignment if is_custom else ReportAccessPermission
        ParentClass = CustomReport if is_custom else ReportTemplate
        perm = await db.get(ModelClass, permission_id)
        if not perm:
            return False
        parent_id = perm.custom_report_id if is_custom else perm.report_template_id
        parent = await db.get(ParentClass, parent_id)
        if not parent or parent.organization_id != organization_id:
            return False

        u_id = perm.user_id
        name = parent.name
        await db.delete(perm)
        await db.flush()

        await record_rights_audit(
            db,
            organization_id=organization_id,
            user_id=u_id,
            resource_type=resource_type,
            resource_id=parent_id,
            resource_name=name,
            action="REVOKED",
            changed_by_id=admin_user.id,
        )
        await db.commit()
        invalidate_all_access_and_report_caches(db)
        return True

    return False


async def bulk_revoke_rights(
    db: AsyncSession,
    organization_id: int,
    admin_user: User,
    items: list[dict[str, Any]],
) -> int:
    """Bulk revoke permissions for multiple selected records."""
    revoked = 0
    for it in items:
        rtype = it.get("resource_type")
        pid = it.get("permission_id")
        if rtype and pid:
            ok = await revoke_right(db, organization_id, admin_user, rtype, pid)
            if ok:
                revoked += 1
    from app.widget_data.service import invalidate_all_widget_caches
    from app.reports.custom_service import CUSTOM_REPORT_CACHE
    invalidate_all_widget_caches()
    CUSTOM_REPORT_CACHE.invalidate_all()
    db.info.clear()
    return revoked


async def get_user_rights_summary(
    db: AsyncSession,
    organization_id: int,
    user_id: int,
    current_user: User | None = None,
) -> dict[str, Any] | None:
    """Return all assigned dashboards and reports for a specific user."""
    user = await db.get(User, user_id)
    if not user:
        return None

    if user.organization_id != organization_id:
        return None

    effective_org_id = organization_id

    dashboards_list: list[dict[str, Any]] = []
    reports_list: list[dict[str, Any]] = []

    d_res = await db.execute(
        select(DashboardAccessPermission, Dashboard)
        .join(Dashboard, DashboardAccessPermission.dashboard_id == Dashboard.id)
        .where(DashboardAccessPermission.user_id == user_id, Dashboard.organization_id == effective_org_id)
    )
    for perm, dash in d_res.all():
        is_u = bool(getattr(perm, "can_use_unique_value", False))
        acc_type = "unique_key" if is_u else "full"
        dashboards_list.append(
            {
                "permission_id": perm.id,
                "resource_type": "dashboard",
                "resource_id": dash.id,
                "resource_name": dash.name,
                "access_type": acc_type,
                "restriction_summary": resolve_effective_access_label(
                    acc_type,
                    getattr(perm, "filter_sub_field_key", None),
                    getattr(perm, "filter_column_configs", None),
                    user.unique_user_key,
                ),
                "is_active": getattr(perm, "is_active", True) is not False,
                "can_view": perm.can_view,
                "can_edit": perm.can_edit,
                "can_print": False,
                "can_export": False,
                "can_download_word": False,
                "can_change_period": getattr(perm, "can_change_period", False),
                "can_load_lms": getattr(perm, "can_load_lms", False),
                "can_download_widget_pdf": getattr(perm, "can_download_widget_pdf", True),
                "can_view_drilldown": getattr(perm, "can_view_drilldown", True),
                "is_default": bool(user.default_dashboard_id == dash.id),
            }
        )

    cr_res = await db.execute(
        select(CustomReportAssignment, CustomReport)
        .join(CustomReport, CustomReportAssignment.custom_report_id == CustomReport.id)
        .where(CustomReportAssignment.user_id == user_id, CustomReport.organization_id == effective_org_id)
    )
    cr_assignments = cr_res.all()
    cr_ids = {cr.id for _, cr in cr_assignments}
    filter_cfg_by_report: dict[int, ReportUserFilterConfiguration] = {}
    if cr_ids:
        cfg_res = await db.execute(
            select(ReportUserFilterConfiguration)
            .options(selectinload(ReportUserFilterConfiguration.sub_field))
            .where(
                ReportUserFilterConfiguration.report_id.in_(cr_ids),
                ReportUserFilterConfiguration.enabled == True,
            )
        )
        for c in cfg_res.scalars().all():
            filter_cfg_by_report[c.report_id] = c

    for perm, cr in cr_assignments:
        is_unique = bool(getattr(perm, "can_use_unique_value", False))
        f_cfg = filter_cfg_by_report.get(cr.id)

        acc_type = "unique_key" if is_unique else "full"
        sub_k = getattr(perm, "filter_sub_field_key", None) if is_unique else None
        filter_cfg_dict = getattr(perm, "filter_column_configs", None) if is_unique else None

        if is_unique:
            if not sub_k and f_cfg:
                if f_cfg.sub_field and (f_cfg.sub_field.name or f_cfg.sub_field.key):
                    sub_k = (f_cfg.sub_field.name or f_cfg.sub_field.key).strip()
                elif f_cfg.field_id:
                    sub_k = f"Field #{f_cfg.field_id}"
            if not filter_cfg_dict and f_cfg and f_cfg.enabled and f_cfg.kpi_id and f_cfg.mli_id and sub_k:
                filter_cfg_dict = {f"{f_cfg.kpi_id}_{f_cfg.mli_id}": sub_k}

        reports_list.append(
            {
                "permission_id": perm.id,
                "resource_type": "custom_report",
                "resource_id": cr.id,
                "resource_name": cr.name,
                "access_type": acc_type,
                "restriction_summary": resolve_effective_access_label(
                    acc_type, sub_k, filter_cfg_dict, getattr(user, "unique_user_key", None)
                ),
                "is_active": getattr(perm, "is_active", True) is not False,
                "can_view": perm.can_view,
                "can_edit": False,
                "can_print": getattr(perm, "can_print", False),
                "can_export": getattr(perm, "can_export", False),
                "can_download_word": getattr(perm, "can_download_word", False),
                "can_change_period": getattr(perm, "can_change_period", False),
                "can_load_lms": getattr(perm, "can_load_lms", False),
            }
        )

    rt_res = await db.execute(
        select(ReportAccessPermission, ReportTemplate)
        .join(ReportTemplate, ReportAccessPermission.report_template_id == ReportTemplate.id)
        .where(ReportAccessPermission.user_id == user_id, ReportTemplate.organization_id == effective_org_id)
    )
    for perm, rt in rt_res.all():
        is_u = bool(getattr(perm, "can_use_unique_value", False))
        acc_type = "unique_key" if is_u else "full"
        sub_k = getattr(perm, "filter_sub_field_key", None)
        cfg_d = getattr(perm, "filter_column_configs", None)
        reports_list.append(
            {
                "permission_id": perm.id,
                "resource_type": "report",
                "resource_id": rt.id,
                "resource_name": rt.name,
                "access_type": acc_type,
                "restriction_summary": resolve_effective_access_label(
                    acc_type, sub_k, cfg_d, getattr(user, "unique_user_key", None)
                ),
                "is_active": getattr(perm, "is_active", True) is not False,
                "can_view": perm.can_view,
                "can_edit": False,
                "can_print": getattr(perm, "can_print", False),
                "can_export": getattr(perm, "can_export", False),
                "can_download_word": getattr(perm, "can_download_word", False),
                "can_change_period": getattr(perm, "can_change_period", False),
                "can_load_lms": getattr(perm, "can_load_lms", False),
            }
        )

    eu_exists = (await db.execute(select(ExternalUser.user_id).where(ExternalUser.user_id == user.id))).scalar_one_or_none() is not None
    is_ext_user = eu_exists or bool(getattr(user, "is_external", False))

    return {
        "user_id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": str(getattr(user.role, "value", user.role)),
        "is_external": is_ext_user,
        "unique_user_key": getattr(user, "unique_user_key", None),
        "dashboards": dashboards_list,
        "reports": reports_list,
        "default_dashboard_id": getattr(user, "default_dashboard_id", None),
    }


async def get_resource_rights_summary(
    db: AsyncSession,
    organization_id: int,
    resource_type: str,
    resource_id: int,
    current_user: User | None = None,
) -> dict[str, Any] | None:
    """Return all users assigned to a specific dashboard or report."""
    assigned_users: list[dict[str, Any]] = []
    res_name = ""

    is_super_admin = current_user is not None and getattr(current_user.role, "value", current_user.role) == "SUPER_ADMIN"

    res_ext_user_ids = set((await db.execute(select(ExternalUser.user_id))).scalars().all())

    if resource_type == "dashboard":
        dash = await db.get(Dashboard, resource_id)
        if not dash:
            return None
        if dash.organization_id != organization_id:
            return None
        res_name = dash.name

        rows = (
            await db.execute(
                select(DashboardAccessPermission, User)
                .join(User, DashboardAccessPermission.user_id == User.id)
                .where(DashboardAccessPermission.dashboard_id == resource_id)
            )
        ).all()

        for perm, u in rows:
            is_u = bool(getattr(perm, "can_use_unique_value", False))
            acc = "unique_key" if is_u else "full"
            assigned_users.append(
                {
                    "permission_id": perm.id,
                    "user_id": u.id,
                    "username": u.username,
                    "full_name": u.full_name,
                    "email": u.email,
                    "role": str(getattr(u.role, "value", u.role)),
                    "is_external": u.id in res_ext_user_ids or bool(getattr(u, "is_external", False)),
                    "unique_user_key": getattr(u, "unique_user_key", None),
                    "access_type": acc,
                    "restriction_summary": resolve_effective_access_label(
                        acc,
                        getattr(perm, "filter_sub_field_key", None),
                        getattr(perm, "filter_column_configs", None),
                        getattr(u, "unique_user_key", None),
                    ),
                    "is_active": getattr(perm, "is_active", True) is not False,
                    "can_view": perm.can_view,
                    "can_edit": perm.can_edit,
                    "can_print": False,
                    "can_export": False,
                    "can_download_word": False,
                    "can_change_period": getattr(perm, "can_change_period", False),
                    "can_load_lms": getattr(perm, "can_load_lms", False),
                    "can_download_widget_pdf": getattr(perm, "can_download_widget_pdf", True),
                    "can_view_drilldown": getattr(perm, "can_view_drilldown", True),
                }
            )

    elif resource_type in ("custom_report", "report"):
        is_custom = resource_type == "custom_report"
        ModelClass = CustomReportAssignment if is_custom else ReportAccessPermission
        ParentClass = CustomReport if is_custom else ReportTemplate
        parent = await db.get(ParentClass, resource_id)
        if not parent:
            return None
        if parent.organization_id != organization_id:
            return None
        res_name = parent.name

        f_cfg = None
        sub_k = None
        if is_custom:
            f_cfg_res = await db.execute(
                select(ReportUserFilterConfiguration)
                .options(selectinload(ReportUserFilterConfiguration.sub_field))
                .where(
                    ReportUserFilterConfiguration.report_id == resource_id,
                    ReportUserFilterConfiguration.enabled == True,
                )
            )
            f_cfg = f_cfg_res.scalars().first()
            if f_cfg:
                if f_cfg.sub_field and (f_cfg.sub_field.name or f_cfg.sub_field.key):
                    sub_k = (f_cfg.sub_field.name or f_cfg.sub_field.key).strip()
                elif f_cfg.field_id:
                    sub_k = f"Field #{f_cfg.field_id}"

        col_id = ModelClass.custom_report_id if is_custom else ModelClass.report_template_id
        rows = (
            await db.execute(
                select(ModelClass, User)
                .join(User, ModelClass.user_id == User.id)
                .where(col_id == resource_id)
            )
        ).all()

        for perm, u in rows:
            u_key = getattr(u, "unique_user_key", None)
            is_unique = bool(getattr(perm, "can_use_unique_value", False))
            sub_label = getattr(perm, "filter_sub_field_key", None) if is_unique else None
            cfg_label = getattr(perm, "filter_column_configs", None) if is_unique else None

            if is_custom and is_unique:
                if not sub_label and sub_k:
                    sub_label = sub_k

            acc = "unique_key" if is_unique else "full"
            assigned_users.append(
                {
                    "permission_id": perm.id,
                    "user_id": u.id,
                    "username": u.username,
                    "full_name": u.full_name,
                    "email": u.email,
                    "role": str(getattr(u.role, "value", u.role)),
                    "is_external": u.id in res_ext_user_ids or bool(getattr(u, "is_external", False)),
                    "unique_user_key": u_key,
                    "access_type": acc,
                    "restriction_summary": resolve_effective_access_label(
                        acc, sub_label, cfg_label, u_key
                    ),
                    "is_active": getattr(perm, "is_active", True) is not False,
                    "can_view": perm.can_view,
                    "can_edit": False,
                    "can_print": getattr(perm, "can_print", False),
                    "can_export": getattr(perm, "can_export", False),
                    "can_download_word": getattr(perm, "can_download_word", False),
                    "can_change_period": getattr(perm, "can_change_period", False),
                    "can_load_lms": getattr(perm, "can_load_lms", False),
                    "can_download_widget_pdf": False,
                    "can_view_drilldown": False,
                }
            )

    return {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "resource_name": res_name,
        "assigned_users": assigned_users,
    }


async def get_dashboard_filterable_columns(
    db: AsyncSession, dashboard_id: int, org_id: int
) -> list[dict[str, Any]]:
    """Inspect dashboard layout and return available MLI columns strictly for MLIs used in the dashboard."""
    d = await db.get(Dashboard, dashboard_id)
    if not d or d.organization_id != org_id:
        return []

    layout = d.layout or {}
    widgets = []
    if isinstance(layout, list):
        widgets = layout
    elif isinstance(layout, dict) and isinstance(layout.get("widgets"), list):
        widgets = layout["widgets"]

    kpi_ids = set()
    used_mli_pairs: set[tuple[int, str]] = set()
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
        if used_mli_pairs or used_field_ids:
            is_matched = (kpi_obj.id, field_obj.key) in used_mli_pairs or field_obj.id in used_field_ids
            if not is_matched:
                continue

        key_tuple = (kpi_obj.id, field_obj.id, sub_obj.key)
        if key_tuple in seen:
            continue
        seen.add(key_tuple)
        col_name = sub_obj.name or sub_obj.key
        items.append({
            "kpi_id": kpi_obj.id,
            "kpi_title": kpi_obj.name or f"KPI #{kpi_obj.id}",
            "mli_id": field_obj.id,
            "mli_title": field_obj.name or field_obj.key,
            "sub_field_id": sub_obj.id,
            "sub_field_key": sub_obj.key,
            "column_name": col_name,
            "label": f"{col_name} ({sub_obj.key})",
        })

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
                            "column_name": sk,
                            "label": f"{sk} ({sk})",
                        })

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
                                "column_name": sk,
                                "label": f"{sk} ({sk})",
                            })

    return items


async def get_custom_report_filterable_columns(
    db: AsyncSession, report_id: int, org_id: int
) -> list[dict[str, Any]]:
    """Inspect custom report layout and return available MLI columns."""
    cr = await db.get(CustomReport, report_id)
    if not cr or cr.organization_id != org_id:
        return []

    sec_res = await db.execute(
        select(CustomReportSection).where(CustomReportSection.custom_report_id == report_id)
    )
    sections = sec_res.scalars().all()
    kpi_ids = set()
    for s in sections:
        if s.kpi_id:
            kpi_ids.add(s.kpi_id)

    fld_res = await db.execute(
        select(CustomReportField).where(CustomReportField.custom_report_id == report_id)
    )
    custom_fields = fld_res.scalars().all()
    used_field_ids = set()
    for f in custom_fields:
        if f.kpi_field_id:
            used_field_ids.add(f.kpi_field_id)

    if used_field_ids:
        kf_res = await db.execute(
            select(KPIField).where(KPIField.id.in_(list(used_field_ids)))
        )
        for kf in kf_res.scalars().all():
            kpi_ids.add(kf.kpi_id)

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
        if used_field_ids and field_obj.id not in used_field_ids:
            continue
        key_tuple = (kpi_obj.id, field_obj.id, sub_obj.key)
        if key_tuple in seen:
            continue
        seen.add(key_tuple)
        col_name = sub_obj.name or sub_obj.key
        items.append({
            "kpi_id": kpi_obj.id,
            "kpi_title": kpi_obj.name or f"KPI #{kpi_obj.id}",
            "mli_id": field_obj.id,
            "mli_title": field_obj.name or field_obj.key,
            "sub_field_id": sub_obj.id,
            "sub_field_key": sub_obj.key,
            "column_name": col_name,
            "label": f"{col_name} ({sub_obj.key})",
        })

    return items


async def get_report_template_filterable_columns(
    db: AsyncSession, template_id: int, org_id: int
) -> list[dict[str, Any]]:
    """Return available MLI columns for a standard report template."""
    rt = await db.get(ReportTemplate, template_id)
    if not rt or rt.organization_id != org_id:
        return []

    res_rtk = await db.execute(
        select(ReportTemplateKPI).where(ReportTemplateKPI.report_template_id == template_id)
    )
    rtks = res_rtk.scalars().all()
    kpi_ids = {rtk.kpi_id for rtk in rtks if rtk.kpi_id}

    if not kpi_ids:
        # Also inspect body_blocks (visual builder) for any referenced KPI IDs
        blocks = rt.body_blocks or []
        if isinstance(blocks, list):
            for b in blocks:
                if isinstance(b, dict):
                    bid = b.get("kpi_id")
                    if bid:
                        try:
                            kpi_ids.add(int(bid))
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
        key_tuple = (kpi_obj.id, field_obj.id, sub_obj.key)
        if key_tuple in seen:
            continue
        seen.add(key_tuple)
        col_name = sub_obj.name or sub_obj.key
        items.append({
            "kpi_id": kpi_obj.id,
            "kpi_title": kpi_obj.name or f"KPI #{kpi_obj.id}",
            "mli_id": field_obj.id,
            "mli_title": field_obj.name or field_obj.key,
            "sub_field_id": sub_obj.id,
            "sub_field_key": sub_obj.key,
            "column_name": col_name,
            "label": f"{col_name} ({sub_obj.key})",
        })

    return items


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
    """Consolidated bulk assign service for dashboards."""
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
    """Consolidated single assign service for dashboards."""
    dash = await db.get(Dashboard, dashboard_id)
    if not dash or dash.organization_id != org_id:
        return None
    user = (
        await db.execute(select(User).where(User.id == user_id, User.organization_id == org_id))
    ).scalar_one_or_none()
    if not user:
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
            is_active=True,
        )
        db.add(perm)
    else:
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
        perm.is_active = True

    await db.flush()
    from app.widget_data.service import invalidate_dashboard_cache
    invalidate_dashboard_cache(dashboard_id)
    return perm


async def unassign_dashboard_from_user(
    db: AsyncSession, dashboard_id: int, org_id: int, user_id: int
) -> bool:
    """Consolidated dashboard unassign."""
    dash = await db.get(Dashboard, dashboard_id)
    if not dash or dash.organization_id != org_id:
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
    target_u = await db.get(User, user_id)
    if target_u and target_u.default_dashboard_id == dashboard_id:
        target_u.default_dashboard_id = None
    await db.flush()
    from app.widget_data.service import invalidate_dashboard_cache
    invalidate_dashboard_cache(dashboard_id)
    return True


async def list_dashboard_assignments(
    db: AsyncSession, dashboard_id: int, org_id: int
) -> list[dict[str, Any]]:
    """Consolidated list dashboard assignments."""
    dash = await db.get(Dashboard, dashboard_id)
    if not dash or dash.organization_id != org_id:
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
            "is_active": getattr(perm, "is_active", True) is not False,
        }
        for perm, user in rows
    ]


async def bulk_assign_custom_report(
    db: AsyncSession,
    custom_report_id: int,
    user_ids: list[int],
    *,
    can_view: bool = True,
    can_print: bool = True,
    can_export: bool = True,
    can_change_period: bool = True,
) -> list[CustomReportAssignment]:
    """Consolidated bulk assign service for custom reports."""
    result = await db.execute(
        select(CustomReportAssignment).where(
            CustomReportAssignment.custom_report_id == custom_report_id,
            CustomReportAssignment.user_id.in_(user_ids),
        )
    )
    existing_list = result.scalars().all()
    existing_by_user_id = {a.user_id: a for a in existing_list}

    out = []
    for uid in user_ids:
        perm = existing_by_user_id.get(uid)
        if not perm:
            perm = CustomReportAssignment(
                custom_report_id=custom_report_id,
                user_id=uid,
                can_change_period=can_change_period,
                is_active=True,
            )
            db.add(perm)
        perm.can_view = can_view
        perm.can_print = can_print
        perm.can_export = can_export
        perm.can_change_period = can_change_period
        perm.is_active = True
        out.append(perm)

    await db.flush()
    return out


async def unassign_custom_report(
    db: AsyncSession, custom_report_id: int, user_id: int
) -> bool:
    """Consolidated custom report unassign."""
    result = await db.execute(
        select(CustomReportAssignment).where(
            CustomReportAssignment.custom_report_id == custom_report_id,
            CustomReportAssignment.user_id == user_id,
        )
    )
    perm = result.scalar_one_or_none()
    if not perm:
        return False
    await db.delete(perm)
    await db.flush()
    return True


async def list_custom_report_assignments(
    db: AsyncSession, custom_report_id: int
) -> list[CustomReportAssignment]:
    """Consolidated list custom report assignments."""
    result = await db.execute(
        select(CustomReportAssignment)
        .where(CustomReportAssignment.custom_report_id == custom_report_id)
        .options(selectinload(CustomReportAssignment.user))
    )
    return list(result.scalars().all())


# ===========================================================================
# SECTION 5: FASTAPI ROUTER & ENDPOINTS
# ===========================================================================

router = APIRouter(prefix="/access-management", tags=["Access Management - Rights"])


def _org_id(current_user: User, organization_id: int | None) -> int:
    oid = organization_id if current_user.role.value == "SUPER_ADMIN" and organization_id else current_user.organization_id
    if oid is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization context required")
    return oid


@router.get("/rights", response_model=RightsListResponse)
async def get_rights_list_route(
    organization_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=10000),
    user_type: str = Query("all", description="all, internal, external"),
    resource_type: str = Query("all", description="all, dashboard, report"),
    access_type: str = Query("all", description="all, full, unique_key"),
    status_filter: str = Query("all", alias="status", description="all, active, inactive"),
    search: str | None = Query(None),
    user_id: int | None = Query(None),
    resource_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List all assigned permissions across dashboards and reports with combinable filtering."""
    org_id = _org_id(current_user, organization_id)
    items, total, counts = await list_unified_rights(
        db,
        org_id,
        page=page,
        page_size=page_size,
        user_type=user_type,
        resource_type=resource_type,
        access_type=access_type,
        status=status_filter,
        search=search,
        user_id=user_id,
        resource_id=resource_id,
    )
    total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1

    return RightsListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
        active_count=counts["active_count"],
        inactive_count=counts["inactive_count"],
        full_access_count=counts["full_access_count"],
        unique_key_count=counts["unique_key_count"],
    )


@router.post("/rights/preview", response_model=BulkAssignPreviewResponse)
async def preview_bulk_assign_route(
    body: BulkAssignRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Calculate preview metrics before executing bulk assignment."""
    org_id = _org_id(current_user, organization_id)
    res = await preview_bulk_assignment(
        db,
        org_id,
        user_ids=body.user_ids,
        dashboard_ids=body.dashboard_ids,
        custom_report_ids=body.custom_report_ids,
        report_template_ids=body.report_template_ids,
        access_type=body.access_type,
        can_view=body.can_view,
        can_edit=body.can_edit,
        can_print=body.can_print,
        can_export=body.can_export,
        can_download_word=body.can_download_word,
        can_change_period=body.can_change_period,
        can_change_period_dashboards=body.can_change_period_dashboards,
        can_change_period_reports=body.can_change_period_reports,
        can_load_lms=body.can_load_lms,
        can_download_widget_pdf=body.can_download_widget_pdf if body.can_download_widget_pdf is not None else True,
        can_view_drilldown=body.can_view_drilldown if body.can_view_drilldown is not None else True,
        filter_kpi_id=body.filter_kpi_id,
        filter_mli_id=body.filter_mli_id,
        filter_sub_field_key=body.filter_sub_field_key,
        filter_column_configs=body.filter_column_configs,
        filter_operator=body.filter_operator,
    )
    return BulkAssignPreviewResponse(**res)



@router.post("/rights/bulk-assign", response_model=BulkAssignResultResponse)
async def bulk_assign_route(
    body: BulkAssignRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Execute unified bulk rights assignment across users, dashboards, and reports."""
    org_id = _org_id(current_user, organization_id)
    res = await execute_bulk_assignment(
        db,
        org_id,
        current_user,
        user_ids=body.user_ids,
        dashboard_ids=body.dashboard_ids,
        custom_report_ids=body.custom_report_ids,
        report_template_ids=body.report_template_ids,
        access_type=body.access_type,
        can_view=body.can_view,
        can_edit=body.can_edit,
        can_print=body.can_print,
        can_export=body.can_export,
        can_download_word=body.can_download_word,
        can_change_period=body.can_change_period,
        can_change_period_dashboards=body.can_change_period_dashboards,
        can_change_period_reports=body.can_change_period_reports,
        can_load_lms=body.can_load_lms,
        can_download_widget_pdf=body.can_download_widget_pdf,
        can_view_drilldown=body.can_view_drilldown,
        filter_kpi_id=body.filter_kpi_id,
        filter_mli_id=body.filter_mli_id,
        filter_sub_field_key=body.filter_sub_field_key,
        filter_column_configs=body.filter_column_configs,
        filter_operator=body.filter_operator,
    )
    return BulkAssignResultResponse(**res)


@router.patch("/rights/{resource_type}/{permission_id}")
async def update_individual_right_route(
    resource_type: ResourceType,
    permission_id: int,
    patch: RightUpdatePayload,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update individual permission attributes."""
    org_id = _org_id(current_user, organization_id)
    res = await update_individual_right(
        db,
        org_id,
        current_user,
        resource_type,
        permission_id,
        patch.model_dump(exclude_unset=True),
    )
    if not res:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Right record not found")
    return {"message": "Permission updated successfully", "id": res["id"]}


@router.delete("/rights/{resource_type}/{permission_id}")
async def revoke_individual_right_route(
    resource_type: ResourceType,
    permission_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Revoke (delete) an individual user right."""
    org_id = _org_id(current_user, organization_id)
    ok = await revoke_right(db, org_id, current_user, resource_type, permission_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Right record not found")
    return {"message": "Right revoked successfully"}


@router.post("/rights/bulk-update")
async def bulk_update_rights_route(
    body: BulkUpdateRightsRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Apply bulk updates across multiple selected rights."""
    org_id = _org_id(current_user, organization_id)
    items_dicts = [it.model_dump() for it in body.items]
    updated_count = await bulk_update_rights(
        db,
        org_id,
        current_user,
        items_dicts,
        body.action,
        filter_column_configs=body.filter_column_configs,
        filter_sub_field_key=body.filter_sub_field_key,
    )
    return {"message": f"Successfully updated {updated_count} rights", "updated_count": updated_count}


@router.post("/rights/bulk-revoke")
async def bulk_revoke_rights_route(
    body: BulkRevokeRightsRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Revoke multiple selected rights in bulk."""
    org_id = _org_id(current_user, organization_id)
    items_dicts = [it.model_dump() for it in body.items]
    revoked_count = await bulk_revoke_rights(db, org_id, current_user, items_dicts)
    return {"message": f"Successfully revoked {revoked_count} rights", "revoked_count": revoked_count}


@router.get("/users/{user_id}/rights", response_model=UserRightsSummaryResponse)
async def get_user_rights_summary_route(
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Inspect all rights and assigned resources belonging to a single user."""
    org_id = _org_id(current_user, organization_id)
    res = await get_user_rights_summary(db, org_id, user_id, current_user=current_user)
    if not res:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in organization")
    return UserRightsSummaryResponse(**res)


@router.put("/users/{user_id}/default-dashboard")
async def set_user_default_dashboard_route(
    user_id: int,
    body: SetUserDefaultDashboardRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Set or clear the default dashboard for a user."""
    org_id = _org_id(current_user, organization_id)
    target_user = await db.get(User, user_id)
    if not target_user or target_user.organization_id != org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in organization")

    if body.dashboard_id is not None:
        dash_res = await db.execute(
            select(Dashboard.id).where(
                Dashboard.id == body.dashboard_id,
                Dashboard.organization_id == org_id,
            )
        )
        if not dash_res.scalar_one_or_none():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected dashboard does not exist in this organization")

        from app.dashboards.service import user_can_access_dashboard
        can_access = await user_can_access_dashboard(db, target_user.id, body.dashboard_id, "view")
        if not can_access and getattr(target_user.role, "value", target_user.role) != "ORG_ADMIN":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User does not have active access to the selected dashboard")

        target_user.default_dashboard_id = body.dashboard_id
    else:
        target_user.default_dashboard_id = None

    await db.commit()
    await db.refresh(target_user)
    invalidate_all_access_and_report_caches(db)

    return {
        "message": "Default dashboard updated successfully",
        "user_id": target_user.id,
        "default_dashboard_id": target_user.default_dashboard_id,
    }


@router.get("/resources/{resource_type}/{resource_id}/rights", response_model=ResourceRightsSummaryResponse)
async def get_resource_rights_summary_route(
    resource_type: ResourceType,
    resource_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Inspect all authorized users belonging to a single dashboard or report."""
    org_id = _org_id(current_user, organization_id)
    res = await get_resource_rights_summary(db, org_id, resource_type, resource_id, current_user=current_user)
    if not res:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found in organization")
    return ResourceRightsSummaryResponse(**res)


@router.get("/filterable-columns", response_model=list[FilterableColumnItem])
async def get_dashboard_filterable_columns_route(
    dashboard_id: int | None = Query(None),
    custom_report_id: int | None = Query(None),
    report_template_id: int | None = Query(None),
    resource_type: str | None = Query(None),
    resource_id: int | None = Query(None),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return available MLI columns across all KPIs in a dashboard or report."""
    org_id = _org_id(current_user, organization_id)
    target_type = resource_type
    target_id = resource_id

    if dashboard_id is not None:
        target_type = "dashboard"
        target_id = dashboard_id
    elif custom_report_id is not None:
        target_type = "custom_report"
        target_id = custom_report_id
    elif report_template_id is not None:
        target_type = "report_template"
        target_id = report_template_id

    if not target_type or not target_id:
        return []

    if target_type == "dashboard":
        cols = await get_dashboard_filterable_columns(db, target_id, org_id)
    elif target_type in ("custom_report",):
        cols = await get_custom_report_filterable_columns(db, target_id, org_id)
    elif target_type in ("report", "report_template", "standard_report"):
        cols = await get_report_template_filterable_columns(db, target_id, org_id)
    else:
        cols = []

    return [FilterableColumnItem(**c) for c in cols]


@router.get("/audit", response_model=AuditLogListResponse)
async def get_rights_audit_route(
    organization_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=10000),
    user_id: int | None = Query(None),
    resource_type: str | None = Query(None),
    resource_id: int | None = Query(None),
    action: str | None = Query(None),
    search: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Retrieve audit history logs for all permission and rights mutations."""
    org_id = _org_id(current_user, organization_id)
    items, total = await list_rights_audit_logs(
        db,
        org_id,
        page=page,
        page_size=page_size,
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        action=action,
        search=search,
    )
    total_pages = max(1, (total + page_size - 1) // page_size) if total > 0 else 1
    return AuditLogListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ===========================================================================
# SECTION 6: MODULE ALIASING FOR 100% RETRO-COMPATIBILITY
# ===========================================================================

# Export router as access_management_router
access_management_router = router

# Alias this consolidated module into sys.modules under subpaths
this_module = sys.modules[__name__]
sys.modules["app.access_management"] = this_module
sys.modules["app.access_management.routes"] = this_module
sys.modules["app.access_management.service"] = this_module
sys.modules["app.access_management.schemas"] = this_module
sys.modules["app.access_management.audit"] = this_module
sys.modules["app.access_management.permission_resolution"] = this_module

__all__ = [
    "router",
    "access_management_router",
    "list_unified_rights",
    "preview_bulk_assignment",
    "execute_bulk_assignment",
    "update_individual_right",
    "bulk_update_rights",
    "revoke_right",
    "bulk_revoke_rights",
    "get_user_rights_summary",
    "get_resource_rights_summary",
    "get_dashboard_filterable_columns",
    "assign_dashboard_to_user",
    "bulk_assign_dashboards_to_users",
    "unassign_dashboard_from_user",
    "list_dashboard_assignments",
    "bulk_assign_custom_report",
    "unassign_custom_report",
    "list_custom_report_assignments",
    "record_rights_audit",
    "list_rights_audit_logs",
    "is_permission_active",
    "resolve_effective_access_label",
    "RightsListResponse",
    "BulkAssignRequest",
    "BulkAssignPreviewResponse",
    "BulkAssignResultResponse",
    "RightUpdatePayload",
    "BulkTargetItem",
    "BulkUpdateRightsRequest",
    "BulkRevokeRightsRequest",
    "UserRightsSummaryResponse",
    "SetUserDefaultDashboardRequest",
    "ResourceRightsSummaryResponse",
    "FilterableColumnItem",
    "AuditLogListResponse",
]
