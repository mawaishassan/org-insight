"""
POST /api/widget-data — bundle KPI + multi-line data for one dashboard widget (v1).

This module also provides dashboard-scoped "fast" endpoints that authorize via dashboard view.
"""

import asyncio
import logging
import time
import traceback
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import get_current_user
from app.core.database import get_db
from app.core.models import User
from app.widget_data.schemas import (
    ChartWidgetDataRequestV1,
    DashboardChartBatchRequestV1,
    DashboardCardBatchRequestV1,
    DashboardMultiLineTableRowsRequestV1,
    DashboardWidgetDataRequestV1,
    WidgetDataRequestV1,
    WidgetDataResponseV1,
)
from app.widget_data.service import (
    resolve_dashboard_card_widget_data,
    resolve_dashboard_chart_widget_data,
    resolve_dashboard_chart_widget_data_batch,
    resolve_dashboard_card_widget_data_batch,
    resolve_dashboard_kpi_table_widget_data,
    resolve_dashboard_line_widget_data,
    resolve_dashboard_single_value_widget_data,
    resolve_dashboard_table_rows_widget_data,
    resolve_dashboard_table_widget_data,
    resolve_dashboard_trend_widget_data,
    resolve_widget_data,
)


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


router = APIRouter(prefix="/widget-data", tags=["widget-data"])
logger = logging.getLogger(__name__)


@router.get("/health")
async def widget_data_health():
    """Lightweight check that this router is mounted (useful behind Next.js `/api` proxy)."""
    return {"status": "ok"}


def _chart_response(meta: dict, data: dict, resolved_type: str, entry_revision: str | None) -> WidgetDataResponseV1:
    etag = entry_revision
    if isinstance(etag, str) and etag:
        weak: str | None = f'W/"{etag[:200]}"' if len(etag) > 200 else f'W/"{etag}"'
    else:
        weak = None
    return WidgetDataResponseV1(
        version=1,
        widget_type=resolved_type,
        meta=meta,
        data=data,
        etag=weak,
        entry_revision=entry_revision,
    )


