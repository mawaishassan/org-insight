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
    KpiMultiLineCell,
    KpiMultiLineRow,
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
        if trigger.field_type not in (FieldType.boolean, FieldType.reference, FieldType.number):
            raise ValueError("Trigger field must be a Boolean, Dropdown (Referential), or Numeric field")

    rules = config.get("conditional_rules")
    if rules is not None:
        if not isinstance(rules, list):
            raise ValueError("conditional_rules must be a list")
        for r in rules:
            if not isinstance(r, dict):
                raise ValueError("Each conditional rule must be a dictionary")
            operator = r.get("operator")
            if not operator:
                raise ValueError("Rule must specify an operator")
            if operator.lower() not in ("eq", "neq", "gt", "lt", "gte", "lte", "between", "outside"):
                raise ValueError(f"Invalid operator '{operator}' in rule")
            dep_fields = r.get("dependent_fields") or r.get("dependent_field_ids")
            if dep_fields is not None:
                if not isinstance(dep_fields, list):
                    raise ValueError("dependent_fields must be a list")


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
    if data.field_type == FieldType.multi_line_items and data.sub_fields:
        from app.formula_engine.circular_validation import validate_mli_circular_dependencies
        validate_mli_circular_dependencies(data.sub_fields)

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
            return False
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
    prev_type = field.field_type
    prev_subfields = {sf.key: sf.field_type for sf in (field.sub_fields or [])}

    # Detect type changes or subfield changes and clean up conditional rules
    type_changed_field_ids = []
    deleted_subfield_keys = []
    type_changed_subfield_keys = []

    if data.field_type is not None and data.field_type != prev_type:
        type_changed_field_ids.append(field.id)

    if data.sub_fields is not None and prev_type == FieldType.multi_line_items:
        new_subkeys = {sub.key for sub in data.sub_fields}
        for k in prev_subfields:
            if k not in new_subkeys:
                deleted_subfield_keys.append(k)
        for sub in data.sub_fields:
            if sub.key in prev_subfields and sub.field_type != prev_subfields[sub.key]:
                type_changed_subfield_keys.append(sub.key)

    if type_changed_field_ids or deleted_subfield_keys or type_changed_subfield_keys:
        await cleanup_conditional_rules_for_kpi(
            db,
            field.kpi_id,
            type_changed_field_ids=type_changed_field_ids,
            deleted_subfield_keys=deleted_subfield_keys,
            type_changed_subfield_keys=type_changed_subfield_keys,
        )

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
        if field.field_type == FieldType.multi_line_items:
            from app.formula_engine.circular_validation import validate_mli_circular_dependencies
            validate_mli_circular_dependencies(data.sub_fields)

        # 1. Map incoming subfields to existing ones
        existing_sfs = {sf.id: sf for sf in (field.sub_fields or [])}
        existing_sfs_by_key = {sf.key: sf for sf in (field.sub_fields or [])}
        
        incoming_matched_ids = set()
        incoming_matched_keys = set()
        
        actions = [] # list of (sub_field_data, existing_sf_or_None)
        
        # First pass: match by ID
        for sub in data.sub_fields:
            sub_id = getattr(sub, "id", None)
            matched_sf = None
            if sub_id is not None and sub_id in existing_sfs:
                matched_sf = existing_sfs[sub_id]
                incoming_matched_ids.add(sub_id)
                incoming_matched_keys.add(matched_sf.key)
            actions.append((sub, matched_sf))
            
        # Second pass: match unmatched by key
        for idx, (sub, matched_sf) in enumerate(actions):
            if matched_sf is None:
                sub_key = getattr(sub, "key", None)
                if sub_key and sub_key in existing_sfs_by_key:
                    candidate = existing_sfs_by_key[sub_key]
                    if candidate.id not in incoming_matched_ids:
                        actions[idx] = (sub, candidate)
                        incoming_matched_ids.add(candidate.id)
                        incoming_matched_keys.add(sub_key)

        # 2. Delete subfields that are not in incoming subfields list
        deleted_sfs = [sf for sf in (field.sub_fields or []) if sf.id not in incoming_matched_ids]
        if deleted_sfs:
            deleted_sf_ids = [sf.id for sf in deleted_sfs]
            # Clean up access rows first
            await db.execute(
                delete(KpiFieldAccess).where(
                    KpiFieldAccess.field_id == field_id,
                    KpiFieldAccess.sub_field_id.in_(deleted_sf_ids)
                )
            )
            await db.execute(
                delete(KpiFieldAccessByRole).where(
                    KpiFieldAccessByRole.field_id == field_id,
                    KpiFieldAccessByRole.sub_field_id.in_(deleted_sf_ids)
                )
            )
            for sf in deleted_sfs:
                if sf in field.sub_fields:
                    field.sub_fields.remove(sf)
                await db.delete(sf)

        # 3. Create or update subfields
        new_subfields_to_init = []
        for i, (sub, sf) in enumerate(actions):
            sub_sort_order = sub.sort_order if getattr(sub, "sort_order", None) is not None else i
            sub_config = getattr(sub, "config", None)
            
            if sf is not None:
                # Update existing subfield
                prev_sub_type = sf.field_type
                sf.name = sub.name
                sf.key = sub.key
                sf.field_type = sub.field_type
                sf.is_required = sub.is_required
                sf.sort_order = sub_sort_order
                sf.config = sub_config
                
                # Check for field type change and migrate values
                if sub.field_type != prev_sub_type:
                    # Load all cells for this subfield
                    cell_res = await db.execute(
                        select(KpiMultiLineCell).where(KpiMultiLineCell.sub_field_id == sf.id)
                    )
                    cells = list(cell_res.scalars().all())
                    for cell in cells:
                        if is_value_compatible(cell, sub.field_type):
                            migrate_value(cell, sub.field_type)
                        else:
                            cell.value_text = None
                            cell.value_number = None
                            cell.value_boolean = None
                            cell.value_date = None
                            cell.value_json = None
                db.add(sf)
            else:
                # Create new subfield
                new_sf = KPIFieldSubField(
                    field_id=field_id,
                    name=sub.name,
                    key=sub.key,
                    field_type=sub.field_type,
                    is_required=sub.is_required,
                    sort_order=sub_sort_order,
                    config=sub_config,
                )
                db.add(new_sf)
                if field.sub_fields is None:
                    field.sub_fields = []
                field.sub_fields.append(new_sf)
                new_subfields_to_init.append(new_sf)
                
        await db.flush()

        # 4. Initialize cell records for new subfields for all existing rows
        if new_subfields_to_init:
            # Find all existing rows for this field
            rows_res = await db.execute(
                select(KpiMultiLineRow.id).where(KpiMultiLineRow.field_id == field.id)
            )
            row_ids = [r[0] for r in rows_res.all()]
            for new_sf in new_subfields_to_init:
                for r_id in row_ids:
                    cell = KpiMultiLineCell(row_id=r_id, sub_field=new_sf)
                    # If default value exists, populate it
                    default_val = None
                    if new_sf.config and isinstance(new_sf.config, dict):
                        default_val = new_sf.config.get("default_value") or new_sf.config.get("default")
                    if default_val is not None:
                        ft_s = new_sf.field_type.value if hasattr(new_sf.field_type, "value") else str(new_sf.field_type)
                        if ft_s == "number":
                            try:
                                cell.value_number = float(default_val)
                            except:
                                cell.value_text = str(default_val)
                        elif ft_s == "boolean":
                            if isinstance(default_val, bool):
                                cell.value_boolean = default_val
                            else:
                                s = str(default_val).strip().lower()
                                cell.value_boolean = s in ("true", "yes", "1")
                        elif ft_s == "date":
                            from datetime import datetime
                            try:
                                cell.value_date = datetime.fromisoformat(str(default_val).replace("Z", "+00:00"))
                            except:
                                cell.value_text = str(default_val)
                        elif ft_s in ("reference", "multi_reference", "mixed_list", "attachment"):
                            if isinstance(default_val, (dict, list)):
                                cell.value_json = default_val
                            else:
                                cell.value_text = str(default_val)
                        else:
                            cell.value_text = str(default_val)
                    db.add(cell)
            await db.flush()

        # Expire only the specific KpiMultiLineRow instances to force SQLAlchemy to reload their cells collection
        rows_to_expire_res = await db.execute(
            select(KpiMultiLineRow).where(KpiMultiLineRow.field_id == field_id)
        )
        for r in rows_to_expire_res.scalars().all():
            db.expire(r)

        # 5. Recompute formula subfields for all entries containing this MLI field
        entry_ids_res = await db.execute(
            select(KpiMultiLineRow.entry_id)
            .where(KpiMultiLineRow.field_id == field_id)
            .distinct()
        )
        entry_ids = [r[0] for r in entry_ids_res.all()]
        if entry_ids:
            from app.entries.service import recompute_mli_formula_subfields
            for e_id in entry_ids:
                await recompute_mli_formula_subfields(db, entry_id=e_id, org_id=org_id, field_id=field.id)
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


