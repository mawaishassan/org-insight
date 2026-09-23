"""User Activity Monitoring & Audit Trail Package."""

from app.activity_log.routes import router as activity_log_router
from app.activity_log.service import (
    log_activity_async,
    record_user_login,
    record_user_logout,
)

from app.activity_log.hooks import (
    log_auth_login,
    log_auth_logout,
    log_kpi_entry_saved,
    log_kpi_entry_submitted,
    log_kpi_row_deleted,
    log_report_export,
)

__all__ = [
    "activity_log_router",
    "log_activity_async",
    "record_user_login",
    "record_user_logout",
    "log_auth_login",
    "log_auth_logout",
    "log_kpi_entry_saved",
    "log_kpi_entry_submitted",
    "log_kpi_row_deleted",
    "log_report_export",
]

