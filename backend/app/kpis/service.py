"""KPI CRUD with tenant isolation via domain."""

import logging
import httpx
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload

from app.core.models import (
    KPI,
    User,
    KPIAssignment,
    KpiRoleAssignment,
    KpiFieldAccess,
    KpiFieldAccessByRole,
    KpiMultiLineRowAccess,
    OrganizationRole,
    Domain,
    Category,
    KPIDomain,
    KPICategory,
    KPIOrganizationTag,
    OrganizationTag,
    KPIEntry,
    KPIFieldValue,
    KPIField,
    KPIFieldOption,
    ReportTemplateField,
    ReportTemplateKPI,
    FieldType,
    Organization,
    TimeDimension,
    time_dimension_allowed_for_kpi,
)
from app.kpis.schemas import KPICreate, KPIUpdate
from app.entries.service import get_or_create_entry, save_entry_values
from app.entries.schemas import FieldValueInput


async def _domain_org_id(db: AsyncSession, domain_id: int) -> int | None:
    """Return organization_id for domain or None."""
    result = await db.execute(select(Domain).where(Domain.id == domain_id))
    d = result.scalar_one_or_none()
    return d.organization_id if d else None


async def _next_sort_order_for_org(db: AsyncSession, org_id: int) -> int:
    """Return the next sort_order for a new KPI in this organization (max + 1, or 0)."""
    r = await db.execute(select(func.coalesce(func.max(KPI.sort_order), -1)).where(KPI.organization_id == org_id))
    max_order = r.scalar() or -1
    return max_order + 1


async def create_kpi(db: AsyncSession, org_id: int, data: KPICreate) -> KPI | None:
    """Create KPI in organization; domain is optional (can attach domains later). sort_order is set to next in org."""
    next_order = await _next_sort_order_for_org(db, org_id)
    entry_mode = (data.entry_mode or "manual").strip().lower() if getattr(data, "entry_mode", None) else "manual"
    if entry_mode not in ("manual", "api"):
        entry_mode = "manual"
    api_url = getattr(data, "api_endpoint_url", None) if entry_mode == "api" else None
    if data.domain_id is not None:
        if await _domain_org_id(db, data.domain_id) != org_id:
            return None
        kpi = KPI(
            organization_id=org_id,
            domain_id=data.domain_id,
            name=data.name,
            description=data.description,
            year=None,
            sort_order=next_order,
            entry_mode=entry_mode,
            api_endpoint_url=api_url,
        )
    else:
        kpi = KPI(
            organization_id=org_id,
            domain_id=None,
            name=data.name,
            description=data.description,
            year=None,
            sort_order=next_order,
            entry_mode=entry_mode,
            api_endpoint_url=api_url,
        )
    db.add(kpi)
    await db.flush()
    if data.domain_ids or data.category_ids:
        await _sync_kpi_domains(db, kpi.id, org_id, data.domain_ids)
        await _sync_kpi_categories(db, kpi.id, org_id, data.category_ids)
    if data.organization_tag_ids:
        await _sync_kpi_organization_tags(db, kpi.id, org_id, data.organization_tag_ids)
    return kpi


async def get_kpi(db: AsyncSession, kpi_id: int, org_id: int) -> KPI | None:
    """Get KPI by id; must belong to org."""
    result = await db.execute(
        select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id)
    )
    return result.scalar_one_or_none()


async def get_kpi_with_tags(db: AsyncSession, kpi_id: int, org_id: int) -> KPI | None:
    """Get KPI by id with domain, category tags, assigned users, and report usage loaded."""
    result = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id, KPI.organization_id == org_id)
        .options(
            selectinload(KPI.domain),
            selectinload(KPI.domain_tags).selectinload(KPIDomain.domain),
            selectinload(KPI.category_tags).selectinload(KPICategory.category).selectinload(Category.domain),
            selectinload(KPI.organization_tags).selectinload(KPIOrganizationTag.tag),
            selectinload(KPI.assignments).selectinload(KPIAssignment.user),
            selectinload(KPI.report_template_kpis).selectinload(ReportTemplateKPI.report_template),
        )
    )
    return result.scalar_one_or_none()


async def get_kpi_with_tags_by_id(db: AsyncSession, kpi_id: int) -> KPI | None:
    """Get KPI by id only (no org filter). For super admin when organization_id is not in context."""
    result = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id)
        .options(
            selectinload(KPI.domain),
            selectinload(KPI.domain_tags).selectinload(KPIDomain.domain),
            selectinload(KPI.category_tags).selectinload(KPICategory.category).selectinload(Category.domain),
            selectinload(KPI.organization_tags).selectinload(KPIOrganizationTag.tag),
            selectinload(KPI.assignments).selectinload(KPIAssignment.user),
            selectinload(KPI.report_template_kpis).selectinload(ReportTemplateKPI.report_template),
        )
    )
    return result.scalar_one_or_none()


async def list_kpis(
    db: AsyncSession,
    org_id: int,
    domain_id: int | None = None,
    category_id: int | None = None,
    organization_tag_id: int | None = None,
    name: str | None = None,
    with_tags: bool = True,
) -> list[KPI]:
    """List KPIs in organization, optionally by domain, category, organization tag, or name search. KPI is not filtered by year; data is scoped by entry year."""
    q = select(KPI).where(KPI.organization_id == org_id)
    if domain_id is not None:
        # KPIs in domain: only those attached to at least one category in this domain (single source of truth)
        sub_category_in_domain = (
            select(KPICategory.kpi_id)
            .join(Category, Category.id == KPICategory.category_id)
            .where(Category.domain_id == domain_id)
            .distinct()
        )
        q = q.where(KPI.id.in_(sub_category_in_domain))
    if category_id is not None:
        q = q.join(KPICategory, KPI.id == KPICategory.kpi_id).where(KPICategory.category_id == category_id)
    if organization_tag_id is not None:
        q = q.join(KPIOrganizationTag, KPI.id == KPIOrganizationTag.kpi_id).where(
            KPIOrganizationTag.organization_tag_id == organization_tag_id
        )
    if name is not None and name.strip():
        q = q.where(KPI.name.ilike(f"%{name.strip()}%"))
    q = q.order_by(KPI.sort_order, KPI.name)
    if with_tags:
        q = q.options(
            selectinload(KPI.domain),
            selectinload(KPI.domain_tags).selectinload(KPIDomain.domain),
            selectinload(KPI.category_tags).selectinload(KPICategory.category).selectinload(Category.domain),
            selectinload(KPI.organization_tags).selectinload(KPIOrganizationTag.tag),
            selectinload(KPI.assignments).selectinload(KPIAssignment.user),
            selectinload(KPI.role_assignments).selectinload(KpiRoleAssignment.organization_role),
        )
    result = await db.execute(q)
    return list(result.unique().scalars().all())


