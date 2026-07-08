"""KPI field CRUD with tenant isolation via KPI -> domain -> org."""

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func
from sqlalchemy.orm import selectinload

from app.core.models import (
    KPIField,
    KPIFieldOption,
    KPIFieldSubField,
    KPI,
    KPIFieldValue,
    ReportTemplateField,
    KpiFieldAccess,
    KpiFieldAccessByRole,
    KpiSection,
    FieldType,
)
from app.fields.schemas import KPIFieldCreate, KPIFieldUpdate, KPIFieldOptionCreate


async def _kpi_org_id(db: AsyncSession, kpi_id: int) -> int | None:
    """Return organization_id for KPI or None (KPI has organization_id directly)."""
    result = await db.execute(select(KPI.organization_id).where(KPI.id == kpi_id))
    row = result.one_or_none()
    return row[0] if row else None


async def get_or_create_general_section(db: AsyncSession, kpi_id: int) -> KpiSection:
    """Return this KPI's "General" section, lazily creating it if it doesn't exist yet.
    "General" is the default unassigned pool every field falls back to."""
    result = await db.execute(select(KpiSection).where(KpiSection.kpi_id == kpi_id, KpiSection.name == "General"))
    general = result.scalars().first()
    if general:
        return general
    general = KpiSection(kpi_id=kpi_id, name="General", sort_order=0)
    db.add(general)
    await db.flush()
    return general


async def _resolve_section_id(db: AsyncSession, kpi_id: int, section_id: int | None) -> int:
    """Validate that section_id belongs to this KPI; otherwise fall back to (lazily creating if
    needed) the KPI's "General" section. Guarantees every field always resolves to a valid
    section_id — the "every field must belong to a section" rule is enforced here, at the
    application layer, for any caller (UI or direct API), not just well-behaved frontend forms."""
    if section_id is not None:
        result = await db.execute(
            select(KpiSection.id).where(KpiSection.id == section_id, KpiSection.kpi_id == kpi_id)
        )
        if result.scalar_one_or_none() is not None:
            return section_id
    general = await get_or_create_general_section(db, kpi_id)
    return general.id


async def _validate_conditional_config(db: AsyncSession, kpi_id: int, config: dict | None) -> None:
    if not config:
        return
    trigger_id = config.get("condition_trigger_field_id")
    if trigger_id is not None:
        result = await db.execute(
            select(KPIField).where(KPIField.id == int(trigger_id), KPIField.kpi_id == kpi_id)
        )
        trigger = result.scalar_one_or_none()
        if not trigger:
            raise ValueError("Trigger field not found in this KPI")
        if trigger.field_type != FieldType.boolean:
            raise ValueError("Trigger field must be a Boolean field")


