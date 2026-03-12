"""KPI field API routes (Org Admin)."""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, distinct
from pydantic import BaseModel

from app.core.database import get_db
from app.auth.dependencies import require_org_admin, get_current_user, require_tenant
from app.core.models import User, KPIField, KPIFieldValue, KPI, KPIEntry
from app.core.models import FieldType
from app.fields.schemas import KPIFieldCreate, KPIFieldUpdate, KPIFieldResponse, KPIFieldOptionResponse, KPIFieldSubFieldResponse, KPIFieldChildDataSummary
from app.fields.service import create_field, get_field, list_fields, update_field, delete_field, get_field_child_data_summary

router = APIRouter(prefix="/fields", tags=["fields"])


def _org_id(user: User, org_id_param: int | None) -> int:
    if org_id_param is not None and user.role.value == "SUPER_ADMIN":
        return org_id_param
    if user.organization_id is not None:
        return user.organization_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Organization required")


def _field_to_response(f):
    """Build KPIFieldResponse with options and sub_fields."""
    return KPIFieldResponse(
        id=f.id,
        kpi_id=f.kpi_id,
        name=f.name,
        key=f.key,
        field_type=f.field_type,
        formula_expression=f.formula_expression,
        is_required=f.is_required,
        sort_order=f.sort_order,
        config=f.config,
        options=[KPIFieldOptionResponse.model_validate(o) for o in (f.options or [])],
        sub_fields=[KPIFieldSubFieldResponse.model_validate(s) for s in (getattr(f, "sub_fields", None) or [])],
    )


class ReferenceAllowedValuesResponse(BaseModel):
    values: list[str]


@router.get("/reference-allowed-values", response_model=ReferenceAllowedValuesResponse)
async def get_reference_allowed_values(
    source_kpi_id: int = Query(..., description="KPI id of the source field"),
    source_field_key: str = Query(..., description="Field key of the source field"),
    source_sub_field_key: str | None = Query(None, description="Sub-field key when source is multi_line_items"),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    _: User = Depends(require_tenant),
):
    """Return distinct values from a source KPI field (or multi_line_items sub-field) for reference/lookup dropdown."""
    org_id = _org_id(current_user, organization_id)
    from app.entries.service import get_reference_allowed_values as get_allowed
    values = await get_allowed(db, source_kpi_id, source_field_key, org_id, source_sub_field_key)
    return ReferenceAllowedValuesResponse(values=values)


@router.get("", response_model=list[KPIFieldResponse])
async def list_kpi_fields(
    kpi_id: int = Query(...),
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """List fields for a KPI."""
    org_id = _org_id(current_user, organization_id)
    fields = await list_fields(db, kpi_id, org_id)
    return [_field_to_response(f) for f in fields]


@router.post("", response_model=KPIFieldResponse, status_code=status.HTTP_201_CREATED)
async def create_kpi_field(
    body: KPIFieldCreate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Create KPI field."""
    org_id = _org_id(current_user, organization_id)
    field = await create_field(db, org_id, body)
    if not field:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="KPI not in organization")
    await db.commit()
    field = await get_field(db, field.id, org_id)
    return _field_to_response(field)


@router.get("/{field_id}", response_model=KPIFieldResponse)
async def get_kpi_field(
    field_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Get field by id."""
    org_id = _org_id(current_user, organization_id)
    field = await get_field(db, field_id, org_id)
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
    return _field_to_response(field)


@router.patch("/{field_id}", response_model=KPIFieldResponse)
async def update_kpi_field(
    field_id: int,
    body: KPIFieldUpdate,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Update KPI field."""
    org_id = _org_id(current_user, organization_id)
    field = await update_field(db, field_id, org_id, body)
    if not field:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
    await db.commit()
    field = await get_field(db, field_id, org_id)
    return _field_to_response(field)


@router.get("/{field_id}/child_data_summary", response_model=KPIFieldChildDataSummary)
async def get_field_child_data(
    field_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Return counts of child records (field values, report template refs) for delete confirmation."""
    org_id = _org_id(current_user, organization_id)
    summary = await get_field_child_data_summary(db, field_id, org_id)
    if summary is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
    return KPIFieldChildDataSummary(**summary)


@router.delete("/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_kpi_field(
    field_id: int,
    organization_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_org_admin),
):
    """Delete KPI field and all child records (stored values, report template refs)."""
    org_id = _org_id(current_user, organization_id)
    ok = await delete_field(db, field_id, org_id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Field not found")
    await db.commit()
