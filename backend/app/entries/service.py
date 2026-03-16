"""KPI entry CRUD, submit, lock; formula evaluation for formula fields."""

from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, distinct
from sqlalchemy.orm import selectinload

from app.core.models import (
    KPIEntry,
    KPIFieldValue,
    KPIField,
    KPI,
    KPIAssignment,
    KpiRoleAssignment,
    KpiFieldAccess,
    KpiFieldAccessByRole,
    KpiMultiLineRowAccess,
    User,
    UserOrganizationRole,
    OrganizationRole,
    Organization,
    TimeDimension,
    effective_kpi_time_dimension,
    period_key_sort_order,
    KPIOrganizationTag,
    OrganizationTag,
)
from app.core.models import FieldType


class EntryValidationError(Exception):
    """Raised when entry values fail validation (e.g. reference field value not in allowed list)."""

    def __init__(self, errors: list[dict]):
        self.errors = errors  # list of {"field_key": str, "sub_field_key": str|None, "row_index": int|None, "value": str, "message": str}
        super().__init__(f"Validation failed: {len(errors)} error(s)")

# Type for multi_line_items data passed to formula evaluator
MultiLineItemsData = dict[str, list[dict]]
from app.entries.schemas import FieldValueInput, EntryCreate
from app.formula_engine.evaluator import evaluate_formula, OtherKpiValues


async def _resolve_org_and_kpi(db: AsyncSession, kpi_id: int) -> int | None:
    """Return organization_id for KPI or None (KPI has organization_id directly)."""
    result = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
    row = result.one_or_none()
    return row[0] if row else None


async def get_reference_allowed_values(
    db: AsyncSession,
    source_kpi_id: int,
    source_field_key: str,
    org_id: int,
    source_sub_field_key: str | None = None,
) -> list[str]:
    """Return distinct values from a source KPI field (or multi_line_items sub-field) for reference. Same org only."""
    result = await db.execute(
        select(KPIField)
        .join(KPI, KPIField.kpi_id == KPI.id)
        .where(
            KPIField.kpi_id == source_kpi_id,
            KPIField.key == source_field_key,
            KPI.organization_id == org_id,
        )
    )
    source_field = result.scalar_one_or_none()
    if not source_field:
        return []
    subq = select(KPIEntry.id).where(KPIEntry.organization_id == org_id)

    if source_field.field_type == FieldType.multi_line_items and source_sub_field_key:
        # Collect distinct values from value_json[*][source_sub_field_key] across all entries
        rows = await db.execute(
            select(KPIFieldValue.value_json).where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_json.isnot(None),
            )
        )
        values_set: set[str] = set()
        for (value_json,) in rows.all():
            if not isinstance(value_json, list):
                continue
            for row in value_json:
                if not isinstance(row, dict):
                    continue
                cell = row.get(source_sub_field_key)
                if cell is None or cell == "":
                    continue
                s = str(cell).strip()
                if s.lower() in ("true", "false"):
                    s = s.lower()
                values_set.add(s)
        return sorted(values_set)
    if source_field.field_type == FieldType.number:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_number))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_number.isnot(None),
            )
        )
        values = [str(r[0]) for r in rows.all() if r[0] is not None]
    elif source_field.field_type == FieldType.boolean:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_boolean))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_boolean.isnot(None),
            )
        )
        values = [str(r[0]).lower() for r in rows.all() if r[0] is not None]
    elif source_field.field_type == FieldType.date:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_date))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_date.isnot(None),
            )
        )
        values = []
        for r in rows.all():
            if r[0] is not None:
                values.append(r[0].isoformat() if hasattr(r[0], "isoformat") else str(r[0]))
    else:
        rows = await db.execute(
            select(distinct(KPIFieldValue.value_text))
            .where(
                KPIFieldValue.field_id == source_field.id,
                KPIFieldValue.entry_id.in_(subq),
                KPIFieldValue.value_text.isnot(None),
                KPIFieldValue.value_text != "",
            )
        )
        values = [r[0] for r in rows.all() if r[0]]
    return sorted(set(values))


def _normalize_reference_value(val: str | None) -> str:
    """Normalize a value for comparison with allowed reference values (strip, lowercase for bool)."""
    if val is None:
        return ""
    s = (val if isinstance(val, str) else str(val)).strip()
    if s.lower() in ("true", "false"):
        return s.lower()
    return s


async def _get_entry(db: AsyncSession, entry_id: int, org_id: int) -> KPIEntry | None:
    """Get entry by id and organization (one entry per org/kpi/year)."""
    result = await db.execute(
        select(KPIEntry).where(
            KPIEntry.id == entry_id,
            KPIEntry.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def _get_entry_admin(db: AsyncSession, entry_id: int, org_id: int) -> KPIEntry | None:
    """Alias for consistency; same as _get_entry (org-scoped)."""
    return await _get_entry(db, entry_id, org_id)


async def _copy_carry_forward_from_previous(
    db: AsyncSession, org_id: int, kpi_id: int, new_entry: KPIEntry, year: int, period_key: str
) -> None:
    """If KPI or any field has carry_forward_data, copy values from the most recent previous period's entry."""
    kpi_res = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id, KPI.organization_id == org_id)
        .options(selectinload(KPI.fields))
    )
    kpi = kpi_res.scalar_one_or_none()
    if not kpi:
        return
    org = await db.get(Organization, org_id)
    if not org:
        return
    org_td_raw = getattr(org, "time_dimension", None) or "yearly"
    kpi_td_raw = getattr(kpi, "time_dimension", None)
    try:
        org_td = TimeDimension(org_td_raw)
    except ValueError:
        org_td = TimeDimension.YEARLY
    kpi_td = None
    if kpi_td_raw:
        try:
            kpi_td = TimeDimension(kpi_td_raw)
        except ValueError:
            pass
    dimension = effective_kpi_time_dimension(kpi_td, org_td)
    kpi_carry = getattr(kpi, "carry_forward_data", False) or False
    carry_field_ids = set()
    for f in kpi.fields or []:
        if f.field_type == FieldType.formula:
            continue
        if kpi_carry or getattr(f, "carry_forward_data", False):
            carry_field_ids.add(f.id)
    if not carry_field_ids:
        return
    prev = _previous_period(year, period_key, dimension)
    while prev:
        pyear, ppk = prev
        prev_res = await db.execute(
            select(KPIEntry)
            .where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == kpi_id,
                KPIEntry.year == pyear,
                KPIEntry.period_key == ppk,
            )
            .options(selectinload(KPIEntry.field_values))
        )
        prev_entry = prev_res.scalar_one_or_none()
        if prev_entry and prev_entry.field_values:
            for fv in prev_entry.field_values:
                if fv.field_id not in carry_field_ids:
                    continue
                new_fv = KPIFieldValue(entry_id=new_entry.id, field_id=fv.field_id)
                new_fv.value_text = fv.value_text
                new_fv.value_number = fv.value_number
                new_fv.value_boolean = fv.value_boolean
                new_fv.value_date = fv.value_date
                new_fv.value_json = fv.value_json
                db.add(new_fv)
            await db.flush()
            return
        prev = _previous_period(pyear, ppk, dimension)


