"""KPI field CRUD with tenant isolation via KPI -> domain -> org."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.models import KPIField, KPIFieldOption, KPI, Domain
from app.fields.schemas import KPIFieldCreate, KPIFieldUpdate, KPIFieldOptionCreate


async def _kpi_org_id(db: AsyncSession, kpi_id: int) -> int | None:
    """Return organization_id for KPI or None."""
    result = await db.execute(
        select(Domain.organization_id).join(KPI, KPI.domain_id == Domain.id).where(KPI.id == kpi_id)
    )
    row = result.one_or_none()
    return row[0] if row else None


async def create_field(db: AsyncSession, org_id: int, data: KPIFieldCreate) -> KPIField | None:
    """Create KPI field (KPI must belong to org)."""
    if await _kpi_org_id(db, data.kpi_id) != org_id:
        return None
    field = KPIField(
        kpi_id=data.kpi_id,
        name=data.name,
        key=data.key,
        field_type=data.field_type,
        formula_expression=data.formula_expression,
        is_required=data.is_required,
        sort_order=data.sort_order,
        config=data.config,
    )
    db.add(field)
    await db.flush()
    for i, opt in enumerate(data.options):
        db.add(
            KPIFieldOption(
                field_id=field.id,
                value=opt.value,
                label=opt.label,
                sort_order=opt.sort_order if opt.sort_order else i,
            )
        )
    await db.flush()
    return field


async def get_field(db: AsyncSession, field_id: int, org_id: int) -> KPIField | None:
    """Get field by id; KPI must belong to org."""
    result = await db.execute(
        select(KPIField)
        .join(KPIField.kpi)
        .join(KPI.domain)
        .where(KPIField.id == field_id, Domain.organization_id == org_id)
        .options(selectinload(KPIField.options))
    )
    return result.scalar_one_or_none()


async def list_fields(db: AsyncSession, kpi_id: int, org_id: int) -> list[KPIField]:
    """List fields for KPI (KPI must belong to org)."""
    result = await db.execute(
        select(KPIField)
        .join(KPIField.kpi)
        .join(KPI.domain)
        .where(KPIField.kpi_id == kpi_id, Domain.organization_id == org_id)
        .order_by(KPIField.sort_order, KPIField.id)
        .options(selectinload(KPIField.options))
    )
    return list(result.scalars().all())


async def update_field(
    db: AsyncSession, field_id: int, org_id: int, data: KPIFieldUpdate
) -> KPIField | None:
    """Update field; optionally replace options."""
    field = await get_field(db, field_id, org_id)
    if not field:
        return None
    if data.name is not None:
        field.name = data.name
    if data.key is not None:
        field.key = data.key
    if data.field_type is not None:
        field.field_type = data.field_type
    if data.formula_expression is not None:
        field.formula_expression = data.formula_expression
    if data.is_required is not None:
        field.is_required = data.is_required
    if data.sort_order is not None:
        field.sort_order = data.sort_order
    if data.config is not None:
        field.config = data.config
    if data.options is not None:
        await db.execute(delete(KPIFieldOption).where(KPIFieldOption.field_id == field_id))
        for i, opt in enumerate(data.options):
            db.add(
                KPIFieldOption(
                    field_id=field_id,
                    value=opt.value,
                    label=opt.label,
                    sort_order=opt.sort_order if opt.sort_order else i,
                )
            )
    await db.flush()
    return field


async def delete_field(db: AsyncSession, field_id: int, org_id: int) -> bool:
    """Delete field."""
    field = await get_field(db, field_id, org_id)
    if not field:
        return False
    await db.delete(field)
    await db.flush()
    return True
