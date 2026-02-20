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
    user_can_view_kpi,
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
    """Return entry_mode, api_endpoint_url, and can_edit for a KPI the current user can view (view or data_entry)."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not assigned to this KPI")
    can_edit = await user_can_edit_kpi(db, current_user.id, kpi_id)
    res = await db.execute(select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id))
    kpi = res.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    return {
        "entry_mode": getattr(kpi, "entry_mode", None) or "manual",
        "api_endpoint_url": getattr(kpi, "api_endpoint_url", None),
        "can_edit": can_edit,
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
    """List fields for a KPI the current user can view or enter data for (USER: assigned with view or data_entry)."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
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


def _excel_sheet_name(name: str, max_len: int = 31) -> str:
    """Sanitize sheet name for Excel (max 31 chars; no : \\ / ? * [ ])."""
    invalid = ":\\/?*[]"
    out = "".join(c if c not in invalid else "_" for c in (name or "Sheet"))
    return out[:max_len].strip() or "Sheet"


def _build_kpi_entry_xlsx(
    kpi_name: str,
    year: int,
    org_id: int,
    fields: list,
    entry,
) -> bytes:
    """Build Excel workbook: one sheet for scalar fields, one sheet per multi_line_items field."""
    from openpyxl import Workbook

    wb = Workbook()
    value_by_field_id = {}
    if entry and getattr(entry, "field_values", None):
        for fv in entry.field_values:
            value_by_field_id[fv.field_id] = fv

    # --- Sheet 1: Scalar (and formula) fields ---
    scalar_types = (
        FieldType.single_line_text,
        FieldType.multi_line_text,
        FieldType.number,
        FieldType.date,
        FieldType.boolean,
        FieldType.formula,
    )
    scalar_fields = [f for f in fields if getattr(f, "field_type", None) in scalar_types]
    ws_scalar = wb.active
    ws_scalar.title = _excel_sheet_name("KPI Data")
    ws_scalar.append(["Field", "Value"])
    for f in scalar_fields:
        fv = value_by_field_id.get(f.id)
        if fv is None:
            ws_scalar.append([f.name, ""])
            continue
        if fv.value_text is not None:
            val = fv.value_text
        elif fv.value_number is not None:
            val = fv.value_number
        elif fv.value_boolean is not None:
            val = "Yes" if fv.value_boolean else "No"
        elif fv.value_date is not None:
            val = str(fv.value_date)[:10] if fv.value_date else ""
        elif fv.value_json is not None:
            val = str(fv.value_json)[:500]
        else:
            val = ""
        ws_scalar.append([f.name, val])

    # --- One sheet per multi_line_items field ---
    multi_fields = [f for f in fields if getattr(f, "field_type", None) == FieldType.multi_line_items]
    for idx, f in enumerate(multi_fields):
        sub_fields = list(getattr(f, "sub_fields", None) or [])
        keys = [s.key for s in sub_fields]
        if not keys:
            keys = ["value"]
        sheet_name = _excel_sheet_name(f.name) or f"Table_{idx + 1}"
        if sheet_name in [s.title for s in wb.worksheets]:
            sheet_name = _excel_sheet_name(f"{f.name}_{idx}") or f"Table_{idx + 1}"
        ws = wb.create_sheet(title=sheet_name)
        ws.append(keys)
        fv = value_by_field_id.get(f.id)
        rows = list(fv.value_json) if (fv and isinstance(getattr(fv, "value_json", None), list)) else []
        for row in rows:
            if not isinstance(row, dict):
                ws.append([""] * len(keys))
                continue
            ws.append([row.get(k, "") for k in keys])

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