async def create_field(db: AsyncSession, org_id: int, data: KPIFieldCreate) -> KPIField | None:
    """Create KPI field (KPI must belong to org)."""
    if await _kpi_org_id(db, data.kpi_id) != org_id:
        return None
    if data.config:
        await _validate_conditional_config(db, data.kpi_id, data.config)
    if data.field_type == FieldType.multi_line_items:
        section_id = await _resolve_section_id(db, data.kpi_id, getattr(data, "section_id", None))
    else:
        section_id = None
    field = KPIField(
        kpi_id=data.kpi_id,
        name=data.name,
        key=data.key,
        field_type=data.field_type,
        formula_expression=data.formula_expression,
        is_required=data.is_required,
        sort_order=data.sort_order,
        config=data.config,
        section_id=section_id,
        carry_forward_data=getattr(data, "carry_forward_data", False),
        full_page_multi_items=getattr(data, "full_page_multi_items", False),
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
    for i, sub in enumerate(data.sub_fields or []):
        db.add(
            KPIFieldSubField(
                field_id=field.id,
                name=sub.name,
                key=sub.key,
                field_type=sub.field_type,
                is_required=sub.is_required,
                sort_order=sub.sort_order if sub.sort_order else i,
                config=sub.config if hasattr(sub, "config") else None,
            )
        )
    await db.flush()
    return field


async def get_field(db: AsyncSession, field_id: int, org_id: int) -> KPIField | None:
    """Get field by id; KPI must belong to org."""
    result = await db.execute(
        select(KPIField)
        .join(KPIField.kpi)
        .where(KPIField.id == field_id, KPI.organization_id == org_id)
        .options(selectinload(KPIField.options), selectinload(KPIField.sub_fields))
    )
    return result.scalar_one_or_none()


async def list_kpi_field_definitions(
    db: AsyncSession, kpi_id: int, org_id: int
) -> list[KPIField]:
    """
    Field rows for a KPI (id, key, name, field_type, etc.) with no options/sub_fields.
    Use for read-heavy paths (e.g. widget-data) to avoid loading thousands of option/child rows
    that are not needed to build a key→id map.
    """
    result = await db.execute(
        select(KPIField)
        .join(KPIField.kpi)
        .where(KPIField.kpi_id == kpi_id, KPI.organization_id == org_id)
        .order_by(KPIField.sort_order, KPIField.id)
    )
    return list(result.scalars().all())


async def get_field_with_subfields_only(
    db: AsyncSession, field_id: int, org_id: int
) -> KPIField | None:
    """
    One field with sub_fields loaded; options excluded (faster than full get_field for multi-line work).
    """
    result = await db.execute(
        select(KPIField)
        .join(KPIField.kpi)
        .where(KPIField.id == field_id, KPI.organization_id == org_id)
        .options(selectinload(KPIField.sub_fields))
    )
    return result.scalar_one_or_none()


async def list_fields(db: AsyncSession, kpi_id: int, org_id: int) -> list[KPIField]:
    """List fields for KPI (KPI must belong to org)."""
    result = await db.execute(
        select(KPIField)
        .join(KPIField.kpi)
        .where(KPIField.kpi_id == kpi_id, KPI.organization_id == org_id)
        .order_by(KPIField.sort_order, KPIField.id)
        .options(selectinload(KPIField.options), selectinload(KPIField.sub_fields))
    )
    return list(result.scalars().all())


def is_value_compatible(value_obj: KPIFieldValue, new_type: FieldType) -> bool:
    if (
        value_obj.value_text is None
        and value_obj.value_number is None
        and value_obj.value_boolean is None
        and value_obj.value_date is None
        and value_obj.value_json is None
    ):
        return True

    if new_type in (FieldType.single_line_text, FieldType.multi_line_text, FieldType.attachment, FieldType.reference):
        return True

    elif new_type == FieldType.number:
        if value_obj.value_number is not None:
            return True
        if value_obj.value_boolean is not None:
            return True
        if value_obj.value_text is not None:
            try:
                float(value_obj.value_text.strip())
                return True
            except ValueError:
                return False
        return False

    elif new_type == FieldType.boolean:
        if value_obj.value_boolean is not None:
            return True
        if value_obj.value_number is not None:
            return False
        if value_obj.value_text is not None:
            s = value_obj.value_text.strip().lower()
            return s in ("1", "true", "yes", "y", "0", "false", "no", "n")
        return False

    elif new_type == FieldType.date:
        if value_obj.value_date is not None:
            return True
        if value_obj.value_text is not None:
            try:
                from datetime import datetime
                datetime.fromisoformat(value_obj.value_text.strip().replace("Z", "+00:00"))
                return True
            except ValueError:
                return False
        return False

    elif new_type in (FieldType.multi_reference, FieldType.mixed_list):
        if value_obj.value_json is not None:
            return isinstance(value_obj.value_json, list)
        return False

    return False


def migrate_value(value_obj: KPIFieldValue, new_type: FieldType) -> None:
    txt = value_obj.value_text
    num = value_obj.value_number
    bool_val = value_obj.value_boolean
    dt = value_obj.value_date
    js = value_obj.value_json

    value_obj.value_text = None
    value_obj.value_number = None
    value_obj.value_boolean = None
    value_obj.value_date = None
    value_obj.value_json = None

    if new_type in (FieldType.single_line_text, FieldType.multi_line_text, FieldType.attachment, FieldType.reference):
        if txt is not None:
            value_obj.value_text = txt
        elif num is not None:
            if num.is_integer():
                value_obj.value_text = str(int(num))
            else:
                value_obj.value_text = str(num)
        elif bool_val is not None:
            value_obj.value_text = "Yes" if bool_val else "No"
        elif dt is not None:
            value_obj.value_text = dt.isoformat()
        elif js is not None:
            import json
            value_obj.value_text = json.dumps(js)

    elif new_type == FieldType.number:
        if num is not None:
            value_obj.value_number = num
        elif bool_val is not None:
            value_obj.value_number = 1.0 if bool_val else 0.0
        elif txt is not None:
            try:
                value_obj.value_number = float(txt.strip())
            except ValueError:
                pass

    elif new_type == FieldType.boolean:
        if bool_val is not None:
            value_obj.value_boolean = bool_val
        elif txt is not None:
            s = txt.strip().lower()
            if s in ("1", "true", "yes", "y"):
                value_obj.value_boolean = True
            elif s in ("0", "false", "no", "n"):
                value_obj.value_boolean = False

    elif new_type == FieldType.date:
        if dt is not None:
            value_obj.value_date = dt
        elif txt is not None:
            from datetime import datetime
            try:
                value_obj.value_date = datetime.fromisoformat(txt.strip().replace("Z", "+00:00"))
            except ValueError:
                pass


async def update_field(
    db: AsyncSession, field_id: int, org_id: int, data: KPIFieldUpdate
) -> KPIField | None:
    """Update field; optionally replace options."""
    field = await get_field(db, field_id, org_id)
    if not field:
        return None
    if data.field_type is not None and data.field_type != field.field_type:
        if field.field_type != FieldType.multi_line_items and data.field_type != FieldType.multi_line_items:
            result = await db.execute(
                select(KPIFieldValue).where(KPIFieldValue.field_id == field_id)
            )
            values = result.scalars().all()
            for v in values:
                if is_value_compatible(v, data.field_type):
                    migrate_value(v, data.field_type)
                else:
                    v.value_text = None
                    v.value_number = None
                    v.value_boolean = None
                    v.value_date = None
                    v.value_json = None
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
        await _validate_conditional_config(db, field.kpi_id, data.config)
        field.config = data.config
    if field.field_type != FieldType.multi_line_items:
        field.section_id = None
    elif getattr(data, "section_id", None) is not None:
        field.section_id = await _resolve_section_id(db, field.kpi_id, data.section_id)
    if data.carry_forward_data is not None:
        field.carry_forward_data = data.carry_forward_data
    if data.full_page_multi_items is not None:
        field.full_page_multi_items = data.full_page_multi_items
    if getattr(data, "row_level_user_access_enabled", None) is not None:
        field.row_level_user_access_enabled = data.row_level_user_access_enabled
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
    if data.sub_fields is not None:
        # Defensive cleanup: some DBs/environments may not cascade sub_field FK rows
        # in access tables consistently when sub-fields are replaced.
        await db.execute(
            delete(KpiFieldAccess).where(
                KpiFieldAccess.field_id == field_id,
                KpiFieldAccess.sub_field_id.is_not(None),
            )
        )
        await db.execute(
            delete(KpiFieldAccessByRole).where(
                KpiFieldAccessByRole.field_id == field_id,
                KpiFieldAccessByRole.sub_field_id.is_not(None),
            )
        )
        await db.execute(delete(KPIFieldSubField).where(KPIFieldSubField.field_id == field_id))
        for i, sub in enumerate(data.sub_fields):
            db.add(
                KPIFieldSubField(
                    field_id=field_id,
                    name=sub.name,
                    key=sub.key,
                    field_type=sub.field_type,
                    is_required=sub.is_required,
                    sort_order=sub.sort_order if sub.sort_order else i,
                    config=getattr(sub, "config", None),
                )
            )
    await db.flush()
    return field


async def get_field_child_data_summary(
    db: AsyncSession, field_id: int, org_id: int
) -> dict[str, int] | None:
    """Return counts of child records for a field (field_values, report_template_fields). None if field not found."""
    field = await get_field(db, field_id, org_id)
    if not field:
        return None
    v_result = await db.execute(
        select(func.count()).select_from(KPIFieldValue).where(KPIFieldValue.field_id == field_id)
    )
    r_result = await db.execute(
        select(func.count())
        .select_from(ReportTemplateField)
        .where(ReportTemplateField.kpi_field_id == field_id)
    )
    field_values_count = v_result.scalar() or 0
    report_template_fields_count = r_result.scalar() or 0
    return {
        "field_values_count": field_values_count,
        "report_template_fields_count": report_template_fields_count,
        "has_child_data": (field_values_count + report_template_fields_count) > 0,
    }


async def delete_field(db: AsyncSession, field_id: int, org_id: int) -> bool:
    """Delete field and all child records (field values, report template refs, options)."""
    field = await get_field(db, field_id, org_id)
    if not field:
        return False
    await db.execute(delete(KPIFieldValue).where(KPIFieldValue.field_id == field_id))
    await db.execute(delete(ReportTemplateField).where(ReportTemplateField.kpi_field_id == field_id))
    await db.execute(delete(KPIFieldOption).where(KPIFieldOption.field_id == field_id))
    await db.execute(delete(KPIFieldSubField).where(KPIFieldSubField.field_id == field_id))
    await db.delete(field)
    await db.flush()
    return True
