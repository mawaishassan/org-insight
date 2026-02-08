"""KPI entry CRUD, submit, lock; formula evaluation for formula fields."""

from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.core.models import (
    KPIEntry,
    KPIFieldValue,
    KPIField,
    KPI,
    KPIAssignment,
    User,
)
from app.core.models import FieldType

# Type for multi_line_items data passed to formula evaluator
MultiLineItemsData = dict[str, list[dict]]
from app.entries.schemas import FieldValueInput, EntryCreate
from app.formula_engine.evaluator import evaluate_formula, OtherKpiValues


async def _resolve_org_and_kpi(db: AsyncSession, kpi_id: int) -> int | None:
    """Return organization_id for KPI or None (KPI has organization_id directly)."""
    result = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
    row = result.one_or_none()
    return row[0] if row else None


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


async def get_or_create_entry(
    db: AsyncSession, user_id: int, org_id: int, kpi_id: int, year: int
) -> tuple[KPIEntry | None, bool]:
    """Get existing entry or create new one (one per organization per KPI per year). Returns (entry, created)."""
    result = await db.execute(
        select(KPIEntry).where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == year,
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
        is_draft=True,
    )
    db.add(entry)
    await db.flush()
    return entry, True


def _assignment_type_value(a) -> str:
    """Return assignment_type as string (handles enum or string column)."""
    t = getattr(a, "assignment_type", None)
    if t is None:
        return "data_entry"
    return t.value if hasattr(t, "value") else str(t)


async def user_can_view_kpi(db: AsyncSession, user_id: int, kpi_id: int) -> bool:
    """Check if user can view KPI (org/super admin or has any assignment: view or data_entry)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    result = await db.execute(
        select(KPIAssignment).where(
            KPIAssignment.user_id == user_id,
            KPIAssignment.kpi_id == kpi_id,
        )
    )
    return result.scalar_one_or_none() is not None


async def user_can_edit_kpi(db: AsyncSession, user_id: int, kpi_id: int) -> bool:
    """Check if user can edit KPI (org/super admin or has data_entry assignment)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        return True
    result = await db.execute(
        select(KPIAssignment).where(
            KPIAssignment.user_id == user_id,
            KPIAssignment.kpi_id == kpi_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return False
    return _assignment_type_value(row) == "data_entry"


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
    """Return KPIs the user can enter data for (assigned KPIs for USER, all org KPIs for ORG_ADMIN/SUPER_ADMIN)."""
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return []
    if user.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        q = select(KPI).where(KPI.organization_id == org_id).order_by(KPI.year.desc(), KPI.name)
        res = await db.execute(q)
        return list(res.scalars().all())
    # USER: only assigned KPIs
    q = (
        select(KPI)
        .join(KPIAssignment, KPIAssignment.kpi_id == KPI.id)
        .where(KPIAssignment.user_id == user_id)
        .order_by(KPI.year.desc(), KPI.name)
    )
    res = await db.execute(q)
    return list(res.scalars().all())


async def list_entries(
    db: AsyncSession,
    user_id: int,
    org_id: int,
    kpi_id: int | None = None,
    year: int | None = None,
    as_admin: bool = False,
) -> list[KPIEntry]:
    """List entries for org (one per KPI per year). Non-admin: only KPIs the user is assigned to."""
    q = select(KPIEntry).where(KPIEntry.organization_id == org_id)
    if kpi_id is not None:
        q = q.where(KPIEntry.kpi_id == kpi_id)
    if year is not None:
        q = q.where(KPIEntry.year == year)
    if not as_admin:
        # Restrict to KPIs the user is assigned to
        q = q.join(
            KPIAssignment,
            (KPIAssignment.kpi_id == KPIEntry.kpi_id) & (KPIAssignment.user_id == user_id),
        )
    q = q.order_by(KPIEntry.year.desc(), KPIEntry.kpi_id)
    q = q.options(selectinload(KPIEntry.field_values))
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
    missing_kpis = [
        {
            "kpi_id": kid,
            "kpi_name": kpis.get(kid).name if kpis.get(kid) else "",
            "assigned_user_names": assignees_by_kpi.get(kid, []),
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


async def _get_entry_for_overview(
    db: AsyncSession, org_id: int, kpi_id: int, year: int
) -> KPIEntry | None:
    """Load the single entry (org/kpi/year) with field_values and field for overview preview."""
    q = (
        select(KPIEntry)
        .where(
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.year == year,
        )
        .options(
            selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field),
            selectinload(KPIEntry.user),
        )
    )
    res = await db.execute(q)
    return res.scalar_one_or_none()


async def list_entries_overview(
    db: AsyncSession, user_id: int, org_id: int, year: int, as_admin: bool = False
) -> list[dict]:
    """
    For the given year, return KPIs with entry status and first 2 field preview.
    One entry per organization per KPI per year. Includes last data entry user and assigned users.
    """
    kpis = await list_available_kpis(db, user_id, org_id)
    kpi_ids = [k.id for k in kpis]
    # Load assigned users per KPI with permission (data_entry vs view); data_entry-only for "assigned" label
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
    # Org admin / super admin see all KPIs with data_entry permission (no assignment row)
    user_res = await db.execute(select(User).where(User.id == user_id))
    current_user_obj = user_res.scalar_one_or_none()
    if current_user_obj and current_user_obj.role.value in ("ORG_ADMIN", "SUPER_ADMIN"):
        for kid in kpi_ids:
            current_user_permission_by_kpi[kid] = "data_entry"
    result = []
    for kpi in kpis:
        entry = await _get_entry_for_overview(db, org_id, kpi.id, year)
        item = {
            "kpi_id": kpi.id,
            "kpi_name": kpi.name,
            "kpi_year": kpi.year,
            "assigned_user_names": assigned_by_kpi.get(kpi.id, []),
            "assigned_users": assigned_users_detail_by_kpi.get(kpi.id, []),
            "current_user_permission": current_user_permission_by_kpi.get(kpi.id) or "data_entry",
            "entry": None,
        }
        if entry:
            field_values = list(entry.field_values or [])
            card_ids = getattr(kpi, "card_display_field_ids", None)
            if isinstance(card_ids, list) and len(card_ids) > 0:
                # Show only selected fields in configured order
                id_to_fv = {fv.field_id: fv for fv in field_values if fv.field}
                preview = []
                for field_id in card_ids:
                    fv = id_to_fv.get(field_id)
                    if fv and fv.field:
                        preview.append({
                            "field_name": fv.field.name,
                            "value": _format_field_value(fv),
                        })
            else:
                # Fallback: first 2 fields by sort_order
                field_values.sort(key=lambda fv: (fv.field.sort_order if fv.field else 0, fv.field_id))
                preview = []
                for fv in field_values[:2]:
                    if fv.field:
                        preview.append({
                            "field_name": fv.field.name,
                            "value": _format_field_value(fv),
                        })
            entered_by_name = None
            if entry.user:
                entered_by_name = (entry.user.full_name or entry.user.username or "").strip() or entry.user.username
            assigned_ids = assigned_data_entry_ids_by_kpi.get(kpi.id, set())
            data_entry_user_is_assigned = entry.user_id is not None and entry.user_id in assigned_ids
            item["entry"] = {
                "id": entry.id,
                "is_draft": entry.is_draft,
                "is_locked": entry.is_locked,
                "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
                "preview": preview,
                "entered_by_user_name": entered_by_name,
                "last_updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
                "data_entry_user_is_assigned": data_entry_user_is_assigned,
            }
        result.append(item)
    return result
