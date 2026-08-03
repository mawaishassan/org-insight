import datetime
import logging
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.models import (
    CustomReport,
    CustomReportSection,
    CustomReportField,
    CustomReportAssignment,
    KPI,
    KPIField,
    KPIEntry,
    Organization,
    User,
    FieldType
)
from app.reports.custom_schemas import (
    CustomReportCreate,
    CustomReportUpdate,
    CustomReportSectionLayout
)
from app.formula_engine.evaluator import evaluate_formula
from app.reports.service import (
    _load_multi_line_items_rows_batch,
    _formulas_need_other_kpi_values,
    _load_other_kpi_values,
    _report_period_display,
    build_reference_resolution_map,
    _multi_raw_pieces,
    _normalize_reference_value,
    _extract_ref_label,
    period_key_sort_order,
    effective_kpi_time_dimension,
)

logger = logging.getLogger(__name__)

# Standard TimeDimension import or helper definition
class TimeDimension:
    YEARLY = "yearly"
    HALF_YEARLY = "half_yearly"
    QUARTERLY = "quarterly"
    MONTHLY = "monthly"

    def __init__(self, val):
        self.val = str(val or "yearly").strip().lower()


async def create_custom_report(db: AsyncSession, org_id: int, data: CustomReportCreate) -> CustomReport:
    report = CustomReport(
        organization_id=org_id,
        name=data.name,
        description=data.description
    )
    db.add(report)
    await db.flush()
    return report


async def get_custom_report(db: AsyncSession, id: int, org_id: int) -> CustomReport | None:
    result = await db.execute(
        select(CustomReport)
        .where(CustomReport.id == id, CustomReport.organization_id == org_id)
        .options(
            selectinload(CustomReport.sections).selectinload(CustomReportSection.fields).selectinload(CustomReportField.kpi_field).selectinload(KPIField.sub_fields),
            selectinload(CustomReport.sections).selectinload(CustomReportSection.kpi),
        )
    )
    return result.scalar_one_or_none()


async def list_custom_reports(db: AsyncSession, org_id: int) -> list[CustomReport]:
    result = await db.execute(
        select(CustomReport)
        .where(CustomReport.organization_id == org_id)
        .order_by(CustomReport.name)
    )
    return list(result.scalars().all())


async def update_custom_report(db: AsyncSession, id: int, org_id: int, data: CustomReportUpdate) -> CustomReport | None:
    report = await get_custom_report(db, id, org_id)
    if not report:
        return None
    report.name = data.name
    report.description = data.description
    await db.flush()
    return report


async def delete_custom_report(db: AsyncSession, id: int, org_id: int) -> bool:
    report = await get_custom_report(db, id, org_id)
    if not report:
        return False
    await db.delete(report)
    await db.flush()
    return True


async def duplicate_custom_report(db: AsyncSession, id: int, org_id: int) -> CustomReport | None:
    orig = await get_custom_report(db, id, org_id)
    if not orig:
        return None

    # Create new CustomReport
    new_report = CustomReport(
        organization_id=org_id,
        name=f"Copy of {orig.name}",
        description=orig.description
    )
    db.add(new_report)
    await db.flush()

    # Copy sections and fields
    for sec in orig.sections:
        new_sec = CustomReportSection(
            custom_report_id=new_report.id,
            kpi_id=sec.kpi_id,
            custom_header=sec.custom_header,
            sort_order=sec.sort_order
        )
        db.add(new_sec)
        await db.flush()

        for f in sec.fields:
            new_field = CustomReportField(
                custom_report_id=new_report.id,
                custom_report_section_id=new_sec.id,
                kpi_field_id=f.kpi_field_id,
                sort_order=f.sort_order
            )
            db.add(new_field)

    await db.flush()
    # Refresh to load relationships
    return await get_custom_report(db, new_report.id, org_id)


async def save_custom_report_layout(
    db: AsyncSession, id: int, org_id: int, sections: list[CustomReportSectionLayout]
) -> bool:
    report = await get_custom_report(db, id, org_id)
    if not report:
        return False

    # Delete all existing sections and fields
    await db.execute(delete(CustomReportSection).where(CustomReportSection.custom_report_id == id))
    await db.execute(delete(CustomReportField).where(CustomReportField.custom_report_id == id))
    await db.flush()

    # Re-insert the new sections and fields
    for s_idx, sec_data in enumerate(sections):
        sec = CustomReportSection(
            custom_report_id=id,
            kpi_id=sec_data.kpi_id,
            custom_header=sec_data.custom_header,
            sort_order=sec_data.sort_order
        )
        db.add(sec)
        await db.flush()

        for f_idx, field_data in enumerate(sec_data.fields):
            f = CustomReportField(
                custom_report_id=id,
                custom_report_section_id=sec.id,
                kpi_field_id=field_data.kpi_field_id,
                sort_order=field_data.sort_order
            )
            db.add(f)

    await db.flush()
    return True


async def assign_custom_report(
    db: AsyncSession, custom_report_id: int, user_id: int, can_view: bool, can_print: bool, can_export: bool
) -> CustomReportAssignment:
    # Check if assignment already exists
    result = await db.execute(
        select(CustomReportAssignment)
        .where(CustomReportAssignment.custom_report_id == custom_report_id, CustomReportAssignment.user_id == user_id)
    )
    perm = result.scalar_one_or_none()
    if not perm:
        perm = CustomReportAssignment(
            custom_report_id=custom_report_id,
            user_id=user_id
        )
        db.add(perm)

    perm.can_view = can_view
    perm.can_print = can_print
    perm.can_export = can_export
    await db.flush()
    return perm


async def unassign_custom_report(db: AsyncSession, custom_report_id: int, user_id: int) -> bool:
    result = await db.execute(
        select(CustomReportAssignment)
        .where(CustomReportAssignment.custom_report_id == custom_report_id, CustomReportAssignment.user_id == user_id)
    )
    perm = result.scalar_one_or_none()
    if not perm:
        return False
    await db.delete(perm)
    await db.flush()
    return True


async def list_custom_report_assignments(db: AsyncSession, custom_report_id: int) -> list[CustomReportAssignment]:
    result = await db.execute(
        select(CustomReportAssignment)
        .where(CustomReportAssignment.custom_report_id == custom_report_id)
        .options(selectinload(CustomReportAssignment.user))
    )
    return list(result.scalars().all())


