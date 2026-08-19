"""Report template and report generation API routes."""

import csv
import io
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin, require_super_admin
from app.core.models import User, ReportTemplate, CustomReportHeader, OrganizationBranding
from app.reports.schemas import (
    ReportTemplateCreate,
    ReportTemplateUpdate,
    ReportTemplateKPIAdd,
    ReportAccessAssign,
    ReportAssignmentResponse,
    ReportTemplateResponse,
    ReportTemplateDetailResponse,
    ReportPreviewRequest,
    EvaluateSnippetRequest,
)
from app.reports.service import (
    create_report_template,
    get_report_template,
    get_report_template_detail,
    list_report_templates,
    list_all_report_templates,
    update_report_template,
    delete_report_template,
    add_kpi_to_template,
    remove_kpi_from_template,
    assign_report_to_user,
    unassign_report_from_user,
    list_template_assignments,
    user_can_access_report,
    add_text_block,
    delete_text_block,
    generate_report_data,
    render_report_html,
    render_report_html_with_template,
    evaluate_report_snippet,
)
from app.reports.header_schemas import (
    CustomReportHeaderResponse,
    OrganizationBrandingResponse,
    OrganizationBrandingUpsert,
)

router = APIRouter(prefix="/reports", tags=["reports"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


async def _org_id_for_template(
    db: AsyncSession, user: User, template_id: int, org_id_param: int | None
) -> int:
    """
    Resolve organization id for template-scoped routes.
    - SUPER_ADMIN: if organization_id is not provided, resolve from the template itself.
    - Others: fall back to normal tenant resolution.
    """
    if user.role.value == "SUPER_ADMIN" and org_id_param is None:
        rt = (await db.execute(select(ReportTemplate).where(ReportTemplate.id == template_id))).scalar_one_or_none()
        if not rt:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
        return rt.organization_id
    return _org_id(user, org_id_param)


@router.get("/templates", response_model=list[ReportTemplateResponse])
async def list_templates(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List report templates (org admin: all org; others: only assigned). Super Admin with no org sees all templates."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        templates = await list_all_report_templates(db)
    else:
        org_id = _org_id(current_user, organization_id)
        templates = await list_report_templates(db, org_id)
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
    """Create report template (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may create report templates")
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
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    can = await user_can_access_report(db, current_user.id, template_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    return ReportTemplateResponse.model_validate(rt)


@router.get("/templates/{template_id}/detail")
async def get_template_detail(
    template_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get template with text_blocks and kpis for design/builder (Super Admin or allowed)."""
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    can = await user_can_access_report(db, current_user.id, template_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    detail = await get_report_template_detail(db, template_id, org_id)
    if not detail:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    return detail


@router.patch("/templates/{template_id}", response_model=ReportTemplateResponse)
async def update_template(
  template_id: int,
  body: ReportTemplateUpdate,
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(require_org_admin),
):
    """Update report template (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may update report templates")
    org_id = _org_id(current_user, organization_id)
    rt = await update_report_template(db, template_id, org_id, body)
    if not rt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await db.commit()
    await db.refresh(rt)
    return ReportTemplateResponse.model_validate(rt)


@router.delete("/templates/{template_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_template(
    template_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete report template (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may delete report templates")
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    ok = await delete_report_template(db, template_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await db.commit()


@router.post("/templates/{template_id}/kpis", status_code=status.HTTP_201_CREATED)
async def add_kpi(
  template_id: int,
  body: ReportTemplateKPIAdd,
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(require_org_admin),
):
    """Add KPI to report template (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may add KPIs to report templates")
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
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
    """Remove KPI from report template (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may remove KPIs from report templates")
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
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
    """Assign report template to user (view/print/export). ORG_ADMIN can assign within their org."""
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    perm = await assign_report_to_user(
        db, template_id, org_id, body.user_id,
        can_view=body.can_view, can_print=body.can_print, can_export=body.can_export,
    )
    if not perm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template or user not found")
    await db.commit()
    return {"user_id": perm.user_id, "template_id": perm.report_template_id, "can_view": perm.can_view, "can_print": perm.can_print, "can_export": perm.can_export}


@router.get("/templates/{template_id}/users", response_model=list[ReportAssignmentResponse])
async def list_template_users(
    template_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List users assigned to this report template. ORG_ADMIN sees assignments for templates in their org."""
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    assignments = await list_template_assignments(db, template_id, org_id)
    return [ReportAssignmentResponse.model_validate(a) for a in assignments]


@router.delete("/templates/{template_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user(
    template_id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove report template assignment from user. ORG_ADMIN can unassign within their org."""
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    ok = await unassign_report_from_user(db, template_id, org_id, user_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.post("/templates/{template_id}/text-blocks", status_code=status.HTTP_201_CREATED)
async def create_text_block(
    template_id: int,
    title: str | None = Query(None),
    content: str = Query(""),
    sort_order: int = Query(0),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Add a text block to a template (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may edit report text blocks")
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    tb = await add_text_block(db, template_id, org_id, title=title, content=content, sort_order=sort_order)
    if not tb:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    await db.commit()
    return {"id": tb.id, "title": tb.title, "content": tb.content, "sort_order": tb.sort_order}


@router.delete("/templates/{template_id}/text-blocks/{text_block_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_text_block(
    template_id: int,
    text_block_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove a text block from a template (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may edit report text blocks")
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    ok = await delete_text_block(db, template_id, org_id, text_block_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()


@router.get("/templates/{template_id}/generate")
async def generate_report(
  template_id: int,
  year: str | int | None = Query(None),
  format: str = Query("json", pattern="^(json|csv)$"),
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(get_current_user),
):
    """Generate report data (JSON or CSV). User must have view/export access."""
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    can = await user_can_access_report(db, current_user.id, template_id, "export" if format == "csv" else "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    data = await generate_report_data(db, template_id, rt.organization_id, year=year, include_drafts=False)
    # If the template has a body_template or body_blocks (visual builder), render HTML
    # so the report view shows the same content as the design live preview.
    can_render = bool(rt.body_template or getattr(rt, "body_blocks", None))
    if format == "json" and can_render:
        html = await render_report_html(
            db, template_id, rt.organization_id, year=year, include_drafts=False, report_data=data
        )
        if html is not None:
            data["rendered_html"] = html
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


@router.post("/templates/{template_id}/evaluate-snippet")
async def evaluate_snippet(
    template_id: int,
    body: EvaluateSnippetRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Evaluate a KPI value or formula snippet in report context; returns the value for preview."""
    org_id = await _org_id_for_template(db, current_user, template_id, body.organization_id or organization_id)
    can = await user_can_access_report(db, current_user.id, template_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
    value = await evaluate_report_snippet(
        db,
        template_id,
        org_id,
        snippet_type=body.type,
        year=body.year,
        kpi_id=body.kpi_id,
        field_key=body.field_key,
        sub_field_key=body.sub_field_key,
        sub_field_group_fn=body.sub_field_group_fn,
        entry_index=body.entry_index,
        expression=body.expression,
        include_drafts=False,
    )
    return {"value": value}


@router.post("/templates/{template_id}/preview")
async def preview_report(
    template_id: int,
    body: ReportPreviewRequest,
    year: str | int | None = Query(None),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Render report HTML with the given template string (for live preview in designer)."""
    org_id = await _org_id_for_template(db, current_user, template_id, organization_id)
    can = await user_can_access_report(db, current_user.id, template_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    include_drafts = False
    try:
        # If designer sends an empty template, render from saved body_blocks/body_template instead.
        # This ensures block-driven features (e.g. multi-line row filters) are included in preview.
        if (body.body_template or "").strip():
            html = await render_report_html_with_template(
                db,
                template_id,
                org_id,
                year=year,
                body_template_override=body.body_template,
                include_drafts=include_drafts,
            )
        else:
            from app.reports.service import render_report_html

            html = await render_report_html(
                db,
                template_id,
                org_id,
                year=year,
                include_drafts=include_drafts,
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Preview render failed: {str(e)}",
        ) from e
    if html is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Preview failed")
    return {"html": html}


# --- Custom Report Header Endpoints ---

import uuid
from datetime import datetime
from app.auth.dependencies import require_super_admin
from app.core.models import CustomReportHeader
from app.reports.header_schemas import CustomReportHeaderResponse
from fastapi import UploadFile, File, Form


def _safe_filename(filename: str) -> str:
    import re
    import unicodedata
    name = unicodedata.normalize("NFKD", filename).encode("ascii", "ignore").decode("ascii")
    name = re.sub(r"[^\w\s\.-]", "", name).strip()
    return re.sub(r"[-\s]+", "_", name)


@router.post("/headers", response_model=CustomReportHeaderResponse, status_code=status.HTTP_201_CREATED)
async def create_custom_report_header_route(
    name: str = Form(...),
    main_heading: str = Form(...),
    sub_heading: str | None = Form(None),
    font_family: str | None = Form(None),
    font_size: int | None = Form(None),
    text_color: str | None = Form(None),
    text_align: str | None = Form("center"),
    sub_font_family: str | None = Form(None),
    sub_font_size: int | None = Form(None),
    sub_text_color: str | None = Form(None),
    sub_text_align: str | None = Form(None),
    kpi_name_color: str | None = Form(None),
    organization_id: int | None = Form(None),
    file: UploadFile = File(...),
    file2: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create a new custom report header with an uploaded logo image. Org Admin or Super Admin."""
    org_id = _org_id(current_user, organization_id)
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No logo file uploaded")
        
    content = await file.read()
    content_type = file.content_type or "application/octet-stream"
    
    # Store logo in storage under custom_headers
    from app.storage.service import upload_file as storage_upload_file
    base_name = _safe_filename(file.filename)
    unique_name = f"{uuid.uuid4().hex[:8]}_{base_name}"
    relative_path = f"org_{org_id}/custom_headers/{unique_name}"
    
    try:
        stored_path = await storage_upload_file(db, org_id, relative_path, content, content_type)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Storage upload error: {e!s}")

    # Store optional second logo
    stored_path_2 = None
    if file2 and file2.filename:
        content2 = await file2.read()
        content_type2 = file2.content_type or "application/octet-stream"
        base_name2 = _safe_filename(file2.filename)
        unique_name2 = f"{uuid.uuid4().hex[:8]}_{base_name2}"
        relative_path2 = f"org_{org_id}/custom_headers/{unique_name2}"
        try:
            stored_path_2 = await storage_upload_file(db, org_id, relative_path2, content2, content_type2)
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Storage upload error (logo2): {e!s}")
        
    header = CustomReportHeader(
        organization_id=org_id,
        name=name,
        logo_path=stored_path,
        logo_path_2=stored_path_2,
        main_heading=main_heading,
        sub_heading=sub_heading,
        font_family=font_family,
        font_size=font_size,
        text_color=text_color,
        text_align=text_align or "center",
        sub_font_family=sub_font_family,
        sub_font_size=sub_font_size,
        sub_text_color=sub_text_color,
        sub_text_align=sub_text_align or "center",
        kpi_name_color=kpi_name_color,
    )
    db.add(header)
    await db.commit()
    await db.refresh(header)
    return CustomReportHeaderResponse.from_model(header)


@router.get("/headers", response_model=list[CustomReportHeaderResponse])
async def list_custom_report_headers_route(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all custom report headers for the organization. Auth: Logged in user."""
    org_id = _org_id(current_user, organization_id)
    if current_user.role.value != "SUPER_ADMIN" and org_id != current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this organization's headers")
        
    stmt = select(CustomReportHeader).where(CustomReportHeader.organization_id == org_id).order_by(CustomReportHeader.name.asc())
    res = await db.execute(stmt)
    headers = res.scalars().all()
    return [CustomReportHeaderResponse.from_model(h) for h in headers]


@router.get("/headers/{header_id}", response_model=CustomReportHeaderResponse)
async def get_custom_report_header_route(
    header_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get details of a specific custom report header. Auth: Logged in user."""
    stmt = select(CustomReportHeader).where(CustomReportHeader.id == header_id)
    res = await db.execute(stmt)
    header = res.scalar_one_or_none()
    if not header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom header not found")
        
    if current_user.role.value != "SUPER_ADMIN" and header.organization_id != current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this header")
        
    return CustomReportHeaderResponse.from_model(header)


@router.get("/headers/{header_id}/logo")
async def download_custom_header_logo_route(
    header_id: int,
    token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Download/stream the custom header logo image."""
    return await _download_custom_header_logo_impl(header_id, token, db, is_secondary=False)


@router.get("/headers/{header_id}/logo2")
@router.get("/headers/{header_id}/logo-2")
async def download_custom_header_logo2_route(
    header_id: int,
    token: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Download/stream the custom header secondary logo image."""
    return await _download_custom_header_logo_impl(header_id, token, db, is_secondary=True)


async def _download_custom_header_logo_impl(header_id: int, token_str: str | None, db: AsyncSession, is_secondary: bool = False):
    stmt = select(CustomReportHeader).where(CustomReportHeader.id == header_id)
    res = await db.execute(stmt)
    header = res.scalar_one_or_none()
    if not header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom header not found")
        
    logo_path = header.logo_path_2 if is_secondary else header.logo_path
    if not logo_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Logo image not set for this header")
        
    from app.storage.service import get_file_stream as storage_get_file_stream
    try:
        data = await storage_get_file_stream(db, header.organization_id, logo_path)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Logo file not found in storage")
        
    import mimetypes
    c_type, _ = mimetypes.guess_type(logo_path)
    return StreamingResponse(io.BytesIO(data), media_type=c_type or "image/png")
    current_user = res_user.scalar_one_or_none()
    if not current_user or not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Inactive or invalid user")
        
    stmt = select(CustomReportHeader).where(CustomReportHeader.id == header_id)
    res = await db.execute(stmt)
    header = res.scalar_one_or_none()
    if not header or not header.logo_path_2:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom header secondary logo not found")
        
    if current_user.role.value != "SUPER_ADMIN" and header.organization_id != current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this header's logo")
        
    from app.storage.service import get_file_stream as storage_get_file_stream
    try:
        data = await storage_get_file_stream(db, header.organization_id, header.logo_path_2)
    except FileNotFoundError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Logo file not found in storage")
        
    import mimetypes
    c_type, _ = mimetypes.guess_type(header.logo_path_2)
    return StreamingResponse(io.BytesIO(data), media_type=c_type or "application/octet-stream")


@router.put("/headers/{header_id}", response_model=CustomReportHeaderResponse)
async def update_custom_report_header_route(
    header_id: int,
    name: str = Form(...),
    main_heading: str = Form(...),
    sub_heading: str | None = Form(None),
    font_family: str | None = Form(None),
    font_size: int | None = Form(None),
    text_color: str | None = Form(None),
    text_align: str | None = Form(None),
    sub_font_family: str | None = Form(None),
    sub_font_size: int | None = Form(None),
    sub_text_color: str | None = Form(None),
    sub_text_align: str | None = Form(None),
    kpi_name_color: str | None = Form(None),
    remove_logo_2: bool | None = Form(False),
    file: UploadFile | None = File(None),
    file2: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update custom report header details. Option to upload new primary or secondary logo files. Org Admin or Super Admin."""
    stmt = select(CustomReportHeader).where(CustomReportHeader.id == header_id)
    res = await db.execute(stmt)
    header = res.scalar_one_or_none()
    if not header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom header not found")
        
    if current_user.role.value != "SUPER_ADMIN" and header.organization_id != current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this header")
        
    org_id = header.organization_id
    header.name = name
    header.main_heading = main_heading
    header.sub_heading = sub_heading
    if font_family is not None:
        header.font_family = font_family
    if font_size is not None:
        header.font_size = font_size
    if text_color is not None:
        header.text_color = text_color
    if text_align is not None:
        header.text_align = text_align
    if sub_font_family is not None:
        header.sub_font_family = sub_font_family
    if sub_font_size is not None:
        header.sub_font_size = sub_font_size
    if sub_text_color is not None:
        header.sub_text_color = sub_text_color
    if sub_text_align is not None:
        header.sub_text_align = sub_text_align
    if kpi_name_color is not None:
        header.kpi_name_color = kpi_name_color
    
    from app.storage.service import upload_file as storage_upload_file, delete_file as storage_delete_file

    if file and file.filename:
        # Delete old primary logo
        try:
            await storage_delete_file(db, org_id, header.logo_path)
        except Exception:
            pass
            
        base_name = _safe_filename(file.filename)
        unique_name = f"{uuid.uuid4().hex[:8]}_{base_name}"
        relative_path = f"org_{org_id}/custom_headers/{unique_name}"
        
        try:
            stored_path = await storage_upload_file(db, org_id, relative_path, content=await file.read(), content_type=file.content_type or "application/octet-stream")
            header.logo_path = stored_path
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Storage upload error: {e!s}")

    if remove_logo_2 and header.logo_path_2:
        try:
            await storage_delete_file(db, org_id, header.logo_path_2)
        except Exception:
            pass
        header.logo_path_2 = None
    elif file2 and file2.filename:
        if header.logo_path_2:
            try:
                await storage_delete_file(db, org_id, header.logo_path_2)
            except Exception:
                pass
        base_name2 = _safe_filename(file2.filename)
        unique_name2 = f"{uuid.uuid4().hex[:8]}_{base_name2}"
        relative_path2 = f"org_{org_id}/custom_headers/{unique_name2}"
        try:
            stored_path2 = await storage_upload_file(db, org_id, relative_path2, content=await file2.read(), content_type=file2.content_type or "application/octet-stream")
            header.logo_path_2 = stored_path2
        except Exception as e:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Storage upload error (logo2): {e!s}")
            
    header.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(header)
    return CustomReportHeaderResponse.from_model(header)


@router.delete("/headers/{header_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_custom_report_header_route(
    header_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete a custom report header and its logo images. Org Admin or Super Admin."""
    stmt = select(CustomReportHeader).where(CustomReportHeader.id == header_id)
    res = await db.execute(stmt)
    header = res.scalar_one_or_none()
    if not header:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Custom header not found")
        
    if current_user.role.value != "SUPER_ADMIN" and header.organization_id != current_user.organization_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this header")
        
    org_id = header.organization_id
    
    # Delete files from storage
    from app.storage.service import delete_file as storage_delete_file
    try:
        await storage_delete_file(db, org_id, header.logo_path)
    except Exception:
        pass

    if header.logo_path_2:
        try:
            await storage_delete_file(db, org_id, header.logo_path_2)
        except Exception:
            pass
        
    await db.delete(header)
    await db.commit()


# --- Organization Branding Endpoints ---

@router.get("/organizations/{organization_id}/branding", response_model=OrganizationBrandingResponse | None)
async def get_organization_branding_route(
    organization_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the organization's custom branding footer label."""
    stmt = select(OrganizationBranding).where(OrganizationBranding.organization_id == organization_id)
    res = await db.execute(stmt)
    branding = res.scalar_one_or_none()
    if not branding:
        return None
    return OrganizationBrandingResponse.model_validate(branding)


@router.put("/organizations/{organization_id}/branding", response_model=OrganizationBrandingResponse)
async def upsert_organization_branding_route(
    organization_id: int,
    body: OrganizationBrandingUpsert,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Upsert the organization's custom branding footer label. Super Admin only."""
    stmt = select(OrganizationBranding).where(OrganizationBranding.organization_id == organization_id)
    res = await db.execute(stmt)
    branding = res.scalar_one_or_none()

    if branding:
        branding.footer_label = body.footer_label
        branding.updated_at = datetime.utcnow()
    else:
        branding = OrganizationBranding(
            organization_id=organization_id,
            footer_label=body.footer_label,
        )
        db.add(branding)

    await db.commit()
    await db.refresh(branding)
    return OrganizationBrandingResponse.model_validate(branding)


@router.delete("/organizations/{organization_id}/branding", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization_branding_route(
    organization_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Delete the organization's custom branding label (resets to default). Super Admin only."""
    stmt = select(OrganizationBranding).where(OrganizationBranding.organization_id == organization_id)
    res = await db.execute(stmt)
    branding = res.scalar_one_or_none()
    if branding:
        await db.delete(branding)
        await db.commit()

