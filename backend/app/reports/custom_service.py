import datetime
import logging
from collections import defaultdict
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, noload

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
    FieldType,
    KpiMultiLineRow,
    KpiMultiLineCell,
    KPIFieldSubField
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
            selectinload(CustomReport.sections).selectinload(CustomReportSection.kpi).options(
                noload(KPI.organization),
                noload(KPI.domain)
            ),
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
    CUSTOM_REPORT_CACHE.invalidate_report(id)
    return report


async def delete_custom_report(db: AsyncSession, id: int, org_id: int) -> bool:
    report = await get_custom_report(db, id, org_id)
    if not report:
        return False
    await db.delete(report)
    await db.flush()
    CUSTOM_REPORT_CACHE.invalidate_report(id)
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
                sort_order=f.sort_order,
                config=f.config
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
                sort_order=field_data.sort_order,
                config=field_data.config
            )
            db.add(f)

    await db.flush()
    CUSTOM_REPORT_CACHE.invalidate_report(id)
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
    CUSTOM_REPORT_CACHE.invalidate_report(custom_report_id)
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
    CUSTOM_REPORT_CACHE.invalidate_report(custom_report_id)
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
    preview: bool = False,
    on_progress=None
) -> dict | None:
    if on_progress:
        on_progress(10)
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
        if on_progress:
            on_progress(100)
        return {
            "custom_report_id": custom_report.id,
            "custom_report_name": custom_report.name,
            "custom_report_description": custom_report.description,
            "organization_id": custom_report.organization_id,
            "year": yr,
            "sections": [],
        }

    if on_progress:
        on_progress(20)

    # 2. Load KPIs and their fields
    kpis_result = await db.execute(
        select(KPI)
        .where(KPI.id.in_(referenced_kpi_ids))
        .options(
            selectinload(KPI.fields).selectinload(KPIField.sub_fields),
            noload(KPI.organization),
            noload(KPI.domain)
        )
    )
    kpis_by_id = {k.id: k for k in kpis_result.scalars().unique().all()}

    # 3. Load Org Config
    org = await db.get(Organization, org_id)
    org_td = TimeDimension(getattr(org, "time_dimension", None) or "yearly") if org else TimeDimension.YEARLY

    # Batch load all entries for all referenced KPIs at once to avoid loop database hits
    all_entries_filters = [
        KPIEntry.organization_id == org_id,
        KPIEntry.kpi_id.in_(referenced_kpi_ids),
        KPIEntry.year == yr,
    ]
    if not include_drafts:
        all_entries_filters.append(KPIEntry.is_draft == False)

    entries_result = await db.execute(
        select(KPIEntry)
        .where(*all_entries_filters)
        .options(selectinload(KPIEntry.field_values))
    )
    all_entries_list = list(entries_result.scalars().all())

    # Group entries by kpi_id
    entries_by_kpi = {}
    for entry in all_entries_list:
        entries_by_kpi.setdefault(entry.kpi_id, []).append(entry)

    kpi_evaluated_data = {}

    if on_progress:
        on_progress(30)

    # 4. Fetch entries and evaluate formulas for each referenced KPI
    total_kpis = len(kpis_by_id)
    for idx, (kid, kpi) in enumerate(kpis_by_id.items()):
        fields_to_include = sorted(list(kpi.fields or []), key=lambda f: (f.sort_order, f.id))
        kpi_td_raw = getattr(kpi, "time_dimension", None)
        kpi_td = TimeDimension(kpi_td_raw) if kpi_td_raw else None
        effective_td = effective_kpi_time_dimension(kpi_td, org_td)

        all_entries = entries_by_kpi.get(kpi.id, [])
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
            limit_val = 100 if preview else None
            ml_rows_by_field_id[mf.id] = await _load_multi_line_items_rows_batch(
                db, entry_ids=entry_ids_sorted, field=mf, limit=limit_val
            )

        if on_progress:
            on_progress(int(30 + 50 * (idx + 1) / total_kpis))

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
                
                if f.field_type == FieldType.multi_line_items:
                    rows_items = ml_rows_by_field_id.get(f.id, {}).get(entry.id, [])
                    multi_line_items_data[f.key] = rows_items
                    val = rows_items
                elif fv:
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
                cfg = getattr(f, "config", None) or {}
                field_payload["config"] = cfg
                
                # Fetch all sub_fields and values
                all_sub_fields = field_eval.get("sub_fields") or []
                all_value_items = field_eval.get("value_items") or []
                
                # Column selection filtering
                visible_keys = cfg.get("selected_columns")
                if visible_keys is None:
                    # Default to first 5 columns if not explicitly configured to prevent ReportLab crash on export
                    visible_keys = [sf["key"] for sf in all_sub_fields][:5]

                sf_map = {sf["key"]: sf for sf in all_sub_fields}
                filtered_sub_fields = [sf_map[k] for k in visible_keys if k in sf_map]
                filtered_sub_field_keys = [sf["key"] for sf in filtered_sub_fields]
                
                # Row filtering
                raw_filters = cfg.get("filters") or {}
                filtered_value_items = []
                if all_value_items:
                    if raw_filters and raw_filters.get("conditions"):
                        from app.entries.multi_item_filters import row_passes_filters
                        from app.entries.reference_filter_resolve import build_reference_resolution_map
                        conds = raw_filters.get("conditions")
                        resolution_maps = await build_reference_resolution_map(
                            db, org_id, yr, kfield, conds, all_value_items
                        )
                        reference_field_types = {sf.key: sf.field_type.value if hasattr(sf.field_type, "value") else sf.field_type for sf in kfield.sub_fields}
                        for r in all_value_items:
                            if row_passes_filters(r, raw_filters, resolution_maps=resolution_maps, reference_field_types=reference_field_types):
                                filtered_value_items.append(r)
                    else:
                        filtered_value_items = all_value_items
                
                # Query total count of rows
                from sqlalchemy import func
                total_cnt = 0
                if entries_sorted:
                    entry = entries_sorted[0]
                    total_cnt = (
                        await db.execute(
                            select(func.count(KpiMultiLineRow.id)).where(
                                KpiMultiLineRow.entry_id == entry.id,
                                KpiMultiLineRow.field_id == kfield.id,
                            )
                        )
                    ).scalar_one() or 0

                if preview:
                    filtered_value_items = filtered_value_items[:50]
                
                field_payload["sub_fields"] = filtered_sub_fields
                field_payload["sub_field_keys"] = filtered_sub_field_keys
                field_payload["value_items"] = filtered_value_items
                field_payload["total_count"] = total_cnt
            else:
                field_payload["config"] = getattr(f, "config", None) or {}

            fields_out.append(field_payload)

        sections_out.append({
            "id": sec.id,
            "kpi_id": sec.kpi_id,
            "custom_header": sec_header,
            "number": sec_num,
            "fields": fields_out,
        })

    if on_progress:
        on_progress(95)

    if on_progress:
        on_progress(100)

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
                    total_cnt = f.get("total_count", len(f["value_items"]))
                    if total_cnt > len(f["value_items"]):
                        out.append(f'<div style="margin-bottom: 0.5rem; font-style: italic; color: #4b5563; font-size: 0.85rem; font-weight: 500;">Showing first {len(f["value_items"])} rows of {total_cnt} records.</div>')
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


