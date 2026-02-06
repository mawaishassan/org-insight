"""KPI entry CRUD, submit, lock; formula evaluation for formula fields."""

from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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


async def user_can_edit_kpi(db: AsyncSession, user_id: int, kpi_id: int) -> bool:
    """Check if user is assigned to KPI or is org admin."""
    result = await db.execute(
        select(User).where(User.id == user_id)
    )
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
        return str(fv.value_json)[:80]
    return ""


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
        .options(selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field))
    )
    res = await db.execute(q)
    return res.scalar_one_or_none()


async def list_entries_overview(
    db: AsyncSession, user_id: int, org_id: int, year: int, as_admin: bool = False
) -> list[dict]:
    """
    For the given year, return KPIs with entry status and first 2 field preview.
    One entry per organization per KPI per year.
    """
    kpis = await list_available_kpis(db, user_id, org_id)
    result = []
    for kpi in kpis:
        entry = await _get_entry_for_overview(db, org_id, kpi.id, year)
        item = {
            "kpi_id": kpi.id,
            "kpi_name": kpi.name,
            "kpi_year": kpi.year,
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
            item["entry"] = {
                "id": entry.id,
                "is_draft": entry.is_draft,
                "is_locked": entry.is_locked,
                "submitted_at": entry.submitted_at.isoformat() if entry.submitted_at else None,
                "preview": preview,
            }
        result.append(item)
    return result
