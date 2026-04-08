"""Dashboard API routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin
from app.core.models import User, Dashboard
from app.dashboards.schemas import (
    DashboardCreate,
    DashboardUpdate,
    DashboardResponse,
    DashboardDetailResponse,
    DashboardAccessAssign,
    DashboardAssignmentResponse,
)
from app.dashboards.service import (
    list_all_dashboards,
    list_dashboards,
    get_dashboard,
    create_dashboard,
    update_dashboard,
    delete_dashboard,
    assign_dashboard_to_user,
    unassign_dashboard_from_user,
    list_dashboard_assignments,
    user_can_access_dashboard,
)


router = APIRouter(prefix="/dashboards", tags=["dashboards"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


async def _org_id_for_dashboard(
    db: AsyncSession, user: User, dashboard_id: int, org_id_param: int | None
) -> int:
    """Resolve org for dashboard-scoped routes (mirrors reports behavior)."""
    if user.role.value == "SUPER_ADMIN" and org_id_param is None:
        d = (await db.execute(select(Dashboard).where(Dashboard.id == dashboard_id))).scalar_one_or_none()
        if not d:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
        return d.organization_id
    return _org_id(user, org_id_param)


@router.get("", response_model=list[DashboardResponse])
async def list_org_dashboards(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List dashboards (org admin: all org; others: only assigned). Super Admin with no org sees all dashboards."""
    if current_user.role.value == "SUPER_ADMIN" and organization_id is None:
        dashboards = await list_all_dashboards(db)
    else:
        org_id = _org_id(current_user, organization_id)
        dashboards = await list_dashboards(db, org_id)
    if current_user.role.value not in ("ORG_ADMIN", "SUPER_ADMIN"):
        allowed: set[int] = set()
        for d in dashboards:
            if await user_can_access_dashboard(db, current_user.id, d.id, "view"):
                allowed.add(d.id)
        dashboards = [d for d in dashboards if d.id in allowed]
    return [DashboardResponse.model_validate(d) for d in dashboards]


@router.post("", response_model=DashboardResponse, status_code=status.HTTP_201_CREATED)
async def create_org_dashboard(
    body: DashboardCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create dashboard (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may create dashboards")
    org_id = _org_id(current_user, organization_id)
    d = await create_dashboard(db, org_id, name=body.name, description=body.description, layout=body.layout)
    await db.commit()
    await db.refresh(d)
    return DashboardResponse.model_validate(d)


@router.get("/{dashboard_id}", response_model=DashboardDetailResponse)
async def get_one_dashboard(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    can = await user_can_access_dashboard(db, current_user.id, dashboard_id, "view")
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access")
    d = await get_dashboard(db, dashboard_id, org_id)
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    return DashboardDetailResponse.model_validate(d)


@router.patch("/{dashboard_id}", response_model=DashboardResponse)
async def update_one_dashboard(
    dashboard_id: int,
    body: DashboardUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update dashboard (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may update dashboards")
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    d = await update_dashboard(
        db,
        dashboard_id,
        org_id,
        name=body.name,
        description=body.description,
        layout=body.layout,
    )
    if not d:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    await db.commit()
    await db.refresh(d)
    return DashboardResponse.model_validate(d)


@router.delete("/{dashboard_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_one_dashboard(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete dashboard (Super Admin only)."""
    if current_user.role.value != "SUPER_ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Super Admin may delete dashboards")
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    ok = await delete_dashboard(db, dashboard_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard not found")
    await db.commit()


@router.get("/{dashboard_id}/users", response_model=list[DashboardAssignmentResponse])
async def list_users_for_dashboard(
    dashboard_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List dashboard assignments. ORG_ADMIN can manage within their org."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    assignments = await list_dashboard_assignments(db, dashboard_id, org_id)
    return [DashboardAssignmentResponse.model_validate(a) for a in assignments]


@router.post("/{dashboard_id}/assign", status_code=status.HTTP_201_CREATED)
async def assign_user_to_dashboard(
    dashboard_id: int,
    body: DashboardAccessAssign,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Assign dashboard to user (view/edit). ORG_ADMIN can assign within their org."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    perm = await assign_dashboard_to_user(
        db,
        dashboard_id,
        org_id,
        body.user_id,
        can_view=body.can_view,
        can_edit=body.can_edit,
    )
    if not perm:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dashboard or user not found")
    await db.commit()
    return {
        "user_id": perm.user_id,
        "dashboard_id": perm.dashboard_id,
        "can_view": perm.can_view,
        "can_edit": perm.can_edit,
    }


@router.delete("/{dashboard_id}/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unassign_user_from_dashboard(
    dashboard_id: int,
    user_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Remove dashboard assignment from user. ORG_ADMIN can unassign within their org."""
    org_id = await _org_id_for_dashboard(db, current_user, dashboard_id, organization_id)
    ok = await unassign_dashboard_from_user(db, dashboard_id, org_id, user_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    await db.commit()

