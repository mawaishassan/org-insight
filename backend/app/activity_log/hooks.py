"""Dedicated Integration Hooks for Activity Logging.

This module decouples user activity auditing and session logging from core
application routes and services (entries, reports, dashboards, auth, etc.).

All future changes, new event triggers, action mappings, and metadata schemas
can be managed inside this file without modifying complex business routes.
"""

import asyncio
import logging
from typing import Any, Dict, Optional
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import User
from app.activity_log.service import (
    log_activity_async,
    record_user_login,
    record_user_logout,
)

logger = logging.getLogger(__name__)


def _safe_create_task(coro) -> None:
    """Helper to schedule coroutine non-blockingly on the running event loop."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(coro)
    except RuntimeError:
        # No running event loop (e.g. sync CLI or script outside FastAPI)
        # Close coroutine cleanly to avoid unawaited warnings
        try:
            coro.close()
        except Exception:
            pass
    except Exception as e:
        logger.warning(f"[ActivityHook] Failed to schedule activity task: {e}")



# ============================================================================
# 1. AUTHENTICATION HOOKS
# ============================================================================

async def log_auth_login(
    user: User,
    request: Request,
    db: AsyncSession,
) -> Optional[str]:
    """Records user login event and creates active session non-blockingly."""
    try:
        remote_ip = request.client.host if request.client else "127.0.0.1"
        user_agent = request.headers.get("user-agent")
        return await record_user_login(db, user, remote_ip, user_agent)
    except Exception as exc:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning(f"[ActivityHook] Failed to record user login: {exc}")
        return None


async def log_auth_logout(
    user: User,
    db: AsyncSession,
    session_id: Optional[str] = None,
) -> None:
    """Records user logout event safely."""
    try:
        await record_user_logout(db, user, session_id=session_id)
    except Exception as exc:
        try:
            await db.rollback()
        except Exception:
            pass
        logger.warning(f"[ActivityHook] Failed to record user logout: {exc}")


# ============================================================================
# 2. KPI DATA ENTRY HOOKS
# ============================================================================

def log_kpi_entry_saved(
    *,
    user: User,
    org_id: int,
    kpi_id: int,
    kpi_name: Optional[str] = None,
    year: Optional[int] = None,
    period_key: Optional[str] = None,
    fields_count: int = 0,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Dispatches background audit log when KPI values are saved."""
    try:
        period_str = f"{year or ''} {period_key or ''}".strip() or None
        meta = {"year": year, "period_key": period_key, "fields_count": fields_count}
        if metadata:
            meta.update(metadata)

        _safe_create_task(
            log_activity_async(
                organization_id=org_id,
                user_id=user.id,
                user_name=getattr(user, "full_name", None) or getattr(user, "username", None),
                user_email=getattr(user, "email", None),
                unique_user_key=getattr(user, "unique_user_key", None),
                department=getattr(user, "department", None),
                faculty=getattr(user, "faculty", None),
                campus=getattr(user, "campus", None),
                module="KPIS",
                resource_type="kpi",
                resource_id=str(kpi_id),
                resource_name=kpi_name or f"KPI #{kpi_id}",
                action_type="DATA_SAVED",
                action_details=f"Saved {fields_count} values for KPI #{kpi_id}",
                reporting_period=period_str,
                kpi_id=kpi_id,
                meta_data=meta,
            )
        )
    except Exception as exc:
        logger.warning(f"[ActivityHook] Failed to queue KPI entry saved log: {exc}")