async def get_or_create_entry(
    db: AsyncSession, user_id: int, org_id: int, kpi_id: int, year: int, period_key: str = ""
) -> tuple[KPIEntry | None, bool]:
    """Get existing entry or create new one (one per organization per KPI per year per period_key). Returns (entry, created)."""
    pk = (period_key or "").strip()[:8]
    result = await db.execute(
        select(KPIEntry).where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == year,
            KPIEntry.period_key == pk,
        )
    )
    entry = result.scalar_one_or_none()
    if entry:
        return entry, False
    kpi_org = await _resolve_org_and_kpi(db, kpi_id)
    if kpi_org != org_id:
        return None, False
    entry = KPIEntry(
        organization_id=org_id,
        kpi_id=kpi_id,
        user_id=user_id,
        year=year,
        period_key=pk,
        is_draft=True,
    )
    db.add(entry)
    await db.flush()
    await _copy_carry_forward_from_previous(db, org_id, kpi_id, entry, year, pk)
    return entry, True


def _assignment_type_value(a) -> str:
    """Return assignment_type as string (handles enum or string column)."""
    t = getattr(a, "assignment_type", None)
    if t is None:
        return "data_entry"
    return t.value if hasattr(t, "value") else str(t)


async def user_can_view_kpi(
    db: AsyncSession, user_id: int, kpi_id: int, org_id: int | None = None
) -> bool:
    """Check if user can view KPI.

    - SUPER_ADMIN: full access.
    - ORG_ADMIN: full access within their organization (ignores assignments).
    - Other users: no implicit access; visibility is based on organization roles:
        * KPI-level role assignments (KpiRoleAssignment) with view/data_entry, OR
        * Field-level role access (KpiFieldAccessByRole) that grants at least view to any field.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    if user.role.value == "SUPER_ADMIN":
        return True
    if user.role.value == "ORG_ADMIN":
        kpi_res = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
        kpi_org = kpi_res.scalar_one_or_none()
        if kpi_org is None:
            return False
        effective_org = org_id if org_id is not None else getattr(user, "organization_id", None)
        return effective_org is not None and kpi_org == effective_org
    # Non-admins: derive visibility from role-based KPI/field access only
    # 1) Any KPI-level role assignment for this user?
    kpi_role_res = await db.execute(
        select(KpiRoleAssignment)
        .join(
            UserOrganizationRole,
            UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id,
        )
        .where(
            UserOrganizationRole.user_id == user_id,
            KpiRoleAssignment.kpi_id == kpi_id,
        )
    )
    if kpi_role_res.scalar_one_or_none() is not None:
        return True
    # 2) Any field-level role access that grants at least view for any field?
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if not access_map:
        return False
    return any(perm in ("view", "data_entry") for perm in access_map.values())


async def user_can_edit_kpi(
    db: AsyncSession, user_id: int, kpi_id: int, org_id: int | None = None
) -> bool:
    """Check if user can edit KPI.

    - SUPER_ADMIN: full access.
    - ORG_ADMIN: full access within their organization (ignores assignments).
    - Other users: no implicit access; edit permission is based on organization roles:
        * KPI-level role assignments with data_entry, OR
        * Field-level role access (via roles) that grants data_entry to at least one field.
    """
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    if user.role.value == "SUPER_ADMIN":
        return True
    if user.role.value == "ORG_ADMIN":
        kpi_res = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
        kpi_org = kpi_res.scalar_one_or_none()
        if kpi_org is None:
            return False
        effective_org = org_id if org_id is not None else getattr(user, "organization_id", None)
        return effective_org is not None and kpi_org == effective_org
    # Non-admins: derive edit permission from role-based KPI/field access only
    # 1) KPI-level role assignment with data_entry?
    kpi_role_res = await db.execute(
        select(KpiRoleAssignment)
        .join(
            UserOrganizationRole,
            UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id,
        )
        .where(
            UserOrganizationRole.user_id == user_id,
            KpiRoleAssignment.kpi_id == kpi_id,
            KpiRoleAssignment.assignment_type == "data_entry",
        )
    )
    if kpi_role_res.scalar_one_or_none() is not None:
        return True
    # 2) Any field-level role access that grants data_entry?
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if not access_map:
        return False
    return any(perm == "data_entry" for perm in access_map.values())


def _merge_access_type(current: str | None, incoming: str) -> str:
    """Merge access: data_entry > view. Return the stronger of current and incoming."""
    if not current:
        return incoming
    if incoming == "data_entry":
        return "data_entry"
    return current


async def get_user_field_access_for_kpi(
    db: AsyncSession, user_id: int, kpi_id: int
) -> dict[tuple[int, int | None], str] | None:
    """
    Get field-level access for user on KPI (user direct + role-based with KPI-level inheritance).
    Returns None if no field-level rows exist (use KPI-level assignment for all fields).
    Otherwise returns map (field_id, sub_field_id) -> "view" | "data_entry".
    By default role's field-level access inherits KPI-level; explicit KpiFieldAccessByRole overrides.
    Org admin and super admin always get full access (return None so callers use KPI-level = full).
    """
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if user and user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return None  # Full access to all KPIs and subfields; callers use KPI-level permission
    # Effective field access is based purely on organization roles (no direct user field overrides).
    out: dict[tuple[int, int | None], str] = {}
    # User's roles that are assigned to this KPI (with KPI-level permission)
    role_assignments_res = await db.execute(
        select(KpiRoleAssignment.organization_role_id, KpiRoleAssignment.assignment_type)
        .join(UserOrganizationRole, UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id)
        .where(
            UserOrganizationRole.user_id == user_id,
            KpiRoleAssignment.kpi_id == kpi_id,
        )
    )
    role_kpi_perms: list[tuple[int, str]] = []
    for row in role_assignments_res.all():
        perm = row[1].value if hasattr(row[1], "value") else str(row[1] or "data_entry")
        p = perm.strip().lower()
        if p not in ("view", "data_entry"):
            p = "data_entry"
        role_kpi_perms.append((row[0], p))
    # All roles the user belongs to (for explicit field-level KpiFieldAccessByRole)
    user_roles_res = await db.execute(
        select(UserOrganizationRole.organization_role_id).where(
            UserOrganizationRole.user_id == user_id
        )
    )
    user_role_ids = [row[0] for row in user_roles_res.all()]
    # Explicit field-level by role (for any role the user belongs to)
    role_access_res = await db.execute(
        select(
            KpiFieldAccessByRole.organization_role_id,
            KpiFieldAccessByRole.field_id,
            KpiFieldAccessByRole.sub_field_id,
            KpiFieldAccessByRole.access_type,
        ).where(
            KpiFieldAccessByRole.kpi_id == kpi_id,
            KpiFieldAccessByRole.organization_role_id.in_(user_role_ids),
        )
    )
    role_perm_by_key: dict[tuple[int, int, int | None], str] = {}
    for r in role_access_res.all():
        perm = r[3].value if hasattr(r[3], "value") else str(r[3] or "data_entry")
        p = perm.strip().lower()
        if p not in ("view", "data_entry"):
            p = "data_entry"
        role_perm_by_key[(r[0], r[1], r[2])] = p
    # Load all fields and subfields for this KPI to apply inherited KPI-level where applicable
    fields_res = await db.execute(
        select(KPIField)
        .where(KPIField.kpi_id == kpi_id)
        .options(selectinload(KPIField.sub_fields))
    )
    fields = list(fields_res.scalars().all())
    if role_kpi_perms:
        # Helper to choose most restrictive between KPI-level and field-level for same role+field
        def _most_restrictive(kpi_perm: str | None, field_perm: str | None) -> str | None:
            if not kpi_perm and not field_perm:
                return None
            if kpi_perm and not field_perm:
                return kpi_perm
            if field_perm and not kpi_perm:
                return field_perm
            # both present: most restrictive → view < data_entry
            if kpi_perm == "view" or field_perm == "view":
                return "view"
            return "data_entry"

        for f in fields:
            sub_fields = getattr(f, "sub_fields", None) or []
            is_multi = getattr(f, "field_type", None) == FieldType.multi_line_items
            if is_multi and sub_fields:
                for s in sub_fields:
                    key = (f.id, s.id)
                    for rid, kpi_perm in role_kpi_perms:
                        explicit = role_perm_by_key.get((rid, f.id, s.id))
                        merged = _most_restrictive(kpi_perm, explicit)
                        if merged:
                            out[key] = _merge_access_type(out.get(key), merged)
                key_whole = (f.id, None)
                for rid, kpi_perm in role_kpi_perms:
                    explicit = role_perm_by_key.get((rid, f.id, None))
                    merged = _most_restrictive(kpi_perm, explicit)
                    if merged:
                        out[key_whole] = _merge_access_type(out.get(key_whole), merged)
            else:
                key = (f.id, None)
                for rid, kpi_perm in role_kpi_perms:
                    explicit = role_perm_by_key.get((rid, f.id, None))
                    merged = _most_restrictive(kpi_perm, explicit)
                    if merged:
                        out[key] = _merge_access_type(out.get(key), merged)
    # Apply any explicit field-level role permissions even when there is no KPI-level role assignment
    if role_perm_by_key:
        for (_rid, field_id, sub_field_id), perm in role_perm_by_key.items():
            key = (field_id, sub_field_id)
            out[key] = _merge_access_type(out.get(key), perm)
    if not out:
        return None
    return out


async def user_can_view_field(
    db: AsyncSession, user_id: int, kpi_id: int, field_id: int, sub_field_id: int | None = None
) -> bool:
    """True if user can view this field (or sub_field). Org/super admin: True. Else field-level or KPI-level."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if access_map is None:
        return await user_can_view_kpi(db, user_id, kpi_id)
    perm = access_map.get((field_id, sub_field_id)) or access_map.get((field_id, None))
    return perm in ("view", "data_entry")