async def list_kpis_for_formula_refs(
    db: AsyncSession, org_id: int, exclude_kpi_id: int | None = None
) -> list[dict]:
    """List KPIs in org with only numeric fields (number, formula) for KPI_FIELD() formula refs."""
    q = select(KPI).where(KPI.organization_id == org_id).order_by(KPI.sort_order, KPI.name)
    if exclude_kpi_id is not None:
        q = q.where(KPI.id != exclude_kpi_id)
    q = q.options(selectinload(KPI.fields))
    result = await db.execute(q)
    kpis = list(result.unique().scalars().all())
    out: list[dict] = []
    for k in kpis:
        numeric_fields = [
            f for f in (k.fields or []) if f.field_type in (FieldType.number, FieldType.formula)
        ]
        out.append({
            "id": k.id,
            "name": k.name,
            "fields": [{"key": f.key, "name": f.name, "field_type": f.field_type.value} for f in numeric_fields],
        })
    return out


async def _sync_kpi_domains(
    db: AsyncSession, kpi_id: int, org_id: int, domain_ids: list[int]
) -> None:
    """Set KPI domain tags to exactly domain_ids (first is primary, rest in KPIDomain)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return
    valid = []
    for d_id in domain_ids:
        if await _domain_org_id(db, d_id) != org_id:
            continue
        valid.append(d_id)
    kpi.domain_id = valid[0] if valid else None
    await db.execute(delete(KPIDomain).where(KPIDomain.kpi_id == kpi_id))
    await db.flush()
    for d_id in valid[1:]:
        link = KPIDomain(kpi_id=kpi_id, domain_id=d_id)
        db.add(link)
    await db.flush()


async def _sync_kpi_categories(
    db: AsyncSession, kpi_id: int, org_id: int, category_ids: list[int]
) -> None:
    """Set KPI category tags to exactly category_ids (one per domain rule applied per add)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return
    await db.execute(delete(KPICategory).where(KPICategory.kpi_id == kpi_id))
    await db.flush()
    for cat_id in category_ids:
        await add_kpi_category(db, kpi_id, cat_id, org_id)


async def _sync_kpi_organization_tags(
    db: AsyncSession, kpi_id: int, org_id: int, tag_ids: list[int]
) -> None:
    """Set KPI organization tags to exactly tag_ids (tags must belong to org)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return
    await db.execute(delete(KPIOrganizationTag).where(KPIOrganizationTag.kpi_id == kpi_id))
    await db.flush()
    for tag_id in tag_ids:
        result = await db.execute(
            select(OrganizationTag).where(
                OrganizationTag.id == tag_id,
                OrganizationTag.organization_id == org_id,
            )
        )
        if result.scalar_one_or_none():
            link = KPIOrganizationTag(kpi_id=kpi_id, organization_tag_id=tag_id)
            db.add(link)
    await db.flush()


async def update_kpi(
    db: AsyncSession, kpi_id: int, org_id: int, data: KPIUpdate
) -> KPI | None:
    """Update KPI (optionally sync domain/category tags)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return None
    if data.name is not None:
        kpi.name = data.name
    if data.description is not None:
        kpi.description = data.description
    if data.sort_order is not None:
        kpi.sort_order = data.sort_order
    if data.entry_mode is not None:
        em = data.entry_mode.strip().lower()
        kpi.entry_mode = em if em in ("manual", "api") else "manual"
        if kpi.entry_mode != "api":
            kpi.api_endpoint_url = None
    if data.api_endpoint_url is not None and kpi.entry_mode == "api":
        kpi.api_endpoint_url = data.api_endpoint_url.strip() or None
    if data.time_dimension is not None:
        val = (data.time_dimension or "").strip().lower() or None
        if val:
            try:
                kpi_td = TimeDimension(val)
            except ValueError:
                kpi_td = None
            if kpi_td:
                org = await db.get(Organization, org_id)
                org_td = TimeDimension(getattr(org, "time_dimension", None) or "yearly")
                if time_dimension_allowed_for_kpi(kpi_td, org_td):
                    kpi.time_dimension = kpi_td.value
                # else leave unchanged
            else:
                kpi.time_dimension = None
        else:
            kpi.time_dimension = None
    if data.card_display_field_ids is not None:
        kpi.card_display_field_ids = data.card_display_field_ids
    if data.carry_forward_data is not None:
        kpi.carry_forward_data = data.carry_forward_data
    await db.flush()
    if data.domain_ids is not None:
        await _sync_kpi_domains(db, kpi_id, org_id, data.domain_ids)
    if data.category_ids is not None:
        await _sync_kpi_categories(db, kpi_id, org_id, data.category_ids)
    if data.organization_tag_ids is not None:
        await _sync_kpi_organization_tags(db, kpi_id, org_id, data.organization_tag_ids)
    return kpi


