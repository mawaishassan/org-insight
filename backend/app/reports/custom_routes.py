import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin
from app.core.models import User, CustomReport, CustomReportAssignment
from app.reports.custom_schemas import (
    CustomReportCreate,
    CustomReportUpdate,
    CustomReportResponse,
    CustomReportLayoutSave,
    CustomReportAssignmentRequest,
    CustomReportAssignmentResponse
)
from app.reports.custom_service import (
    create_custom_report,
    get_custom_report,
    list_custom_reports,
    update_custom_report,
    delete_custom_report,
    duplicate_custom_report,
    save_custom_report_layout,
    assign_custom_report,
    unassign_custom_report,
    list_custom_report_assignments,
    generate_custom_report_data,
    render_custom_report_html,
    CUSTOM_REPORT_CACHE,
    REPORT_TASKS,
    run_background_generation_task,
    stream_custom_report_data
)

router = APIRouter(prefix="/custom-reports", tags=["custom-reports"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


async def check_custom_report_access(db: AsyncSession, user: User, custom_report_id: int, action: str) -> bool:
    if user.role.value == "SUPER_ADMIN":
        return True

    report = (await db.execute(select(CustomReport).where(CustomReport.id == custom_report_id))).scalar_one_or_none()
    if not report:
        return False

    if user.organization_id != report.organization_id:
        return False

    if user.role.value == "ORG_ADMIN":
        if action in ("view", "assign", "generate", "print", "export"):
            return True
        return False

    # Other roles (USER / REPORT_VIEWER): check assignment
    assignment = (
        await db.execute(
            select(CustomReportAssignment)
            .where(CustomReportAssignment.custom_report_id == custom_report_id, CustomReportAssignment.user_id == user.id)
        )
    ).scalar_one_or_none()

    if not assignment:
        return False

    if action in ("view", "generate"):
        return assignment.can_view
    elif action == "print":
        return assignment.can_print
    elif action == "export":
        return assignment.can_export

    return False


@router.get("", response_model=list[CustomReportResponse])
async def list_reports(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List custom reports."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        # Super Admin sees all reports
        result = await db.execute(select(CustomReport).order_by(CustomReport.name))
        return list(result.scalars().all())

    org_id = _org_id(current_user, organization_id)
    reports = await list_custom_reports(db, org_id)

    # Filter for non-admin roles based on assignments
    if current_user.role.value not in ("ORG_ADMIN", "SUPER_ADMIN"):
        allowed = []
        for r in reports:
            if await check_custom_report_access(db, current_user, r.id, "view"):
                allowed.append(r)
        reports = allowed

    return reports


@router.post("", response_model=CustomReportResponse, status_code=status.HTTP_201_CREATED)
async def create_template(
    body: CustomReportCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may create custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    report = await create_custom_report(db, org_id, body)
    await db.commit()
    await db.refresh(report)
    return report


@router.get("/{id}", response_model=CustomReportResponse)
async def get_report_metadata(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get custom report metadata."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    report = await get_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    return report


@router.get("/{id}/detail")
async def get_report_details(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get custom report with sections and fields (for builder)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "view"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    report = await get_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    # Serialize sections and fields
    sections_data = []
    for sec in report.sections:
        fields_data = []
        for f in sec.fields:
            fields_data.append({
                "id": f.id,
                "custom_report_section_id": f.custom_report_section_id,
                "kpi_field_id": f.kpi_field_id,
                "field_key": f.kpi_field.key,
                "field_name": f.kpi_field.name,
                "field_type": f.kpi_field.field_type.value if hasattr(f.kpi_field.field_type, "value") else str(f.kpi_field.field_type),
                "sort_order": f.sort_order,
                "kpi_id": f.kpi_field.kpi_id,
                "config": f.config
            })
        sections_data.append({
            "id": sec.id,
            "kpi_id": sec.kpi_id,
            "kpi_name": sec.kpi.name if sec.kpi else f"KPI #{sec.kpi_id}",
            "custom_header": sec.custom_header,
            "sort_order": sec.sort_order,
            "fields": fields_data
        })

    return {
        "id": report.id,
        "organization_id": report.organization_id,
        "name": report.name,
        "description": report.description,
        "sections": sections_data
    }


@router.patch("/{id}", response_model=CustomReportResponse)
async def update_report_metadata(
    id: int,
    body: CustomReportUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may update custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    report = await update_custom_report(db, id, org_id, body)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    await db.commit()
    await db.refresh(report)
    return report


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_report(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may delete custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    ok = await delete_custom_report(db, id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    await db.commit()


@router.post("/{id}/duplicate", response_model=CustomReportResponse)
async def duplicate_report_route(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Duplicate custom report (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may duplicate custom reports"
        )
    org_id = _org_id(current_user, organization_id)
    report = await duplicate_custom_report(db, id, org_id)
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    await db.commit()
    return report


@router.put("/{id}/layout", status_code=status.HTTP_204_NO_CONTENT)
async def save_layout(
    id: int,
    body: CustomReportLayoutSave,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Save custom report layout (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may edit custom report layouts"
        )
    org_id = _org_id(current_user, organization_id)
    ok = await save_custom_report_layout(db, id, org_id, body.sections)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")
    await db.commit()


@router.get("/{id}/generate")
async def generate_report(
    id: int,
    year: int | None = Query(None),
    organization_id: int | None = Query(None),
    preview: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate custom report data (with optional preview capping and cache support)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "generate"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    cache_key = (id, org_id, year or "current", "preview" if preview else "full")
    cached = CUSTOM_REPORT_CACHE.get(cache_key)
    if cached:
        return cached

    data = await generate_custom_report_data(
        db, id, org_id, year=year, include_drafts=False, preview=preview
    )
    if not data:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found")

    # Render HTML and attach
    html = await render_custom_report_html(
        db, id, org_id, year=year, include_drafts=False, report_data=data
    )
    if html is not None:
        data["rendered_html"] = html

    CUSTOM_REPORT_CACHE.set(cache_key, data)
    return data


@router.get("/{id}/generate-stream")
async def generate_report_stream(
    id: int,
    year: int | None = Query(None),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Stream custom report data in NDJSON format for progressive loading."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "generate"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    from fastapi.responses import StreamingResponse
    import json
    import logging
    logger = logging.getLogger(__name__)

    async def event_generator():
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as stream_db:
            try:
                async for chunk in stream_custom_report_data(stream_db, id, org_id, year):
                    yield json.dumps(chunk) + "\n"
            except Exception as e:
                logger.exception("Error during custom report streaming")
                yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


@router.post("/{id}/generate-async")
async def generate_report_async(
    id: int,
    background_tasks: BackgroundTasks,
    year: int | None = Query(None),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Start custom report generation in background (non-blocking)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "generate"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    task_id = str(uuid.uuid4())
    background_tasks.add_task(run_background_generation_task, task_id, id, org_id, year)
    
    return {"task_id": task_id, "status": "processing", "progress": 0}


@router.get("/tasks/{task_id}")
async def get_report_task_status(
    task_id: str,
    current_user: User = Depends(get_current_user),
):
    """Poll the status of a background report generation task."""
    task = REPORT_TASKS.get(task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    return {
        "task_id": task_id,
        "status": task["status"],
        "progress": task["progress"],
        "error": task["error"],
        "result": task["result"] if task["status"] == "completed" else None
    }


@router.get("/{id}/users", response_model=list[CustomReportAssignmentResponse])
async def list_assignments(
    id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List user assignments (Org Admin / Super Admin)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "assign"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    assignments = await list_custom_report_assignments(db, id)

    out = []
    for a in assignments:
        out.append(
            CustomReportAssignmentResponse(
                id=a.id,
                custom_report_id=a.custom_report_id,
                user_id=a.user_id,
                can_view=a.can_view,
                can_print=a.can_print,
                can_export=a.can_export,
                created_at=a.created_at,
                user_name=a.user.full_name or a.user.username if a.user else None,
                user_role=a.user.role.value if a.user else None,
            )
        )
    return out


@router.post("/{id}/assign", response_model=CustomReportAssignmentResponse)
async def assign_user(
    id: int,
    body: CustomReportAssignmentRequest,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign custom report to user (Org Admin / Super Admin)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "assign"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    perm = await assign_custom_report(
        db, id, body.user_id, can_view=body.can_view, can_print=body.can_print, can_export=body.can_export
    )
    await db.commit()
    await db.refresh(perm)

    # Fetch user for details
    from app.core.models import User
    user = await db.get(User, perm.user_id)

    return CustomReportAssignmentResponse(
        id=perm.id,
        custom_report_id=perm.custom_report_id,
        user_id=perm.user_id,
        can_view=perm.can_view,
        can_print=perm.can_print,
        can_export=perm.can_export,
        created_at=perm.created_at,
        user_name=user.full_name or user.username if user else None,
        user_role=user.role.value if user else None,
    )


@router.delete("/{id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_route(
    id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Unassign custom report from user (Org Admin / Super Admin)."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "assign"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    ok = await unassign_custom_report(db, id, user_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found")
    await db.commit()


@router.get("/{id}/export")
async def export_custom_report(
    id: int,
    year: int = Query(...),
    format: str = Query("pdf"), # "pdf" | "docx" | "xlsx"
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export custom report as PDF, DOCX, or XLSX."""
    org_id = _org_id(current_user, organization_id)
    if not await check_custom_report_access(db, current_user, id, "export"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")

    from app.reports.custom_service import export_custom_report_file
    try:
        file_bytes, filename, content_type = await export_custom_report_file(
            db, id, org_id, year, format
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export report: {str(e)}"
        )

    from fastapi.responses import StreamingResponse
    import io
    return StreamingResponse(
        io.BytesIO(file_bytes),
        media_type=content_type,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )
