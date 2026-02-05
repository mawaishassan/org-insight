"""Report template CRUD, KPI/field selection, access control, and report generation."""

from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.models import (
    ReportTemplate,
    ReportTemplateKPI,
    ReportTemplateField,
    ReportAccessPermission,
    KPI,
    KPIField,
    KPIEntry,
    KPIFieldValue,
    Domain,
)
from app.reports.schemas import ReportTemplateCreate, ReportTemplateUpdate, ReportTemplateKPIAdd
from app.formula_engine.evaluator import evaluate_formula
from app.core.models import FieldType
from app.entries.service import _load_other_kpi_values


async def create_report_template(
    db: AsyncSession, org_id: int, data: ReportTemplateCreate
) -> ReportTemplate:
    """Create report template."""
    rt = ReportTemplate(
        organization_id=org_id,
        name=data.name,
        description=data.description,
        year=data.year,
    )
    db.add(rt)
    await db.flush()
    return rt


async def get_report_template(
    db: AsyncSession, template_id: int, org_id: int
) -> ReportTemplate | None:
    """Get report template by id within org."""
    result = await db.execute(
        select(ReportTemplate).where(
            ReportTemplate.id == template_id,
            ReportTemplate.organization_id == org_id,
        )
    )
    return result.scalar_one_or_none()


async def list_report_templates(
    db: AsyncSession, org_id: int, year: int | None = None
) -> list[ReportTemplate]:
    """List report templates in organization."""
    q = select(ReportTemplate).where(ReportTemplate.organization_id == org_id)
    if year is not None:
        q = q.where(ReportTemplate.year == year)
    q = q.order_by(ReportTemplate.name)
    result = await db.execute(q)
    return list(result.scalars().all())


async def update_report_template(
    db: AsyncSession, template_id: int, org_id: int, data: ReportTemplateUpdate
) -> ReportTemplate | None:
    """Update report template."""
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    if data.name is not None:
        rt.name = data.name
    if data.description is not None:
        rt.description = data.description
    if data.year is not None:
        rt.year = data.year
    await db.flush()
    return rt


async def add_kpi_to_template(
    db: AsyncSession, template_id: int, org_id: int, data: ReportTemplateKPIAdd
) -> ReportTemplateKPI | None:
    """Add KPI to report template with optional field selection."""
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    # Verify KPI belongs to org
    result = await db.execute(
        select(KPI).join(KPI.domain).where(KPI.id == data.kpi_id, Domain.organization_id == org_id)
    )
    if result.scalar_one_or_none() is None:
        return None
    rtk = ReportTemplateKPI(
        report_template_id=template_id,
        kpi_id=data.kpi_id,
        include_all_fields=data.include_all_fields,
        sort_order=data.sort_order,
    )
    db.add(rtk)
    await db.flush()
    if not data.include_all_fields and data.field_ids:
        for i, fid in enumerate(data.field_ids):
            db.add(
                ReportTemplateField(
                    report_template_kpi_id=rtk.id,
                    kpi_field_id=fid,
                    sort_order=i,
                )
            )
    await db.flush()
    return rtk


async def remove_kpi_from_template(
    db: AsyncSession, template_id: int, org_id: int, report_template_kpi_id: int
) -> bool:
    """Remove KPI from report template."""
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return False
    result = await db.execute(
        select(ReportTemplateKPI).where(
            ReportTemplateKPI.id == report_template_kpi_id,
            ReportTemplateKPI.report_template_id == template_id,
        )
    )
    rtk = result.scalar_one_or_none()
    if not rtk:
        return False
    await db.delete(rtk)
    await db.flush()
    return True


async def assign_report_to_user(
    db: AsyncSession,
    template_id: int,
    org_id: int,
    user_id: int,
    can_view: bool = True,
    can_print: bool = True,
    can_export: bool = True,
) -> ReportAccessPermission | None:
    """Assign report template to user."""
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    perm = ReportAccessPermission(
        report_template_id=template_id,
        user_id=user_id,
        can_view=can_view,
        can_print=can_print,
        can_export=can_export,
    )
    db.add(perm)
    await db.flush()
    return perm


async def user_can_access_report(
    db: AsyncSession, user_id: int, template_id: int, action: str = "view"
) -> bool:
    """Check if user can view/print/export report. Org admin can always access org reports."""
    from app.core.models import User

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return False
    if user.role.value == "SUPER_ADMIN":
        result = await db.execute(select(ReportTemplate).where(ReportTemplate.id == template_id))
        if result.scalar_one_or_none():
            return True
    if user.role.value == "ORG_ADMIN" and user.organization_id:
        result = await db.execute(
            select(ReportTemplate).where(
                ReportTemplate.id == template_id,
                ReportTemplate.organization_id == user.organization_id,
            )
        )
        if result.scalar_one_or_none():
            return True
    result = await db.execute(
        select(ReportAccessPermission).where(
            ReportAccessPermission.report_template_id == template_id,
            ReportAccessPermission.user_id == user_id,
        )
    )
    perm = result.scalar_one_or_none()
    if not perm:
        return False
    if action == "view":
        return perm.can_view
    if action == "print":
        return perm.can_print
    if action == "export":
        return perm.can_export
    return False


async def generate_report_data(
    db: AsyncSession, template_id: int, org_id: int, year: int | None = None
) -> dict | None:
    """
    Compile report data from KPI entries for the template.
    Returns structured dict: { template_name, year, kpis: [ { kpi_name, fields: [ { name, value } ] } ] }
    Formula fields are evaluated.
    """
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    yr = year or rt.year
    result = await db.execute(
        select(ReportTemplateKPI)
        .where(ReportTemplateKPI.report_template_id == template_id)
        .order_by(ReportTemplateKPI.sort_order)
        .options(
            selectinload(ReportTemplateKPI.kpi).selectinload(KPI.fields),
            selectinload(ReportTemplateKPI.fields).selectinload(ReportTemplateField.kpi_field),
        )
    )
    template_kpis = list(result.scalars().all())
    out = {
        "template_name": rt.name,
        "template_id": rt.id,
        "year": yr,
        "kpis": [],
    }
    for rtk in template_kpis:
        kpi = rtk.kpi
        if not kpi:
            continue
        fields_to_include = []
        if rtk.include_all_fields:
            fields_to_include = list(kpi.fields)
        else:
            for rtf in sorted(rtk.fields or [], key=lambda x: x.sort_order):
                if rtf.kpi_field:
                    fields_to_include.append(rtf.kpi_field)
        # Gather all submitted entries for this KPI and year in org
        entries_result = await db.execute(
            select(KPIEntry)
            .where(KPIEntry.kpi_id == kpi.id, KPIEntry.year == yr, KPIEntry.is_draft == False)
            .options(selectinload(KPIEntry.field_values))
        )
        entries = list(entries_result.scalars().all())
        # Build value by entry and field
        rows = []
        for entry in entries:
            fv_by_field = {fv.field_id: fv for fv in entry.field_values}
            value_by_key = {}
            field_values_out = []
            multi_line_items_data = {}
            for f in fields_to_include:
                fv = fv_by_field.get(f.id)
                val = None
                if fv:
                    val = fv.value_text or fv.value_number or fv.value_json or fv.value_boolean
                    if fv.value_date:
                        val = fv.value_date.isoformat() if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
                    if f.field_type == FieldType.number and fv.value_number is not None:
                        value_by_key[f.key] = fv.value_number
                    if f.field_type == FieldType.multi_line_items and isinstance(fv.value_json, list):
                        multi_line_items_data[f.key] = fv.value_json
                field_values_out.append({"field_key": f.key, "field_name": f.name, "value": val})
                if val is not None and f.field_type == FieldType.number:
                    value_by_key[f.key] = val
            # Other KPIs' numeric values for KPI_FIELD(kpi_id, field_key) in formulas
            other_kpi_values = await _load_other_kpi_values(
                db, entry.user_id, entry.year, org_id, kpi.id
            )
            # Formula fields (with multi_line_items support for SUM_ITEMS etc.)
            for f in fields_to_include:
                if f.field_type == FieldType.formula and f.formula_expression:
                    computed = evaluate_formula(
                        f.formula_expression,
                        value_by_key,
                        multi_line_items_data,
                        other_kpi_values,
                    )
                    field_values_out.append({"field_key": f.key, "field_name": f.name, "value": computed})
                    if computed is not None:
                        value_by_key[f.key] = computed
            rows.append({"entry_id": entry.id, "fields": field_values_out})
        out["kpis"].append({
            "kpi_id": kpi.id,
            "kpi_name": kpi.name,
            "entries": rows,
        })
    return out
