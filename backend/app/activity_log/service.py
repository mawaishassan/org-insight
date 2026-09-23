"""Centralized, non-blocking service for Activity Monitoring & Audit Trail."""

from __future__ import annotations

import io
import csv
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import select, func, and_, or_, desc, update, literal_column
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal
from app.core.models import (
    User,
    UserRole,
    Organization,
    UserSession,
    UserActivity,
    utc_now,
)
from app.activity_log.schemas import (
    ActivityLogItem,
    UserStats,
    ActivityStats,
    DailyTrendPoint,
    ModuleBreakdownItem,
    TopActiveUser,
    ActivitySummaryResponse,
    UserOverviewItem,
    PKT,
)

logger = logging.getLogger(__name__)


# ============================================================================
# 1. NON-BLOCKING EVENT LOGGING ENGINE
# ============================================================================

async def log_activity_async(
    organization_id: int,
    user_id: int,
    module: str,
    resource_type: str,
    action_type: str,
    session_id: Optional[str] = None,
    unique_user_key: Optional[str] = None,
    user_name: Optional[str] = None,
    user_email: Optional[str] = None,
    department: Optional[str] = None,
    faculty: Optional[str] = None,
    campus: Optional[str] = None,
    resource_id: Optional[str] = None,
    resource_name: Optional[str] = None,
    action_details: Optional[str] = None,
    reporting_period: Optional[str] = None,
    kpi_id: Optional[int] = None,
    dashboard_id: Optional[int] = None,
    widget_id: Optional[str] = None,
    status: str = "SUCCESS",
    error_message: Optional[str] = None,
    records_affected: Optional[int] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    meta_data: Optional[Dict[str, Any]] = None,
) -> None:
    """Non-blocking background activity logging.

    Uses an independent database session so failure never impedes or rolls back
    the primary operation.
    """
    if not organization_id or not user_id:
        return

    try:
        async with AsyncSessionLocal() as db:
            now = utc_now()

            # Resolve user details if not provided
            if not user_name or not unique_user_key or not user_email:
                u = await db.get(User, user_id)
                if u:
                    user_name = user_name or u.full_name or u.username
                    unique_user_key = unique_user_key or u.unique_user_key or u.username
                    user_email = user_email or u.email
                    u.last_activity_at = now

            activity = UserActivity(
                organization_id=organization_id,
                user_id=user_id,
                session_id=session_id,
                unique_user_key=unique_user_key,
                user_name=user_name,
                user_email=user_email,
                department=department,
                faculty=faculty,
                campus=campus,
                module=module.upper(),
                resource_type=resource_type.lower(),
                resource_id=str(resource_id) if resource_id is not None else None,
                resource_name=resource_name,
                action_type=action_type.upper(),
                action_details=action_details,
                reporting_period=reporting_period,
                kpi_id=kpi_id,
                dashboard_id=dashboard_id,
                widget_id=str(widget_id) if widget_id is not None else None,
                status=status.upper(),
                error_message=error_message,
                records_affected=records_affected,
                ip_address=ip_address,
                user_agent=user_agent,
                meta_data=meta_data,
                created_at=now,
            )
            db.add(activity)

            # Update session last activity time if session exists
            if session_id:
                stmt = (
                    update(UserSession)
                    .where(UserSession.session_id == session_id)
                    .values(last_activity_time=now)
                )
                await db.execute(stmt)

            await db.commit()
    except Exception as exc:
        logger.warning("Activity logging encountered an error (ignored to preserve user flow): %s", exc)