async def user_can_edit_field(
    db: AsyncSession, user_id: int, kpi_id: int, field_id: int, sub_field_id: int | None = None
) -> bool:
    """True if user can edit this field (or sub_field)."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)
    if access_map is None:
        return await user_can_edit_kpi(db, user_id, kpi_id)
    perm = access_map.get((field_id, sub_field_id)) or access_map.get((field_id, None))
    return perm == "data_entry"


def _user_can_edit_sub_field(access_map: dict | None, field_id: int, sub_field_id: int | None) -> bool:
    """Given access_map from get_user_field_access_for_kpi, return True if user can edit (field_id, sub_field_id)."""
    if access_map is None:
        return False
    perm = access_map.get((field_id, sub_field_id)) or access_map.get((field_id, None))
    return perm == "data_entry"


async def user_can_edit_multi_line_field(
    db: AsyncSession, user_id: int, kpi_id: int, field: "KPIField"
) -> bool:
    """True if user can edit this multi_line_items field (whole-field or at least one sub_field)."""
    if await user_can_edit_field(db, user_id, kpi_id, field.id, None):
        return True
    for sub in getattr(field, "sub_fields", None) or []:
        if await user_can_edit_field(db, user_id, kpi_id, field.id, getattr(sub, "id", None)):
            return True
    return False


async def user_can_edit_row(
    db: AsyncSession, user_id: int, entry_id: int, field_id: int, row_index: int
) -> bool:
    """True if user can edit this specific row. When row_level_user_access_enabled is False, all rows follow role/field access; when True, row-level user access is enforced."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    # Load field to check row_level_user_access_enabled
    entry_res = await db.execute(select(KPIEntry).where(KPIEntry.id == entry_id))
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return False
    field_res = await db.execute(
        select(KPIField)
        .where(KPIField.id == field_id, KPIField.kpi_id == entry.kpi_id)
        .options(selectinload(KPIField.sub_fields))
    )
    field = field_res.scalar_one_or_none()
    if field and not getattr(field, "row_level_user_access_enabled", False):
        # Row-level user access not enabled: all rows follow role/field access
        if field.field_type == FieldType.multi_line_items:
            return await user_can_edit_multi_line_field(db, user_id, entry.kpi_id, field)
        return await user_can_edit_field(db, user_id, entry.kpi_id, field_id, None)
    # Row-level user access enabled: check KpiMultiLineRowAccess
    row_res = await db.execute(
        select(KpiMultiLineRowAccess).where(
            KpiMultiLineRowAccess.user_id == user_id,
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    row_rules = row_res.scalars().all()
    if not row_rules:
        if field and field.field_type == FieldType.multi_line_items:
            return await user_can_edit_multi_line_field(db, user_id, entry.kpi_id, field)
        return await user_can_edit_field(db, user_id, entry.kpi_id, field_id, None)
    for r in row_rules:
        if r.row_index == row_index and r.can_edit:
            return True
    return False


async def user_can_delete_row(
    db: AsyncSession, user_id: int, entry_id: int, field_id: int, row_index: int
) -> bool:
    """True if user can delete this specific row. When row_level_user_access_enabled is False, all rows follow role/field access; when True, row-level user access is enforced."""
    user_res = await db.execute(select(User).where(User.id == user_id))
    user = user_res.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    entry_res = await db.execute(select(KPIEntry).where(KPIEntry.id == entry_id))
    entry = entry_res.scalar_one_or_none()
    if not entry:
        return False
    field_res = await db.execute(
        select(KPIField).where(KPIField.id == field_id, KPIField.kpi_id == entry.kpi_id)
    )
    field = field_res.scalar_one_or_none()
    if field and not getattr(field, "row_level_user_access_enabled", False):
        return await user_can_edit_field(db, user_id, entry.kpi_id, field_id, None)
    row_res = await db.execute(
        select(KpiMultiLineRowAccess).where(
            KpiMultiLineRowAccess.user_id == user_id,
            KpiMultiLineRowAccess.entry_id == entry_id,
            KpiMultiLineRowAccess.field_id == field_id,
        )
    )
    row_rules = row_res.scalars().all()
    if not row_rules:
        return await user_can_edit_field(db, user_id, entry.kpi_id, field_id, None)
    for r in row_rules:
        if r.row_index == row_index and r.can_delete:
            return True
    return False


async def _load_other_kpi_values(
    db: AsyncSession, year: int, org_id: int, exclude_kpi_id: int
) -> OtherKpiValues:
    """Load numeric field values from org's entries for other KPIs (same org, same year)."""
    out: OtherKpiValues = {}
    q = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.year == year,
            KPIEntry.kpi_id != exclude_kpi_id,
        )
        .options(selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field))
    )
    res = await db.execute(q)
    for other_entry in res.scalars().all():
        kid = other_entry.kpi_id
        for fv in other_entry.field_values or []:
            if not fv.field or fv.value_number is None:
                continue
            if fv.field.field_type not in (FieldType.number, FieldType.formula):
                continue
            try:
                out[(kid, fv.field.key)] = float(fv.value_number)
            except (TypeError, ValueError):
                pass
    return out


