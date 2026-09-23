"""User CRUD with tenant isolation and KPI/report assignments."""

from datetime import datetime
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete

from app.core.models import User, UserRole, KPI, KPIAssignment, ReportAccessPermission, ReportTemplate
from app.core.security import get_password_hash
from uuid import uuid4

from app.users.schemas import UserCreate, UserUpdate, ExternalUserCreate
from app.core.models import ExternalUser


def _tenant_filter(q, org_id: int | None, super_admin: bool):
    """Apply tenant filter: org users must match org_id; super admin can list any org."""
    if super_admin and org_id is not None:
        return q.where(User.organization_id == org_id)
    if not super_admin and org_id is not None:
        return q.where(User.organization_id == org_id)
    return q


async def create_user(
    db: AsyncSession,
    org_id: int,
    data: UserCreate,
) -> User:
    """Create user in organization and assign KPIs and report templates."""
    # Validate KPI IDs belong to org_id
    assigned_kpi_ids = [a.kpi_id for a in data.kpi_assignments] if data.kpi_assignments is not None else list(data.kpi_ids)
    if assigned_kpi_ids:
        kpi_res = await db.execute(select(KPI.id).where(KPI.id.in_(assigned_kpi_ids), KPI.organization_id == org_id))
        valid_kpi_ids = set(kpi_res.scalars().all())
        invalid_kpis = set(assigned_kpi_ids) - valid_kpi_ids
        if invalid_kpis:
            raise HTTPException(status_code=400, detail=f"KPI IDs do not belong to this organization: {sorted(list(invalid_kpis))}")

    # Validate ReportTemplate IDs belong to org_id
    if data.report_template_ids:
        rt_res = await db.execute(
            select(ReportTemplate.id).where(
                ReportTemplate.id.in_(data.report_template_ids),
                ReportTemplate.organization_id == org_id,
            )
        )
        valid_rt_ids = set(rt_res.scalars().all())
        invalid_rts = set(data.report_template_ids) - valid_rt_ids
        if invalid_rts:
            raise HTTPException(status_code=400, detail=f"Report template IDs do not belong to this organization: {sorted(list(invalid_rts))}")

    user = User(
        organization_id=org_id,
        username=data.username,
        email=data.email,
        full_name=data.full_name,
        hashed_password=get_password_hash(data.password),
        role=data.role,
        is_active=True,
        unique_user_key=data.unique_user_key,
    )
    db.add(user)
    await db.flush()
    if data.kpi_assignments is not None:
        for a in data.kpi_assignments:
            perm = (a.permission or "data_entry").strip().lower()
            if perm not in ("data_entry", "view"):
                perm = "data_entry"
            db.add(KPIAssignment(user_id=user.id, kpi_id=a.kpi_id, assignment_type=perm))
    else:
        for kpi_id in data.kpi_ids:
            db.add(KPIAssignment(user_id=user.id, kpi_id=kpi_id))
    for rt_id in data.report_template_ids:
        db.add(
            ReportAccessPermission(
                report_template_id=rt_id,
                user_id=user.id,
                can_view=True,
                can_print=True,
                can_export=True,
            )
        )
    await db.flush()
    return user


async def create_external_user(
    db: AsyncSession,
    org_id: int,
    data: ExternalUserCreate,
) -> User:
    """
    Create an external user.

    Note: No password is stored/validated for external logins; we still must populate `hashed_password`
    because the column is non-nullable. We use a random dummy hash.
    """
    dummy_password = f"external:{uuid4().hex}"
    val_key = data.unique_user_key.strip() if data.unique_user_key and data.unique_user_key.strip() else None
    user = User(
        organization_id=org_id,
        username=data.username,
        email=None,
        full_name=data.full_name,
        unique_user_key=val_key,
        hashed_password=get_password_hash(dummy_password),
        role=UserRole.USER,
        is_active=data.is_active,
    )
    db.add(user)
    await db.flush()

    db.add(ExternalUser(user_id=user.id, description=data.description))
    await db.flush()
    return user


async def get_user(db: AsyncSession, user_id: int, org_id: int | None = None) -> User | None:
    """Get user by id; optionally enforce org."""
    q = select(User).where(User.id == user_id)
    if org_id is not None:
        q = q.where(User.organization_id == org_id)
    result = await db.execute(q)
    return result.scalar_one_or_none()


async def get_user_kpi_assignments(
    db: AsyncSession, user_id: int, org_id: int
) -> list[dict]:
    """Get user's KPI assignments (kpi_id, permission) within org. Returns list of { kpi_id, permission }."""
    user = await get_user(db, user_id, org_id)
    if not user:
        return []
    result = await db.execute(
        select(KPIAssignment.kpi_id, KPIAssignment.assignment_type)
        .join(KPI, KPI.id == KPIAssignment.kpi_id)
        .where(KPIAssignment.user_id == user_id, KPI.organization_id == org_id)
    )
    out = []
    for row in result.all():
        kpi_id, atype = row[0], row[1]
        perm = atype.value if hasattr(atype, "value") else str(atype or "data_entry")
        if perm not in ("data_entry", "view"):
            perm = "data_entry"
        out.append({"kpi_id": kpi_id, "permission": perm})
    return out


async def list_users(
    db: AsyncSession,
    org_id: int,
) -> list[User]:
    """List users in organization (exclude super admin)."""
    result = await db.execute(
        select(User)
        .where(User.organization_id == org_id)
        .order_by(User.username)
    )
    return list(result.scalars().all())