async def get_kpi_child_data_summary(
    db: AsyncSession, kpi_id: int, org_id: int
) -> dict[str, int] | None:
    """Return counts of child records for a KPI (for delete confirmation). None if KPI not found."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return None
    assignments_count = (await db.execute(select(func.count()).select_from(KPIAssignment).where(KPIAssignment.kpi_id == kpi_id))).scalar() or 0
    entries_count = (await db.execute(select(func.count()).select_from(KPIEntry).where(KPIEntry.kpi_id == kpi_id))).scalar() or 0
    fields_count = (await db.execute(select(func.count()).select_from(KPIField).where(KPIField.kpi_id == kpi_id))).scalar() or 0
    subq_entries = select(KPIEntry.id).where(KPIEntry.kpi_id == kpi_id)
    field_values_count = (await db.execute(select(func.count()).select_from(KPIFieldValue).where(KPIFieldValue.entry_id.in_(subq_entries)))).scalar() or 0
    report_template_kpis_count = (await db.execute(select(func.count()).select_from(ReportTemplateKPI).where(ReportTemplateKPI.kpi_id == kpi_id))).scalar() or 0
    total = assignments_count + entries_count + fields_count + field_values_count + report_template_kpis_count
    return {
        "assignments_count": assignments_count,
        "entries_count": entries_count,
        "fields_count": fields_count,
        "field_values_count": field_values_count,
        "report_template_kpis_count": report_template_kpis_count,
        "has_child_data": total > 0,
    }


async def delete_kpi(db: AsyncSession, kpi_id: int, org_id: int) -> bool:
    """Delete KPI and all child records (assignments, entries, field values, fields, report refs, tags)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    # Delete in FK-safe order so SQLAlchemy does not try to null out child FKs
    subq_entries = select(KPIEntry.id).where(KPIEntry.kpi_id == kpi_id)
    subq_fields = select(KPIField.id).where(KPIField.kpi_id == kpi_id)
    await db.execute(delete(KPIFieldValue).where(KPIFieldValue.entry_id.in_(subq_entries)))
    await db.execute(delete(ReportTemplateField).where(ReportTemplateField.kpi_field_id.in_(subq_fields)))
    await db.execute(delete(KPIFieldOption).where(KPIFieldOption.field_id.in_(subq_fields)))
    await db.execute(delete(KPIField).where(KPIField.kpi_id == kpi_id))
    await db.execute(delete(KPIEntry).where(KPIEntry.kpi_id == kpi_id))
    await db.execute(delete(KPIAssignment).where(KPIAssignment.kpi_id == kpi_id))
    await db.execute(delete(ReportTemplateKPI).where(ReportTemplateKPI.kpi_id == kpi_id))
    await db.execute(delete(KPIDomain).where(KPIDomain.kpi_id == kpi_id))
    await db.execute(delete(KPICategory).where(KPICategory.kpi_id == kpi_id))
    await db.execute(delete(KPIOrganizationTag).where(KPIOrganizationTag.kpi_id == kpi_id))
    await db.delete(kpi)
    await db.flush()
    return True