async def cleanup_conditional_rules_for_kpi(
    db: AsyncSession,
    kpi_id: int,
    deleted_field_ids: list[int] | None = None,
    deleted_subfield_keys: list[str] | None = None,
    type_changed_field_ids: list[int] | None = None,
    type_changed_subfield_keys: list[str] | None = None,
) -> None:
    deleted_fields = set(str(x) for x in (deleted_field_ids or []))
    deleted_subs = set(str(x) for x in (deleted_subfield_keys or []))
    changed_fields = set(str(x) for x in (type_changed_field_ids or []))
    changed_subs = set(str(x) for x in (type_changed_subfield_keys or []))

    all_affected_fields = deleted_fields.union(changed_fields)
    all_affected_subs = deleted_subs.union(changed_subs)

    if not all_affected_fields and not all_affected_subs:
        return

    res = await db.execute(
        select(KPIField)
        .where(KPIField.kpi_id == kpi_id)
        .options(selectinload(KPIField.sub_fields))
    )
    all_fields = res.scalars().all()

    from sqlalchemy.orm.attributes import flag_modified

    for f in all_fields:
        # 1. Check legacy/conditional rules on the scalar field level
        f_changed = False
        if f.config and isinstance(f.config, dict):
            # Check legacy trigger
            tid = f.config.get("condition_trigger_field_id")
            tkey = f.config.get("condition_trigger_field_key")
            if (tid is not None and str(tid) in all_affected_fields) or (tkey is not None and str(tkey) in all_affected_fields):
                f.config.pop("condition_trigger_field_id", None)
                f.config.pop("condition_trigger_field_key", None)
                f.config.pop("condition_trigger_value", None)
                f_changed = True

            # Check conditional rules
            rules = f.config.get("conditional_rules")
            if rules and isinstance(rules, list):
                next_rules = []
                for r in rules:
                    if not isinstance(r, dict):
                        continue
                    # If this field is the trigger, and it had a type change or deletion, remove the rule
                    if str(f.id) in all_affected_fields or str(f.key) in all_affected_fields:
                        continue
                    
                    # Otherwise, check if any dependent field is affected
                    deps = r.get("dependent_fields") or r.get("dependent_field_ids") or []
                    next_deps = [d for d in deps if str(d) not in all_affected_fields]
                    if next_deps:
                        r["dependent_fields"] = next_deps
                        if "dependent_field_ids" in r:
                            r["dependent_field_ids"] = next_deps
                        next_rules.append(r)
                if len(next_rules) != len(rules):
                    if next_rules:
                        f.config["conditional_rules"] = next_rules
                    else:
                        f.config.pop("conditional_rules", None)
                    f_changed = True
            
            if f_changed:
                flag_modified(f, "config")
                db.add(f)

        # 2. Check rules on subfields of this field
        for sf in getattr(f, "sub_fields", None) or []:
            sf_changed = False
            if sf.config and isinstance(sf.config, dict):
                # Check legacy trigger
                tid = sf.config.get("condition_trigger_field_id")
                tkey = sf.config.get("condition_trigger_field_key")
                if (tid is not None and (str(tid) in all_affected_subs or str(tid) in all_affected_fields)) or \
                   (tkey is not None and (str(tkey) in all_affected_subs or str(tkey) in all_affected_fields)):
                    sf.config.pop("condition_trigger_field_id", None)
                    sf.config.pop("condition_trigger_field_key", None)
                    sf.config.pop("condition_trigger_value", None)
                    sf_changed = True

                # Check conditional rules
                rules = sf.config.get("conditional_rules")
                if rules and isinstance(rules, list):
                    next_rules = []
                    for r in rules:
                        if not isinstance(r, dict):
                            continue
                        # If this subfield is the trigger, and it had a type change/deletion, remove the rule
                        if str(sf.id) in all_affected_subs or str(sf.key) in all_affected_subs:
                            continue
                        
                        # Check dependent subfields
                        deps = r.get("dependent_fields") or r.get("dependent_field_ids") or []
                        next_deps = [d for d in deps if str(d) not in all_affected_subs]
                        if next_deps:
                            r["dependent_fields"] = next_deps
                            if "dependent_field_ids" in r:
                                r["dependent_field_ids"] = next_deps
                            next_rules.append(r)
                    if len(next_rules) != len(rules):
                        if next_rules:
                            sf.config["conditional_rules"] = next_rules
                        else:
                            sf.config.pop("conditional_rules", None)
                        sf_changed = True

                if sf_changed:
                    flag_modified(sf, "config")
                    db.add(sf)


async def delete_field(db: AsyncSession, field_id: int, org_id: int) -> bool:
    """Delete field and all child records (field values, report template refs, options)."""
    field = await get_field(db, field_id, org_id)
    if not field:
        return False
    await cleanup_conditional_rules_for_kpi(db, field.kpi_id, deleted_field_ids=[field.id])
    await db.execute(delete(KPIFieldValue).where(KPIFieldValue.field_id == field_id))
    await db.execute(delete(ReportTemplateField).where(ReportTemplateField.kpi_field_id == field_id))
    await db.execute(delete(KPIFieldOption).where(KPIFieldOption.field_id == field_id))
    await db.execute(delete(KPIFieldSubField).where(KPIFieldSubField.field_id == field_id))
    await db.delete(field)
    await db.flush()
    return True