async def update_user(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    data: UserUpdate,
) -> User | None:
    """Update user and optionally KPI/report assignments."""
    user = await get_user(db, user_id, org_id)
    if not user:
        return None
    if data.username is not None:
        user.username = data.username
    if data.email is not None:
        user.email = data.email
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.password is not None:
        user.hashed_password = get_password_hash(data.password)
    if data.role is not None:
        user.role = data.role
    if data.is_active is not None:
        user.is_active = data.is_active
    if data.unique_user_key is not None:
        val = data.unique_user_key.strip()
        user.unique_user_key = val if val else None
    if "default_dashboard_id" in data.model_dump(exclude_unset=True):
        if data.default_dashboard_id is not None:
            from app.core.models import Dashboard
            from app.dashboards.service import user_can_access_dashboard
            d_res = await db.execute(
                select(Dashboard.id).where(
                    Dashboard.id == data.default_dashboard_id,
                    Dashboard.organization_id == org_id,
                )
            )
            if not d_res.scalar_one_or_none():
                raise HTTPException(status_code=400, detail="Selected dashboard does not exist in this organization")
            can_access = await user_can_access_dashboard(db, user.id, data.default_dashboard_id, "view")
            if not can_access and user.role != UserRole.ORG_ADMIN:
                raise HTTPException(status_code=400, detail="User does not have access to the selected dashboard")
            user.default_dashboard_id = data.default_dashboard_id
        else:
            user.default_dashboard_id = None
    if data.force_password_reset is not None:
        user.force_password_reset = data.force_password_reset
        now = datetime.utcnow()
        if data.force_password_reset:
            user.password_reset_requested_at = now
            from app.core.models import PasswordResetAudit
            db.add(
                PasswordResetAudit(
                    organization_id=org_id,
                    user_id=user.id,
                    status="PENDING",
                    requested_at=now,
                )
            )
        else:
            from app.core.models import PasswordResetAudit
            audit_res = await db.execute(
                select(PasswordResetAudit).where(
                    PasswordResetAudit.user_id == user.id,
                    PasswordResetAudit.status == "PENDING",
                )
            )
            for pa in audit_res.scalars().all():
                pa.status = "CANCELLED"
                pa.cancelled_at = now
    if data.kpi_assignments is not None:
        assigned_kpi_ids = [a.kpi_id for a in data.kpi_assignments]
        if assigned_kpi_ids:
            kpi_res = await db.execute(select(KPI.id).where(KPI.id.in_(assigned_kpi_ids), KPI.organization_id == org_id))
            valid_kpi_ids = set(kpi_res.scalars().all())
            invalid_kpis = set(assigned_kpi_ids) - valid_kpi_ids
            if invalid_kpis:
                raise HTTPException(status_code=400, detail=f"KPI IDs do not belong to this organization: {sorted(list(invalid_kpis))}")

        await db.execute(delete(KPIAssignment).where(KPIAssignment.user_id == user_id))
        for a in data.kpi_assignments:
            perm = (a.permission or "data_entry").strip().lower()
            if perm not in ("data_entry", "view"):
                perm = "data_entry"
            db.add(KPIAssignment(user_id=user_id, kpi_id=a.kpi_id, assignment_type=perm))
    elif data.kpi_ids is not None:
        if data.kpi_ids:
            kpi_res = await db.execute(select(KPI.id).where(KPI.id.in_(data.kpi_ids), KPI.organization_id == org_id))
            valid_kpi_ids = set(kpi_res.scalars().all())
            invalid_kpis = set(data.kpi_ids) - valid_kpi_ids
            if invalid_kpis:
                raise HTTPException(status_code=400, detail=f"KPI IDs do not belong to this organization: {sorted(list(invalid_kpis))}")

        await db.execute(delete(KPIAssignment).where(KPIAssignment.user_id == user_id))
        for kpi_id in data.kpi_ids:
            db.add(KPIAssignment(user_id=user_id, kpi_id=kpi_id))
    if data.report_template_ids is not None:
        if data.report_template_ids:
            rt_res = await db.execute(
                select(ReportTemplate.id).where(
                    ReportTemplate.id.in_(data.report_template_ids),
                    ReportTemplate.organization_id == org_id,
                )
            )
            valid_rt_ids = set(rt_res.scalars().all())
            invalid_rts = set(data.report_template_ids) - valid_rt_ids
            if invalid_rts:
                raise HTTPException(status_code=400, detail=f"Report template IDs do not belong to this organization: {sorted(list(invalid_rts))}")

        await db.execute(
            delete(ReportAccessPermission).where(ReportAccessPermission.user_id == user_id)
        )
        for rt_id in data.report_template_ids:
            db.add(
                ReportAccessPermission(
                    report_template_id=rt_id,
                    user_id=user_id,
                    can_view=True,
                    can_print=True,
                    can_export=True,
                )
            )
    await db.flush()
    try:
        from app.access_management import invalidate_all_access_and_report_caches
        invalidate_all_access_and_report_caches(db)
    except Exception:
        pass
    return user


async def delete_user(db: AsyncSession, user_id: int, org_id: int) -> bool:
    """Delete user (cascade will remove assignments)."""
    user = await get_user(db, user_id, org_id)
    if not user:
        return False
    if user.role == UserRole.ORG_ADMIN:
        return False  # Prevent deleting org admin via this endpoint if desired
    await db.delete(user)
    await db.flush()
    return True
