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
    ReportTemplateDomain,
    ReportTemplateTextBlock,
    Category,
    KPICategory,
)
from app.reports.schemas import ReportTemplateCreate, ReportTemplateUpdate, ReportTemplateKPIAdd
from app.formula_engine.evaluator import evaluate_formula
from app.core.models import FieldType
from app.entries.service import _load_other_kpi_values
from jinja2 import Environment, BaseLoader, select_autoescape


async def create_report_template(
    db: AsyncSession, org_id: int, data: ReportTemplateCreate
) -> ReportTemplate:
    """Create report template."""
    rt = ReportTemplate(
        organization_id=org_id,
        name=data.name,
        description=data.description,
        body_template=data.body_template,
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


async def get_report_template_detail(
    db: AsyncSession, template_id: int, org_id: int
) -> dict | None:
    """Get template with body_template, attached_domains, and kpis_from_domains (read-only; no add/remove)."""
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    # Attached domains (template is attached to these domains)
    rtd_result = await db.execute(
        select(ReportTemplateDomain, Domain.name)
        .join(Domain, Domain.id == ReportTemplateDomain.domain_id)
        .where(ReportTemplateDomain.report_template_id == template_id)
    )
    attached_domains = [{"id": row[0].domain_id, "name": row[1]} for row in rtd_result.all()]
    domain_ids = [d["id"] for d in attached_domains]

    # KPIs that will be included (all KPIs from attached domains, with all fields)
    kpis_from_domains = []
    if domain_ids:
        kpi_ids_subq = _kpi_ids_in_domains_query(domain_ids)
        result = await db.execute(
            select(KPI)
            .where(KPI.id.in_(kpi_ids_subq), KPI.organization_id == org_id)
            .order_by(KPI.sort_order, KPI.name)
            .options(selectinload(KPI.fields))
        )
        for kpi in result.unique().scalars().all():
            field_count = len(kpi.fields) if kpi.fields else 0
            kpis_from_domains.append({
                "kpi_id": kpi.id,
                "kpi_name": kpi.name,
                "fields_count": field_count,
            })

    return {
        "id": rt.id,
        "organization_id": rt.organization_id,
        "name": rt.name,
        "description": rt.description,
        "year": rt.year,
        "body_template": rt.body_template,
        "attached_domains": attached_domains,
        "kpis_from_domains": kpis_from_domains,
    }


async def list_report_templates(
    db: AsyncSession, org_id: int, year: int | None = None, only_attached: bool = False
) -> list[ReportTemplate]:
    """List report templates in organization."""
    q = select(ReportTemplate).where(ReportTemplate.organization_id == org_id)
    if year is not None:
        q = q.where(ReportTemplate.year == year)
    if only_attached:
        q = q.join(ReportTemplateDomain, ReportTemplateDomain.report_template_id == ReportTemplate.id).distinct()
    q = q.order_by(ReportTemplate.name)
    result = await db.execute(q)
    return list(result.scalars().all())


async def list_domain_report_templates(
    db: AsyncSession, org_id: int, domain_id: int, year: int | None = None
) -> list[ReportTemplate]:
    """List templates attached to a specific domain within the org."""
    q = (
        select(ReportTemplate)
        .join(ReportTemplateDomain, ReportTemplateDomain.report_template_id == ReportTemplate.id)
        .join(Domain, Domain.id == ReportTemplateDomain.domain_id)
        .where(Domain.id == domain_id, Domain.organization_id == org_id)
        .distinct()
        .order_by(ReportTemplate.name)
    )
    if year is not None:
        q = q.where(ReportTemplate.year == year)
    result = await db.execute(q)
    return list(result.scalars().all())


async def attach_template_to_domain(
    db: AsyncSession, template_id: int, org_id: int, domain_id: int
) -> bool:
    """Attach template to domain (must be in same org)."""
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return False
    d = (await db.execute(select(Domain).where(Domain.id == domain_id, Domain.organization_id == org_id))).scalar_one_or_none()
    if not d:
        return False
    existing = (
        await db.execute(
            select(ReportTemplateDomain).where(
                ReportTemplateDomain.report_template_id == template_id,
                ReportTemplateDomain.domain_id == domain_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return True
    db.add(ReportTemplateDomain(report_template_id=template_id, domain_id=domain_id))
    await db.flush()
    return True


async def detach_template_from_domain(
    db: AsyncSession, template_id: int, org_id: int, domain_id: int
) -> bool:
    """Detach template from domain."""
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return False
    row = (
        await db.execute(
            select(ReportTemplateDomain)
            .join(Domain, Domain.id == ReportTemplateDomain.domain_id)
            .where(
                ReportTemplateDomain.report_template_id == template_id,
                Domain.id == domain_id,
                Domain.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        return False
    await db.delete(row)
    await db.flush()
    return True


async def add_text_block(
    db: AsyncSession, template_id: int, org_id: int, title: str | None, content: str, sort_order: int = 0
) -> ReportTemplateTextBlock | None:
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    tb = ReportTemplateTextBlock(report_template_id=template_id, title=title, content=content or "", sort_order=sort_order)
    db.add(tb)
    await db.flush()
    return tb


async def delete_text_block(
    db: AsyncSession, template_id: int, org_id: int, text_block_id: int
) -> bool:
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return False
    tb = (
        await db.execute(
            select(ReportTemplateTextBlock).where(
                ReportTemplateTextBlock.id == text_block_id,
                ReportTemplateTextBlock.report_template_id == template_id,
            )
        )
    ).scalar_one_or_none()
    if not tb:
        return False
    await db.delete(tb)
    await db.flush()
    return True


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
    if data.body_template is not None:
        rt.body_template = data.body_template
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
    # Verify KPI belongs to org (KPI has organization_id; domain is optional)
    result = await db.execute(
        select(KPI).where(KPI.id == data.kpi_id, KPI.organization_id == org_id)
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
    """Check if user can view/print/export report.

    Rules:
    - SUPER_ADMIN: can access any template.
    - ORG_ADMIN: can access templates in their org *only if attached to at least one domain*.
    - Other roles: must be explicitly assigned (ReportAccessPermission).
    """
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
            select(ReportTemplate)
            .join(ReportTemplateDomain, ReportTemplateDomain.report_template_id == ReportTemplate.id)
            .join(Domain, Domain.id == ReportTemplateDomain.domain_id)
            .where(
                ReportTemplate.id == template_id,
                ReportTemplate.organization_id == user.organization_id,
                Domain.organization_id == user.organization_id,
            )
            .distinct()
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


def _get_kpi_field_value(kpis: list, kpi_id: int, field_key: str, sub_field_key: str | None = None, entry_index: int = 0):
    """
    Jinja-accessible helper: get value for a KPI field (optionally a sub-field of multi_line_items).
    Returns the value from the first entry by default (entry_index=0); used for placeholder rendering.
    """
    if not kpis:
        return ""
    kpi = next((k for k in kpis if k.get("kpi_id") == kpi_id), None)
    if not kpi:
        return ""
    entries = kpi.get("entries") or []
    if entry_index >= len(entries):
        return ""
    entry = entries[entry_index]
    fields = entry.get("fields") or []
    field = next((f for f in fields if f.get("field_key") == field_key), None)
    if not field:
        return ""
    val = field.get("value")
    if sub_field_key and isinstance(val, list):
        # multi_line_items: val is list of dicts; extract sub_field_key from each item
        parts = []
        for item in val:
            if isinstance(item, dict) and sub_field_key in item:
                parts.append(item[sub_field_key])
        return ", ".join(str(p) for p in parts) if parts else ""
    if val is None:
        return ""
    return val


_jinja_env = Environment(
    loader=BaseLoader(),
    autoescape=True,
)
_jinja_env.globals["get_kpi_field_value"] = _get_kpi_field_value


def _kpi_ids_in_domains_query(domain_ids: list[int]):
    """Subquery: KPI ids that have at least one category in any of the given domains."""
    return (
        select(KPICategory.kpi_id)
        .join(Category, Category.id == KPICategory.category_id)
        .where(Category.domain_id.in_(domain_ids))
        .distinct()
    )


async def generate_report_data(
    db: AsyncSession, template_id: int, org_id: int, year: int | None = None
) -> dict | None:
    """
    Compile report data from KPI entries for the template.
    Uses all KPIs (and all their fields) that are attached to the domains this template is attached to.
    Returns structured dict: { template_name, year, kpis: [ { kpi_name, entries: [ { fields } ] } ] }
    Formula fields are evaluated.
    """
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    yr = year or rt.year

    # Domains this template is attached to
    rtd_result = await db.execute(
        select(ReportTemplateDomain.domain_id).where(
            ReportTemplateDomain.report_template_id == template_id
        )
    )
    domain_ids = [row[0] for row in rtd_result.all()]

    # KPIs that belong to any of these domains (via categories in that domain)
    if not domain_ids:
        template_kpis: list[KPI] = []
    else:
        kpi_ids_subq = _kpi_ids_in_domains_query(domain_ids)
        result = await db.execute(
            select(KPI)
            .where(KPI.id.in_(kpi_ids_subq), KPI.organization_id == org_id)
            .order_by(KPI.sort_order, KPI.name)
            .options(selectinload(KPI.fields))
        )
        template_kpis = list(result.unique().scalars().all())

    # Load text blocks
    text_blocks_result = await db.execute(
        select(ReportTemplateTextBlock)
        .where(ReportTemplateTextBlock.report_template_id == template_id)
        .order_by(ReportTemplateTextBlock.sort_order, ReportTemplateTextBlock.id)
    )
    text_blocks = [
        {"id": tb.id, "title": tb.title, "content": tb.content, "sort_order": tb.sort_order}
        for tb in text_blocks_result.scalars().all()
    ]

    out = {
        "template_name": rt.name,
        "template_id": rt.id,
        "year": yr,
        "text_blocks": text_blocks,
        "kpis": [],
    }
    for kpi in template_kpis:
        fields_to_include = list(kpi.fields)
        # One submitted entry per org per KPI per year
        entries_result = await db.execute(
            select(KPIEntry)
            .where(
                KPIEntry.organization_id == org_id,
                KPIEntry.kpi_id == kpi.id,
                KPIEntry.year == yr,
                KPIEntry.is_draft == False,
            )
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
                # Skip formula fields here; they are added once with computed value in the loop below
                if f.field_type == FieldType.formula:
                    continue
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
                card_ids = kpi.card_display_field_ids or []
                show_on_card = f.id in card_ids if isinstance(card_ids, list) else False
                field_values_out.append({
                    "field_key": f.key,
                    "field_name": f.name,
                    "value": val,
                    "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                    "show_on_card": show_on_card,
                })
                if val is not None and f.field_type == FieldType.number:
                    value_by_key[f.key] = val
            # Other KPIs' numeric values for KPI_FIELD(kpi_id, field_key) in formulas
            other_kpi_values = await _load_other_kpi_values(
                db, entry.year, org_id, kpi.id
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
                    card_ids_f = kpi.card_display_field_ids or []
                    show_on_card_f = f.id in card_ids_f if isinstance(card_ids_f, list) else False
                    field_values_out.append({
                        "field_key": f.key,
                        "field_name": f.name,
                        "value": computed,
                        "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                        "show_on_card": show_on_card_f,
                    })
                    if computed is not None:
                        value_by_key[f.key] = computed
            rows.append({"entry_id": entry.id, "fields": field_values_out})
        out["kpis"].append({
            "kpi_id": kpi.id,
            "kpi_name": kpi.name,
            "entries": rows,
        })

    # Build domains → categories → KPIs for template access
    out["domains"] = []
    if domain_ids and out["kpis"]:
        kpi_payload_by_id = {p["kpi_id"]: p for p in out["kpis"]}
        template_kpi_ids = set(kpi_payload_by_id.keys())
        domains_result = await db.execute(
            select(Domain)
            .where(Domain.id.in_(domain_ids))
            .order_by(Domain.sort_order, Domain.name)
            .options(selectinload(Domain.categories))
        )
        domains_orm = list(domains_result.unique().scalars().all())
        category_ids = [c.id for d in domains_orm for c in (d.categories or [])]
        category_to_kpi_ids = defaultdict(list)
        if category_ids:
            kc_result = await db.execute(
                select(KPICategory.kpi_id, KPICategory.category_id).where(
                    KPICategory.category_id.in_(category_ids),
                    KPICategory.kpi_id.in_(template_kpi_ids),
                )
            )
            for kpi_id, cat_id in kc_result.all():
                category_to_kpi_ids[cat_id].append(kpi_id)
        for d in domains_orm:
            categories_out = []
            for cat in sorted(d.categories or [], key=lambda c: (c.sort_order, c.name)):
                kpi_ids_in_cat = category_to_kpi_ids.get(cat.id, [])
                kpis_in_cat = [kpi_payload_by_id[kid] for kid in kpi_ids_in_cat if kid in kpi_payload_by_id]
                categories_out.append({
                    "id": cat.id,
                    "name": cat.name,
                    "kpis": kpis_in_cat,
                })
            out["domains"].append({
                "id": d.id,
                "name": d.name,
                "categories": categories_out,
            })

    return out


async def render_report_html(
    db: AsyncSession, template_id: int, org_id: int, year: int | None = None
) -> str | None:
    """
    Render report using the template's body_template (if present) and
    the structured KPI data produced by generate_report_data.
    """
    # Load template including body_template
    rt = await get_report_template(db, template_id, org_id)
    if not rt or not rt.body_template:
        return None
    data = await generate_report_data(db, template_id, org_id, year=year)
    if not data:
        return None
    template = _jinja_env.from_string(rt.body_template)
    # Expose top-level keys directly to the template (template_name, year, kpis, text_blocks, etc.)
    return template.render(**data)