@router.post("/chart", response_model=WidgetDataResponseV1)
async def post_dashboard_chart_widget_data(
    body: ChartWidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Fast path for **kpi_bar_chart** (bar + pie) on a dashboard the user can view.
    Does **not** run KPI field-level permission checks — use only when `dashboard_id` is trusted
    (same dashboard page). For other contexts, use `POST /widget-data`.
    """
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported request version",
        )
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="widget is required",
        )
    try:
        meta, data, resolved_type, entry_revision = await resolve_dashboard_chart_widget_data(
            db,
            current_user,
            org_id,
            body.dashboard_id,
            body.widget,
            body.overrides,
        )
    except Exception:
        wid = (body.widget or {}).get("id")
        wtype = (body.widget or {}).get("type")
        logger.exception(
            "widget-data/chart failed (dashboard_id=%s org_id=%s widget_id=%s type=%s)",
            body.dashboard_id,
            org_id,
            wid,
            wtype,
        )
        raise
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to view this dashboard",
        )
    if resolved_type == "error":
        if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(meta.get("error") or data.get("error") or "Invalid request"),
        )
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("/chart/batch")
async def post_dashboard_chart_widget_data_batch(
    body: DashboardChartBatchRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Batch chart loads to avoid browser connection queuing when many charts are on one dashboard.
    Returns a dict keyed by widget id (or index fallback).
    """
    t0 = time.perf_counter()
    print(f"[widget-data] BEGIN /chart/batch dashboard_id={body.dashboard_id} org={body.organization_id}")
    try:
        org_id = _org_id(current_user, body.organization_id)
        if body.version != 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
        items = body.items or []
        if not isinstance(items, list) or not items:
            return {"version": 1, "results": {}}

        results = await resolve_dashboard_chart_widget_data_batch(
            db, current_user, org_id, body.dashboard_id, [it for it in items if isinstance(it, dict)]
        )
        dt = (time.perf_counter() - t0) * 1000.0
        print(f"[widget-data] END /chart/batch dashboard_id={body.dashboard_id} ({dt:.1f}ms) items={len(results)}")
        return {"version": 1, "results": results}
    except Exception:
        dt = (time.perf_counter() - t0) * 1000.0
        logger.exception(
            "widget-data/chart batch failed (dashboard_id=%s org_id=%s) after %.1fms",
            body.dashboard_id,
            body.organization_id,
            dt,
        )
        traceback.print_exc()
        print(f"[widget-data] CRASH /chart/batch dashboard_id={body.dashboard_id} ({dt:.1f}ms)")
        raise


@router.post("/card/batch")
async def post_dashboard_card_widget_data_batch(
    body: DashboardCardBatchRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    t0 = time.perf_counter()
    print(f"[widget-data] BEGIN /card/batch dashboard_id={body.dashboard_id} org={body.organization_id}", flush=True)
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    items = body.items or []
    if not isinstance(items, list) or not items:
        return {"version": 1, "results": {}}
    results = await resolve_dashboard_card_widget_data_batch(
        db, current_user, org_id, body.dashboard_id, [it for it in items if isinstance(it, dict)]
    )
    dt = (time.perf_counter() - t0) * 1000.0
    print(f"[widget-data] END /card/batch dashboard_id={body.dashboard_id} ({dt:.1f}ms) items={len(results)}", flush=True)
    return {"version": 1, "results": results}


@router.post("/card", response_model=WidgetDataResponseV1)
async def post_dashboard_card_widget_data(
    body: DashboardWidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="widget is required")
    try:
        meta, data, resolved_type, entry_revision = await resolve_dashboard_card_widget_data(
            db, current_user, org_id, body.dashboard_id, body.widget, body.overrides
        )
    except Exception:
        wid = (body.widget or {}).get("id")
        wtype = (body.widget or {}).get("type")
        logger.exception(
            "widget-data/card failed (dashboard_id=%s org_id=%s widget_id=%s type=%s)",
            body.dashboard_id,
            org_id,
            wid,
            wtype,
        )
        raise
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this dashboard")
    if resolved_type == "error":
        if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(meta.get("error") or data.get("error") or "Invalid request"))
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("/table", response_model=WidgetDataResponseV1)
async def post_dashboard_table_widget_data(
    body: DashboardWidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="widget is required")
    try:
        meta, data, resolved_type, entry_revision = await resolve_dashboard_table_widget_data(
            db, current_user, org_id, body.dashboard_id, body.widget, body.overrides
        )
    except Exception:
        wid = (body.widget or {}).get("id")
        wtype = (body.widget or {}).get("type")
        logger.exception(
            "widget-data/table failed (dashboard_id=%s org_id=%s widget_id=%s type=%s)",
            body.dashboard_id,
            org_id,
            wid,
            wtype,
        )
        raise
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this dashboard")
    if resolved_type == "error":
        if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(meta.get("error") or data.get("error") or "Invalid request"))
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("/table/rows")
async def post_dashboard_table_widget_rows(
    body: DashboardMultiLineTableRowsRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="widget is required")
    meta, data, resolved_type, entry_revision = await resolve_dashboard_table_rows_widget_data(
        db,
        current_user,
        org_id,
        body.dashboard_id,
        body.widget,
        body.overrides,
        page=body.page,
        page_size=body.page_size,
        search=body.search,
        sort_by=body.sort_by,
        sort_dir=body.sort_dir,
    )
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this dashboard")
    if resolved_type == "error":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(meta.get("error") or data.get("error") or "Invalid request"))
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("/line", response_model=WidgetDataResponseV1)
async def post_dashboard_line_widget_data(
    body: DashboardWidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="widget is required")
    try:
        meta, data, resolved_type, entry_revision = await resolve_dashboard_line_widget_data(
            db, current_user, org_id, body.dashboard_id, body.widget, body.overrides
        )
    except Exception:
        wid = (body.widget or {}).get("id")
        wtype = (body.widget or {}).get("type")
        logger.exception(
            "widget-data/line failed (dashboard_id=%s org_id=%s widget_id=%s type=%s)",
            body.dashboard_id,
            org_id,
            wid,
            wtype,
        )
        raise
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this dashboard")
    if resolved_type == "error":
        if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(meta.get("error") or data.get("error") or "Invalid request"))
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("/trend", response_model=WidgetDataResponseV1)
async def post_dashboard_trend_widget_data(
    body: DashboardWidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="widget is required")
    try:
        meta, data, resolved_type, entry_revision = await resolve_dashboard_trend_widget_data(
            db, current_user, org_id, body.dashboard_id, body.widget, body.overrides
        )
    except Exception:
        wid = (body.widget or {}).get("id")
        wtype = (body.widget or {}).get("type")
        logger.exception(
            "widget-data/trend failed (dashboard_id=%s org_id=%s widget_id=%s type=%s)",
            body.dashboard_id,
            org_id,
            wid,
            wtype,
        )
        raise
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this dashboard")
    if resolved_type == "error":
        if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(meta.get("error") or data.get("error") or "Invalid request"))
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("/value", response_model=WidgetDataResponseV1)
async def post_dashboard_single_value_widget_data(
    body: DashboardWidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="widget is required")
    try:
        meta, data, resolved_type, entry_revision = await resolve_dashboard_single_value_widget_data(
            db, current_user, org_id, body.dashboard_id, body.widget, body.overrides
        )
    except Exception:
        wid = (body.widget or {}).get("id")
        wtype = (body.widget or {}).get("type")
        logger.exception(
            "widget-data/value failed (dashboard_id=%s org_id=%s widget_id=%s type=%s)",
            body.dashboard_id,
            org_id,
            wid,
            wtype,
        )
        raise
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this dashboard")
    if resolved_type == "error":
        if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(meta.get("error") or data.get("error") or "Invalid request"))
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("/kv-table", response_model=WidgetDataResponseV1)
async def post_dashboard_kv_table_widget_data(
    body: DashboardWidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported request version")
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="widget is required")
    try:
        meta, data, resolved_type, entry_revision = await resolve_dashboard_kpi_table_widget_data(
            db, current_user, org_id, body.dashboard_id, body.widget, body.overrides
        )
    except Exception:
        wid = (body.widget or {}).get("id")
        wtype = (body.widget or {}).get("type")
        logger.exception(
            "widget-data/kv-table failed (dashboard_id=%s org_id=%s widget_id=%s type=%s)",
            body.dashboard_id,
            org_id,
            wid,
            wtype,
        )
        raise
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to view this dashboard")
    if resolved_type == "error":
        if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(meta.get("error") or data.get("error") or "Invalid request"))
    return _chart_response(meta, data, resolved_type, entry_revision)