async def generate_custom_report_data(
    db: AsyncSession,
    id: int,
    org_id: int,
    year: int | None = None,
    include_drafts: bool = False,
) -> dict | None:
    custom_report = await get_custom_report(db, id, org_id)
    if not custom_report:
        return None

    yr = year if year is not None else datetime.date.today().year

    # 1. Identify all referenced KPIs
    referenced_kpi_ids = set()
    for sec in custom_report.sections:
        referenced_kpi_ids.add(sec.kpi_id)
        for f in sec.fields:
            referenced_kpi_ids.add(f.kpi_field.kpi_id)

    if not referenced_kpi_ids:
        # Empty report
        return {
            "custom_report_id": custom_report.id,
            "custom_report_name": custom_report.name,
            "custom_report_description": custom_report.description,
            "organization_id": custom_report.organization_id,
            "year": yr,
            "sections": [],
        }

    # 2. Load KPIs and their fields
    kpis_result = await db.execute(
        select(KPI)
        .where(KPI.id.in_(referenced_kpi_ids))
        .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
    )
    kpis_by_id = {k.id: k for k in kpis_result.scalars().unique().all()}

    # 3. Load Org Config
    org = await db.get(Organization, org_id)
    org_td = TimeDimension(getattr(org, "time_dimension", None) or "yearly") if org else TimeDimension.YEARLY

    kpi_evaluated_data = {}

    # 4. Fetch entries and evaluate formulas for each referenced KPI
    for kid, kpi in kpis_by_id.items():
        fields_to_include = sorted(list(kpi.fields or []), key=lambda f: (f.sort_order, f.id))
        kpi_td_raw = getattr(kpi, "time_dimension", None)
        kpi_td = TimeDimension(kpi_td_raw) if kpi_td_raw else None
        effective_td = effective_kpi_time_dimension(kpi_td, org_td)

        entry_filters = [
            KPIEntry.organization_id == org_id,
            KPIEntry.kpi_id == kpi.id,
            KPIEntry.year == yr,
        ]
        if not include_drafts:
            entry_filters.append(KPIEntry.is_draft == False)

        entries_result = await db.execute(
            select(KPIEntry)
            .where(*entry_filters)
            .options(selectinload(KPIEntry.field_values))
        )
        all_entries = list(entries_result.scalars().all())
        entries_sorted = sorted(
            all_entries,
            key=lambda e: period_key_sort_order(getattr(e, "period_key", "") or "", effective_td),
        )

        # Use latest entry
        if len(entries_sorted) > 1:
            entries_sorted = [entries_sorted[-1]]

        need_cross_kpi = _formulas_need_other_kpi_values(fields_to_include)
        other_kpi_values = (
            await _load_other_kpi_values(db, yr, org_id, kpi.id)
            if entries_sorted and need_cross_kpi
            else {}
        )
        entry_ids_sorted = [e.id for e in entries_sorted]

        # Load multi-line rows
        ml_fields = [f for f in fields_to_include if f.field_type == FieldType.multi_line_items]
        ml_rows_by_field_id = {}
        for mf in ml_fields:
            ml_rows_by_field_id[mf.id] = await _load_multi_line_items_rows_batch(
                db, entry_ids=entry_ids_sorted, field=mf
            )

        evaluated_fields = {}

        if not entries_sorted:
            # Placeholder for no data
            _NO_DATA_PLACEHOLDER = "No data entered"
            for f in fields_to_include:
                field_payload = {
                    "field_key": f.key,
                    "field_name": f.name,
                    "value": _NO_DATA_PLACEHOLDER,
                    "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                }
                if f.field_type == FieldType.multi_line_items:
                    sub_fields_orm = getattr(f, "sub_fields") or []
                    field_payload["value_items"] = []
                    field_payload["sub_field_keys"] = [sf.key for sf in sub_fields_orm]
                    field_payload["sub_fields"] = [{"key": sf.key, "name": getattr(sf, "name", sf.key)} for sf in sub_fields_orm]
                evaluated_fields[f.key] = field_payload
        else:
            entry = entries_sorted[0]
            fv_by_field = {fv.field_id: fv for fv in entry.field_values}
            value_by_key = {}
            multi_line_items_data = {}

            for f in fields_to_include:
                if f.field_type == FieldType.formula:
                    continue
                fv = fv_by_field.get(f.id)
                val = None
                if fv:
                    if fv.value_date is not None:
                        val = fv.value_date.isoformat() if hasattr(fv.value_date, "isoformat") else str(fv.value_date)
                    elif fv.value_text is not None:
                        val = fv.value_text
                    elif fv.value_number is not None:
                        val = fv.value_number
                    elif fv.value_json is not None:
                        val = fv.value_json
                    elif fv.value_boolean is not None:
                        val = fv.value_boolean

                    if f.field_type == FieldType.number and fv.value_number is not None:
                        value_by_key[f.key] = fv.value_number
                    if f.field_type == FieldType.multi_line_items:
                        rows_items = ml_rows_by_field_id.get(f.id, {}).get(entry.id, [])
                        multi_line_items_data[f.key] = rows_items
                        val = rows_items

                field_payload = {
                    "field_key": f.key,
                    "field_name": f.name,
                    "value": val,
                    "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                }
                if f.field_type == FieldType.multi_line_items:
                    sub_fields_orm = getattr(f, "sub_fields") or []
                    field_payload["sub_field_keys"] = [sf.key for sf in sub_fields_orm]
                    field_payload["sub_fields"] = [{"key": sf.key, "name": getattr(sf, "name", sf.key)} for sf in sub_fields_orm]
                    field_payload["value_items"] = val if isinstance(val, list) else []
                evaluated_fields[f.key] = field_payload
                if val is not None and f.field_type == FieldType.number:
                    value_by_key[f.key] = val

            # Seed formula values
            for f in fields_to_include:
                if f.field_type != FieldType.formula:
                    continue
                fv_formula = fv_by_field.get(f.id)
                if not fv_formula or fv_formula.value_number is None:
                    continue
                try:
                    value_by_key[f.key] = float(fv_formula.value_number)
                except (TypeError, ValueError):
                    continue

            # Evaluate formula fields
            for f in fields_to_include:
                if f.field_type == FieldType.formula and f.formula_expression:
                    computed = evaluate_formula(
                        f.formula_expression,
                        value_by_key,
                        multi_line_items_data,
                        other_kpi_values,
                    )
                    if computed is None:
                        fv_formula = fv_by_field.get(f.id)
                        if fv_formula and fv_formula.value_number is not None:
                            computed = fv_formula.value_number
                    field_payload = {
                        "field_key": f.key,
                        "field_name": f.name,
                        "value": computed,
                        "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                    }
                    evaluated_fields[f.key] = field_payload

        kpi_evaluated_data[kpi.id] = evaluated_fields

    # 5. Build structured layout output with hierarchical numbering
    sections_out = []
    for s_idx, sec in enumerate(custom_report.sections):
        sec_num = str(s_idx + 1)
        sec_header = sec.custom_header or (sec.kpi.name if sec.kpi else f"Section {sec_num}")

        fields_out = []
        for f_idx, f in enumerate(sec.fields):
            f_num = f"{sec_num}.{f_idx + 1}"
            kfield = f.kpi_field

            # Lookup evaluated value
            kpi_data = kpi_evaluated_data.get(kfield.kpi_id, {})
            field_eval = kpi_data.get(kfield.key, {})

            field_payload = {
                "id": f.id,
                "kpi_field_id": f.kpi_field_id,
                "field_key": kfield.key,
                "field_name": kfield.name,
                "field_type": kfield.field_type.value if hasattr(kfield.field_type, "value") else str(kfield.field_type),
                "number": f_num,
                "value": field_eval.get("value"),
            }
            if kfield.field_type == FieldType.multi_line_items:
                field_payload["sub_fields"] = field_eval.get("sub_fields") or []
                field_payload["sub_field_keys"] = field_eval.get("sub_field_keys") or []
                field_payload["value_items"] = field_eval.get("value_items") or []

            fields_out.append(field_payload)

        sections_out.append({
            "id": sec.id,
            "kpi_id": sec.kpi_id,
            "custom_header": sec_header,
            "number": sec_num,
            "fields": fields_out,
        })

    return {
        "custom_report_id": custom_report.id,
        "custom_report_name": custom_report.name,
        "template_id": custom_report.id,
        "template_name": custom_report.name,
        "custom_report_description": custom_report.description,
        "organization_id": custom_report.organization_id,
        "year": yr,
        "sections": sections_out,
    }


async def render_custom_report_html(
    db: AsyncSession,
    id: int,
    org_id: int,
    year: int | None = None,
    include_drafts: bool = False,
    report_data: dict | None = None,
) -> str | None:
    if report_data is not None:
        data = report_data
    else:
        data = await generate_custom_report_data(
            db, id, org_id, year=year, include_drafts=include_drafts
        )
    if not data:
        return None

    # Compile the sections and fields into styled HTML matching Simple Reports styling
    out = []
    out.append('<div class="custom-report" style="color: #111;">')
    for sec in data["sections"]:
        out.append('<section style="margin-bottom: 1.5rem;">')
        out.append(
            f'<h2 style="font-size: 1.15rem; margin-bottom: 0.5rem; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.25rem;">'
            f'{sec["number"]} {sec["custom_header"]}'
            f'</h2>'
        )
        out.append('<div style="margin-left: 1rem; margin-bottom: 0.75rem;">')
        for f in sec["fields"]:
            if f["field_type"] != "multi_line_items":
                val = f["value"]
                if val is None:
                    val = "—"
                out.append('<div style="display: flex; gap: 0.5rem; margin-bottom: 0.35rem; font-size: 0.95rem;">')
                out.append(f'<strong style="min-width: 180px; color: #4b5563;">{f["number"]} {f["field_name"]}:</strong>')
                out.append(f'<span style="color: #111827;">{val}</span>')
                out.append('</div>')
            else:
                out.append('<div style="margin-bottom: 1rem; font-size: 0.95rem;">')
                out.append(f'<strong style="display: block; margin-bottom: 0.35rem; color: #4b5563;">{f["number"]} {f["field_name"]}:</strong>')
                if f.get("value_items"):
                    out.append('<table style="border-collapse: collapse; width: 100%; border: 1px solid #d1d5db; margin-top: 0.25rem; margin-bottom: 0.5rem;">')
                    out.append('<thead>')
                    out.append('<tr style="background-color: #f9fafb; border-bottom: 2px solid #d1d5db;">')
                    out.append('<th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 0.85rem; font-weight: 600; color: #374151;">S.No</th>')
                    for sub in f["sub_fields"]:
                        out.append(f'<th style="border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 0.85rem; font-weight: 600; color: #374151;">{sub["name"]}</th>')
                    out.append('</tr>')
                    out.append('</thead>')
                    out.append('<tbody>')
                    for r_idx, row in enumerate(f["value_items"]):
                        bg = ' style="background-color: #f9fafb;"' if r_idx % 2 == 1 else ''
                        out.append(f'<tr{bg}>')
                        out.append(f'<td style="border: 1px solid #d1d5db; padding: 8px; font-size: 0.85rem; color: #4b5563;">{r_idx + 1}</td>')
                        for sub in f["sub_fields"]:
                            rval = row.get(sub["key"])
                            if rval is None:
                                rval = "—"
                            out.append(f'<td style="border: 1px solid #d1d5db; padding: 8px; font-size: 0.85rem; color: #111827;">{rval}</td>')
                        out.append('</tr>')
                    out.append('</tbody>')
                    out.append('</table>')
                else:
                    out.append('<span style="color: #9ca3af; font-style: italic; font-size: 0.9rem;">No data entered</span>')
                out.append('</div>')
        out.append('</div>')
        out.append('</section>')
    out.append('</div>')
    return "\n".join(out)
