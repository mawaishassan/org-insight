"""Report template and report generation API routes."""

import csv
import io
from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin
from app.core.models import User
from app.reports.schemas import (
    ReportTemplateCreate,
    ReportTemplateUpdate,
    ReportTemplateKPIAdd,
    ReportAccessAssign,
    ReportTemplateResponse,
    ReportTemplateDetailResponse,
)
from app.reports.service import (
    create_report_template,
    get_report_template,
    list_report_templates,
    update_report_template,
    add_kpi_to_template,
    remove_kpi_from_template,
    assign_report_to_user,
    user_can_access_report,
    generate_report_data,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


@router.get("/templates", response_model=list[ReportTemplateResponse])
async def list_templates(
    organization_id: int | None = Query(None),
    year: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List report templates (org admin: all org; others: only assigned)."""
    org_id = _org_id(current_user, organization_id)
    templates = await list_report_templates(db, org_id, year=year)
    if current_user.role.value not in ("ORG_ADMIN", "SUPER_ADMIN"):
        from sqlalchemy import select
        from app.core.models import ReportAccessPermission
        allowed = set()
        for t in templates:
            if await user_can_access_report(db, current_user.id, t.id, "view"):
                allowed.add(t.id)
        templates = [t for t in templates if t.id in allowed]
    return [ReportTemplateResponse.model_validate(t) for t in templates]


@router.post("/templates", response_model=ReportTemplateResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: ReportTemplateCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create report template (Org Admin)."""
    org_id = _org_id(current_user, organization_id)
    rt = await create_report_template(db, org_id, body)
    await db.commit()
    await db.refresh(rt)
    return ReportTemplateResponse.model_validate(rt)


@router.get("/templates/{template_id}", response_model=ReportTemplateResponse)
async def get_template(
    template_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
  current_user: User = Depends(get_current_user),
):
    """Get report template (if allowed)."""
    org_id = _org_id(current_user, organization_id)
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    can = await user_can_access_report(db, current_user.id, template_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    return ReportTemplateResponse.model_validate(rt)


@router.patch("/templates/{template_id}", response_model=ReportTemplateResponse)
async def update_template(
  template_id: int,
  body: ReportTemplateUpdate,
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(require_org_admin),
):
    """Update report template."""
    org_id = _org_id(current_user, organization_id)
    rt = await update_report_template(db, template_id, org_id, body)
    if not rt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await db.commit()
    await db.refresh(rt)
    return ReportTemplateResponse.model_validate(rt)


@router.post("/templates/{template_id}/kpis", status_code=status.HTTP_201_CREATED)
async def add_kpi(
  template_id: int,
  body: ReportTemplateKPIAdd,
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(require_org_admin),
):
    """Add KPI to report template."""
    org_id = _org_id(current_user, organization_id)
    rtk = await add_kpi_to_template(db, template_id, org_id, body)
    if not rtk:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template or KPI not found")
    await db.commit()
    return {"id": rtk.id, "kpi_id": rtk.kpi_id, "sort_order": rtk.sort_order}


@router.delete("/templates/{template_id}/kpis/{rtk_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_kpi(
  template_id: int,
  rtk_id: int,
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(require_org_admin),
):
    """Remove KPI from report template."""
    org_id = _org_id(current_user, organization_id)
    ok = await remove_kpi_from_template(db, template_id, org_id, rtk_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.post("/templates/{template_id}/assign", status_code=status.HTTP_201_CREATED)
async def assign_user(
  template_id: int,
  body: ReportAccessAssign,
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(require_org_admin),
):
    """Assign report template to user (view/print/export)."""
    org_id = _org_id(current_user, organization_id)
    perm = await assign_report_to_user(
        db, template_id, org_id, body.user_id,
        can_view=body.can_view, can_print=body.can_print, can_export=body.can_export,
    )
    if not perm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template or user not found")
    await db.commit()
    return {"user_id": perm.user_id, "template_id": perm.report_template_id}


@router.get("/templates/{template_id}/generate")
async def generate_report(
  template_id: int,
  year: int | None = Query(None),
  format: str = Query("json", pattern="^(json|csv)$"),
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(get_current_user),
):
    """Generate report data (JSON or CSV). User must have view/export access."""
    org_id = _org_id(current_user, organization_id)
    can = await user_can_access_report(db, current_user.id, template_id, "export" if format == "csv" else "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    data = await generate_report_data(db, template_id, rt.organization_id, year=year)
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    if format == "csv":
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Template", data["template_name"]])
        w.writerow(["Year", data["year"]])
        w.writerow([])
        for k in data["kpis"]:
            w.writerow([k["kpi_name"]])
            for entry in k.get("entries", []):
                for f in entry.get("fields", []):
                    w.writerow([f["field_name"], f["value"]])
            w.writerow([])
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=report_{template_id}.csv"},
        )
    return data
