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
from markupsafe import escape as html_escape


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
        "body_blocks": getattr(rt, "body_blocks", None),
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
    if data.body_blocks is not None:
        rt.body_blocks = data.body_blocks
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


def _get_multi_line_field(kpis: list, kpi_id: int, field_key: str, entry_index: int = 0) -> dict | None:
    """
    Jinja-accessible helper: get the multi_line_items field dict for a given KPI and field key.
    Returns a dict with value_items (list of row dicts) and sub_field_keys (list of column keys),
    or None if not found / not multi_line. Use once then loop: {% set ml = get_multi_line_field(...) %}.
    """
    if not kpis:
        return None
    kpi = next((k for k in kpis if k.get("kpi_id") == kpi_id), None)
    if not kpi:
        return None
    entries = kpi.get("entries") or []
    if entry_index >= len(entries):
        return None
    entry = entries[entry_index]
    fields = entry.get("fields") or []
    field = next((f for f in fields if f.get("field_key") == field_key), None)
    if not field or field.get("field_type") != "multi_line_items":
        return None
    value_items = field.get("value_items")
    if not isinstance(value_items, list):
        return None
    sub_field_keys = field.get("sub_field_keys") or []
    return {"value_items": value_items, "sub_field_keys": sub_field_keys, "field_name": field.get("field_name", field_key)}


_jinja_env.globals["get_multi_line_field"] = _get_multi_line_field


def _apply_formula(value, formula: str):
    """
    Jinja-accessible helper: apply a formula expression to a single value.
    Formula can use variable 'value' (e.g. "value * 1.1", "round(value, 2)").
    Returns the computed result or the original value if not numeric / formula invalid.
    """
    if not formula or not str(formula).strip():
        return value
    try:
        num = float(value) if value is not None else 0
    except (TypeError, ValueError):
        return value
    result = evaluate_formula(str(formula).strip(), {"value": num}, None, None)
    return result if result is not None else value


_jinja_env.globals["apply_formula"] = _apply_formula


def _build_formula_context_from_report(kpis: list, kpi_id: int, entry_index: int):
    """
    Build (value_by_key, multi_line_items_data, other_kpi_values) from report kpis payload
    for the given kpi_id and entry_index. Used by evaluate_report_formula.
    """
    value_by_key: dict[str, float] = {}
    multi_line_items_data: dict[str, list] = {}
    other_kpi_values: dict[tuple[int, str], float] = {}

    if not kpis:
        return value_by_key, multi_line_items_data, other_kpi_values

    # Current KPI entry
    kpi_payload = next((k for k in kpis if k.get("kpi_id") == kpi_id), None)
    if kpi_payload:
        entries = kpi_payload.get("entries") or []
        entry = entries[entry_index] if entry_index < len(entries) else (entries[0] if entries else None)
        if entry:
            for f in entry.get("fields") or []:
                fkey = f.get("field_key")
                if not fkey:
                    continue
                ft = f.get("field_type") or ""
                val = f.get("value")
                if ft in ("number", "formula"):
                    try:
                        value_by_key[fkey] = float(val) if val is not None else 0.0
                    except (TypeError, ValueError):
                        value_by_key[fkey] = 0.0
                elif ft == "multi_line_items":
                    items = f.get("value_items")
                    if isinstance(items, list):
                        multi_line_items_data[fkey] = items

    # Other KPIs' numeric values (same entry index)
    for k in kpis:
        other_id = k.get("kpi_id")
        if other_id is None or other_id == kpi_id:
            continue
        entries = k.get("entries") or []
        other_entry = entries[entry_index] if entry_index < len(entries) else (entries[0] if entries else None)
        if not other_entry:
            continue
        for f in other_entry.get("fields") or []:
            ft = f.get("field_type") or ""
            if ft not in ("number", "formula"):
                continue
            fkey = f.get("field_key")
            if not fkey:
                continue
            val = f.get("value")
            try:
                other_kpi_values[(other_id, fkey)] = float(val) if val is not None else 0.0
            except (TypeError, ValueError):
                other_kpi_values[(other_id, fkey)] = 0.0

    return value_by_key, multi_line_items_data, other_kpi_values


def _evaluate_report_formula(kpis: list, expression: str, kpi_id: int, entry_index: int = 0):
    """
    Jinja-accessible helper: evaluate a full formula expression in report context.
    Uses the same expression language as KPI formula fields (field refs, SUM_ITEMS, KPI_FIELD, etc.).
    """
    if not expression or not str(expression).strip():
        return ""
    expression = str(expression).strip()
    value_by_key, multi_line_items_data, other_kpi_values = _build_formula_context_from_report(
        kpis, kpi_id, entry_index
    )
    result = evaluate_formula(expression, value_by_key, multi_line_items_data, other_kpi_values)
    if result is None:
        return ""
    return result