async def save_entry_values(
    db: AsyncSession,
    entry_id: int,
    user_id: int,
    values: list[FieldValueInput],
    kpi_id: int,
    org_id: int,
) -> KPIEntry | None:
    """Save or update field values for entry; evaluate formula fields."""
    entry = await _get_entry(db, entry_id, org_id)
    if not entry or entry.kpi_id != kpi_id or entry.is_locked:
        return None
    # Load KPI and fields (with sub_fields for multi_line_items formula support)
    result = await db.execute(
        select(KPI)
        .where(KPI.id == kpi_id)
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpi = result.scalar_one_or_none()
    if not kpi:
        return None
    key_to_field = {f.key: f for f in kpi.fields}
    validation_errors: list[dict] = []

    # Field-level access for merging multi_line_items by editable columns
    access_map = await get_user_field_access_for_kpi(db, user_id, kpi_id)

    # Reference field validation (scalar and inside multi_line_items)
    for v in values:
        f = next((x for x in kpi.fields if x.id == v.field_id), None)
        if not f:
            continue
        if f.field_type == FieldType.reference:
            config = getattr(f, "config", None) or {}
            sid = config.get("reference_source_kpi_id")
            skey = config.get("reference_source_field_key")
            sub_key = config.get("reference_source_sub_field_key")
            if sid and skey:
                allowed = await get_reference_allowed_values(db, int(sid), str(skey), org_id, source_sub_field_key=sub_key)
                allowed_normalized = {_normalize_reference_value(a) for a in allowed}
                raw = (v.value_text or "").strip()
                normalized = _normalize_reference_value(v.value_text)
                if raw and normalized not in allowed_normalized:
                    validation_errors.append({
                        "field_key": f.key,
                        "sub_field_key": None,
                        "row_index": None,
                        "value": v.value_text or "",
                        "message": "Value must be one of the referenced field's values.",
                    })
        elif f.field_type == FieldType.multi_line_items and isinstance(v.value_json, list):
            for sub in getattr(f, "sub_fields", []) or []:
                if getattr(sub, "field_type", None) != FieldType.reference:
                    continue
                config = getattr(sub, "config", None) or {}
                sid = config.get("reference_source_kpi_id")
                skey = config.get("reference_source_field_key")
                sub_key = config.get("reference_source_sub_field_key")
                if not sid or not skey:
                    continue
                allowed = await get_reference_allowed_values(db, int(sid), str(skey), org_id, source_sub_field_key=sub_key)
                allowed_normalized = {_normalize_reference_value(a) for a in allowed}
                for row_idx, row in enumerate(v.value_json):
                    if not isinstance(row, dict):
                        continue
                    cell = row.get(sub.key)
                    raw = cell if isinstance(cell, str) else str(cell) if cell is not None else ""
                    normalized = _normalize_reference_value(raw)
                    if normalized and normalized not in allowed_normalized:
                        validation_errors.append({
                            "field_key": f.key,
                            "sub_field_key": sub.key,
                            "row_index": row_idx,
                            "value": raw,
                            "message": "Value must be one of the referenced field's values.",
                        })

    if validation_errors:
        raise EntryValidationError(validation_errors)

    value_by_key: dict[str, float | int] = {}
    multi_line_items_data: MultiLineItemsData = {}
    for v in values:
        f = next((x for x in kpi.fields if x.id == v.field_id), None)
        if not f:
            continue
        if f.field_type == FieldType.formula:
            continue  # computed below
        fv = (
            await db.execute(
                select(KPIFieldValue).where(
                    KPIFieldValue.entry_id == entry_id,
                    KPIFieldValue.field_id == v.field_id,
                )
            )
        ).scalar_one_or_none()
        num_val = None
        if v.value_number is not None:
            num_val = float(v.value_number) if not isinstance(v.value_number, (int, float)) else v.value_number
        if f.field_type == FieldType.number and num_val is not None:
            value_by_key[f.key] = num_val
        if f.field_type == FieldType.multi_line_items and isinstance(v.value_json, list):
            multi_line_items_data[f.key] = v.value_json
        if fv is None:
            fv = KPIFieldValue(entry_id=entry_id, field_id=v.field_id)
            db.add(fv)
        fv.value_text = v.value_text
        fv.value_number = v.value_number
        if f.field_type == FieldType.multi_line_items and isinstance(v.value_json, list):
            if access_map is None:
                # No field-level ACL (e.g. org/super admin): accept full value
                fv.value_json = v.value_json
            else:
                # Merge by column: only update cells for sub_fields the user can edit; keep rest from existing
                existing_list = fv.value_json if isinstance(fv.value_json, list) else []
                merged_rows: list[dict] = []
                sub_fields = getattr(f, "sub_fields", None) or []
                for i, inc_row in enumerate(v.value_json):
                    inc_row = inc_row if isinstance(inc_row, dict) else {}
                    exist_row = existing_list[i] if i < len(existing_list) and isinstance(existing_list[i], dict) else {}
                    new_row: dict = {}
                    for sub in sub_fields:
                        sub_id = getattr(sub, "id", None)
                        sub_key = getattr(sub, "key", None)
                        if sub_key is None:
                            continue
                        if _user_can_edit_sub_field(access_map, f.id, sub_id):
                            new_row[sub_key] = inc_row.get(sub_key)
                        else:
                            new_row[sub_key] = exist_row.get(sub_key)
                    merged_rows.append(new_row)
                fv.value_json = merged_rows
        else:
            fv.value_json = v.value_json
        fv.value_boolean = v.value_boolean
        if v.value_date is not None:
            if isinstance(v.value_date, datetime):
                fv.value_date = v.value_date
            elif isinstance(v.value_date, str):
                try:
                    s = v.value_date.strip()
                    if s:
                        fv.value_date = datetime.fromisoformat(s.replace("Z", "+00:00"))
                except (ValueError, TypeError):
                    pass
            else:
                fv.value_date = None
        if num_val is not None:
            value_by_key[f.key] = num_val

    # For multi_line_items not in request, use existing stored value
    for f in kpi.fields:
        if f.field_type != FieldType.multi_line_items or f.key in multi_line_items_data:
            continue
        existing = (
            await db.execute(
                select(KPIFieldValue).where(
                    KPIFieldValue.entry_id == entry_id,
                    KPIFieldValue.field_id == f.id,
                )
            )
        ).scalar_one_or_none()
        if existing and isinstance(existing.value_json, list):
            multi_line_items_data[f.key] = existing.value_json

    # Other KPIs' numeric values for KPI_FIELD(kpi_id, field_key) in formulas
    other_kpi_values = await _load_other_kpi_values(db, entry.year, org_id, kpi_id)

    # Formula fields
    for f in kpi.fields:
        if f.field_type != FieldType.formula or not f.formula_expression:
            continue
        computed = evaluate_formula(
            f.formula_expression, value_by_key, multi_line_items_data, other_kpi_values
        )
        fv = (
            await db.execute(
                select(KPIFieldValue).where(
                    KPIFieldValue.entry_id == entry_id,
                    KPIFieldValue.field_id == f.id,
                )
            )
        ).scalar_one_or_none()
        if fv is None:
            fv = KPIFieldValue(entry_id=entry_id, field_id=f.id)
            db.add(fv)
        fv.value_number = computed
        if computed is not None:
            value_by_key[f.key] = computed

    entry.user_id = user_id
    entry.updated_at = datetime.utcnow()
    await db.flush()
    return entry


async def submit_entry(
    db: AsyncSession, entry_id: int, user_id: int, org_id: int
) -> KPIEntry | None:
    """Mark entry as submitted (no longer draft)."""
    entry = await _get_entry(db, entry_id, org_id)
    if not entry or entry.is_locked:
        return None
    entry.is_draft = False
    entry.submitted_at = datetime.utcnow()
    entry.user_id = user_id
    entry.updated_at = datetime.utcnow()
    await db.flush()
    return entry


async def lock_entry(
    db: AsyncSession, entry_id: int, org_id: int, is_locked: bool
) -> KPIEntry | None:
    """Lock or unlock entry (admin)."""
    entry = await _get_entry_admin(db, entry_id, org_id)
    if not entry:
        return None
    entry.is_locked = is_locked
    await db.flush()
    return entry


async def list_available_kpis(db: AsyncSession, user_id: int, org_id: int) -> list[KPI]:
    """Return KPIs the user can enter data for.

    - ORG_ADMIN / SUPER_ADMIN: all KPIs in the organization.
    - Other users: no implicit access; KPIs are visible if any organization role for the user
      grants either KPI-level access (KpiRoleAssignment) OR field-level access (KpiFieldAccessByRole)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return []
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        q = select(KPI).where(KPI.organization_id == org_id).order_by(KPI.sort_order, KPI.name)
        res = await db.execute(q)
        return list(res.scalars().all())
    # Non-admins: derive visible KPIs from organization roles
    # 1) KPI-level role assignments
    kpi_from_roles_res = await db.execute(
        select(KpiRoleAssignment.kpi_id)
        .join(
            UserOrganizationRole,
            UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id,
        )
        .join(KPI, KPI.id == KpiRoleAssignment.kpi_id)
        .where(
            UserOrganizationRole.user_id == user_id,
            KPI.organization_id == org_id,
        )
    )
    kpi_ids_from_roles = {row[0] for row in kpi_from_roles_res.all()}
    # 2) Field-level role access (KpiFieldAccessByRole)
    user_roles_res = await db.execute(
        select(UserOrganizationRole.organization_role_id).where(
            UserOrganizationRole.user_id == user_id
        )
    )
    user_role_ids = [row[0] for row in user_roles_res.all()]
    if user_role_ids:
        field_based_res = await db.execute(
            select(KpiFieldAccessByRole.kpi_id)
            .join(KPI, KPI.id == KpiFieldAccessByRole.kpi_id)
            .where(
                KpiFieldAccessByRole.organization_role_id.in_(user_role_ids),
                KPI.organization_id == org_id,
            )
        )
        for row in field_based_res.all():
            kpi_ids_from_roles.add(row[0])
    if not kpi_ids_from_roles:
        return []
    q = (
        select(KPI)
        .where(
            KPI.organization_id == org_id,
            KPI.id.in_(kpi_ids_from_roles),
        )
        .order_by(KPI.sort_order, KPI.name)
    )
    res = await db.execute(q)
    return list(res.scalars().all())


async def list_entries(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    kpi_id: int | None = None,
    year: int | None = None,
    period_key: str | None = None,
    as_admin: bool = False,
) -> list[KPIEntry]:
    """List entries for org (per KPI per year per period_key). Non-admin: only KPIs the user is assigned to."""
    q = select(KPIEntry).where(KPIEntry.organization_id == org_id)
    if kpi_id is not None:
        q = q.where(KPIEntry.kpi_id == kpi_id)
    if year is not None:
        q = q.where(KPIEntry.year == year)
    if period_key is not None:
        q = q.where(KPIEntry.period_key == (period_key.strip()[:8] if period_key else ""))
    if not as_admin:
        q = q.join(
            KPIAssignment,
            (KPIAssignment.kpi_id == KPIEntry.kpi_id) & (KPIAssignment.user_id == user_id),
        )
    q = q.order_by(KPIEntry.year.desc(), KPIEntry.period_key, KPIEntry.kpi_id)
    q = q.options(selectinload(KPIEntry.field_values), selectinload(KPIEntry.user))
    result = await db.execute(q)
    return list(result.unique().scalars().all())


async def get_latest_year_with_entries(
    db: AsyncSession,
    org_id: int,
    kpi_ids: list[int],
) -> int | None:
    """Return the latest (max) year that has at least one entry for the given org and KPIs, or None."""
    if not kpi_ids:
        return None
    q = select(func.max(KPIEntry.year)).where(
        KPIEntry.organization_id == org_id,
        KPIEntry.kpi_id.in_(kpi_ids),
    )
    r = await db.execute(q)
    val = r.scalar()
    return int(val) if val is not None else None


async def get_available_years(
    db: AsyncSession,
    org_id: int,
    kpi_ids: list[int],
    limit: int = 10,
) -> list[int]:
    """Return distinct years (descending) that have at least one entry for the given org and KPIs."""
    if not kpi_ids:
        return []
    q = (
        select(KPIEntry.year)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id.in_(kpi_ids),
        )
        .distinct()
        .order_by(KPIEntry.year.desc())
        .limit(limit)
    )
    r = await db.execute(q)
    return [int(row[0]) for row in r.all()]


async def get_entries_for_kpis(
    db: AsyncSession,
    org_id: int,
    kpi_ids: list[int],
    year: int,
) -> tuple[list[dict], list[dict]]:
    """
    Load entries for given org, kpi_ids, and year. Returns (rows, missing_kpis).
    - rows: list of { "kpi_id", "kpi_name", "entry_id", "row": { field_key: display_value } }
    - missing_kpis: list of { "kpi_id", "kpi_name", "assigned_user_names": [...] } for KPIs with no entry.
    """
    if not kpi_ids:
        return [], []
    # Load KPIs with fields (for names and keys)
    from sqlalchemy.orm import selectinload as sl
    kpi_q = select(KPI).where(KPI.id.in_(kpi_ids)).options(sl(KPI.fields).selectinload(KPIField.sub_fields))
    kpi_res = await db.execute(kpi_q)
    kpis = {k.id: k for k in kpi_res.scalars().all()}
    # Load entries with field_values and field
    entry_q = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id.in_(kpi_ids),
            KPIEntry.year == year,
        )
        .options(
            selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field).selectinload(KPIField.sub_fields),
        )
    )
    entry_res = await db.execute(entry_q)
    entries = list(entry_res.scalars().all())
    entry_by_kpi = {e.kpi_id: e for e in entries}
    rows = []
    for e in entries:
        kpi = kpis.get(e.kpi_id)
        kpi_name = kpi.name if kpi else ""
        row = {}
        for fv in e.field_values or []:
            if fv.field:
                row[fv.field.key] = _format_field_value(fv)
        rows.append({"kpi_id": e.kpi_id, "kpi_name": kpi_name, "entry_id": e.id, "row": row})
    missing_ids = [kid for kid in kpi_ids if kid not in entry_by_kpi]
    if not missing_ids:
        return rows, []
    # Data-entry assignees for missing KPIs
    assign_q = (
        select(KPIAssignment.kpi_id, User.full_name, User.username)
        .join(User, User.id == KPIAssignment.user_id)
        .where(
            KPIAssignment.kpi_id.in_(missing_ids),
            KPIAssignment.assignment_type == "data_entry",
        )
    )
    assign_res = await db.execute(assign_q)
    assignees_by_kpi: dict[int, list[str]] = {}
    for row in assign_res.all():
        kpi_id, full_name, username = row[0], row[1], row[2]
        display = (full_name or "").strip() or username or ""
        if display and kpi_id in missing_ids:
            assignees_by_kpi.setdefault(kpi_id, []).append(display)
    role_names_by_kpi: dict[int, list[str]] = {kid: [] for kid in missing_ids}
    if missing_ids:
        role_assign_q = (
            select(KpiRoleAssignment.kpi_id, OrganizationRole.name)
            .join(OrganizationRole, OrganizationRole.id == KpiRoleAssignment.organization_role_id)
            .where(KpiRoleAssignment.kpi_id.in_(missing_ids))
        )
        role_assign_res = await db.execute(role_assign_q)
        for row in role_assign_res.all():
            kpi_id, role_name = row[0], (row[1] or "").strip()
            if role_name and kpi_id in missing_ids:
                role_names_by_kpi.setdefault(kpi_id, []).append(role_name)
    missing_kpis = [
        {
            "kpi_id": kid,
            "kpi_name": kpis.get(kid).name if kpis.get(kid) else "",
            "assigned_user_names": assignees_by_kpi.get(kid, []),
            "assigned_role_names": role_names_by_kpi.get(kid, []),
        }
        for kid in missing_ids
    ]
    return rows, missing_kpis


def _format_field_value(fv) -> str:
    """Format a field value for display."""
    if fv.value_text is not None:
        return str(fv.value_text)[:80]
    if fv.value_number is not None:
        return str(fv.value_number)
    if fv.value_boolean is not None:
        return "Yes" if fv.value_boolean else "No"
    if fv.value_date is not None:
        return str(fv.value_date)[:10] if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
    if fv.value_json is not None:
        # multi_line_items: use sub_fields for readable summary when available
        if getattr(fv.field, "field_type", None) == FieldType.multi_line_items and isinstance(fv.value_json, list):
            return _format_multi_line_for_display(fv)
        return str(fv.value_json)[:80]
    return ""


def _format_multi_line_for_display(fv) -> str:
    """Format multi_line_items value_json as a short summary using sub_field keys (for NLP/chat)."""
    if not isinstance(fv.value_json, list) or not fv.field:
        return str(fv.value_json)[:80] if fv.value_json else ""
    sub_fields = getattr(fv.field, "sub_fields", None) or []
    keys = [sf.key for sf in sorted(sub_fields, key=lambda x: getattr(x, "sort_order", 0))]
    parts = []
    for item in fv.value_json[:5]:  # first 5 items
        if not isinstance(item, dict):
            parts.append(str(item)[:40])
            continue
        if not keys:
            keys = list(item.keys())[:5]
        pair_str = ", ".join(f"{k}={str(item.get(k, ''))[:25]}" for k in keys)
        parts.append(pair_str[:60])
    out = f"{len(fv.value_json)} item(s): " + "; ".join(parts) if parts else f"{len(fv.value_json)} item(s)"
    return out[:250]


def _expected_period_keys(dimension: TimeDimension) -> list[str]:
    """Return expected period_key values for the dimension (for display order)."""
    if dimension in (TimeDimension.YEARLY, TimeDimension.MULTI_YEAR):
        return [""]
    if dimension == TimeDimension.HALF_YEARLY:
        return ["H1", "H2"]
    if dimension == TimeDimension.QUARTERLY:
        return ["Q1", "Q2", "Q3", "Q4"]
    if dimension == TimeDimension.MONTHLY:
        return [f"{i:02d}" for i in range(1, 13)]
    return [""]


def _previous_period(year: int, period_key: str, dimension: TimeDimension) -> tuple[int, str] | None:
    """Return (year_prev, period_key_prev) for the period before (year, period_key), or None if no previous (e.g. yearly 2020)."""
    pk = (period_key or "").strip()
    keys = _expected_period_keys(dimension)
    try:
        idx = keys.index(pk) if pk in keys else (keys.index("") if "" in keys else 0)
    except ValueError:
        idx = 0
    if idx > 0:
        return year, keys[idx - 1]
    if year <= 2000:  # arbitrary lower bound
        return None
    return year - 1, keys[-1] if keys else ""


def _period_display(period_key: str) -> str:
    """Human-readable label for period_key."""
    if not period_key or not period_key.strip():
        return "Full year"
    pk = period_key.strip().upper()
    if pk in ("H1", "H2"):
        return f"Half {pk[1]}"
    if pk in ("Q1", "Q2", "Q3", "Q4"):
        return pk
    if period_key.isdigit() and 1 <= int(period_key) <= 12:
        months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
        return months[int(period_key) - 1]
    return period_key or "Full year"


async def _get_entries_for_overview(
    db: AsyncSession, org_id: int, kpi_ids: list[int], year: int
) -> list[KPIEntry]:
    """Load all entries for org, kpi_ids, year with field_values and user."""
    if not kpi_ids:
        return []
    q = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id.in_(kpi_ids),
            KPIEntry.year == year,
        )
        .options(
            selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field),
            selectinload(KPIEntry.user),
        )
    )
    res = await db.execute(q)
    return list(res.unique().scalars().all())


async def list_entries_overview(
    db: AsyncSession, user_id: int, org_id: int, year: int, as_admin: bool = False
) -> list[dict]:
    """
    For the given year, return KPIs with entry status, effective time dimension, and per-period entries.
    Includes last data entry user and assigned users. entries[] has one slot per expected period.
    """
    kpis = await list_available_kpis(db, user_id, org_id)
    kpi_ids = [k.id for k in kpis]
    org = await db.get(Organization, org_id)
    org_td_raw = getattr(org, "time_dimension", None) or "yearly"
    try:
        org_td = TimeDimension(org_td_raw)
    except ValueError:
        org_td = TimeDimension.YEARLY

    assigned_by_kpi: dict[int, list[str]] = {kid: [] for kid in kpi_ids}
    assigned_users_detail_by_kpi: dict[int, list[dict]] = {kid: [] for kid in kpi_ids}
    assigned_data_entry_ids_by_kpi: dict[int, set[int]] = {kid: set() for kid in kpi_ids}
    current_user_permission_by_kpi: dict[int, str] = {}
    if kpi_ids:
        assign_res = await db.execute(
            select(
                KPIAssignment.kpi_id,
                KPIAssignment.user_id,
                KPIAssignment.assignment_type,
                User.full_name,
                User.username,
                User.email,
            )
            .join(User, User.id == KPIAssignment.user_id)
            .where(KPIAssignment.kpi_id.in_(kpi_ids))
        )
        for row in assign_res.all():
            kpi_id, uid, atype, full_name, username, email = row[0], row[1], row[2], row[3], row[4], row[5]
            perm = row[2].value if hasattr(row[2], "value") else str(row[2] or "data_entry")
            if uid == user_id:
                current_user_permission_by_kpi[kpi_id] = perm
            if perm == "data_entry":
                assigned_data_entry_ids_by_kpi.setdefault(kpi_id, set()).add(uid)
                display = (full_name or "").strip() or username or ""
                if display and display not in assigned_by_kpi.get(kpi_id, []):
                    assigned_by_kpi.setdefault(kpi_id, []).append(display)
            assigned_users_detail_by_kpi.setdefault(kpi_id, []).append({
                "display_name": (full_name or "").strip() or username or "",
                "email": (email or "").strip() or None,
                "permission": perm,
            })
    user_res = await db.execute(select(User).where(User.id == user_id))
    current_user_obj = user_res.scalar_one_or_none()
    if current_user_obj and current_user_obj.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        for kid in kpi_ids:
            current_user_permission_by_kpi[kid] = "data_entry"

    all_entries = await _get_entries_for_overview(db, org_id, kpi_ids, year)
    entry_by_kpi_period: dict[tuple[int, str], KPIEntry] = {}
    for e in all_entries:
        pk = getattr(e, "period_key", "") or ""
        entry_by_kpi_period[(e.kpi_id, pk)] = e

    tag_names_by_kpi: dict[int, list[str]] = {kid: [] for kid in kpi_ids}
    if kpi_ids:
        tag_res = await db.execute(
            select(KPIOrganizationTag.kpi_id, OrganizationTag.name)
            .join(OrganizationTag, OrganizationTag.id == KPIOrganizationTag.organization_tag_id)
            .where(KPIOrganizationTag.kpi_id.in_(kpi_ids))
        )
        for row in tag_res.all():
            kpi_id, name = row[0], (row[1] or "").strip()
            if name and name not in tag_names_by_kpi.get(kpi_id, []):
                tag_names_by_kpi.setdefault(kpi_id, []).append(name)

    assigned_role_names_by_kpi: dict[int, list[str]] = {kid: [] for kid in kpi_ids}
    if kpi_ids:
        role_assign_res = await db.execute(
            select(KpiRoleAssignment.kpi_id, OrganizationRole.name)
            .join(OrganizationRole, OrganizationRole.id == KpiRoleAssignment.organization_role_id)
            .where(KpiRoleAssignment.kpi_id.in_(kpi_ids))
        )
        for row in role_assign_res.all():
            kpi_id, role_name = row[0], (row[1] or "").strip()
            if role_name and kpi_id in kpi_ids and role_name not in assigned_role_names_by_kpi.get(kpi_id, []):
                assigned_role_names_by_kpi.setdefault(kpi_id, []).append(role_name)
        # Set current_user_permission from role assignment when not set by direct assignment
        role_perm_res = await db.execute(
            select(KpiRoleAssignment.kpi_id, KpiRoleAssignment.assignment_type)
            .join(UserOrganizationRole, UserOrganizationRole.organization_role_id == KpiRoleAssignment.organization_role_id)
            .where(
                UserOrganizationRole.user_id == user_id,
                KpiRoleAssignment.kpi_id.in_(kpi_ids),
            )
        )
        for row in role_perm_res.all():
            kid, atype = row[0], row[1]
            if kid not in current_user_permission_by_kpi:
                perm = atype.value if hasattr(atype, "value") else str(atype or "data_entry")
                if perm not in ("data_entry", "view"):
                    perm = "data_entry"
                current_user_permission_by_kpi[kid] = perm

    result = []
    for kpi in kpis:
        kpi_td_raw = getattr(kpi, "time_dimension", None)
        kpi_td = TimeDimension(kpi_td_raw) if kpi_td_raw else None
        effective_td = effective_kpi_time_dimension(kpi_td, org_td)
        expected_periods = _expected_period_keys(effective_td)

        periods_out = []
        primary_entry: KPIEntry | None = None
        for pk in expected_periods:
            entry = entry_by_kpi_period.get((kpi.id, pk))
            if entry and primary_entry is None:
                primary_entry = entry
            preview = []
            entered_by_name = None
            if entry:
                field_values = list(entry.field_values or [])
                card_ids = getattr(kpi, "card_display_field_ids", None)
                if isinstance(card_ids, list) and len(card_ids) > 0:
                    id_to_fv = {fv.field_id: fv for fv in field_values if fv.field}
                    for field_id in card_ids:
                        fv = id_to_fv.get(field_id)
                        if fv and fv.field:
                            preview.append({"field_name": fv.field.name, "value": _format_field_value(fv)})
                else:
                    field_values.sort(key=lambda fv: (fv.field.sort_order if fv.field else 0, fv.field_id))
                    for fv in field_values[:2]:
                        if fv.field:
                            preview.append({"field_name": fv.field.name, "value": _format_field_value(fv)})
                if entry.user:
                    entered_by_name = (entry.user.full_name or entry.user.username or "").strip() or entry.user.username
            assigned_ids = assigned_data_entry_ids_by_kpi.get(kpi.id, set())
            data_entry_user_is_assigned = entry and entry.user_id is not None and entry.user_id in assigned_ids if entry else False
            period_payload = {
                "period_key": pk,
                "period_display": _period_display(pk),
                "entry": None,
            }
            if entry:
                period_payload["entry"] = {
                    "id": entry.id,
                    "is_draft": entry.is_draft,
                    "is_locked": entry.is_locked,
                    "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
                    "preview": preview,
                    "entered_by_user_name": entered_by_name,
                    "last_updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
                    "data_entry_user_is_assigned": data_entry_user_is_assigned,
                }
            periods_out.append(period_payload)

        item = {
            "kpi_id": kpi.id,
            "kpi_name": kpi.name,
            "kpi_description": getattr(kpi, "description", None) or None,
            "entry_mode": getattr(kpi, "entry_mode", None) or "manual",
            "kpi_year": year,  # context year (data scope), not KPI-level year
            "org_time_dimension": org_td.value,
            "kpi_time_dimension": kpi_td_raw,
            "effective_time_dimension": effective_td.value,
            "organization_tag_names": tag_names_by_kpi.get(kpi.id, []),
            "entries": periods_out,
            "assigned_user_names": assigned_by_kpi.get(kpi.id, []),
            "assigned_role_names": assigned_role_names_by_kpi.get(kpi.id, []),
            "assigned_users": assigned_users_detail_by_kpi.get(kpi.id, []),
            "current_user_permission": current_user_permission_by_kpi.get(kpi.id) or "data_entry",
            "entry": None,
        }
        if primary_entry:
            field_values = list(primary_entry.field_values or [])
            card_ids = getattr(kpi, "card_display_field_ids", None)
            if isinstance(card_ids, list) and len(card_ids) > 0:
                id_to_fv = {fv.field_id: fv for fv in field_values if fv.field}
                preview = []
                for field_id in card_ids:
                    fv = id_to_fv.get(field_id)
                    if fv and fv.field:
                        preview.append({"field_name": fv.field.name, "value": _format_field_value(fv)})
            else:
                field_values.sort(key=lambda fv: (fv.field.sort_order if fv.field else 0, fv.field_id))
                preview = [{"field_name": fv.field.name, "value": _format_field_value(fv)} for fv in field_values[:2] if fv.field]
            entered_by_name = None
            if primary_entry.user:
                entered_by_name = (primary_entry.user.full_name or primary_entry.user.username or "").strip() or primary_entry.user.username
            assigned_ids = assigned_data_entry_ids_by_kpi.get(kpi.id, set())
            data_entry_user_is_assigned = primary_entry.user_id is not None and primary_entry.user_id in assigned_ids
            item["entry"] = {
                "id": primary_entry.id,
                "is_draft": primary_entry.is_draft,
                "is_locked": primary_entry.is_locked,
                "submitted_at": primary_entry.submitted_at.isoformat() if primary_entry.submitted_at else None,
                "preview": preview,
                "entered_by_user_name": entered_by_name,
                "last_updated_at": primary_entry.updated_at.isoformat() if primary_entry.updated_at else None,
                "data_entry_user_is_assigned": data_entry_user_is_assigned,
            }
        result.append(item)
    return result