@router.post("", response_model=WidgetDataResponseV1)
async def post_widget_data(
    body: WidgetDataRequestV1,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns all server-resolved data for a single widget in one call.

    **v1 request:** `version` (1), `organization_id`, `widget` (object from dashboard layout),
    optional `overrides` to override `year`, `period_key`, `selected_years` (trend) without
    mutating stored layout.

    **Response:** `widget_type`, `meta` (e.g. `kpi_id`, `year`, `entry_id`, `row_count`),
    `data` (per-type; includes `raw_rows` / `bars` / `field_map` as applicable),
    `entry_revision` (etag-like string from entry timestamps for cache invalidation).
    """
    org_id = _org_id(current_user, body.organization_id)
    if body.version != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported request version",
        )
    if not body.widget or not isinstance(body.widget, dict):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="widget is required",
        )
    widget_type = str((body.widget or {}).get("type") or "")

    meta, data, resolved_type, entry_revision = await resolve_widget_data(
        db,
        current_user,
        org_id,
        body.version,
        body.widget,
        body.overrides,
    )
    if data.get("error") == "forbidden" or meta.get("error") == "forbidden":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not allowed to view this KPI or resource",
        )
    if data.get("error") == "KPI not found" or meta.get("error") == "KPI not found":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    if resolved_type == "error":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(meta.get("error") or "Invalid request"),
        )
    if resolved_type == "unknown" or (meta.get("error", "").startswith("Unknown")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(meta.get("error") or data.get("error") or f"Unknown widget type: {widget_type}"),
        )
    return _chart_response(meta, data, resolved_type, entry_revision)
