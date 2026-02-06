"""KPI entry API routes (data entry + admin lock)."""

from io import BytesIO
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.auth.dependencies import get_current_user, require_org_admin
from app.core.models import User, KPIEntry, KPIField, KPIFieldValue, KPI, FieldType
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
from app.kpis.service import sync_kpi_entry_from_api

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
        organization_id=entry.organization_id,
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


async def _load_multi_items_field(db: AsyncSession, org_id: int, field_id: int) -> KPIField | None:
    """Load a multi_line_items field with sub_fields, scoped to org."""
    res = await db.execute(
        select(KPIField)
        .join(KPI, KPI.id == KPIField.kpi_id)
        .where(KPIField.id == field_id, KPI.organization_id == org_id)
        .options(selectinload(KPIField.sub_fields))
    )
    field = res.scalar_one_or_none()
    if not field or field.field_type != FieldType.multi_line_items:
        return None
    return field


def _xlsx_bytes_for_multi_items_template(field: KPIField) -> bytes:
    """Create an empty Excel template for multi_line_items sub_fields."""
    # Import here so app can start even if optional dependency isn't installed yet.
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Items"

    sub_fields = list(field.sub_fields or [])
    # Header row uses sub-field keys (stable API identifiers).
    ws.append([s.key for s in sub_fields])
    # Empty sample row (user fills in).
    ws.append(["" for _ in sub_fields])

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _parse_multi_items_xlsx(content: bytes, field: KPIField) -> list[dict]:
    """Parse uploaded xlsx into list[dict[sub_key] = value] for the field's sub_fields."""
    from openpyxl import load_workbook

    wb = load_workbook(filename=BytesIO(content), data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    header = [str(x).strip() if x is not None else "" for x in rows[0]]
    key_to_idx = {k: i for i, k in enumerate(header) if k}
    allowed = {s.key: s for s in (field.sub_fields or [])}

    # Accept either key or name as column header (keys preferred).
    name_to_key = {s.name.strip(): s.key for s in (field.sub_fields or []) if s.name}

    def resolve_col_to_key(col: str) -> str | None:
        if col in allowed:
            return col
        if col in name_to_key:
            return name_to_key[col]
        return None

    out: list[dict] = []
    for r in rows[1:]:
        if r is None:
            continue
        item: dict = {}
        empty = True
        for col, idx in key_to_idx.items():
            key = resolve_col_to_key(col)
            if not key:
                continue
            raw = r[idx] if idx < len(r) else None
            if raw is None or raw == "":
                continue
            empty = False
            sf = allowed[key]
            if sf.field_type == FieldType.number:
                try:
                    item[key] = float(raw)
                except Exception:
                    # keep as string if can't coerce
                    item[key] = str(raw)
            elif sf.field_type == FieldType.boolean:
                if isinstance(raw, bool):
                    item[key] = raw
                else:
                    s = str(raw).strip().lower()
                    item[key] = s in ("1", "true", "yes", "y")
            elif sf.field_type == FieldType.date:
                # Store ISO date string (matches UI expectation for <input type=\"date\">)
                if hasattr(raw, "date"):
                    try:
                        item[key] = raw.date().isoformat()
                    except Exception:
                        item[key] = str(raw)
                else:
                    item[key] = str(raw)
            else:
                item[key] = str(raw)
        if not empty:
            out.append(item)
    return out


@router.get("/multi-items/template")
async def download_multi_items_template(
    field_id: int = Query(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download an empty Excel template for a multi_line_items field (any user who can edit this KPI)."""
    org_id = _org_id(current_user, organization_id)
    field = await _load_multi_items_field(db, org_id, field_id)
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Multi-item field not found")
    can_edit = await user_can_edit_kpi(db, current_user.id, field.kpi_id)
    if not can_edit:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to edit this KPI")

    content = _xlsx_bytes_for_multi_items_template(field)
    filename = f"multi_items_{field.key}_{field.id}.xlsx"
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/multi-items/upload")
async def upload_multi_items_excel(
    entry_id: int = Query(...),
    field_id: int = Query(...),
    append: bool = Query(False, description="If true, append rows; otherwise replace"),
    file: UploadFile = File(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload Excel and set/append multi_line_items value_json for an entry+field (any user who can edit this KPI)."""
    org_id = _org_id(current_user, organization_id)

    entry_res = await db.execute(
        select(KPIEntry).where(KPIEntry.id == entry_id, KPIEntry.organization_id == org_id)
    )
    entry = entry_res.scalar_one_or_none()
    if not entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    if entry.is_locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Entry is locked")

    field = await _load_multi_items_field(db, org_id, field_id)
    if field:
        can_edit = await user_can_edit_kpi(db, current_user.id, field.kpi_id)
        if not can_edit:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to edit this KPI")
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Multi-item field not found")
    if field.kpi_id != entry.kpi_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Field does not belong to entry KPI")

    content = await file.read()
    items = _parse_multi_items_xlsx(content, field)

    fv_res = await db.execute(
        select(KPIFieldValue).where(KPIFieldValue.entry_id == entry.id, KPIFieldValue.field_id == field.id)
    )
    fv = fv_res.scalar_one_or_none()
    if fv is None:
        fv = KPIFieldValue(entry_id=entry.id, field_id=field.id)
        db.add(fv)
    if append and isinstance(fv.value_json, list):
        fv.value_json = list(fv.value_json) + items
    else:
        fv.value_json = items
    entry.user_id = current_user.id  # track last editor (optional)
    await db.commit()

    return {"entry_id": entry.id, "field_id": field.id, "items": fv.value_json, "append": append}


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


@router.get("/kpi-api-info")
async def get_kpi_api_info(
    kpi_id: int = Query(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return entry_mode and api_endpoint_url for a KPI the current user can enter data for (for data entry page)."""
    org_id = _org_id(current_user, organization_id)
    can = await user_can_edit_kpi(db, current_user.id, kpi_id)
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to edit this KPI")
    res = await db.execute(select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id))
    kpi = res.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return {
        "entry_mode": getattr(kpi, "entry_mode", None) or "manual",
        "api_endpoint_url": getattr(kpi, "api_endpoint_url", None),
    }


@router.post("/sync-from-api")
async def entry_sync_from_api(
    kpi_id: int = Query(...),
    year: int = Query(..., ge=2000, le=2100),
    organization_id: int | None = Query(None),
    force_override: bool = Query(True, description="If true, overwrite existing entry data when API returns override_existing=false"),
    sync_mode: str = Query("override", description="override = replace existing; append = append API rows to multi_line_items (ignores API override_existing)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch entry data from the KPI's API endpoint. User must be allowed to edit this KPI."""
    org_id = _org_id(current_user, organization_id)
    can = await user_can_edit_kpi(db, current_user.id, kpi_id)
    if not can:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to edit this KPI")
    result = await sync_kpi_entry_from_api(
        db, kpi_id, org_id, year, current_user.id, force_override=force_override, sync_mode=sync_mode
    )
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="KPI not found, not in API mode, API endpoint not set, or API call failed",
        )
    await db.commit()
    return result


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
            "sub_fields": [
                {"id": s.id, "field_id": s.field_id, "name": s.name, "key": s.key, "field_type": s.field_type.value, "is_required": s.is_required, "sort_order": s.sort_order}
                for s in (getattr(f, "sub_fields", None) or [])
            ],
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
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit entry (no longer draft)."""
    org_id = _org_id(current_user, organization_id)
    entry = await submit_entry(db, body.entry_id, current_user.id, org_id)
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