async def record_user_login(
    db: AsyncSession,
    user: User,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> str:
    """Records a user login, creates a session, updates counters, and logs activity."""
    session_id = str(uuid.uuid4())
    now = utc_now()

    # 1. Update user login counters
    user.last_login_at = now
    user.last_activity_at = now
    user.login_count = (user.login_count or 0) + 1

    # 2. Create session record
    session_record = UserSession(
        session_id=session_id,
        user_id=user.id,
        organization_id=user.organization_id,
        ip_address=ip_address,
        user_agent=user_agent,
        login_time=now,
        last_activity_time=now,
        status="ACTIVE",
    )
    db.add(session_record)

    # 3. Create Login activity
    activity = UserActivity(
        organization_id=user.organization_id,
        user_id=user.id,
        session_id=session_id,
        unique_user_key=user.unique_user_key or user.username,
        user_name=user.full_name or user.username,
        user_email=user.email,
        module="AUTH",
        resource_type="session",
        resource_id=session_id,
        resource_name="User Session",
        action_type="LOGIN",
        action_details=f"Successful login for user '{user.username}'",
        status="SUCCESS",
        ip_address=ip_address,
        user_agent=user_agent,
        created_at=now,
    )
    db.add(activity)
    await db.commit()

    return session_id


async def record_user_logout(
    db: AsyncSession,
    user: User,
    session_id: Optional[str] = None,
) -> None:
    """Marks a user session as logged out and logs activity."""
    now = utc_now()
    if session_id:
        stmt = (
            update(UserSession)
            .where(UserSession.session_id == session_id)
            .values(status="LOGGED_OUT", logout_time=now)
        )
        await db.execute(stmt)

    activity = UserActivity(
        organization_id=user.organization_id,
        user_id=user.id,
        session_id=session_id,
        unique_user_key=user.unique_user_key or user.username,
        user_name=user.full_name or user.username,
        user_email=user.email,
        module="AUTH",
        resource_type="session",
        resource_id=session_id,
        resource_name="User Session",
        action_type="LOGOUT",
        action_details=f"User '{user.username}' logged out",
        status="SUCCESS",
        created_at=now,
    )
    db.add(activity)
    await db.commit()


# ============================================================================
# 2. QUERY & SUMMARY STATISTICS ENGINE
# ============================================================================

async def get_activity_summary(
    db: AsyncSession,
    organization_id: Optional[int] = None,
    days: int = 30,
) -> ActivitySummaryResponse:
    """Calculates all KPI cards, trends, and breakdown charts for the Org Admin or Super Admin."""
    now = utc_now()
    PKT = timezone(timedelta(hours=5), name="PKT")
    now_pkt = datetime.now(timezone.utc).astimezone(PKT)
    pkt_today_midnight = datetime(now_pkt.year, now_pkt.month, now_pkt.day, 0, 0, 0, tzinfo=PKT)
    # Convert to naive UTC for DB timestamp comparison
    today_start = pkt_today_midnight.astimezone(timezone.utc).replace(tzinfo=None)
    week_start = (pkt_today_midnight - timedelta(days=7)).astimezone(timezone.utc).replace(tzinfo=None)
    month_start = (pkt_today_midnight - timedelta(days=30)).astimezone(timezone.utc).replace(tzinfo=None)
    active_cutoff = now - timedelta(minutes=15)

    # A. User Statistics
    # Total Users in organization scope (excluding global super admin)
    user_filter_conditions = [
        User.is_active.is_(True),
    ]
    if organization_id is not None:
        user_filter_conditions.append(User.organization_id == organization_id)
        user_filter_conditions.append(User.role != UserRole.SUPER_ADMIN)
    org_user_filter = and_(*user_filter_conditions)

    total_end_users_res = await db.execute(select(func.count(User.id)).where(org_user_filter))
    total_end_users = total_end_users_res.scalar() or 0

    never_logged_in_res = await db.execute(
        select(func.count(User.id)).where(
            org_user_filter,
            or_(User.last_login_at.is_(None), User.login_count == 0),
        )
    )
    never_logged_in = never_logged_in_res.scalar() or 0

    # 1. Total real login actions recorded today in UserActivity
    today_login_conditions = [
        UserActivity.created_at >= today_start,
        UserActivity.action_type == "LOGIN",
    ]
    if organization_id is not None:
        today_login_conditions.append(UserActivity.organization_id == organization_id)
    today_logins_res = await db.execute(
        select(func.count(UserActivity.id)).where(and_(*today_login_conditions))
    )
    logins_today_events = today_logins_res.scalar() or 0

    # 2. Users with last_login_at today
    logged_today_res = await db.execute(
        select(func.count(User.id)).where(
            org_user_filter,
            User.last_login_at >= today_start,
        )
    )
    user_last_login_today = logged_today_res.scalar() or 0
    users_logged_in_today = max(logins_today_events, user_last_login_today)

    # 3. Active users in past 7 days (distinct users with activity or logins)
    week_active_conditions = [
        UserActivity.created_at >= week_start,
    ]
    if organization_id is not None:
        week_active_conditions.append(UserActivity.organization_id == organization_id)
    week_active_res = await db.execute(
        select(func.count(func.distinct(UserActivity.user_id))).where(and_(*week_active_conditions))
    )
    unique_active_week = week_active_res.scalar() or 0

    logged_week_res = await db.execute(
        select(func.count(User.id)).where(
            org_user_filter,
            User.last_login_at >= week_start,
        )
    )
    user_last_login_week = logged_week_res.scalar() or 0
    users_logged_in_week = max(unique_active_week, user_last_login_week)

    logged_month_res = await db.execute(
        select(func.count(User.id)).where(
            org_user_filter,
            User.last_login_at >= month_start,
        )
    )
    users_logged_in_month = logged_month_res.scalar() or 0

    # Currently active (active within last 15 minutes)
    active_users_res = await db.execute(
        select(func.count(User.id)).where(
            org_user_filter,
            User.last_activity_at >= active_cutoff,
        )
    )
    currently_active = active_users_res.scalar() or 0

    user_stats = UserStats(
        total_end_users=total_end_users,
        users_logged_in_today=users_logged_in_today,
        users_logged_in_week=users_logged_in_week,
        users_logged_in_month=users_logged_in_month,
        never_logged_in=never_logged_in,
        currently_active=currently_active,
    )

    # B. Activity Statistics (past `days` days)
    activity_cutoff = now - timedelta(days=days)
    act_conditions = [UserActivity.created_at >= activity_cutoff]
    if organization_id is not None:
        act_conditions.append(UserActivity.organization_id == organization_id)
    act_base = and_(*act_conditions)

    total_activities_res = await db.execute(select(func.count(UserActivity.id)).where(act_base))
    total_activities = total_activities_res.scalar() or 0

    # Count specific action types
    counts_query = (
        select(UserActivity.action_type, func.count(UserActivity.id))
        .where(act_base)
        .group_by(UserActivity.action_type)
    )
    counts_res = await db.execute(counts_query)
    action_counts = dict(counts_res.fetchall())

    reports_viewed = action_counts.get("VIEW", 0) + action_counts.get("OPEN", 0)
    reports_downloaded = (
        action_counts.get("DOWNLOAD_PDF", 0)
        + action_counts.get("DOWNLOAD_EXCEL", 0)
        + action_counts.get("DOWNLOAD_WORD", 0)
        + action_counts.get("DOWNLOAD_CSV", 0)
        + action_counts.get("PRINT", 0)
    )
    dashboards_viewed = action_counts.get("DASHBOARD_VIEW", 0) + action_counts.get("WIDGET_VIEW", 0)
    dashboard_drilldowns = action_counts.get("DRILL_DOWN", 0)
    drilldown_downloads = action_counts.get("DRILLDOWN_DOWNLOAD_PDF", 0) + action_counts.get("DRILLDOWN_DOWNLOAD_EXCEL", 0)
    kpi_data_saved = action_counts.get("SAVE", 0) + action_counts.get("DATA_SAVED", 0)
    kpi_data_submitted = action_counts.get("SUBMIT", 0) + action_counts.get("SUBMISSION_COMPLETED", 0)
    kpi_data_updated = action_counts.get("UPDATE", 0) + action_counts.get("DATA_UPDATED", 0)

    activity_stats = ActivityStats(
        total_activities=total_activities,
        reports_viewed=reports_viewed,
        reports_downloaded=reports_downloaded,
        dashboards_viewed=dashboards_viewed,
        dashboard_drilldowns=dashboard_drilldowns,
        drilldown_downloads=drilldown_downloads,
        kpi_data_saved=kpi_data_saved,
        kpi_data_submitted=kpi_data_submitted,
        kpi_data_updated=kpi_data_updated,
    )

    # C. Daily Trend Points (last 30 days in Pakistan Standard Time)
    history_days = max(days, 30)
    trend_cutoff_pkt = pkt_today_midnight - timedelta(days=history_days)
    trend_cutoff = trend_cutoff_pkt.astimezone(timezone.utc).replace(tzinfo=None)
    trend_conditions = [UserActivity.created_at >= trend_cutoff]
    if organization_id is not None:
        trend_conditions.append(UserActivity.organization_id == organization_id)

    # Shift UTC timestamp by +5 hours to group by Pakistan date
    trend_query = (
        select(
            func.date(UserActivity.created_at + timedelta(hours=5)).label("day"),
            func.count(UserActivity.id).label("count"),
        )
        .where(and_(*trend_conditions))
        .group_by(literal_column("day"))
        .order_by(literal_column("day"))
    )
    trend_res = await db.execute(trend_query)
    trend_dict = {str(r[0]): r[1] for r in trend_res.fetchall()}

    login_trend_query = (
        select(
            func.date(UserActivity.created_at + timedelta(hours=5)).label("day"),
            func.count(UserActivity.id).label("count"),
        )
        .where(and_(*trend_conditions, UserActivity.action_type == "LOGIN"))
        .group_by(literal_column("day"))
        .order_by(literal_column("day"))
    )
    login_trend_res = await db.execute(login_trend_query)
    login_trend_dict = {str(r[0]): r[1] for r in login_trend_res.fetchall()}

    active_users_trend_query = (
        select(
            func.date(UserActivity.created_at + timedelta(hours=5)).label("day"),
            func.count(func.distinct(UserActivity.user_id)).label("count"),
        )
        .where(and_(*trend_conditions))
        .group_by(literal_column("day"))
        .order_by(literal_column("day"))
    )
    active_users_trend_res = await db.execute(active_users_trend_query)
    active_users_trend_dict = {str(r[0]): r[1] for r in active_users_trend_res.fetchall()}

    daily_trend: List[DailyTrendPoint] = []
    for i in range(history_days - 1, -1, -1):
        day_str = (now_pkt - timedelta(days=i)).strftime("%Y-%m-%d")
        daily_trend.append(
            DailyTrendPoint(
                date=day_str,
                count=trend_dict.get(day_str, 0),
                logins=login_trend_dict.get(day_str, 0),
                active_users=active_users_trend_dict.get(day_str, 0),
            )
        )

    # D. Module Breakdown
    module_query = (
        select(UserActivity.module, func.count(UserActivity.id))
        .where(act_base)
        .group_by(UserActivity.module)
    )
    module_res = await db.execute(module_query)
    module_rows = module_res.fetchall()
    module_breakdown: List[ModuleBreakdownItem] = []
    for mod, count in module_rows:
        pct = (count / total_activities * 100.0) if total_activities > 0 else 0.0
        module_breakdown.append(ModuleBreakdownItem(module=mod, count=count, percentage=round(pct, 1)))

    # E. Top Active Users (grouped strictly by user_id so each user has only 1 card)
    top_users_query = (
        select(
            UserActivity.user_id,
            func.coalesce(func.max(User.full_name), func.max(User.username), func.max(UserActivity.user_name)).label("user_name"),
            func.coalesce(func.max(User.unique_user_key), func.max(UserActivity.unique_user_key)).label("unique_user_key"),
            func.count(UserActivity.id).label("count"),
        )
        .outerjoin(User, User.id == UserActivity.user_id)
        .where(and_(act_base, UserActivity.user_id.isnot(None)))
        .group_by(UserActivity.user_id)
        .order_by(desc("count"))
        .limit(5)
    )
    top_users_res = await db.execute(top_users_query)
    top_active_users = [
        TopActiveUser(
            user_id=r[0],
            user_name=r[1] or "Unknown",
            unique_user_key=r[2],
            activity_count=r[3],
        )
        for r in top_users_res.fetchall()
    ]

    # Calculate activities today
    today_conditions = [UserActivity.created_at >= today_start]
    if organization_id is not None:
        today_conditions.append(UserActivity.organization_id == organization_id)
    today_activities_res = await db.execute(
        select(func.count(UserActivity.id)).where(and_(*today_conditions))
    )
    activities_today = today_activities_res.scalar() or 0

    return ActivitySummaryResponse(
        user_stats=user_stats,
        activity_stats=activity_stats,
        daily_trend=daily_trend,
        module_breakdown=module_breakdown,
        top_active_users=top_active_users,
        total_activities=total_activities,
        total_users=total_end_users,
        active_users_7d=users_logged_in_week,
        logins_today=users_logged_in_today,
        activities_today=activities_today,
        daily_trends=daily_trend,
        top_users=top_active_users,
    )


# ============================================================================
# 3. PAGINATED SEARCH & FILTER QUERY
# ============================================================================

async def query_activity_logs(
    db: AsyncSession,
    organization_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 25,
    search: Optional[str] = None,
    user_id: Optional[int] = None,
    module: Optional[str] = None,
    action_type: Optional[str] = None,
    status: Optional[str] = None,
    faculty: Optional[str] = None,
    department: Optional[str] = None,
    campus: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> Tuple[List[UserActivity], int]:
    """Retrieves paginated, filtered activity logs."""
    conditions = []
    if organization_id is not None:
        conditions.append(UserActivity.organization_id == organization_id)

    if user_id:
        conditions.append(UserActivity.user_id == user_id)
    if module and module.strip():
        mod_upper = module.upper().strip()
        if mod_upper in ["REPORT", "REPORTS"]:
            conditions.append(UserActivity.module.in_(["REPORT", "REPORTS"]))
        elif mod_upper in ["DASHBOARD", "DASHBOARDS"]:
            conditions.append(UserActivity.module.in_(["DASHBOARD", "DASHBOARDS"]))
        elif mod_upper in ["DATA_ENTRY", "KPI", "KPIS"]:
            conditions.append(UserActivity.module.in_(["DATA_ENTRY", "KPI", "KPIS"]))
        elif mod_upper in ["DRILLDOWN", "DRILL_DOWN"]:
            conditions.append(UserActivity.module.in_(["DRILLDOWN", "DRILL_DOWN"]))
        elif mod_upper in ["AUTH", "AUTHENTICATION"]:
            conditions.append(UserActivity.module.in_(["AUTH", "AUTHENTICATION"]))
        else:
            conditions.append(UserActivity.module.ilike(f"%{mod_upper}%"))

    if action_type and action_type.strip():
        act_upper = action_type.upper().strip()
        if act_upper in ["DRILL_DOWN", "DRILLDOWN"]:
            conditions.append(UserActivity.action_type.in_(["DRILL_DOWN", "DRILLDOWN"]))
        elif act_upper in ["VIEW", "OPEN"]:
            conditions.append(UserActivity.action_type.in_(["VIEW", "OPEN", "DASHBOARD_VIEW", "WIDGET_VIEW"]))
        elif act_upper in ["EXPORT", "DOWNLOAD"]:
            conditions.append(UserActivity.action_type.ilike("%DOWNLOAD%"))
        else:
            conditions.append(UserActivity.action_type == act_upper)

    if status and status.strip():
        conditions.append(UserActivity.status == status.upper().strip())

    if faculty:
        conditions.append(UserActivity.faculty.ilike(f"%{faculty.strip()}%"))
    if department:
        conditions.append(UserActivity.department.ilike(f"%{department.strip()}%"))
    if campus:
        conditions.append(UserActivity.campus.ilike(f"%{campus.strip()}%"))

    if start_date:
        # Strip timezone for PostgreSQL TIMESTAMP WITHOUT TIME ZONE
        if start_date.tzinfo is not None:
            start_date = start_date.replace(tzinfo=None)
        conditions.append(UserActivity.created_at >= start_date)

    if end_date:
        if end_date.tzinfo is not None:
            end_date = end_date.replace(tzinfo=None)
        # If time is 00:00:00 (date only), include through the entire day
        if end_date.hour == 0 and end_date.minute == 0 and end_date.second == 0:
            end_date = end_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        conditions.append(UserActivity.created_at <= end_date)

    if search and search.strip():
        term = f"%{search.strip()}%"
        conditions.append(
            or_(
                UserActivity.user_name.ilike(term),
                UserActivity.unique_user_key.ilike(term),
                UserActivity.user_email.ilike(term),
                UserActivity.resource_name.ilike(term),
                UserActivity.action_details.ilike(term),
                UserActivity.reporting_period.ilike(term),
                UserActivity.module.ilike(term),
                UserActivity.action_type.ilike(term),
                UserActivity.status.ilike(term),
            )
        )

    where_clause = and_(*conditions)

    # Count total
    count_res = await db.execute(select(func.count(UserActivity.id)).where(where_clause))
    total = count_res.scalar() or 0

    # Fetch items with offset and limit
    offset = (page - 1) * page_size
    query = (
        select(UserActivity)
        .options(selectinload(UserActivity.user))
        .where(where_clause)
        .order_by(desc(UserActivity.created_at))
        .offset(offset)
        .limit(page_size)
    )
    items_res = await db.execute(query)
    items = list(items_res.scalars().all())

    for item in items:
        if item.user:
            setattr(item, "user_role", item.user.role.value if hasattr(item.user.role, "value") else str(item.user.role))
            if not item.user_email and (item.user.email or item.user.username):
                item.user_email = item.user.email or item.user.username
            if not item.unique_user_key and item.user.unique_user_key:
                item.unique_user_key = item.user.unique_user_key
        setattr(item, "period", item.reporting_period)
        setattr(item, "details", item.action_details)

    return items, total


# ============================================================================
# 4. USERS OVERVIEW QUERY
# ============================================================================

async def query_users_overview(
    db: AsyncSession,
    organization_id: Optional[int] = None,
    page: int = 1,
    page_size: int = 25,
    search: Optional[str] = None,
    status_filter: Optional[str] = None,
) -> Tuple[List[UserOverviewItem], int]:
    """Returns overview of users with their login counts, last login, and status."""
    conditions = [
        User.role != UserRole.SUPER_ADMIN,
        User.is_active.is_(True),
    ]
    if organization_id is not None:
        conditions.append(User.organization_id == organization_id)

    now = utc_now()
    active_cutoff = now - timedelta(minutes=15)
    idle_cutoff = now - timedelta(days=7)

    if search and search.strip():
        term = f"%{search.strip()}%"
        conditions.append(
            or_(
                User.full_name.ilike(term),
                User.username.ilike(term),
                User.email.ilike(term),
                User.unique_user_key.ilike(term),
            )
        )

    if status_filter == "NEVER_LOGGED_IN":
        conditions.append(or_(User.last_login_at.is_(None), User.login_count == 0))
    elif status_filter == "ACTIVE":
        conditions.append(User.last_activity_at >= active_cutoff)
    elif status_filter == "INACTIVE_7D":
        conditions.append(or_(User.last_login_at < idle_cutoff, User.last_login_at.is_(None)))

    where_clause = and_(*conditions)

    count_res = await db.execute(select(func.count(User.id)).where(where_clause))
    total = count_res.scalar() or 0

    offset = (page - 1) * page_size
    query = (
        select(User)
        .where(where_clause)
        .order_by(User.last_activity_at.desc().nulls_last(), User.last_login_at.desc().nulls_last(), User.username)
        .offset(offset)
        .limit(page_size)
    )

    users_res = await db.execute(query)
    users = users_res.scalars().all()

    items: List[UserOverviewItem] = []
    for u in users:
        # Determine status
        if not u.last_login_at or u.login_count == 0:
            current_status = "NEVER_LOGGED_IN"
        elif u.last_activity_at and u.last_activity_at >= active_cutoff:
            current_status = "ACTIVE"
        elif u.last_activity_at and u.last_activity_at >= idle_cutoff:
            current_status = "IDLE"
        else:
            current_status = "OFFLINE"

        display_name = u.full_name or u.unique_user_key or u.username
        items.append(
            UserOverviewItem(
                user_id=u.id,
                username=u.username,
                full_name=u.full_name or u.unique_user_key,
                name=display_name,
                email=u.email,
                unique_user_key=u.unique_user_key,
                role=u.role.value if hasattr(u.role, "value") else str(u.role),
                department=u.full_name or u.unique_user_key,
                is_active=u.is_active,
                login_count=u.login_count or 0,
                last_login_at=u.last_login_at,
                last_activity_at=u.last_activity_at,
                current_status=current_status,
            )
        )

    return items, total


# ============================================================================
# 5. EXCEL & CSV EXPORT GENERATOR
# ============================================================================

async def generate_activity_export(
    db: AsyncSession,
    organization_id: Optional[int] = None,
    format_type: str = "csv",  # csv | xlsx
    search: Optional[str] = None,
    user_id: Optional[int] = None,
    module: Optional[str] = None,
    action_type: Optional[str] = None,
    status: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
) -> Tuple[bytes, str, str]:
    """Generates a downloadable CSV or Excel export of activity logs."""
    items, _ = await query_activity_logs(
        db=db,
        organization_id=organization_id,
        page=1,
        page_size=5000,  # export up to 5,000 records
        search=search,
        user_id=user_id,
        module=module,
        action_type=action_type,
        status=status,
        start_date=start_date,
        end_date=end_date,
    )

    headers = [
        "Date & Time",
        "User Name",
        "Unique Key / Email",
        "Module",
        "Resource Type",
        "Resource Name",
        "Action",
        "Reporting Period",
        "Status",
        "Details",
        "IP Address",
    ]

    rows = []
    for it in items:
        dt_str = it.created_at.strftime("%Y-%m-%d %H:%M:%S") if it.created_at else ""
        rows.append([
            dt_str,
            it.user_name or "",
            it.unique_user_key or it.user_email or "",
            it.module,
            it.resource_type,
            it.resource_name or "",
            it.action_type,
            it.reporting_period or "",
            it.status,
            it.action_details or "",
            it.ip_address or "",
        ])

    if format_type.lower() == "xlsx":
        try:
            import openpyxl
            wb = openpyxl.Workbook()
            ws = wb.active
            ws.title = "User Activity Audit"
            ws.append(headers)
            for row in rows:
                ws.append(row)
            
            # Format header row
            for col in range(1, len(headers) + 1):
                cell = ws.cell(row=1, column=col)
                cell.font = openpyxl.styles.Font(bold=True, color="FFFFFF")
                cell.fill = openpyxl.styles.PatternFill("solid", fgColor="1E293B")

            buf = io.BytesIO()
            wb.save(buf)
            buf.seek(0)
            return (
                buf.getvalue(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                f"activity_audit_logs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.xlsx",
            )
        except ImportError:
            # Fallback to CSV if openpyxl not installed
            pass

    # Default CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    for row in rows:
        writer.writerow(row)

    return (
        output.getvalue().encode("utf-8"),
        "text/csv; charset=utf-8",
        f"activity_audit_logs_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv",
    )
