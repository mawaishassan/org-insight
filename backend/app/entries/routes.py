"""KPI entry API routes (data entry + admin lock)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin
from app.core.models import User
from app.entries.schemas import EntryCreate, EntrySubmit, EntryLock, EntryResponse, FieldValueResponse
from app.entries.service import (
    get_or_create_entry,
    user_can_edit_kpi,
    save_entry_values,
    submit_entry,
    lock_entry,
    list_entries,
    list_available_kpis,
    list_entries_overview,
)
from app.fields.service import list_fields as list_kpi_fields_service

router = APIRouter(prefix="/entries", tags=["entries"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


def _entry_to_response(entry):
    return EntryResponse(
        id=entry.id,
        kpi_id=entry.kpi_id,
        user_id=entry.user_id,
        year=entry.year,
        is_draft=entry.is_draft,
        is_locked=entry.is_locked,
        submitted_at=entry.submitted_at,
        values=[
            FieldValueResponse(
                field_id=fv.field_id,
                value_text=fv.value_text,
                value_number=fv.value_number,
                value_json=fv.value_json,
                value_boolean=fv.value_boolean,
                value_date=fv.value_date,
            )
            for fv in (entry.field_values or [])
        ],
    )


@router.get("/overview")
async def get_entries_overview(
    year: int = Query(..., ge=2000, le=2100),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List KPIs with entry status and first 2 field preview. For admins, shows assigned user's entry (same source as data entry operator)."""
    org_id = _org_id(current_user, organization_id)
    as_admin = current_user.role.value in ("ORG_ADMIN", "SUPER_ADMIN")
    items = await list_entries_overview(db, current_user.id, org_id, year, as_admin=as_admin)
    return items


@router.get("/available-kpis")
async def get_available_kpis(
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List KPIs the current user can enter data for (assigned KPIs or all org KPIs for admin)."""
    org_id = _org_id(current_user, organization_id)
    kpis = await list_available_kpis(db, current_user.id, org_id)
    return [{"id": k.id, "name": k.name, "year": k.year, "domain_id": k.domain_id} for k in kpis]


@router.get("/fields")
async def get_entry_fields(
    kpi_id: int = Query(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List fields for a KPI the current user can enter data for (so USER can load form for assigned KPIs)."""
    org_id = _org_id(current_user, organization_id)
    can = await user_can_edit_kpi(db, current_user.id, kpi_id)
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this KPI")
    fields = await list_kpi_fields_service(db, kpi_id, org_id)
    return [
        {
            "id": f.id,
            "kpi_id": f.kpi_id,
            "name": f.name,
            "key": f.key,
            "field_type": f.field_type.value,
            "formula_expression": f.formula_expression,
            "is_required": f.is_required,
            "sort_order": f.sort_order,
            "options": [{"value": o.value, "label": o.label} for o in (f.options or [])],
        }
        for f in fields
    ]


@router.get("", response_model=list[EntryResponse])
async def list_my_entries(
    kpi_id: int | None = Query(None),
    year: int | None = Query(None),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List entries for current user; org admin can list all org entries with organization_id."""
    org_id = _org_id(current_user, organization_id)
    as_admin = current_user.role.value in ("ORG_ADMIN", "SUPER_ADMIN")
    entries = await list_entries(db, current_user.id, org_id, kpi_id=kpi_id, year=year, as_admin=as_admin)
    return [_entry_to_response(e) for e in entries]


@router.post("", response_model=EntryResponse, status_code=status.HTTP_201_CREATED)
async def create_or_update_entry(
    body: EntryCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or get entry and save values (draft). User must be assigned to KPI."""
    org_id = _org_id(current_user, organization_id)
    can = await user_can_edit_kpi(db, current_user.id, body.kpi_id)
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this KPI")
    entry, _ = await get_or_create_entry(db, current_user.id, org_id, body.kpi_id, body.year)
    if not entry:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="KPI not in organization")
    await save_entry_values(db, entry.id, current_user.id, body.values, body.kpi_id, org_id)
    await db.commit()
    await db.refresh(entry)
    entry.field_values  # load
    return _entry_to_response(entry)


@router.post("/submit", response_model=EntryResponse)
async def submit_entry_route(
    body: EntrySubmit,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit entry (no longer draft)."""
    entry = await submit_entry(db, body.entry_id, current_user.id)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found or locked")
    await db.commit()
    await db.refresh(entry)
    entry.field_values
    return _entry_to_response(entry)


@router.post("/lock", response_model=EntryResponse)
async def lock_entry_route(
  body: EntryLock,
  organization_id: int | None = Query(None),
  db: AsyncSession = Depends(get_db),
  current_user: User = Depends(require_org_admin),
):
    """Lock or unlock entry (Org Admin)."""
    org_id = _org_id(current_user, organization_id)
    entry = await lock_entry(db, body.entry_id, org_id, body.is_locked)
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    await db.commit()
    await db.refresh(entry)
    entry.field_values
    return _entry_to_response(entry)