async def export_custom_report_file(
    db: AsyncSession,
    custom_report_id: int,
    org_id: int,
    year: int,
    format: str,
) -> tuple[bytes, str, str]:
    """Export custom report as PDF, DOCX, or XLSX bytes, with name and content-type."""
    import re
    import io

    # Generate custom report data
    data = await generate_custom_report_data(db, custom_report_id, org_id, year=year, include_drafts=False)
    if not data:
        raise ValueError("Report data generation failed")
    report_name = data.get("template_name", "Custom Report")
    # Clean filename
    clean_report_name = re.sub(r'[^\w\s-]', '', report_name).strip().replace(' ', '_')

    if format == "xlsx":
        import openpyxl
        from openpyxl.styles import Font, Alignment, PatternFill, Border, Side
        from openpyxl.utils import get_column_letter

        wb = openpyxl.Workbook()
        wb.remove(wb.active) # Remove default sheet
        
        # Styles
        title_font = Font(name="Calibri", size=15, bold=True, color="1E3A8A")
        section_font = Font(name="Calibri", size=12, bold=True, color="1F2937")
        header_font = Font(name="Calibri", size=10, bold=True, color="FFFFFF")
        header_fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
        label_font = Font(name="Calibri", size=10, bold=True)
        normal_font = Font(name="Calibri", size=10)
        border_side = Side(border_style="thin", color="E5E7EB")
        thin_border = Border(left=border_side, right=border_side, top=border_side, bottom=border_side)

        for s_idx, sec in enumerate(data.get("sections", [])):
            sec_name = sec.get("custom_header") or sec.get("kpi_name", f"Section {s_idx+1}")
            sheet_title = re.sub(r'[\\*?:/\[\]]', '', sec_name)[:30].strip() or f"Sheet {s_idx+1}"
            ws = wb.create_sheet(title=sheet_title)
            ws.views.sheetView[0].showGridLines = True

            # Title Block
            ws.merge_cells("A1:D1")
            ws["A1"] = f"{report_name} - {sec_name}"
            ws["A1"].font = title_font
            ws["A1"].alignment = Alignment(vertical="center")
            ws.row_dimensions[1].height = 28

            ws["A2"] = f"Year: {year}"
            ws["A2"].font = Font(name="Calibri", size=10, italic=True)
            ws.row_dimensions[2].height = 18

            row_num = 4
            scalars = [f for f in sec.get("fields", []) if f.get("field_type") != "multi_line_items"]
            mlis = [f for f in sec.get("fields", []) if f.get("field_type") == "multi_line_items"]

            if scalars:
                # Column Headers
                ws.cell(row=row_num, column=1, value="Field Label").font = header_font
                ws.cell(row=row_num, column=1).fill = header_fill
                ws.cell(row=row_num, column=2, value="Value").font = header_font
                ws.cell(row=row_num, column=2).fill = header_fill
                ws.row_dimensions[row_num].height = 20
                row_num += 1

                for f in scalars:
                    ws.cell(row=row_num, column=1, value=f.get("field_name")).font = label_font
                    ws.cell(row=row_num, column=1).border = thin_border
                    ws.cell(row=row_num, column=2, value=f.get("value") if f.get("value") is not None else "—").font = normal_font
                    ws.cell(row=row_num, column=2).border = thin_border
                    ws.row_dimensions[row_num].height = 18
                    row_num += 1
                row_num += 2 # spacer

            for f in mlis:
                ws.cell(row=row_num, column=1, value=f.get("field_name")).font = section_font
                row_num += 1

                sub_fields = f.get("sub_fields", [])
                value_items = f.get("value_items", [])

                if sub_fields:
                    # Headers
                    for col_idx, sf in enumerate(sub_fields):
                        c = ws.cell(row=row_num, column=col_idx+1, value=sf.get("name") or sf.get("key"))
                        c.font = header_font
                        c.fill = header_fill
                        c.alignment = Alignment(horizontal="center", vertical="center")
                    ws.row_dimensions[row_num].height = 20
                    row_num += 1

                    # Body
                    for item in value_items:
                        for col_idx, sf in enumerate(sub_fields):
                            val = item.get(sf.get("key"))
                            c = ws.cell(row=row_num, column=col_idx+1, value=val if val is not None else "—")
                            c.font = normal_font
                            c.border = thin_border
                        ws.row_dimensions[row_num].height = 18
                        row_num += 1
                row_num += 2 # spacer

            # Autofit column widths
            for col in ws.columns:
                max_len = 0
                for cell in col:
                    if cell.value is not None:
                        max_len = max(max_len, len(str(cell.value)))
                col_letter = get_column_letter(col[0].column)
                ws.column_dimensions[col_letter].width = max(max_len + 3, 14)

        out_io = io.BytesIO()
        wb.save(out_io)
        return out_io.getvalue(), f"{clean_report_name}_{year}.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

    elif format == "docx":
        from docx import Document
        from docx.shared import Pt, Inches, RGBColor
        from docx.enum.text import WD_ALIGN_PARAGRAPH

        doc = Document()
        for section in doc.sections:
            section.top_margin = Inches(0.8)
            section.bottom_margin = Inches(0.8)
            section.left_margin = Inches(0.8)
            section.right_margin = Inches(0.8)

        # Title
        p_title = doc.add_paragraph()
        r_title = p_title.add_run(report_name)
        r_title.font.size = Pt(22)
        r_title.font.name = "Calibri"
        r_title.font.bold = True
        r_title.font.color.rgb = RGBColor(30, 58, 138)
        p_title.alignment = WD_ALIGN_PARAGRAPH.CENTER

        # Subtitle
        p_sub = doc.add_paragraph()
        r_sub = p_sub.add_run(f"Academic Year: {year}")
        r_sub.font.size = Pt(11)
        r_sub.font.name = "Calibri"
        r_sub.font.italic = True
        p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER

        for s_idx, sec in enumerate(data.get("sections", [])):
            sec_name = sec.get("custom_header") or sec.get("kpi_name", f"Section {s_idx+1}")
            h = doc.add_heading(level=1)
            r_h = h.add_run(f"{s_idx+1}. {sec_name}")
            r_h.font.size = Pt(14)
            r_h.font.bold = True
            r_h.font.color.rgb = RGBColor(31, 41, 55)

            scalars = [f for f in sec.get("fields", []) if f.get("field_type") != "multi_line_items"]
            mlis = [f for f in sec.get("fields", []) if f.get("field_type") == "multi_line_items"]

            if scalars:
                p_scal = doc.add_paragraph()
                for f in scalars:
                    r_lbl = p_scal.add_run(f"\n{f.get('field_name')}: ")
                    r_lbl.bold = True
                    r_lbl.font.size = Pt(10)
                    r_val = p_scal.add_run(str(f.get("value") if f.get("value") is not None else "—"))
                    r_val.font.size = Pt(10)

            for f in mlis:
                doc.add_paragraph()
                p_f = doc.add_paragraph()
                r_f = p_f.add_run(f.get("field_name"))
                r_f.bold = True
                r_f.font.size = Pt(11)
                r_f.font.color.rgb = RGBColor(30, 58, 138)

                sub_fields = f.get("sub_fields", [])
                value_items = f.get("value_items", [])

                if sub_fields:
                    table = doc.add_table(rows=1, cols=len(sub_fields))
                    table.style = 'Light Shading Accent 1'
                    hdr_cells = table.rows[0].cells
                    for col_idx, sf in enumerate(sub_fields):
                        hdr_cells[col_idx].text = sf.get("name") or sf.get("key")
                        hdr_cells[col_idx].paragraphs[0].runs[0].font.bold = True
                        hdr_cells[col_idx].paragraphs[0].runs[0].font.size = Pt(9.5)

                    for item in value_items:
                        row_cells = table.add_row().cells
                        for col_idx, sf in enumerate(sub_fields):
                            row_cells[col_idx].text = str(item.get(sf.get("key")) if item.get(sf.get("key")) is not None else "—")
                            row_cells[col_idx].paragraphs[0].runs[0].font.size = Pt(9.5)

        out_io = io.BytesIO()
        doc.save(out_io)
        return out_io.getvalue(), f"{clean_report_name}_{year}.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    elif format == "pdf":
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.enums import TA_CENTER, TA_LEFT
        from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

        out_io = io.BytesIO()
        pdf_doc = SimpleDocTemplate(out_io, pagesize=letter, rightMargin=36, leftMargin=36, topMargin=36, bottomMargin=36)
        story = []

        styles = getSampleStyleSheet()
        title_style = ParagraphStyle(
            "CustomTitleStyle",
            parent=styles["Title"],
            fontSize=20,
            textColor=colors.HexColor("#1E3A8A"),
            spaceAfter=10
        )
        subtitle_style = ParagraphStyle(
            "CustomSubtitleStyle",
            parent=styles["Normal"],
            fontSize=11,
            alignment=TA_CENTER,
            textColor=colors.HexColor("#4B5563"),
            spaceAfter=18
        )
        h1_style = ParagraphStyle(
            "CustomHeading1Style",
            parent=styles["Heading1"],
            fontSize=13,
            textColor=colors.HexColor("#1F2937"),
            spaceBefore=12,
            spaceAfter=6
        )
        h2_style = ParagraphStyle(
            "CustomHeading2Style",
            parent=styles["Heading2"],
            fontSize=11,
            textColor=colors.HexColor("#1E3A8A"),
            spaceBefore=8,
            spaceAfter=4
        )
        body_style = ParagraphStyle(
            "CustomBodyStyle",
            parent=styles["Normal"],
            fontSize=9.5,
            textColor=colors.HexColor("#111111"),
            leading=13
        )
        bold_body_style = ParagraphStyle(
            "CustomBoldBodyStyle",
            parent=body_style,
            fontName="Helvetica-Bold"
        )
        table_hdr_style = ParagraphStyle(
            "CustomTableHdrStyle",
            parent=styles["Normal"],
            fontSize=8.5,
            fontName="Helvetica-Bold",
            textColor=colors.white
        )
        table_body_style = ParagraphStyle(
            "CustomTableBodyStyle",
            parent=styles["Normal"],
            fontSize=8.5
        )

        story.append(Paragraph(report_name, title_style))
        story.append(Paragraph(f"Academic Year: {year}", subtitle_style))

        for s_idx, sec in enumerate(data.get("sections", [])):
            sec_name = sec.get("custom_header") or sec.get("kpi_name", f"Section {s_idx+1}")
            story.append(Paragraph(f"{s_idx+1}. {sec_name}", h1_style))

            scalars = [f for f in sec.get("fields", []) if f.get("field_type") != "multi_line_items"]
            mlis = [f for f in sec.get("fields", []) if f.get("field_type") == "multi_line_items"]

            if scalars:
                scalar_data = []
                for f in scalars:
                    scalar_data.append([
                        Paragraph(f.get("field_name"), bold_body_style),
                        Paragraph(str(f.get("value") if f.get("value") is not None else "—"), body_style)
                    ])
                t = Table(scalar_data, colWidths=[200, 340])
                t.setStyle(TableStyle([
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                    ("TOPPADDING", (0, 0), (-1, -1), 3),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ]))
                story.append(t)
                story.append(Spacer(1, 8))

            for f in mlis:
                story.append(Paragraph(f.get("field_name"), h2_style))
                sub_fields = f.get("sub_fields", [])
                value_items = f.get("value_items", [])

                if sub_fields:
                    col_widths = [540 / len(sub_fields)] * len(sub_fields)
                    hdr_row = [Paragraph(sf.get("name") or sf.get("key"), table_hdr_style) for sf in sub_fields]
                    pdf_table_data = [hdr_row]

                    for item in value_items:
                        row = []
                        for sf in sub_fields:
                            val = item.get(sf.get("key"))
                            if val is not None:
                                val_str = str(val)
                                if len(val_str) > 250:
                                    val_str = val_str[:250] + "..."
                            else:
                                val_str = "—"
                            row.append(Paragraph(val_str, table_body_style))
                        pdf_table_data.append(row)

                    t_mli = Table(pdf_table_data, colWidths=col_widths)
                    t_mli.setStyle(TableStyle([
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1E3A8A")),
                        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
                        ("TOPPADDING", (0, 0), (-1, -1), 3),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                    ]))
                    story.append(t_mli)
                    story.append(Spacer(1, 8))

        pdf_doc.build(story)
        return out_io.getvalue(), f"{clean_report_name}_{year}.pdf", "application/pdf"

    raise ValueError("Invalid format: " + format)


# ----------------------------------------------------
# Optimized Caching & Background Task Generation
# ----------------------------------------------------

class CustomReportCache:
    def __init__(self):
        self._cache = {}

    def get(self, key):
        return self._cache.get(key)

    def set(self, key, value):
        # Prevent unbounded growth
        if len(self._cache) > 256:
            self._cache.clear()
        self._cache[key] = value

    def invalidate_report(self, report_id: int):
        keys_to_del = [k for k in self._cache if isinstance(k, tuple) and k[0] == report_id]
        for k in keys_to_del:
            self._cache.pop(k, None)

    def invalidate_all(self):
        self._cache.clear()

CUSTOM_REPORT_CACHE = CustomReportCache()

# Thread-safe/process-safe in-memory task registry
REPORT_TASKS = {} # task_id -> {"status": "processing"/"completed"/"failed", "progress": 0, "result": None, "error": None}


async def run_background_generation_task(task_id: str, id: int, org_id: int, year: int | None):
    REPORT_TASKS[task_id] = {
        "status": "processing",
        "progress": 0,
        "result": None,
        "error": None
    }
    try:
        from app.core.database import AsyncSessionLocal
        async with AsyncSessionLocal() as db:
            def update_progress(p):
                REPORT_TASKS[task_id]["progress"] = p

            # Run full generation in background (preview=False)
            data = await generate_custom_report_data(
                db, id, org_id, year=year, include_drafts=False, preview=False, on_progress=update_progress
            )
            if not data:
                REPORT_TASKS[task_id]["status"] = "failed"
                REPORT_TASKS[task_id]["error"] = "Report not found or empty"
                return

            html = await render_custom_report_html(
                db, id, org_id, year=year, include_drafts=False, report_data=data
            )
            if html is not None:
                data["rendered_html"] = html

            REPORT_TASKS[task_id]["status"] = "completed"
            REPORT_TASKS[task_id]["progress"] = 100
            REPORT_TASKS[task_id]["result"] = data
    except Exception as e:
        logger.exception("Error in background generation task: %s", task_id)
        REPORT_TASKS[task_id]["status"] = "failed"
        REPORT_TASKS[task_id]["error"] = str(e)


