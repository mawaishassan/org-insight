from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, field_validator, field_serializer

PKT = timezone(timedelta(hours=5), name="PKT")


class ClientActivityEvent(BaseModel):
    """Schema for client-side activity events posted from UI."""
    module: str = Field(..., description="AUTH, REPORTS, DASHBOARDS, KPIS, SYSTEM")
    resource_type: str = Field(..., description="session, report, custom_report, dashboard, widget, kpi, etc.")
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None
    action_type: str = Field(..., description="VIEW, OPEN, DOWNLOAD_PDF, DOWNLOAD_EXCEL, DOWNLOAD_WORD, DOWNLOAD_CSV, PRINT, DRILL_DOWN, etc.")
    action_details: Optional[str] = None
    details: Optional[str] = None
    reporting_period: Optional[str] = None
    period: Optional[str] = None
    kpi_id: Optional[int] = None
    dashboard_id: Optional[int] = None
    widget_id: Optional[str] = None
    records_affected: Optional[int] = None
    status: str = Field(default="SUCCESS", description="SUCCESS, FAILED")
    error_message: Optional[str] = None
    meta_data: Optional[Dict[str, Any]] = None


class ActivityLogItem(BaseModel):
    """Schema for returning a single activity log record."""
    id: int
    organization_id: int
    user_id: int
    session_id: Optional[str] = None
    unique_user_key: Optional[str] = None
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_role: Optional[str] = None
    department: Optional[str] = None
    faculty: Optional[str] = None
    campus: Optional[str] = None
    module: str
    resource_type: str
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None
    action_type: str
    action_details: Optional[str] = None
    details: Optional[str] = None
    reporting_period: Optional[str] = None
    period: Optional[str] = None
    kpi_id: Optional[int] = None
    dashboard_id: Optional[int] = None
    widget_id: Optional[str] = None
    status: str
    error_message: Optional[str] = None
    records_affected: Optional[int] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    meta_data: Optional[Dict[str, Any]] = None
    created_at: datetime

    @field_validator("created_at", mode="after")
    @classmethod
    def convert_created_at(cls, dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc).astimezone(PKT)
        return dt.astimezone(PKT)

    class Config:
        from_attributes = True


class ActivityLogListResponse(BaseModel):
    """Paginated list of activity logs."""
    items: List[ActivityLogItem]
    total: int
    page: int
    page_size: int
    total_pages: int


class UserStats(BaseModel):
    """User login summary metrics."""
    total_end_users: int = 0
    users_logged_in_today: int = 0
    users_logged_in_week: int = 0
    users_logged_in_month: int = 0
    never_logged_in: int = 0
    currently_active: int = 0


class ActivityStats(BaseModel):
    """Overall activity metrics."""
    total_activities: int = 0
    reports_viewed: int = 0
    reports_downloaded: int = 0
    dashboards_viewed: int = 0
    dashboard_drilldowns: int = 0
    drilldown_downloads: int = 0
    kpi_data_saved: int = 0
    kpi_data_submitted: int = 0
    kpi_data_updated: int = 0


class DailyTrendPoint(BaseModel):
    """Time series point for activity trend chart."""
    date: str
    count: int
    logins: int = 0
    active_users: int = 0


class ModuleBreakdownItem(BaseModel):
    """Distribution of activities by module."""
    module: str
    count: int
    percentage: float


class TopActiveUser(BaseModel):
    """Most active users."""
    user_id: int
    user_name: str
    unique_user_key: Optional[str] = None
    activity_count: int


class ActivitySummaryResponse(BaseModel):
    """Complete summary statistics for Org Admin dashboard."""
    user_stats: UserStats
    activity_stats: ActivityStats
    daily_trend: List[DailyTrendPoint]
    module_breakdown: List[ModuleBreakdownItem]
    top_active_users: List[TopActiveUser]

    # Direct convenience properties for UI components
    total_activities: int = 0
    total_users: int = 0
    active_users_7d: int = 0
    logins_today: int = 0
    activities_today: int = 0
    daily_trends: List[DailyTrendPoint] = []
    top_users: List[TopActiveUser] = []



class UserOverviewItem(BaseModel):
    """Overview item of user status and activity."""
    user_id: int
    username: str
    full_name: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    unique_user_key: Optional[str] = None
    role: str
    department: Optional[str] = None
    faculty: Optional[str] = None
    campus: Optional[str] = None
    is_active: bool
    login_count: int
    last_login_at: Optional[datetime] = None
    last_activity_at: Optional[datetime] = None
    current_status: str  # ACTIVE, IDLE, OFFLINE, NEVER_LOGGED_IN

    @field_validator("last_login_at", "last_activity_at", mode="after")
    @classmethod
    def convert_user_dates(cls, dt: Optional[datetime]) -> Optional[datetime]:
        if dt is None:
            return None
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc).astimezone(PKT)
        return dt.astimezone(PKT)


class UserOverviewListResponse(BaseModel):
    """Paginated list of users overview."""
    items: List[UserOverviewItem]
    total: int
    page: int
    page_size: int
    total_pages: int