_jinja_env.globals["evaluate_report_formula"] = _evaluate_report_formula


def _blocks_to_jinja(blocks: list[dict]) -> str:
    """
    Convert visual builder block list to Jinja2 HTML template.
    Block types: title, section_heading, spacer, text, domain_list, domain_categories,
    domain_kpis, kpi_table, kpi_grid, kpi_list, single_value.
    """
    out: list[str] = []
    for b in blocks:
        block_type = (b.get("type") or "").strip()
        if not block_type:
            continue
        if block_type == "title":
            use_name = b.get("useTemplateName", True)
            custom = (b.get("customText") or "").strip()
            if custom:
                out.append(f'<h1 class="report-title">{custom}</h1>')
            elif use_name:
                out.append('<h1 class="report-title">{{ template_name }}</h1>')
            out.append('<p class="report-year">Year: {{ year }}</p>')
        elif block_type == "section_heading":
            text = (b.get("text") or "").strip() or "Section"
            level = min(4, max(1, int(b.get("level") or 2)))
            out.append(f"<h{level} class=\"report-section\">{text}</h{level}>")
        elif block_type == "spacer":
            size = b.get("size") or "medium"
            height = {"small": "16px", "medium": "24px", "large": "40px"}.get(size, "24px")
            out.append(f'<div class="report-spacer" style="height: {height}"></div>')
        elif block_type == "text":
            content = (b.get("content") or "").strip()
            if content:
                out.append(f'<div class="report-text-block">{content}</div>')
        elif block_type == "domain_list":
            domain_ids = b.get("domainIds") or []
            if domain_ids:
                ids_str = ", ".join(str(i) for i in domain_ids)
                out.append(
                    "{% for domain in domains %}"
                    f"{{% if domain.id in [{ids_str}] %}}"
                    '<div class="report-domain"><h3>{{ domain.name }}</h3></div>'
                    "{% endif %}{% endfor %}"
                )
            else:
                out.append(
                    '{% for domain in domains %}'
                    '<div class="report-domain"><h3>{{ domain.name }}</h3></div>'
                    '{% endfor %}'
                )
        elif block_type == "domain_categories":
            domain_ids = b.get("domainIds") or []
            if domain_ids:
                ids_str = ", ".join(str(i) for i in domain_ids)
                out.append(
                    "{% for domain in domains %}"
                    f"{{% if domain.id in [{ids_str}] %}}"
                    '<div class="report-domain"><h3>{{ domain.name }}</h3>'
                    '<ul>{% for cat in domain.categories %}<li>{{ cat.name }}</li>{% endfor %}</ul></div>'
                    "{% endif %}{% endfor %}"
                )
            else:
                out.append(
                    "{% for domain in domains %}"
                    '<div class="report-domain"><h3>{{ domain.name }}</h3>'
                    '<ul>{% for cat in domain.categories %}<li>{{ cat.name }}</li>{% endfor %}</ul></div>'
                    "{% endfor %}"
                )
        elif block_type == "domain_kpis":
            domain_ids = b.get("domainIds") or []
            if domain_ids:
                ids_str = ", ".join(str(i) for i in domain_ids)
                out.append(
                    "{% for domain in domains %}"
                    f"{{% if domain.id in [{ids_str}] %}}"
                    '<div class="report-domain"><h3>{{ domain.name }}</h3>'
                    '<ul>{% for cat in domain.categories %}<li>{{ cat.name }}'
                    '<ul>{% for kpi in cat.kpis %}<li>{{ kpi.kpi_name }}</li>{% endfor %}</ul>'
                    '</li>{% endfor %}</ul></div>'
                    "{% endif %}{% endfor %}"
                )
            else:
                out.append(
                    "{% for domain in domains %}"
                    '<div class="report-domain"><h3>{{ domain.name }}</h3>'
                    '<ul>{% for cat in domain.categories %}<li>{{ cat.name }}'
                    '<ul>{% for kpi in cat.kpis %}<li>{{ kpi.kpi_name }}</li>{% endfor %}</ul>'
                    '</li>{% endfor %}</ul></div>'
                    "{% endfor %}"
                )
        elif block_type == "single_value":
            kpi_id = int(b.get("kpiId") or 0)
            field_key = (b.get("fieldKey") or "").strip()
            sub_key = (b.get("subFieldKey") or "").strip() or None
            entry_idx = int(b.get("entryIndex") or 0)
            if not field_key:
                continue
            sub_arg = f", '{sub_key}'" if sub_key else ", none"
            out.append(
                f'<span class="report-single-value">'
                f"{{{{ get_kpi_field_value(kpis, {kpi_id}, '{field_key}'{sub_arg}, {entry_idx}) }}}}"
                f"</span>"
            )
        elif block_type == "kpi_table":
            kpi_ids = b.get("kpiIds") or []
            field_keys = b.get("fieldKeys") or []
            one_per_kpi = b.get("oneTablePerKpi", True)
            _cell_multi = (
                "{% if f.field_type == 'multi_line_items' and f.value_items %}"
                "<table border=\"1\" cellpadding=\"4\" style=\"border-collapse: collapse; width: 100%;\">"
                "{% for item in f.value_items %}<tr>{% for sub_key in f.sub_field_keys %}<td>{{ item[sub_key] }}</td>{% endfor %}</tr>{% endfor %}"
                "</table>{% else %}{{ f.value }}{% endif %}"
            )
            if not kpi_ids and not field_keys:
                out.append(
                    '<div class="report-kpi-table">'
                    "{% if kpis %}"
                    "{% for kpi in kpis %}"
                    '<h4>{{ kpi.kpi_name }}</h4><table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;">'
                    '<thead><tr>{% for f in kpi.entries[0].fields if kpi.entries %}<th>{{ f.field_name }}</th>{% endfor %}</tr></thead>'
                    '<tbody>'
                    "{% for entry in kpi.entries %}"
                    '<tr>{% for f in entry.fields %}<td>' + _cell_multi + '</td>{% endfor %}</tr>'
                    "{% endfor %}"
                    "</tbody></table>"
                    "{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>"
                )
            else:
                fid_list = ", ".join(str(i) for i in kpi_ids)
                fkeys_list = ", ".join(repr(k) for k in field_keys)
                _cell_by_key = (
                    "{% for f in entry.fields %}{% if f.field_key == key %}<td>" + _cell_multi + "</td>{% endif %}{% endfor %}"
                )
                out.append(
                    f"{{% set kpi_ids_set = [{fid_list}] %}}"
                    f"{{% set field_keys_list = [{fkeys_list}] %}}"
                    '<div class="report-kpi-table">'
                    "{% if kpis %}"
                    "{% for kpi in kpis %}"
                    "{% if kpi.kpi_id in kpi_ids_set %}"
                    '<h4>{{ kpi.kpi_name }}</h4><table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;">'
                    '<thead><tr>{% for key in field_keys_list %}<th>{{ key }}</th>{% endfor %}</tr></thead>'
                    '<tbody>'
                    "{% for entry in kpi.entries %}"
                    '<tr>{% for key in field_keys_list %}' + _cell_by_key + "{% endfor %}</tr>"
                    "{% endfor %}"
                    "</tbody></table>"
                    "{% endif %}"
                    "{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>"
                )
        elif block_type == "simple_table":
            rows = b.get("rows") or []
            row_parts = []
            for row in rows:
                cells = row.get("cells") if isinstance(row, dict) else []
                cell_parts = []
                for cell in cells:
                    if not isinstance(cell, dict):
                        cell_parts.append("<td></td>")
                        continue
                    ctype = cell.get("type") or "text"
                    if ctype == "text":
                        content = (cell.get("content") or "").strip()
                        cell_parts.append(f"<td>{html_escape(content)}</td>")
                    elif ctype == "kpi":
                        kpi_id = int(cell.get("kpiId") or 0)
                        field_key = (cell.get("fieldKey") or "").strip().replace("\\", "\\\\").replace("'", "\\'")
                        sub_key = (cell.get("subFieldKey") or "").strip()
                        sub_field_group_fn = (cell.get("subFieldGroupFn") or "SUM_ITEMS").strip() or "SUM_ITEMS"
                        entry_idx = int(cell.get("entryIndex") or 0)
                        if cell.get("asGroup"):
                            cell_parts.append(
                                "<td>{% set _ml = get_multi_line_field(kpis, " + str(kpi_id) + ", '" + field_key + "', " + str(entry_idx) + ") %}"
                                "{% if _ml %}<table border=\"1\" cellpadding=\"4\" style=\"border-collapse: collapse;\">"
                                "<tr>{% for sk in _ml.sub_field_keys %}<th>{{ sk }}</th>{% endfor %}</tr>"
                                "{% for item in _ml.value_items %}<tr>{% for sk in _ml.sub_field_keys %}<td>{{ item[sk] }}</td>{% endfor %}</tr>{% endfor %}"
                                "</table>{% endif %}</td>"
                            )
                        elif sub_key:
                            raw_field_key = (cell.get("fieldKey") or "").strip()
                            formula_expr = f"{sub_field_group_fn}({raw_field_key}, {sub_key})"
                            formula_escaped = formula_expr.replace("\\", "\\\\").replace("'", "\\'")
                            cell_parts.append(
                                f"<td>{{{{ evaluate_report_formula(kpis, '{formula_escaped}', {kpi_id}, {entry_idx}) }}}}</td>"
                            )
                        else:
                            sub_arg = ", none"
                            cell_parts.append(
                                f"<td>{{{{ get_kpi_field_value(kpis, {kpi_id}, '{field_key}'{sub_arg}, {entry_idx}) }}}}</td>"
                            )
                    elif ctype == "formula":
                        kpi_id = int(cell.get("kpiId") or 0)
                        entry_idx = int(cell.get("entryIndex") or 0)
                        formula = (cell.get("formula") or "").strip().replace("\\", "\\\\").replace("'", "\\'")
                        cell_parts.append(
                            f"<td>{{{{ evaluate_report_formula(kpis, '{formula}', {kpi_id}, {entry_idx}) }}}}</td>"
                        )
                    else:
                        cell_parts.append("<td></td>")
                row_parts.append("<tr>" + "".join(cell_parts) + "</tr>")
            out.append(
                '<div class="report-simple-table"><table border="1" cellpadding="6" cellspacing="0" style="border-collapse: collapse; width: 100%;">'
                "<tbody>" + "".join(row_parts) + "</tbody></table></div>"
            )
        elif block_type == "kpi_grid":
            kpi_ids = b.get("kpiIds") or []
            field_keys = b.get("fieldKeys") or []
            _grid_cell_multi = (
                "{% if f.field_type == 'multi_line_items' and f.value_items %}"
                "<table border=\"1\" cellpadding=\"4\" style=\"border-collapse: collapse;\">"
                "{% for item in f.value_items %}<tr>{% for sub_key in f.sub_field_keys %}<td>{{ item[sub_key] }}</td>{% endfor %}</tr>{% endfor %}"
                "</table>{% else %}{{ f.value }}{% endif %}"
            )
            if not kpi_ids and not field_keys:
                out.append(
                    '<div class="report-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">'
                    "{% if kpis %}{% for kpi in kpis %}"
                    "{% for entry in kpi.entries %}"
                    '<div class="report-card" style="border: 1px solid #ddd; padding: 1rem; border-radius: 8px;">'
                    '<h4 style="margin-top: 0;">{{ kpi.kpi_name }}</h4>'
                    "{% for f in entry.fields %}"
                    '<p style="margin: 0.25rem 0;"><strong>{{ f.field_name }}:</strong> ' + _grid_cell_multi + '</p>'
                    "{% endfor %}</div>"
                    "{% endfor %}{% endfor %}{% endif %}</div>"
                )
            else:
                fid_list = ", ".join(str(i) for i in kpi_ids)
                fkeys_list = ", ".join(repr(k) for k in field_keys)
                _grid_cell_by_key = (
                    "{% for f in entry.fields %}{% if f.field_key == key %}" + _grid_cell_multi + "{% endif %}{% endfor %}"
                )
                out.append(
                    f"{{% set kpi_ids_set = [{fid_list}] %}}"
                    f"{{% set field_keys_list = [{fkeys_list}] %}}"
                    '<div class="report-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem;">'
                    "{% if kpis %}{% for kpi in kpis %}"
                    "{% if kpi.kpi_id in kpi_ids_set %}"
                    "{% for entry in kpi.entries %}"
                    '<div class="report-card" style="border: 1px solid #ddd; padding: 1rem; border-radius: 8px;">'
                    '<h4 style="margin-top: 0;">{{ kpi.kpi_name }}</h4>'
                    "{% for key in field_keys_list %}"
                    '<p style="margin: 0.25rem 0;"><strong>{{ key }}:</strong> ' + _grid_cell_by_key + '</p>'
                    "{% endfor %}</div>"
                    "{% endfor %}{% endif %}{% endfor %}{% endif %}</div>"
                )
        elif block_type == "kpi_list":
            kpi_ids = b.get("kpiIds") or []
            field_keys = b.get("fieldKeys") or []
            _list_cell_multi = (
                "{% if f.field_type == 'multi_line_items' and f.value_items %}"
                "<ul style=\"margin: 0.25rem 0;\">{% for item in f.value_items %}<li>{% for sub_key in f.sub_field_keys %}{{ item[sub_key] }}{% if not loop.last %} – {% endif %}{% endfor %}</li>{% endfor %}</ul>"
                "{% else %}{{ f.value }}{% endif %}"
            )
            if not kpi_ids and not field_keys:
                out.append(
                    '<div class="report-kpi-list">'
                    "{% if kpis %}{% for kpi in kpis %}"
                    '<h4>{{ kpi.kpi_name }}</h4><dl style="margin: 0.5rem 0;">'
                    "{% for entry in kpi.entries %}"
                    "{% for f in entry.fields %}"
                    '<dt style="font-weight: 600;">{{ f.field_name }}</dt><dd style="margin-left: 1rem;">' + _list_cell_multi + '</dd>'
                    "{% endfor %}{% endfor %}</dl>"
                    "{% endfor %}{% else %}<p>No data.</p>{% endif %}</div>"
                )
            else:
                fid_list = ", ".join(str(i) for i in kpi_ids)
                fkeys_list = ", ".join(repr(k) for k in field_keys)
                _list_cell_by_key = (
                    "{% for f in entry.fields %}{% if f.field_key == key %}" + _list_cell_multi + "{% endif %}{% endfor %}"
                )
                out.append(
                    f"{{% set kpi_ids_set = [{fid_list}] %}}"
                    f"{{% set field_keys_list = [{fkeys_list}] %}}"
                    '<div class="report-kpi-list">'
                    "{% if kpis %}{% for kpi in kpis %}"
                    "{% if kpi.kpi_id in kpi_ids_set %}"
                    '<h4>{{ kpi.kpi_name }}</h4><dl style="margin: 0.5rem 0;">'
                    "{% for entry in kpi.entries %}"
                    "{% for key in field_keys_list %}"
                    '<dt style="font-weight: 600;">{{ key }}</dt><dd style="margin-left: 1rem;">' + _list_cell_by_key + '</dd>'
                    "{% endfor %}{% endfor %}</dl>"
                    "{% endif %}{% endfor %}{% endif %}</div>"
                )
    if not out:
        return "<p>No content. Add blocks in the visual designer.</p>"
    return "\n".join(out)


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
            .options(selectinload(KPI.fields).selectinload(KPIField.sub_fields))
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
                field_payload = {
                    "field_key": f.key,
                    "field_name": f.name,
                    "value": val,
                    "field_type": f.field_type.value if hasattr(f.field_type, "value") else str(f.field_type),
                    "show_on_card": show_on_card,
                }
                if f.field_type == FieldType.multi_line_items and isinstance(val, list):
                    field_payload["value_items"] = val
                    field_payload["sub_field_keys"] = [sf.key for sf in (getattr(f, "sub_fields") or [])]
                field_values_out.append(field_payload)
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
    Render report using the template's body_template or body_blocks and
    the structured KPI data produced by generate_report_data.
    When body_blocks is set, body_template is generated from it first.
    """
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    body_template = rt.body_template
    if getattr(rt, "body_blocks", None):
        body_template = _blocks_to_jinja(rt.body_blocks)
    if not body_template:
        return None
    data = await generate_report_data(db, template_id, org_id, year=year)
    if not data:
        return None
    template = _jinja_env.from_string(body_template)
    return template.render(**data)


async def evaluate_report_snippet(
    db: AsyncSession,
    template_id: int,
    org_id: int,
    snippet_type: str,
    year: int | None = None,
    kpi_id: int | None = None,
    field_key: str | None = None,
    sub_field_key: str | None = None,
    sub_field_group_fn: str | None = None,
    entry_index: int = 0,
    expression: str | None = None,
) -> str | int | float | None:
    """
    Evaluate a single KPI value or formula in report context for preview.
    Returns the computed value or None if not found / error.
    """
    rt = await get_report_template(db, template_id, org_id)
    if not rt:
        return None
    yr = year if year is not None else rt.year
    data = await generate_report_data(db, template_id, org_id, year=yr)
    if not data or "kpis" not in data:
        return None
    kpis = data["kpis"]

    if snippet_type == "formula":
        if expression is None or kpi_id is None:
            return None
        result = _evaluate_report_formula(kpis, expression.strip(), kpi_id, entry_index)
        return result if result != "" else None

    if snippet_type == "kpi_value":
        if kpi_id is None or not field_key:
            return None
        if sub_field_key and sub_field_group_fn:
            formula_expr = f"{sub_field_group_fn.strip()}({field_key}, {sub_field_key})"
            result = _evaluate_report_formula(kpis, formula_expr, kpi_id, entry_index)
            return result if result != "" else None
        val = _get_kpi_field_value(
            kpis, kpi_id, field_key, sub_field_key or None, entry_index
        )
        return val if val != "" else None

    return None