async def stream_custom_report_data(
    db: AsyncSession,
    id: int,
    org_id: int,
    year: int | None = None,
):
    custom_report = await get_custom_report(db, id, org_id)
    if not custom_report:
        yield {"type": "error", "message": "Report not found"}
        return

    yr = year if year is not None else datetime.date.today().year

    # Yield metadata
    yield {
        "type": "metadata",
        "custom_report_id": custom_report.id,
        "custom_report_name": custom_report.name,
        "custom_report_description": custom_report.description,
        "year": yr,
    }

    # 1. Identify all referenced KPIs
    referenced_kpi_ids = set()
    for sec in custom_report.sections:
        referenced_kpi_ids.add(sec.kpi_id)
        for f in sec.fields:
            referenced_kpi_ids.add(f.kpi_field.kpi_id)

    if not referenced_kpi_ids:
        yield {"type": "done"}
        return

    # Load KPIs, Org Config, and Entries
    kpis_result = await db.execute(
        select(KPI)
        .where(KPI.id.in_(referenced_kpi_ids))
        .options(
            selectinload(KPI.fields).selectinload(KPIField.sub_fields),
            noload(KPI.organization),
            noload(KPI.domain)
        )
    )
    kpis_by_id = {k.id: k for k in kpis_result.scalars().unique().all()}

    org = await db.get(Organization, org_id)
    org_td = TimeDimension(getattr(org, "time_dimension", None) or "yearly") if org else TimeDimension.YEARLY

    all_entries_filters = [
        KPIEntry.organization_id == org_id,
        KPIEntry.kpi_id.in_(referenced_kpi_ids),
        KPIEntry.year == yr,
        KPIEntry.is_draft == False,
    ]
    entries_result = await db.execute(
        select(KPIEntry)
        .where(*all_entries_filters)
        .options(selectinload(KPIEntry.field_values))
    )
    all_entries_list = list(entries_result.scalars().all())

    entries_by_kpi = {}
    for entry in all_entries_list:
        entries_by_kpi.setdefault(entry.kpi_id, []).append(entry)

    # Evaluate scalar and formula fields
    kpi_evaluated_data = {}
    for kid, kpi in kpis_by_id.items():
        fields_to_include = sorted(list(kpi.fields or []), key=lambda f: (f.sort_order, f.id))
        kpi_td_raw = getattr(kpi, "time_dimension", None)
        kpi_td = TimeDimension(kpi_td_raw) if kpi_td_raw else None
        effective_td = effective_kpi_time_dimension(kpi_td, org_td)

        all_entries = entries_by_kpi.get(kpi.id, [])
        entries_sorted = sorted(
            all_entries,
            key=lambda e: period_key_sort_order(getattr(e, "period_key", "") or "", effective_td),
        )
        if len(entries_sorted) > 1:
            entries_sorted = [entries_sorted[-1]]

        need_cross_kpi = _formulas_need_other_kpi_values(fields_to_include)
        other_kpi_values = (
            await _load_other_kpi_values(db, yr, org_id, kpi.id)
            if entries_sorted and need_cross_kpi
            else {}
        )

        evaluated_fields = {}
        if not entries_sorted:
            _NO_DATA_PLACEHOLDER = "No data entered"
            for f in fields_to_include:
                if f.field_type == FieldType.multi_line_items:
                    continue
                evaluated_fields[f.key] = {
                    "field_key": f.key,
                    "field_name": f.name,
                    "value": _NO_DATA_PLACEHOLDER,
                    "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                }
        else:
            entry = entries_sorted[0]
            fv_by_field = {fv.field_id: fv for fv in entry.field_values}
            value_by_key = {}
            multi_line_items_data = {}

            # Load multi-line rows for all multi-line fields to evaluate formulas
            ml_fields = [f for f in fields_to_include if f.field_type == FieldType.multi_line_items]
            for mf in ml_fields:
                ml_rows = await _load_multi_line_items_rows_batch(
                    db, entry_ids=[entry.id], field=mf
                )
                multi_line_items_data[mf.key] = ml_rows.get(entry.id, [])

            for f in fields_to_include:
                if f.field_type == FieldType.formula or f.field_type == FieldType.multi_line_items:
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
                evaluated_fields[f.key] = {
                    "field_key": f.key,
                    "field_name": f.name,
                    "value": val,
                    "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                }
                if val is not None and f.field_type == FieldType.number:
                    value_by_key[f.key] = val

            for f in fields_to_include:
                if f.field_type == FieldType.formula:
                    fv_formula = fv_by_field.get(f.id)
                    if fv_formula and fv_formula.value_number is not None:
                        try:
                            value_by_key[f.key] = float(fv_formula.value_number)
                        except (TypeError, ValueError):
                            pass

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
                    evaluated_fields[f.key] = {
                        "field_key": f.key,
                        "field_name": f.name,
                        "value": computed,
                        "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                    }
        kpi_evaluated_data[kpi.id] = evaluated_fields

    # Yield structure
    sections_structure = []
    for s_idx, sec in enumerate(custom_report.sections):
        sec_num = str(s_idx + 1)
        sec_header = sec.custom_header or (sec.kpi.name if sec.kpi else f"Section {sec_num}")

        fields_struct = []
        for f_idx, f in enumerate(sec.fields):
            f_num = f"{sec_num}.{f_idx + 1}"
            kfield = f.kpi_field

            field_payload = {
                "id": f.id,
                "kpi_field_id": f.kpi_field_id,
                "field_key": kfield.key,
                "field_name": kfield.name,
                "field_type": kfield.field_type.value if hasattr(kfield.field_type, "value") else str(kfield.field_type),
                "number": f_num,
                "config": getattr(f, "config", None) or {},
            }
            if kfield.field_type == FieldType.multi_line_items:
                sub_fields_orm = getattr(kfield, "sub_fields") or []
                cfg = getattr(f, "config", None) or {}
                visible_keys = cfg.get("selected_columns")
                if visible_keys is None:
                    # Default to first 5 columns if not explicitly configured to prevent ReportLab crash on export
                    visible_keys = [sf.key for sf in sub_fields_orm][:5]

                all_subs = [{"key": sf.key, "name": getattr(sf, "name", sf.key), "field_type": sf.field_type.value if hasattr(sf.field_type, "value") else str(sf.field_type)} for sf in sub_fields_orm]
                key_to_sf = {sf["key"]: sf for sf in all_subs}

                field_payload["sub_fields"] = [key_to_sf[k] for k in visible_keys if k in key_to_sf]
                field_payload["sub_field_keys"] = [k for k in visible_keys]
            else:
                kpi_data = kpi_evaluated_data.get(kfield.kpi_id, {})
                field_eval = kpi_data.get(kfield.key, {})
                field_payload["value"] = field_eval.get("value")

            fields_struct.append(field_payload)

        sections_structure.append({
            "id": sec.id,
            "kpi_id": sec.kpi_id,
            "custom_header": sec_header,
            "number": sec_num,
            "fields": fields_struct
        })

    yield {
        "type": "structure",
        "sections": sections_structure
    }

    # Stream table rows in chunks
    for s_idx, sec in enumerate(custom_report.sections):
        for f_idx, f in enumerate(sec.fields):
            kfield = f.kpi_field
            if kfield.field_type != FieldType.multi_line_items:
                continue

            all_entries = entries_by_kpi.get(kfield.kpi_id, [])
            if not all_entries:
                yield {
                    "type": "table_rows",
                    "field_id": f.id,
                    "value_items": [],
                    "total_count": 0,
                    "offset": 0,
                    "done": True
                }
                continue

            kpi_td_raw = getattr(kfield.kpi, "time_dimension", None)
            kpi_td = TimeDimension(kpi_td_raw) if kpi_td_raw else None
            effective_td = effective_kpi_time_dimension(kpi_td, org_td)
            entries_sorted = sorted(
                all_entries,
                key=lambda e: period_key_sort_order(getattr(e, "period_key", "") or "", effective_td),
            )
            if len(entries_sorted) > 1:
                entries_sorted = [entries_sorted[-1]]
            entry = entries_sorted[0]

            count_stmt = (
                select(func.count(KpiMultiLineRow.id))
                .where(
                    KpiMultiLineRow.entry_id == entry.id,
                    KpiMultiLineRow.field_id == kfield.id,
                )
            )
            total_count = (await db.execute(count_stmt)).scalar_one() or 0

            yield {
                "type": "table_meta",
                "field_id": f.id,
                "total_count": total_count
            }

            if total_count == 0:
                continue

            chunk_size = 1000
            for offset in range(0, total_count, chunk_size):
                rows_stmt = (
                    select(KpiMultiLineRow.id, KpiMultiLineRow.row_index)
                    .where(
                        KpiMultiLineRow.entry_id == entry.id,
                        KpiMultiLineRow.field_id == kfield.id,
                    )
                    .order_by(KpiMultiLineRow.row_index)
                    .limit(chunk_size)
                    .offset(offset)
                )
                rows_res = await db.execute(rows_stmt)
                rows_list = rows_res.all()
                if not rows_list:
                    break

                row_ids = [r[0] for r in rows_list]

                cells_res = await db.execute(
                    select(
                        KpiMultiLineCell.row_id,
                        KpiMultiLineCell.value_text,
                        KpiMultiLineCell.value_number,
                        KpiMultiLineCell.value_boolean,
                        KpiMultiLineCell.value_date,
                        KpiMultiLineCell.value_json,
                        KPIFieldSubField.key
                    )
                    .join(KPIFieldSubField, KPIFieldSubField.id == KpiMultiLineCell.sub_field_id)
                    .where(KpiMultiLineCell.row_id.in_(row_ids))
                )
                cells_list = cells_res.all()

                cells_by_row = defaultdict(dict)
                for row_id, vt, vn, vb, vd, vj, sf_key in cells_list:
                    raw_val = None
                    if vj is not None:
                        raw_val = vj
                    elif vt is not None:
                        raw_val = vt
                    elif vn is not None:
                        raw_val = vn
                    elif vb is not None:
                        raw_val = vb
                    elif vd is not None:
                        try:
                            raw_val = vd.isoformat()
                        except Exception:
                            raw_val = str(vd)
                    cells_by_row[row_id][str(sf_key)] = raw_val

                chunk_rows = []
                for rid, r_idx in rows_list:
                    row_dict = cells_by_row.get(rid, {})
                    chunk_rows.append(row_dict)

                cfg = getattr(f, "config", None) or {}
                raw_filters = cfg.get("filters") or {}
                filtered_chunk_rows = []

                if chunk_rows:
                    if raw_filters and raw_filters.get("conditions"):
                        from app.entries.multi_item_filters import row_passes_filters
                        from app.entries.reference_filter_resolve import build_reference_resolution_map
                        conds = raw_filters.get("conditions")
                        resolution_maps = await build_reference_resolution_map(
                            db, org_id, yr, kfield, conds, chunk_rows
                        )
                        reference_field_types = {sf.key: sf.field_type.value if hasattr(sf.field_type, "value") else sf.field_type for sf in kfield.sub_fields}
                        for r in chunk_rows:
                            if row_passes_filters(r, raw_filters, resolution_maps=resolution_maps, reference_field_types=reference_field_types):
                                filtered_chunk_rows.append(r)
                    else:
                        filtered_chunk_rows = chunk_rows

                yield {
                    "type": "table_rows",
                    "field_id": f.id,
                    "value_items": filtered_chunk_rows,
                    "offset": offset,
                    "done": (offset + chunk_size >= total_count)
                }

    yield {"type": "done"}

