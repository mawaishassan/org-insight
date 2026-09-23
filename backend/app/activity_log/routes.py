"""FastAPI router endpoints for User Activity Monitoring & Audit Trail."""

from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, BackgroundTasks, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.models import User, UserRole
from app.auth.dependencies import get_current_user, require_org_admin
from app.activity_log.schemas import (
    ClientActivityEvent,
    ActivityLogListResponse,
    ActivitySummaryResponse,
    UserOverviewListResponse,
)
from app.activity_log.service import (
    log_activity_async,
    get_activity_summary,
    query_activity_logs,
    query_users_overview,
    generate_activity_export,
)

router = APIRouter(prefix="/activity-logs", tags=["Activity Monitoring"])


# ============================================================================
# 1. CLIENT ACTION EVENT INGESTION (NON-BLOCKING)
# ============================================================================

@router.post("/event", status_code=status.HTTP_202_ACCEPTED)
async def track_client_event(
    event: ClientActivityEvent,
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
):
    """Receives client-side UI activity events and logs them in the background."""
    if not current_user.organization_id:
        return {"status": "skipped", "reason": "No organization"}

    remote_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")

    # Enqueue background activity logging
    background_tasks.add_task(
        log_activity_async,
        organization_id=current_user.organization_id,
        user_id=current_user.id,
        unique_user_key=current_user.unique_user_key or current_user.username,
        user_name=current_user.full_name or current_user.username,
        user_email=current_user.email,
        module=event.module,
        resource_type=event.resource_type,
        resource_id=event.resource_id,
        resource_name=event.resource_name,
        action_type=event.action_type,
        action_details=event.action_details or event.details,
        reporting_period=event.reporting_period or event.period,
        kpi_id=event.kpi_id,
        dashboard_id=event.dashboard_id,
        widget_id=event.widget_id,
        records_affected=event.records_affected,
        status=event.status,
        error_message=event.error_message,
        ip_address=remote_ip,
        user_agent=user_agent,
        meta_data=event.meta_data,
    )

    return {"status": "accepted"}


# ============================================================================
# 2. ORG ADMIN ACTIVITY SUMMARY & STATS
# ============================================================================

@router.get("/summary", response_model=ActivitySummaryResponse)
async def get_summary_statistics(
    days: int = Query(30, ge=1, le=365),
    organization_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns overview KPI cards, activity counts, trends, and module distributions."""
    if current_user.role not in [UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only Organization Admins can view activity logs.",
        )

    target_org_id = current_user.organization_id
    if current_user.role == UserRole.SUPER_ADMIN:
        target_org_id = organization_id or current_user.organization_id
    elif not target_org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must belong to an organization to view activity logs.",
        )

    return await get_activity_summary(db=db, organization_id=target_org_id, days=days)


# ============================================================================
# 3. PAGINATED SEARCHABLE ACTIVITY LOGS
# ============================================================================

@router.get("", response_model=ActivityLogListResponse)
async def list_activity_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    module: Optional[str] = Query(None),
    action_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    faculty: Optional[str] = Query(None),
    department: Optional[str] = Query(None),
    campus: Optional[str] = Query(None),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    organization_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetches paginated, searchable, and filtered activity log records."""
    if current_user.role not in [UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Organization Admins can view logs.")

    target_org_id = current_user.organization_id
    if current_user.role == UserRole.SUPER_ADMIN:
        target_org_id = organization_id or current_user.organization_id
    elif not target_org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No organization context.")

    items, total = await query_activity_logs(
        db=db,
        organization_id=target_org_id,
        page=page,
        page_size=page_size,
        search=search,
        user_id=user_id,
        module=module,
        action_type=action_type,
        status=status_filter,
        faculty=faculty,
        department=department,
        campus=campus,
        start_date=start_date,
        end_date=end_date,
    )

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1

    return ActivityLogListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ============================================================================
# 4. USERS LOGIN & STATUS OVERVIEW
# ============================================================================

@router.get("/users-overview", response_model=UserOverviewListResponse)
async def list_users_overview(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    search: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None),
    organization_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Returns a list of all End Users and their login counters, last login, and activity status."""
    if current_user.role not in [UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Organization Admins can view users overview.")

    target_org_id = current_user.organization_id
    if current_user.role == UserRole.SUPER_ADMIN:
        target_org_id = organization_id or current_user.organization_id
    elif not target_org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No organization context.")

    items, total = await query_users_overview(
        db=db,
        organization_id=target_org_id,
        page=page,
        page_size=page_size,
        search=search,
        status_filter=status_filter,
    )

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1

    return UserOverviewListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ============================================================================
# 5. ACTIVITY LOGS EXPORT (CSV / EXCEL)
# ============================================================================

@router.get("/export")
async def export_logs(
    format_type: str = Query("csv", regex="^(csv|xlsx)$"),
    search: Optional[str] = Query(None),
    user_id: Optional[int] = Query(None),
    module: Optional[str] = Query(None),
    action_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    start_date: Optional[datetime] = Query(None),
    end_date: Optional[datetime] = Query(None),
    organization_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Streams an exported CSV or Excel sheet of the filtered activity logs."""
    if current_user.role not in [UserRole.ORG_ADMIN, UserRole.SUPER_ADMIN]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    target_org_id = current_user.organization_id
    if current_user.role == UserRole.SUPER_ADMIN:
        target_org_id = organization_id or current_user.organization_id
    elif not target_org_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")

    content, media_type, filename = await generate_activity_export(
        db=db,
        organization_id=target_org_id,
        format_type=format_type,
        search=search,
        user_id=user_id,
        module=module,
        action_type=action_type,
        status=status_filter,
        start_date=start_date,
        end_date=end_date,
    )

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
