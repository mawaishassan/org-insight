"""
Unified Effective Access Resolver for Dashboards and Reports.
Provides a single source of truth for resolving user permissions, access modes (Full vs Unique Key-Based),
and filter configurations. Enforces strict fail-closed security rules.
"""

from dataclasses import dataclass
from typing import Any, Literal
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import (
    User,
    UserRole,
    Dashboard,
    ReportTemplate,
    CustomReport,
    DashboardAccessPermission,
    ReportAccessPermission,
    CustomReportAssignment,
)

ResourceType = Literal["dashboard", "report", "custom_report"]
AccessType = Literal["full", "unique_key"]


@dataclass
class EffectiveAccess:
    user_id: int
    resource_type: ResourceType
    resource_id: int
    access_type: AccessType = "full"
    is_active: bool = True
    can_view: bool = True
    can_edit: bool = False
    can_print: bool = True
    can_export: bool = True
    can_download_word: bool = True
    can_change_period: bool = True
    can_load_lms: bool = True
    can_view_drilldown: bool = True
    can_download_widget_pdf: bool = True
    user_unique_key: str | None = None
    filter_sub_field_key: str | None = None
    filter_column_configs: dict[str, Any] | None = None
    filter_kpi_id: int | None = None
    filter_mli_id: int | None = None
    filter_operator: str = "="
    is_satisfiable: bool = True  # Set to False if access_type == 'unique_key' but key is missing/empty


