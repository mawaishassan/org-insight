from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.models import User
from app.auth.dependencies import get_current_user
from app.reports.routes import _org_id
from app.reports.custom_report_groups.schemas import (
    CustomReportGroupCreate,
    CustomReportGroupUpdate,
    CustomReportGroupResponse,
)
from app.reports.custom_report_groups.service import (
    list_custom_report_groups,
    create_custom_report_group,
    update_custom_report_group,
    delete_custom_report_group,
    get_custom_report_group,
)

router = APIRouter(prefix="/custom-report-groups", tags=["Custom Report Groups"])

def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: Custom Report Groups management is restricted to Super Admins",
        )
    return current_user

@router.get("", response_model=list[CustomReportGroupResponse])
async def list_groups(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List Custom Report Groups/Sections for an organization."""
    org_id = _org_id(current_user, organization_id)
    return await list_custom_report_groups(db, org_id)

@router.post("", response_model=CustomReportGroupResponse, status_code=status.HTTP_201_CREATED)
async def create_group(
    data: CustomReportGroupCreate,
    organization_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Create a new Custom Report Group/Section."""
    return await create_custom_report_group(db, organization_id, data)

@router.put("/{id}", response_model=CustomReportGroupResponse)
async def update_group(
    id: int,
    data: CustomReportGroupUpdate,
    organization_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Update Custom Report Group name/sorting."""
    group = await update_custom_report_group(db, id, organization_id, data)
    if not group:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return group

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_group(
    id: int,
    organization_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """Delete a Custom Report Group/Section."""
    deleted = await delete_custom_report_group(db, id, organization_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Group not found")
    return None