@router.get("/export-excel")
async def export_entry_excel(
    kpi_id: int = Query(...),
    year: int = Query(..., ge=2000, le=2100),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Download KPI entry data as Excel: scalar fields in one sheet, each multi_line_items in its own sheet."""
    org_id = _org_id(current_user, organization_id)
    can_view = await user_can_view_kpi(db, current_user.id, kpi_id)
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this KPI")
    kpi_res = await db.execute(
        select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id)
    )
    kpi = kpi_res.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    fields = await list_kpi_fields_service(db, kpi_id, org_id)
    entry_res = await db.execute(
        select(KPIEntry)
        .where(
            KPIEntry.kpi_id == kpi_id,
            KPIEntry.organization_id == org_id,
            KPIEntry.year == year,
        )
        .options(selectinload(KPIEntry.field_values).selectinload(KPIFieldValue.field))
    )
    entry = entry_res.scalar_one_or_none()
    xlsx_bytes = _build_kpi_entry_xlsx(
        kpi_name=getattr(kpi, "name", "") or f"KPI_{kpi_id}",
        year=year,
        org_id=org_id,
        fields=fields,
        entry=entry,
    )
    filename = f"KPI_{kpi_id}_{year}_org{org_id}.xlsx"
    return StreamingResponse(
        iter([xlsx_bytes]),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _parse_kpi_entry_xlsx(
    content: bytes,
    fields: list,
) -> dict[int, dict]:
    """Parse uploaded Excel into field values. Returns {field_id: {value_text, value_number, value_boolean, value_date, value_json}}."""
    from openpyxl import load_workbook

    wb = load_workbook(filename=BytesIO(content), data_only=True)
    result: dict[int, dict] = {}

    # Build lookup from field name -> field
    name_to_field = {f.name.strip().lower(): f for f in fields}
    sheet_name_to_field = {}
    for f in fields:
        if getattr(f, "field_type", None) == FieldType.multi_line_items:
            sanitized = _excel_sheet_name(f.name).lower()
            sheet_name_to_field[sanitized] = f

    # Parse scalar sheet ("KPI Data")
    scalar_sheet = None
    for ws in wb.worksheets:
        if ws.title.lower() == "kpi data":
            scalar_sheet = ws
            break
    if not scalar_sheet and wb.worksheets:
        scalar_sheet = wb.worksheets[0]

    if scalar_sheet:
        rows = list(scalar_sheet.iter_rows(values_only=True))
        for row in rows[1:]:  # skip header
            if not row or len(row) < 2:
                continue
            field_name = str(row[0]).strip().lower() if row[0] else ""
            raw_value = row[1]
            field = name_to_field.get(field_name)
            if not field:
                continue
            ft = getattr(field, "field_type", None)
            if ft == FieldType.formula:
                continue  # skip formula fields on upload
            if ft == FieldType.multi_line_items:
                continue  # handled separately
            val: dict = {}
            if raw_value is None or raw_value == "":
                pass
            elif ft == FieldType.number:
                try:
                    val["value_number"] = float(raw_value)
                except (TypeError, ValueError):
                    val["value_text"] = str(raw_value)
            elif ft == FieldType.boolean:
                if isinstance(raw_value, bool):
                    val["value_boolean"] = raw_value
                else:
                    s = str(raw_value).strip().lower()
                    val["value_boolean"] = s in ("1", "true", "yes", "y")
            elif ft == FieldType.date:
                if hasattr(raw_value, "date"):
                    try:
                        val["value_date"] = raw_value.date().isoformat()
                    except Exception:
                        val["value_text"] = str(raw_value)
                else:
                    val["value_text"] = str(raw_value)
            else:
                val["value_text"] = str(raw_value) if raw_value is not None else None
            result[field.id] = val

    # Parse multi_line_items sheets
    for ws in wb.worksheets:
        title_lower = ws.title.lower()
        if title_lower == "kpi data":
            continue
        field = sheet_name_to_field.get(title_lower)
        if not field:
            # Try matching by prefix
            for sn, f in sheet_name_to_field.items():
                if title_lower.startswith(sn[:20]):
                    field = f
                    break
        if not field:
            continue
        sub_fields = list(getattr(field, "sub_fields", None) or [])
        key_to_sf = {s.key: s for s in sub_fields}
        name_to_sf = {s.name.strip().lower(): s for s in sub_fields}
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            continue
        header = [str(c).strip() if c else "" for c in rows[0]]
        col_to_key: list[str | None] = []
        for col in header:
            col_lower = col.lower()
            if col in key_to_sf:
                col_to_key.append(col)
            elif col_lower in name_to_sf:
                col_to_key.append(name_to_sf[col_lower].key)
            else:
                col_to_key.append(None)
        items: list[dict] = []
        for row in rows[1:]:
            if not row:
                continue
            item: dict = {}
            empty = True
            for i, raw in enumerate(row):
                if i >= len(col_to_key):
                    continue
                key = col_to_key[i]
                if not key:
                    continue
                if raw is None or raw == "":
                    continue
                empty = False
                sf = key_to_sf.get(key)
                sf_type = sf.field_type if sf else "single_line_text"
                if sf_type == FieldType.number or sf_type == "number":
                    try:
                        item[key] = float(raw)
                    except (TypeError, ValueError):
                        item[key] = str(raw)
                elif sf_type == FieldType.boolean or sf_type == "boolean":
                    if isinstance(raw, bool):
                        item[key] = raw
                    else:
                        s = str(raw).strip().lower()
                        item[key] = s in ("1", "true", "yes", "y")
                elif sf_type == FieldType.date or sf_type == "date":
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
                items.append(item)
        result[field.id] = {"value_json": items}

    return result


@router.post("/import-excel")
async def import_entry_excel(
    kpi_id: int = Query(...),
    year: int = Query(..., ge=2000, le=2100),
    organization_id: int | None = Query(None),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload KPI entry data from Excel (same format as download). Auth: Org Admin or data_entry for this KPI."""
    org_id = _org_id(current_user, organization_id)
    can_edit = await user_can_edit_kpi(db, current_user.id, kpi_id)
    if not can_edit:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No edit access to this KPI")
    kpi_res = await db.execute(
        select(KPI).where(KPI.id == kpi_id, KPI.organization_id == org_id)
    )
    kpi = kpi_res.scalar_one_or_none()
    if not kpi:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="KPI not found")
    fields = await list_kpi_fields_service(db, kpi_id, org_id)
    content = await file.read()
    try:
        parsed = _parse_kpi_entry_xlsx(content, fields)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Failed to parse Excel: {e}")
    # Get or create entry
    entry, _ = await get_or_create_entry(db, current_user.id, org_id, kpi_id, year)
    if not entry:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="KPI not in organization")
    if entry.is_locked:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Entry is locked")
    # Build FieldValueInput list
    from app.entries.schemas import FieldValueInput
    values = []
    for field in fields:
        if field.id not in parsed:
            continue
        data = parsed[field.id]
        values.append(
            FieldValueInput(
                field_id=field.id,
                value_text=data.get("value_text"),
                value_number=data.get("value_number"),
                value_boolean=data.get("value_boolean"),
                value_date=data.get("value_date"),
                value_json=data.get("value_json"),
            )
        )
    await save_entry_values(db, entry.id, current_user.id, values, kpi_id, org_id)
    await db.commit()
    await db.refresh(entry)
    return {"message": "Import successful", "entry_id": entry.id, "fields_updated": len(values)}


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
    """Submit entry (no longer draft). User must have data_entry permission."""
    org_id = _org_id(current_user, organization_id)
    ent = await db.execute(select(KPIEntry).where(KPIEntry.id == body.entry_id, KPIEntry.organization_id == org_id))
    entry_row = ent.scalar_one_or_none()
    if not entry_row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entry not found")
    can_edit = await user_can_edit_kpi(db, current_user.id, entry_row.kpi_id)
    if not can_edit:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to edit this KPI")
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