async def resolve_effective_user_access(
    db: AsyncSession,
    user: User,
    resource_type: ResourceType,
    resource_id: int,
    organization_id: int | None = None,
) -> EffectiveAccess:
    """
    Resolves authoritative access permissions and mode for a given user and resource.
    
    Rules:
    1. Organization Boundary: The resource must exist and belong to the user's active organization.
       If the resource belongs to another organization, fail closed (No Access).
    2. SUPER_ADMIN and ORG_ADMIN have Full Access within their active organization.
    3. End Users (USER, REPORT_VIEWER, etc.) inherit permissions from the respective
       assignment record (DashboardAccessPermission, CustomReportAssignment, or ReportAccessPermission).
    4. If access_type == "unique_key" (can_use_unique_value == True), user MUST have a non-empty unique_user_key.
       If unique_user_key is missing/empty, is_satisfiable is set to False (FAIL CLOSED).
    """
    user_id = user.id
    role_str = str(getattr(user.role, "value", user.role) or "").upper()
    u_key = str(getattr(user, "unique_user_key", "") or "").strip() or None

    # Determine target organization
    if role_str == "SUPER_ADMIN":
        target_org_id = organization_id if organization_id is not None else user.organization_id
    else:
        target_org_id = user.organization_id

    # 1. Organization Boundary & Existence Check
    resource_org_id: int | None = None
    if resource_type == "dashboard":
        dash = (await db.execute(select(Dashboard).where(Dashboard.id == resource_id))).scalar_one_or_none()
        if not dash:
            return EffectiveAccess(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                access_type="full",
                is_active=False,
                can_view=False,
                can_edit=False,
                can_print=False,
                can_export=False,
                can_download_word=False,
                can_change_period=False,
                can_load_lms=False,
                can_view_drilldown=False,
                can_download_widget_pdf=False,
                is_satisfiable=False,
            )
        resource_org_id = dash.organization_id
    elif resource_type == "custom_report":
        cr = (await db.execute(select(CustomReport).where(CustomReport.id == resource_id))).scalar_one_or_none()
        if not cr:
            return EffectiveAccess(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                access_type="full",
                is_active=False,
                can_view=False,
                can_edit=False,
                can_print=False,
                can_export=False,
                can_download_word=False,
                can_change_period=False,
                can_load_lms=False,
                can_view_drilldown=False,
                can_download_widget_pdf=False,
                is_satisfiable=False,
            )
        resource_org_id = cr.organization_id
    elif resource_type == "report":
        rt = (await db.execute(select(ReportTemplate).where(ReportTemplate.id == resource_id))).scalar_one_or_none()
        if not rt:
            return EffectiveAccess(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                access_type="full",
                is_active=False,
                can_view=False,
                can_edit=False,
                can_print=False,
                can_export=False,
                can_download_word=False,
                can_change_period=False,
                can_load_lms=False,
                can_view_drilldown=False,
                can_download_widget_pdf=False,
                is_satisfiable=False,
            )
        resource_org_id = rt.organization_id

    # If organization is mismatched, fail closed immediately
    if target_org_id is not None and resource_org_id != target_org_id:
        return EffectiveAccess(
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            access_type="full",
            is_active=False,
            can_view=False,
            can_edit=False,
            can_print=False,
            can_export=False,
            can_download_word=False,
            can_change_period=False,
            can_load_lms=False,
            can_view_drilldown=False,
            can_download_widget_pdf=False,
            is_satisfiable=False,
        )

    # Admin bypass within the verified organization
    if role_str in ("SUPER_ADMIN", "ORG_ADMIN"):
        return EffectiveAccess(
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            access_type="full",
            is_active=True,
            can_view=True,
            can_edit=True,
            can_print=True,
            can_export=True,
            can_download_word=True,
            can_change_period=True,
            can_load_lms=True,
            can_view_drilldown=True,
            can_download_widget_pdf=True,
            user_unique_key=u_key,
            is_satisfiable=True,
        )

    if resource_type == "dashboard":
        res = await db.execute(
            select(DashboardAccessPermission).where(
                DashboardAccessPermission.dashboard_id == resource_id,
                DashboardAccessPermission.user_id == user_id,
            )
        )
        perm = res.scalar_one_or_none()
        if not perm or getattr(perm, "is_active", True) is False:
            # Not assigned or inactive -> No view access
            return EffectiveAccess(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                access_type="full",
                is_active=False,
                can_view=False,
                can_edit=False,
                can_print=False,
                can_export=False,
                can_download_word=False,
                can_change_period=False,
                can_load_lms=False,
                can_view_drilldown=False,
                can_download_widget_pdf=False,
                is_satisfiable=False,
            )

        target_unique = bool(getattr(perm, "can_use_unique_value", False))
        access_type: AccessType = "unique_key" if target_unique else "full"
        is_sat = True
        if access_type == "unique_key" and not u_key:
            is_sat = False

        return EffectiveAccess(
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            access_type=access_type,
            is_active=True,
            can_view=bool(getattr(perm, "can_view", True)),
            can_edit=bool(getattr(perm, "can_edit", False)),
            can_print=bool(getattr(perm, "can_print", False)),
            can_export=bool(getattr(perm, "can_export", False)),
            can_download_word=bool(getattr(perm, "can_download_word", False)),
            can_change_period=bool(getattr(perm, "can_change_period", True)),
            can_load_lms=bool(getattr(perm, "can_load_lms", True)),
            can_view_drilldown=bool(getattr(perm, "can_view_drilldown", True)),
            can_download_widget_pdf=bool(getattr(perm, "can_download_widget_pdf", True)),
            user_unique_key=u_key,
            filter_sub_field_key=getattr(perm, "filter_sub_field_key", None),
            filter_column_configs=getattr(perm, "filter_column_configs", None),
            filter_kpi_id=getattr(perm, "filter_kpi_id", None),
            filter_mli_id=getattr(perm, "filter_mli_id", None),
            filter_operator=getattr(perm, "filter_operator", "=") or "=",
            is_satisfiable=is_sat,
        )

    elif resource_type == "custom_report":
        res = await db.execute(
            select(CustomReportAssignment).where(
                CustomReportAssignment.custom_report_id == resource_id,
                CustomReportAssignment.user_id == user_id,
            )
        )
        perm = res.scalar_one_or_none()
        if not perm or getattr(perm, "is_active", True) is False:
            return EffectiveAccess(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                access_type="full",
                is_active=False,
                can_view=False,
                can_edit=False,
                can_print=False,
                can_export=False,
                can_download_word=False,
                can_change_period=False,
                can_load_lms=False,
                can_view_drilldown=False,
                can_download_widget_pdf=False,
                is_satisfiable=False,
            )

        # Access mode is now stored per-user on CustomReportAssignment (not per-report via
        # ReportUserFilterConfiguration). This prevents one user's mode change from
        # affecting all other users assigned to the same report.
        target_unique = bool(getattr(perm, "can_use_unique_value", False))
        access_type: AccessType = "unique_key" if target_unique else "full"
        is_sat = True
        if access_type == "unique_key" and not u_key:
            is_sat = False

        return EffectiveAccess(
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            access_type=access_type,
            is_active=True,
            can_view=bool(getattr(perm, "can_view", True)),
            can_edit=False,
            can_print=bool(getattr(perm, "can_print", False)),
            can_export=bool(getattr(perm, "can_export", False)),
            can_download_word=bool(getattr(perm, "can_download_word", False)),
            can_change_period=bool(getattr(perm, "can_change_period", True)),
            can_load_lms=bool(getattr(perm, "can_load_lms", True)),
            can_view_drilldown=True,
            can_download_widget_pdf=True,
            user_unique_key=u_key,
            filter_sub_field_key=getattr(perm, "filter_sub_field_key", None),
            filter_column_configs=getattr(perm, "filter_column_configs", None),
            filter_kpi_id=getattr(perm, "filter_kpi_id", None),
            filter_mli_id=getattr(perm, "filter_mli_id", None),
            filter_operator=getattr(perm, "filter_operator", "=") or "=",
            is_satisfiable=is_sat,
        )

    elif resource_type == "report":
        res = await db.execute(
            select(ReportAccessPermission).where(
                ReportAccessPermission.report_template_id == resource_id,
                ReportAccessPermission.user_id == user_id,
            )
        )
        perm = res.scalar_one_or_none()
        if not perm or getattr(perm, "is_active", True) is False:
            return EffectiveAccess(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                access_type="full",
                is_active=False,
                can_view=False,
                can_edit=False,
                can_print=False,
                can_export=False,
                can_download_word=False,
                can_change_period=False,
                can_load_lms=False,
                can_view_drilldown=False,
                can_download_widget_pdf=False,
                is_satisfiable=False,
            )

        target_unique = bool(getattr(perm, "can_use_unique_value", False))
        access_type: AccessType = "unique_key" if target_unique else "full"
        is_sat = True
        if access_type == "unique_key" and not u_key:
            is_sat = False

        return EffectiveAccess(
            user_id=user_id,
            resource_type=resource_type,
            resource_id=resource_id,
            access_type=access_type,
            is_active=True,
            can_view=bool(getattr(perm, "can_view", True)),
            can_edit=False,
            can_print=bool(getattr(perm, "can_print", False)),
            can_export=bool(getattr(perm, "can_export", False)),
            can_download_word=bool(getattr(perm, "can_download_word", False)),
            can_change_period=bool(getattr(perm, "can_change_period", True)),
            can_load_lms=bool(getattr(perm, "can_load_lms", True)),
            can_view_drilldown=True,
            can_download_widget_pdf=True,
            user_unique_key=u_key,
            filter_sub_field_key=getattr(perm, "filter_sub_field_key", None),
            filter_column_configs=getattr(perm, "filter_column_configs", None),
            filter_kpi_id=getattr(perm, "filter_kpi_id", None),
            filter_mli_id=getattr(perm, "filter_mli_id", None),
            filter_operator=getattr(perm, "filter_operator", "=") or "=",
            is_satisfiable=is_sat,
        )

    # Fallback default
    return EffectiveAccess(
        user_id=user_id,
        resource_type=resource_type,
        resource_id=resource_id,
        access_type="full",
        is_active=True,
    )