def log_kpi_entry_submitted(
    *,
    user: User,
    org_id: int,
    entry_id: int,
    kpi_id: int,
    kpi_name: Optional[str] = None,
    year: Optional[int] = None,
    period_key: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    """Dispatches background audit log when KPI data entry is submitted."""
    try:
        period_str = f"{year or ''} {period_key or ''}".strip() or None
        meta = {"entry_id": entry_id, "year": year, "period_key": period_key}
        if metadata:
            meta.update(metadata)

        _safe_create_task(
            log_activity_async(
                organization_id=org_id,
                user_id=user.id,
                user_name=getattr(user, "full_name", None) or getattr(user, "username", None),
                user_email=getattr(user, "email", None),
                unique_user_key=getattr(user, "unique_user_key", None),
                department=getattr(user, "department", None),
                faculty=getattr(user, "faculty", None),
                campus=getattr(user, "campus", None),
                module="KPIS",
                resource_type="kpi",
                resource_id=str(kpi_id),
                resource_name=kpi_name or f"KPI #{kpi_id}",
                action_type="DATA_SUBMITTED",
                action_details=f"Submitted data entry #{entry_id} for KPI #{kpi_id}",
                reporting_period=period_str,
                kpi_id=kpi_id,
                meta_data=meta,
            )
        )
    except Exception as exc:
        logger.warning(f"[ActivityHook] Failed to queue KPI entry submitted log: {exc}")


def log_kpi_row_deleted(
    *,
    user: User,
    org_id: int,
    entry_id: int,
    kpi_id: int,
    field_id: int,
    row_index: int,
    year: Optional[int] = None,
    period_key: Optional[str] = None,
) -> None:
    """Dispatches background audit log when a multi-line item row is deleted."""
    try:
        period_str = f"{year or ''} {period_key or ''}".strip() or None
        _safe_create_task(
            log_activity_async(
                organization_id=org_id,
                user_id=user.id,
                user_name=getattr(user, "full_name", None) or getattr(user, "username", None),
                user_email=getattr(user, "email", None),
                unique_user_key=getattr(user, "unique_user_key", None),
                department=getattr(user, "department", None),
                faculty=getattr(user, "faculty", None),
                campus=getattr(user, "campus", None),
                module="KPIS",
                resource_type="kpi",
                resource_id=str(kpi_id),
                resource_name=f"KPI #{kpi_id}",
                action_type="DATA_DELETED",
                action_details=f"Deleted row {row_index} from field #{field_id}",
                reporting_period=period_str,
                kpi_id=kpi_id,
                meta_data={"entry_id": entry_id, "field_id": field_id, "row_index": row_index},
            )
        )
    except Exception as exc:
        logger.warning(f"[ActivityHook] Failed to queue KPI row deleted log: {exc}")


# ============================================================================
# 3. REPORT EXPORT & DOWNLOAD HOOKS
# ============================================================================

ACTION_MAP = {
    "pdf": "DOWNLOAD_PDF",
    "docx": "DOWNLOAD_WORD",
    "word": "DOWNLOAD_WORD",
    "xlsx": "DOWNLOAD_EXCEL",
    "excel": "DOWNLOAD_EXCEL",
    "csv": "DOWNLOAD_CSV",
}

def log_report_export(
    *,
    user: User,
    org_id: int,
    report_id: Any,
    report_name: str,
    fmt: str,
    year: Optional[Any] = None,
    period_type: Optional[str] = None,
    filename: Optional[str] = None,
    by_default: bool = False,
    report_obj: Optional[Any] = None,
) -> None:
    """Dispatches background audit log when a report or custom report is exported."""
    try:
        action_type = ACTION_MAP.get(str(fmt).lower(), f"DOWNLOAD_{str(fmt).upper()}")
        
        # Resolve reporting period
        period_val = None
        if year and str(year).strip() and str(year).strip().lower() not in ("none", "by_default"):
            period_val = str(year).strip()
        elif period_type and str(period_type).strip() and str(period_type).strip().lower() not in ("none", "by_default"):
            period_val = str(period_type).strip()
        elif report_obj:
            cfg = getattr(report_obj, "date_fetching_config", None) or {}
            def_period = cfg.get("default_period") or cfg.get("period")
            if def_period and str(def_period).strip():
                period_val = str(def_period).strip()

        _safe_create_task(
            log_activity_async(
                organization_id=org_id,
                user_id=user.id,
                user_name=getattr(user, "full_name", None) or getattr(user, "username", None),
                user_email=getattr(user, "email", None),
                unique_user_key=getattr(user, "unique_user_key", None),
                department=getattr(user, "department", None),
                faculty=getattr(user, "faculty", None),
                campus=getattr(user, "campus", None),
                module="REPORTS",
                resource_type="custom_report",
                resource_id=str(report_id),
                resource_name=report_name,
                action_type=action_type,
                action_details=f"Downloaded report '{report_name}' ({str(fmt).upper()})",
                reporting_period=period_val,
                meta_data={"format": fmt, "filename": filename, "by_default": by_default},
            )
        )
    except Exception as exc:
        logger.warning(f"[ActivityHook] Failed to queue report export log: {exc}")