async def add_kpi_domain(db: AsyncSession, kpi_id: int, domain_id: int, org_id: int) -> bool:
    """Associate KPI with domain. KPI must belong to org; domain must belong to org."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(select(Domain).where(Domain.id == domain_id, Domain.organization_id == org_id))
    domain = result.scalar_one_or_none()
    if not domain:
        return False
    if kpi.domain_id == domain_id:
        return True  # already primary
    existing = await db.execute(
        select(KPIDomain).where(KPIDomain.kpi_id == kpi_id, KPIDomain.domain_id == domain_id)
    )
    if existing.scalar_one_or_none():
        return True  # already linked
    link = KPIDomain(kpi_id=kpi_id, domain_id=domain_id)
    db.add(link)
    await db.flush()
    return True


async def remove_kpi_domain(db: AsyncSession, kpi_id: int, domain_id: int, org_id: int) -> bool:
    """Remove KPI-domain association (not primary domain; no primary if domain_id is null)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    if kpi.domain_id is not None and kpi.domain_id == domain_id:
        return False  # cannot remove primary
    result = await db.execute(
        select(KPIDomain).where(KPIDomain.kpi_id == kpi_id, KPIDomain.domain_id == domain_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        return True  # already not linked
    await db.delete(link)
    await db.flush()
    return True


async def add_kpi_category(db: AsyncSession, kpi_id: int, category_id: int, org_id: int) -> bool:
    """Associate KPI with category. KPI and category must belong to org.
    A KPI can only be in one category per domain; attaching to this category
    removes any existing attachment to other categories in the same domain.
    """
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(
        select(Category)
        .join(Category.domain)
        .where(Category.id == category_id, Domain.organization_id == org_id)
    )
    category = result.scalar_one_or_none()
    if not category:
        return False
    # One category per domain: remove any existing KPI-category link in this domain
    await db.execute(
        delete(KPICategory).where(
            KPICategory.kpi_id == kpi_id,
            KPICategory.category_id.in_(select(Category.id).where(Category.domain_id == category.domain_id)),
        )
    )
    await db.flush()
    link = KPICategory(kpi_id=kpi_id, category_id=category_id)
    db.add(link)
    await db.flush()
    return True


async def remove_kpi_category(db: AsyncSession, kpi_id: int, category_id: int, org_id: int) -> bool:
    """Remove KPI-category association."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(
        select(KPICategory).where(KPICategory.kpi_id == kpi_id, KPICategory.category_id == category_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        return True
    await db.delete(link)
    await db.flush()
    return True


def _assignment_type_str(a: KPIAssignment) -> str:
    t = getattr(a, "assignment_type", None)
    if t is None:
        return "data_entry"
    return t.value if hasattr(t, "value") else str(t)


async def list_kpi_assignments(db: AsyncSession, kpi_id: int, org_id: int) -> list[tuple[User, str]]:
    """List (user, permission) assigned to this KPI. Permission is 'data_entry' or 'view'."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return []
    result = await db.execute(
        select(User, KPIAssignment)
        .join(KPIAssignment, KPIAssignment.user_id == User.id)
        .where(KPIAssignment.kpi_id == kpi_id, User.organization_id == org_id)
        .order_by(User.username)
    )
    return [(row[0], _assignment_type_str(row[1])) for row in result.all()]


async def assign_user_to_kpi(
    db: AsyncSession, kpi_id: int, user_id: int, org_id: int, permission: str = "data_entry"
) -> bool:
    """Assign a user to KPI with permission (data_entry or view)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(select(User).where(User.id == user_id, User.organization_id == org_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    perm = (permission or "data_entry").strip().lower()
    if perm not in ("data_entry", "view"):
        perm = "data_entry"
    # Upsert: remove existing for this user+kpi then add
    await db.execute(
        delete(KPIAssignment).where(KPIAssignment.kpi_id == kpi_id, KPIAssignment.user_id == user_id)
    )
    db.add(KPIAssignment(kpi_id=kpi_id, user_id=user_id, assignment_type=perm))
    await db.flush()
    return True


async def unassign_user_from_kpi(db: AsyncSession, kpi_id: int, user_id: int, org_id: int) -> bool:
    """Remove user assignment from KPI."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(
        select(KPIAssignment).where(KPIAssignment.kpi_id == kpi_id, KPIAssignment.user_id == user_id)
    )
    link = result.scalar_one_or_none()
    if not link:
        return True
    await db.delete(link)
    await db.flush()
    return True


async def replace_kpi_assignments(
    db: AsyncSession,
    kpi_id: int,
    assignments: list[tuple[int, str]],
    org_id: int,
) -> bool:
    """Replace all assignments for this KPI. assignments: list of (user_id, permission) with permission in ('data_entry', 'view')."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    for uid, _ in assignments:
        result = await db.execute(select(User).where(User.id == uid, User.organization_id == org_id))
        if result.scalar_one_or_none() is None:
            return False
    await db.execute(delete(KPIAssignment).where(KPIAssignment.kpi_id == kpi_id))
    for uid, perm in assignments:
        p = (perm or "data_entry").strip().lower() if isinstance(perm, str) else "data_entry"
        if p not in ("data_entry", "view"):
            p = "data_entry"
        db.add(KPIAssignment(kpi_id=kpi_id, user_id=uid, assignment_type=p))
    await db.flush()
    return True


async def list_kpi_role_assignments(
    db: AsyncSession, kpi_id: int, org_id: int
) -> list[tuple[OrganizationRole, str]]:
    """List (role, permission) assigned to this KPI. Permission is 'data_entry' or 'view'."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return []
    result = await db.execute(
        select(OrganizationRole, KpiRoleAssignment)
        .join(KpiRoleAssignment, KpiRoleAssignment.organization_role_id == OrganizationRole.id)
        .where(KpiRoleAssignment.kpi_id == kpi_id, OrganizationRole.organization_id == org_id)
        .order_by(OrganizationRole.name)
    )
    out = []
    for row in result.all():
        perm = getattr(row[1], "assignment_type", None) or "data_entry"
        perm = perm.value if hasattr(perm, "value") else str(perm)
        out.append((row[0], perm))
    return out


async def replace_kpi_role_assignments(
    db: AsyncSession,
    kpi_id: int,
    assignments: list[tuple[int, str]],
    org_id: int,
) -> bool:
    """Replace all role assignments for this KPI. assignments: list of (role_id, permission)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    for role_id, _ in assignments:
        result = await db.execute(
            select(OrganizationRole).where(
                OrganizationRole.id == role_id,
                OrganizationRole.organization_id == org_id,
            )
        )
        if result.scalar_one_or_none() is None:
            return False
    await db.execute(delete(KpiRoleAssignment).where(KpiRoleAssignment.kpi_id == kpi_id))
    for role_id, perm in assignments:
        p = (perm or "data_entry").strip().lower() if isinstance(perm, str) else "data_entry"
        if p not in ("data_entry", "view"):
            p = "data_entry"
        db.add(KpiRoleAssignment(kpi_id=kpi_id, organization_role_id=role_id, assignment_type=p))
    await db.flush()
    return True


async def get_field_access_for_user(
    db: AsyncSession, kpi_id: int, user_id: int, org_id: int
) -> list[dict]:
    """List field-level access for a user on a KPI. Returns list of { field_id, sub_field_id, access_type }."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return []
    result = await db.execute(
        select(KpiFieldAccess.field_id, KpiFieldAccess.sub_field_id, KpiFieldAccess.access_type).where(
            KpiFieldAccess.kpi_id == kpi_id,
            KpiFieldAccess.user_id == user_id,
        )
    )
    out = []
    for r in result.all():
        at = r[2].value if hasattr(r[2], "value") else str(r[2] or "data_entry")
        out.append({"field_id": r[0], "sub_field_id": r[1], "access_type": at})
    return out


async def replace_field_access(
    db: AsyncSession,
    kpi_id: int,
    user_id: int,
    org_id: int,
    accesses: list[tuple[int, int | None, str]],
) -> bool:
    """Replace all field-level access for a user on a KPI. accesses: list of (field_id, sub_field_id|None, access_type)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    result = await db.execute(select(User).where(User.id == user_id, User.organization_id == org_id))
    if result.scalar_one_or_none() is None:
        return False
    # Load fields and sub_fields for validation
    fields_res = await db.execute(
        select(KPIField).where(KPIField.kpi_id == kpi_id).options(selectinload(KPIField.sub_fields))
    )
    fields_list = list(fields_res.scalars().all())
    field_ids = {f.id for f in fields_list}
    sub_by_field: dict[int, set[int | None]] = {}
    for f in fields_list:
        sub_by_field[f.id] = {None}
        for s in getattr(f, "sub_fields", None) or []:
            sub_by_field[f.id].add(s.id)
    for field_id, sub_field_id, _ in accesses:
        if field_id not in field_ids:
            return False
        if sub_field_id is not None and sub_field_id not in (sub_by_field.get(field_id) or set()):
            return False
    await db.execute(
        delete(KpiFieldAccess).where(KpiFieldAccess.kpi_id == kpi_id, KpiFieldAccess.user_id == user_id)
    )
    for field_id, sub_field_id, access_type in accesses:
        at = (access_type or "data_entry").strip().lower()
        if at not in ("data_entry", "view", "add_row"):
            at = "data_entry"
        db.add(KpiFieldAccess(kpi_id=kpi_id, user_id=user_id, field_id=field_id, sub_field_id=sub_field_id, access_type=at))
    await db.flush()
    return True


async def get_field_access_for_role(
    db: AsyncSession, kpi_id: int, role_id: int, org_id: int
) -> list[dict]:
    """List field-level access for a role on a KPI. Returns list of { field_id, sub_field_id, access_type }."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return []
    role_res = await db.execute(
        select(OrganizationRole).where(
            OrganizationRole.id == role_id,
            OrganizationRole.organization_id == org_id,
        )
    )
    if role_res.scalar_one_or_none() is None:
        return []
    result = await db.execute(
        select(
            KpiFieldAccessByRole.field_id,
            KpiFieldAccessByRole.sub_field_id,
            KpiFieldAccessByRole.access_type,
        ).where(
            KpiFieldAccessByRole.kpi_id == kpi_id,
            KpiFieldAccessByRole.organization_role_id == role_id,
        )
    )
    out = []
    for r in result.all():
        at = r[2].value if hasattr(r[2], "value") else str(r[2] or "data_entry")
        out.append({"field_id": r[0], "sub_field_id": r[1], "access_type": at})
    return out


async def replace_field_access_for_role(
    db: AsyncSession,
    kpi_id: int,
    role_id: int,
    org_id: int,
    accesses: list[tuple[int, int | None, str]],
) -> bool:
    """Replace all field-level access for a role on a KPI. accesses: list of (field_id, sub_field_id|None, access_type)."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    role_res = await db.execute(
        select(OrganizationRole).where(
            OrganizationRole.id == role_id,
            OrganizationRole.organization_id == org_id,
        )
    )
    if role_res.scalar_one_or_none() is None:
        return False
    fields_res = await db.execute(
        select(KPIField).where(KPIField.kpi_id == kpi_id).options(selectinload(KPIField.sub_fields))
    )
    fields_list = list(fields_res.scalars().all())
    field_ids = {f.id for f in fields_list}
    sub_by_field: dict[int, set[int | None]] = {}
    for f in fields_list:
        sub_by_field[f.id] = {None}
        for s in getattr(f, "sub_fields", None) or []:
            sub_by_field[f.id].add(s.id)
    for field_id, sub_field_id, _ in accesses:
        if field_id not in field_ids:
            return False
        if sub_field_id is not None and sub_field_id not in (sub_by_field.get(field_id) or set()):
            return False
    await db.execute(
        delete(KpiFieldAccessByRole).where(
            KpiFieldAccessByRole.kpi_id == kpi_id,
            KpiFieldAccessByRole.organization_role_id == role_id,
        )
    )
    for field_id, sub_field_id, access_type in accesses:
        at = (access_type or "data_entry").strip().lower()
        if at not in ("data_entry", "view", "add_row"):
            at = "data_entry"
        db.add(
            KpiFieldAccessByRole(
                kpi_id=kpi_id,
                organization_role_id=role_id,
                field_id=field_id,
                sub_field_id=sub_field_id,
                access_type=at,
            )
        )
    await db.flush()
    return True


async def get_add_row_users_for_field(
    db: AsyncSession,
    kpi_id: int,
    field_id: int,
    org_id: int,
) -> list[dict]:
    """List users who have add_row access to a specific multi-line field."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return []
    # Validate field belongs to KPI and is multi_line_items
    field_res = await db.execute(select(KPIField).where(KPIField.id == field_id, KPIField.kpi_id == kpi_id))
    field = field_res.scalar_one_or_none()
    if not field or getattr(field, "field_type", None) != FieldType.multi_line_items:
        return []
    res = await db.execute(
        select(User.id, User.username, User.full_name)
        .join(KpiFieldAccess, KpiFieldAccess.user_id == User.id)
        .where(
            KpiFieldAccess.kpi_id == kpi_id,
            KpiFieldAccess.field_id == field_id,
            KpiFieldAccess.sub_field_id.is_(None),
            KpiFieldAccess.access_type == "add_row",
            User.organization_id == org_id,
        )
        .order_by(User.username.asc())
    )
    return [{"id": r[0], "username": r[1], "full_name": r[2]} for r in res.all()]


async def replace_add_row_users_for_field(
    db: AsyncSession,
    kpi_id: int,
    field_id: int,
    user_ids: list[int],
    org_id: int,
) -> bool:
    """Replace add_row user list for a specific multi-line field without touching other access rows."""
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        return False
    field_res = await db.execute(select(KPIField).where(KPIField.id == field_id, KPIField.kpi_id == kpi_id))
    field = field_res.scalar_one_or_none()
    if not field or getattr(field, "field_type", None) != FieldType.multi_line_items:
        return False
    # Validate users belong to org
    if user_ids:
        users_res = await db.execute(select(User.id).where(User.id.in_(user_ids), User.organization_id == org_id))
        valid = {r[0] for r in users_res.all()}
        if set(user_ids) - valid:
            return False
    await db.execute(
        delete(KpiFieldAccess).where(
            KpiFieldAccess.kpi_id == kpi_id,
            KpiFieldAccess.field_id == field_id,
            KpiFieldAccess.sub_field_id.is_(None),
            KpiFieldAccess.access_type == "add_row",
        )
    )
    for uid in user_ids:
        db.add(
            KpiFieldAccess(
                kpi_id=kpi_id,
                user_id=uid,
                field_id=field_id,
                sub_field_id=None,
                access_type="add_row",
            )
        )
    await db.flush()
    return True


async def get_row_access_for_user(
    db: AsyncSession, user_id: int, entry_id: int, field_id: int
) -> list[dict]:
    """List record-level access for a user on an entry+field (multi_line_items). Returns list of {row_index, can_edit, can_delete}."""
    result = await db.execute(
        select(
            KpiMultiLineRowAccess.row_index,
            KpiMultiLineRowAccess.can_edit,
            KpiMultiLineRowAccess.can_delete,
        ).where(
            KpiMultiLineRowAccess.user_id == user_id,
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    return [
        {"row_index": r[0], "can_edit": r[1], "can_delete": r[2]}
        for r in result.all()
    ]


def _normalized_field_type_for_row(f) -> str:
    """Return field type as lowercase string (used by replace_row_access)."""
    ft = getattr(f, "field_type", None)
    if hasattr(ft, "value"):
        return (ft.value or "single_line_text").lower()
    return (str(ft) if ft else "single_line_text").lower()


async def replace_row_access(
    db: AsyncSession,
    user_id: int,
    entry_id: int,
    field_id: int,
    org_id: int,
    rows: list[tuple[int, bool, bool]],
) -> bool:
    """Replace record-level access for a user on an entry+field. rows: list of (row_index, can_edit, can_delete)."""
    # Validate entry belongs to org and field is multi_line_items on same KPI
    entry_res = await db.execute(
        select(KPIEntry).where(
            KPIEntry.id == entry_id,
            KPIEntry.organization_id == org_id,
        )
    )
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return False
    field_res = await db.execute(
        select(KPIField)
        .where(KPIField.id == field_id, KPIField.kpi_id == entry.kpi_id)
        .options(selectinload(KPIField.sub_fields))
    )
    field = field_res.scalar_one_or_none()
    if not field or _normalized_field_type_for_row(field) != "multi_line_items":
        return False
    user_res = await db.execute(select(User).where(User.id == user_id, User.organization_id == org_id))
    if user_res.scalar_one_or_none() is None:
        return False
    await db.execute(
        delete(KpiMultiLineRowAccess).where(
            KpiMultiLineRowAccess.user_id == user_id,
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    for row_index, can_edit, can_delete in rows:
        db.add(
            KpiMultiLineRowAccess(
                user_id=user_id,
                entry_id=entry_id,
                field_id=field_id,
                row_index=row_index,
                can_edit=can_edit,
                can_delete=can_delete,
            )
        )
    await db.flush()
    return True


async def get_row_access_by_entry(
    db: AsyncSession, entry_id: int, field_id: int, org_id: int
) -> list[dict]:
    """
    Return row-level access grouped by row for an entry+field (multi_line_items).
    For use in org admin UI: list actual rows and which users have access to each.
    Returns list of { row_index, preview, users: [ { user_id, full_name, username, can_edit, can_delete } ] }.
    """
    entry_res = await db.execute(
        select(KPIEntry).where(
            KPIEntry.id == entry_id,
            KPIEntry.organization_id == org_id,
        )
    )
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return []
    field_res = await db.execute(
        select(KPIField)
        .where(KPIField.id == field_id, KPIField.kpi_id == entry.kpi_id)
        .options(selectinload(KPIField.sub_fields))
    )
    field = field_res.scalar_one_or_none()
    if not field or _normalized_field_type_for_row(field) != "multi_line_items":
        return []
    fv_res = await db.execute(
        select(KPIFieldValue.value_json).where(
            KPIFieldValue.entry_id == entry_id,
            KPIFieldValue.field_id == field_id,
        )
    )
    fv_row = fv_res.one_or_none()
    value_json = fv_row[0] if fv_row and fv_row[0] is not None else []
    if not isinstance(value_json, list):
        value_json = []
    sub_keys = [getattr(s, "key", "") for s in (field.sub_fields or []) if getattr(s, "key", None)][:3]
    row_previews: list[str] = []
    for i, row in enumerate(value_json):
        if not isinstance(row, dict):
            row_previews.append("")
            continue
        parts = [str(row.get(k, ""))[:30] for k in sub_keys if row.get(k) not in (None, "")]
        row_previews.append(" | ".join(parts) if parts else "")

    result = await db.execute(
        select(
            KpiMultiLineRowAccess.row_index,
            KpiMultiLineRowAccess.can_edit,
            KpiMultiLineRowAccess.can_delete,
            User.id,
            User.full_name,
            User.username,
        )
        .join(User, User.id == KpiMultiLineRowAccess.user_id)
        .where(
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    by_row: dict[int, list[dict]] = {}
    for r in result.all():
        ri, can_edit, can_delete, uid, full_name, username = r
        by_row.setdefault(ri, []).append({
            "user_id": uid,
            "full_name": full_name,
            "username": username or "",
            "can_edit": can_edit,
            "can_delete": can_delete,
        })
    out = []
    for row_index in range(len(value_json)):
        preview = row_previews[row_index] if row_index < len(row_previews) else ""
        out.append({
            "row_index": row_index,
            "preview": preview,
            "users": by_row.get(row_index, []),
        })
    return out


async def get_full_row_access_users(
    db: AsyncSession, entry_id: int, field_id: int, org_id: int
) -> list[dict]:
    """
    Return users who currently have full row-level access on an entry+multi-line field.
    "Full access" means:
      - user has an access row for every existing row index [0..total_rows-1]
      - and each row has can_edit=True
      - optional can_delete=True for all rows => mode "edit_delete", else "edit"
    """
    entry_res = await db.execute(
        select(KPIEntry).where(
            KPIEntry.id == entry_id,
            KPIEntry.organization_id == org_id,
        )
    )
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return []

    field_res = await db.execute(
        select(KPIField).where(KPIField.id == field_id, KPIField.kpi_id == entry.kpi_id)
    )
    field = field_res.scalar_one_or_none()
    if not field or _normalized_field_type_for_row(field) != "multi_line_items":
        return []

    fv_res = await db.execute(
        select(KPIFieldValue.value_json).where(
            KPIFieldValue.entry_id == entry_id,
            KPIFieldValue.field_id == field_id,
        )
    )
    fv_row = fv_res.one_or_none()
    value_json = fv_row[0] if fv_row and fv_row[0] is not None else []
    total_rows = len(value_json) if isinstance(value_json, list) else 0
    if total_rows <= 0:
        return []

    result = await db.execute(
        select(
            KpiMultiLineRowAccess.user_id,
            KpiMultiLineRowAccess.row_index,
            KpiMultiLineRowAccess.can_edit,
            KpiMultiLineRowAccess.can_delete,
            User.full_name,
            User.username,
        )
        .join(User, User.id == KpiMultiLineRowAccess.user_id)
        .where(
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )

    by_user: dict[int, dict] = {}
    for r in result.all():
        uid, row_index, can_edit, can_delete, full_name, username = r
        u = by_user.get(uid)
        if u is None:
            u = {
                "user_id": int(uid),
                "full_name": full_name,
                "username": username or "",
                "rows": set(),
                "all_edit": True,
                "all_delete": True,
            }
            by_user[uid] = u
        u["rows"].add(int(row_index))
        if not bool(can_edit):
            u["all_edit"] = False
        if not bool(can_delete):
            u["all_delete"] = False

    out: list[dict] = []
    for u in by_user.values():
        has_all_rows = len(u["rows"]) >= total_rows and all(i in u["rows"] for i in range(total_rows))
        if not has_all_rows:
            continue
        if not u["all_edit"]:
            continue
        mode = "edit_delete" if u["all_delete"] else "edit"
        out.append(
            {
                "user_id": u["user_id"],
                "full_name": u["full_name"],
                "username": u["username"],
                "mode": mode,
            }
        )
    out.sort(key=lambda x: ((x.get("full_name") or "").lower(), (x.get("username") or "").lower()))
    return out


def _normalized_field_type(f) -> str:
    """Return field type as lowercase string for consistent comparison."""
    ft = getattr(f, "field_type", None)
    if hasattr(ft, "value"):
        return (ft.value or "single_line_text").lower()
    return (str(ft) if ft else "single_line_text").lower()


async def list_kpi_data_for_export(
    db: AsyncSession,
    org_id: int,
    year: int | None = None,
) -> list[dict]:
    """
    Return KPI data with fields and values for JSON export.

    Shape:
    [
        {
            "kpi_id": int,
            "kpi_name": str,
            "kpi_description": str | None,
            "kpi_year": int,
            "kpi_fields_ids": [int, ...],
            "kpi_fields": [
                {
                    "kpi_field_id": int,
                    "kpi_field_key": str,
                    "kpi_field_data_type": str,
                    "kpi_field_values": Any | None,
                    "kpi_field_year": int | None,
                },
                ...
            ],
        },
        ...
    ]
    """
    # Load all KPIs in organization with their fields; entries are filtered by year.
    kpi_query = select(KPI).where(KPI.organization_id == org_id).order_by(KPI.sort_order, KPI.name).options(selectinload(KPI.fields))
    result = await db.execute(kpi_query)
    kpis: list[KPI] = list(result.unique().scalars().all())
    if not kpis:
        return []

    kpi_ids = [k.id for k in kpis]

    # Load submitted entries (one per KPI per year) with field values.
    entry_query = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id.in_(kpi_ids),
            KPIEntry.is_draft == False,  # noqa: E712
        )
        .options(selectinload(KPIEntry.field_values))
    )
    if year is not None:
        entry_query = entry_query.where(KPIEntry.year == year)
    entry_result = await db.execute(entry_query)
    entries: list[KPIEntry] = list(entry_result.unique().scalars().all())
    entry_by_kpi: dict[int, KPIEntry] = {e.kpi_id: e for e in entries}

    out: list[dict] = []
    for k in kpis:
        entry = entry_by_kpi.get(k.id)
        fv_by_field_id: dict[int, KPIFieldValue] = {}
        if entry and getattr(entry, "field_values", None):
            fv_by_field_id = {fv.field_id: fv for fv in entry.field_values}

        fields_payload: list[dict] = []
        field_ids: list[int] = []
        for f in getattr(k, "fields", []) or []:
            field_ids.append(f.id)
            fv = fv_by_field_id.get(f.id)
            value = None
            if fv is not None:
                # Prefer explicit value_* attributes in a stable order.
                if fv.value_date is not None:
                    value = fv.value_date.isoformat() if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
                elif fv.value_json is not None:
                    value = fv.value_json
                elif fv.value_number is not None:
                    value = fv.value_number
                elif fv.value_boolean is not None:
                    value = fv.value_boolean
                else:
                    value = fv.value_text

            fields_payload.append(
                {
                    "kpi_field_id": f.id,
                    "kpi_field_key": f.key,
                    "kpi_field_data_type": _normalized_field_type(f),
                    "kpi_field_values": value,
                    "kpi_field_year": getattr(entry, "year", None) if entry else year,
                }
            )

        out.append(
            {
                "kpi_id": k.id,
                "kpi_name": k.name,
                "kpi_description": k.description,
                "kpi_year": year,  # export year (data scope), not KPI-level year
                "kpi_fields_ids": field_ids,
                "kpi_fields": fields_payload,
            }
        )

    return out


def _normalize_api_boolean(raw) -> bool | None:
    """Convert API value to bool. Accepts bool, 1, 0, '1', '0', 'true', 'false' (case-insensitive). Returns None if not recognized."""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, int):
        if raw == 0:
            return False
        if raw == 1:
            return True
        return None
    if isinstance(raw, float) and raw == int(raw):
        return _normalize_api_boolean(int(raw))
    if isinstance(raw, str):
        s = raw.strip().lower()
        if s in ("1", "true", "yes"):
            return True
        if s in ("0", "false", "no"):
            return False
        return None
    return None


async def sync_kpi_entry_from_api(
    db: AsyncSession,
    kpi_id: int,
    org_id: int,
    year: int,
    user_id: int,
    *,
    force_override: bool = False,
    sync_mode: str = "override",  # "override" = replace; "append" = for multi_line_items append rows (ignores API override_existing)
) -> dict | None:
    """
    Call the KPI's API endpoint to fetch entry data and apply it.
    force_override: always apply even when API returns override_existing=false.
    sync_mode: "override" = replace existing; "append" = for multi_line_items append API rows to existing (other fields still overwritten).
    """
    def _log(msg: str, *args: object) -> None:
        logger.info(msg, *args)
        try:
            out = msg % args if args else msg
        except (TypeError, ValueError):
            out = msg + " " + " ".join(repr(a) for a in args)
        print(f"[sync-from-api] {out}")

    _log("START kpi_id=%s org_id=%s year=%s user_id=%s", kpi_id, org_id, year, user_id)
    kpi = await get_kpi(db, kpi_id, org_id)
    if not kpi:
        _log("KPI not found or not in org: kpi_id=%s org_id=%s", kpi_id, org_id)
        return None
    entry_mode = getattr(kpi, "entry_mode", None) or "manual"
    api_url = (getattr(kpi, "api_endpoint_url", None) or "").strip()
    if entry_mode != "api" or not api_url:
        _log("KPI not in API mode or no URL: kpi_id=%s entry_mode=%s api_url=%s", kpi_id, entry_mode, api_url or "(empty)")
        return None
    payload = {"year": year, "kpi_id": kpi_id, "organization_id": org_id}
    _log("Calling API POST %s payload=%s", api_url, payload)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(api_url, json=payload)
            _log("Response status=%s", resp.status_code)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.exception("[sync-from-api] API request failed: %s", e)
        print(f"[sync-from-api] API request failed: {e}")
        return None
    if not isinstance(data, dict):
        _log("API response is not a dict: type=%s", type(data).__name__)
        return None
    resp_year = data.get("year")
    values_map = data.get("values")
    override_existing = data.get("override_existing", True)
    _log("Response keys: year=%s values_keys=%s override_existing=%s", resp_year, list(values_map.keys()) if isinstance(values_map, dict) else values_map, override_existing)
    if resp_year is None or not isinstance(values_map, dict):
        _log("Missing year or values dict: resp_year=%s values_type=%s", resp_year, type(values_map).__name__)
        return None
    resp_year = int(resp_year) if resp_year is not None else year
    if resp_year != year:
        _log("Year mismatch: response year=%s requested year=%s", resp_year, year)
        return None
    # When user explicitly triggers sync from UI, we can force overwrite regardless of API's override_existing
    effective_override = override_existing or force_override
    if force_override and not override_existing:
        _log("force_override=true: will apply data even though API returned override_existing=false")
    _log("values from API (key -> value): %s", {k: v for k, v in (values_map or {}).items()})

    # Load KPI with fields
    result = await db.execute(
        select(KPI).where(KPI.id == kpi_id).options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi_with_fields = result.scalar_one_or_none()
    if not kpi_with_fields or not kpi_with_fields.fields:
        _log("KPI has no fields: kpi_id=%s", kpi_id)
        return None
    _log("KPI fields (key, name, type): %s", [(f.key, f.name, _normalized_field_type(f)) for f in kpi_with_fields.fields])

    # Check existing entry and override_existing
    entry_res = await db.execute(
        select(KPIEntry).where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == year,
        )
    )
    existing_entry = entry_res.scalar_one_or_none()
    if not effective_override and existing_entry:
        fv_count = await db.execute(
            select(func.count()).select_from(KPIFieldValue).where(KPIFieldValue.entry_id == existing_entry.id)
        )
        if (fv_count.scalar() or 0) > 0:
            _log("Skipped: entry has data and override_existing=false (use force_override=true to overwrite)")
            return {"skipped": True, "reason": "Entry already has data and override_existing is false. Use force_override=true to overwrite."}

    entry, _ = await get_or_create_entry(db, user_id, org_id, kpi_id, year)
    if not entry:
        _log("get_or_create_entry returned None")
        return None
    _log("Entry id=%s (created or existing)", entry.id)
    _log("sync_mode=%s (UI choice; API override_existing ignored)", sync_mode)

    # When append: load existing field values so we can merge for multi_line_items
    existing_value_json_by_field: dict[int, list] = {}
    if (sync_mode or "override").lower() == "append":
        fv_res = await db.execute(
            select(KPIFieldValue).where(KPIFieldValue.entry_id == entry.id)
        )
        for fv in fv_res.scalars().all():
            if isinstance(fv.value_json, list):
                existing_value_json_by_field[fv.field_id] = fv.value_json
        _log("append mode: existing multi_line_items field_ids with data: %s", list(existing_value_json_by_field.keys()))

    # Case-insensitive key lookup for API response (some APIs return "Grant_Type" vs "grant_type")
    _values_lower = {k.lower(): (k, v) for k, v in values_map.items() if isinstance(k, str)} if values_map else {}
    _log("values_map keys (original): %s | lower map keys: %s", list(values_map.keys()) if values_map else [], list(_values_lower.keys()) if _values_lower else [])

    def _get_raw(f):
        raw = values_map.get(f.key)
        if raw is not None:
            return raw
        raw = values_map.get(f.name)
        if raw is not None:
            return raw
        key_lower = f.key.lower()
        if key_lower in _values_lower:
            return _values_lower[key_lower][1]
        name_lower = (f.name or "").replace(" ", "_").lower()
        if name_lower in _values_lower:
            return _values_lower[name_lower][1]
        alt = f.key.replace("_", " ")
        raw = values_map.get(alt)
        if raw is not None:
            return raw
        alt = f.name.replace(" ", "_").lower()
        return values_map.get(alt)

    value_inputs: list[FieldValueInput] = []
    for f in kpi_with_fields.fields:
        ft_norm = _normalized_field_type(f)
        if ft_norm == "formula":
            _log("  field key=%s name=%s type=formula -> SKIP (computed)", f.key, f.name)
            continue
        raw = _get_raw(f)
        if raw is None:
            _log("  field key=%s name=%s type=%s -> NOT FOUND in API values (no match)", f.key, f.name, ft_norm)
            continue
        _log("  field key=%s name=%s type=%s raw_value=%s (type=%s)", f.key, f.name, ft_norm, raw, type(raw).__name__)
        if ft_norm == "number":
            try:
                num = float(raw) if not isinstance(raw, (int, float)) else raw
            except (TypeError, ValueError) as e:
                _log("    -> SKIP number parse failed: %s", e)
                continue
            value_inputs.append(FieldValueInput(field_id=f.id, value_number=num))
            _log("    -> ADD value_number=%s", num)
        elif ft_norm == "boolean":
            b = _normalize_api_boolean(raw)
            if b is not None:
                value_inputs.append(FieldValueInput(field_id=f.id, value_boolean=b))
                _log("    -> ADD value_boolean=%s", b)
            else:
                _log("    -> SKIP boolean normalize returned None for raw=%s", raw)
        elif ft_norm == "date":
            value_inputs.append(
                FieldValueInput(field_id=f.id, value_date=str(raw) if raw else None)
            )
            _log("    -> ADD value_date=%s", raw)
        elif ft_norm == "multi_line_items" and isinstance(raw, list):
            if (sync_mode or "override").lower() == "append":
                existing_list = existing_value_json_by_field.get(f.id) or []
                merged = existing_list + raw
                value_inputs.append(FieldValueInput(field_id=f.id, value_json=merged))
                _log("    -> APPEND value_json existing=%s + new=%s -> total=%s", len(existing_list), len(raw), len(merged))
            else:
                value_inputs.append(FieldValueInput(field_id=f.id, value_json=raw))
                _log("    -> ADD value_json len=%s (override)", len(raw))
        else:
            value_inputs.append(FieldValueInput(field_id=f.id, value_text=str(raw) if raw is not None else None))
            _log("    -> ADD value_text=%s", (str(raw)[:80] if raw is not None else None))

    _log("value_inputs count=%s (will save=%s)", len(value_inputs), bool(value_inputs))
    if value_inputs:
        await save_entry_values(db, entry.id, user_id, value_inputs, kpi_id, org_id)
        _log("save_entry_values done for entry_id=%s", entry.id)
    else:
        _log("No value_inputs to save; check field keys vs API response keys above")
    return {"entry_id": entry.id, "year": year, "fields_updated": len(value_inputs)}
