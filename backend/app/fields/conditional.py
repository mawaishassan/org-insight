"""Backend service for parsing and evaluating conditional visibility rules."""

from typing import Any, Dict, List, Set, Union
from app.core.models import FieldType

def coerce_to_bool(val: Any) -> bool:
    """Coerce value to boolean representation."""
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "y")
    if isinstance(val, (int, float)):
        return bool(val)
    return False

def coerce_to_num(val: Any) -> float | None:
    """Coerce value to numeric float representation or None."""
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None

def check_condition(operator: str, rule_value: Any, current_val: Any) -> bool:
    """Evaluate current field value against rule value under given operator."""
    if current_val is None:
        return False

    op = operator.lower()

    # Boolean or standard equal/not equal
    if op == "eq":
        if isinstance(rule_value, bool):
            return coerce_to_bool(current_val) == rule_value
        return str(current_val).strip() == str(rule_value).strip()
    elif op == "neq":
        if isinstance(rule_value, bool):
            return coerce_to_bool(current_val) != rule_value
        return str(current_val).strip() != str(rule_value).strip()

    # Numeric comparisons
    cur_num = coerce_to_num(current_val)
    if cur_num is None:
        return False

    if op == "gt":
        ref_num = coerce_to_num(rule_value)
        return ref_num is not None and cur_num > ref_num
    elif op == "lt":
        ref_num = coerce_to_num(rule_value)
        return ref_num is not None and cur_num < ref_num
    elif op == "gte":
        ref_num = coerce_to_num(rule_value)
        return ref_num is not None and cur_num >= ref_num
    elif op == "lte":
        ref_num = coerce_to_num(rule_value)
        return ref_num is not None and cur_num <= ref_num
    elif op == "between":
        if not isinstance(rule_value, list) or len(rule_value) < 2:
            return False
        num_min = coerce_to_num(rule_value[0])
        num_max = coerce_to_num(rule_value[1])
        if num_min is None or num_max is None:
            return False
        return num_min <= cur_num <= num_max
    elif op == "outside":
        if not isinstance(rule_value, list) or len(rule_value) < 2:
            return False
        num_min = coerce_to_num(rule_value[0])
        num_max = coerce_to_num(rule_value[1])
        if num_min is None or num_max is None:
            return False
        return not (num_min <= cur_num <= num_max)

    return False

def get_value_from_dict_or_object(field_id: int, values_dict: dict) -> Any:
    """Extract raw value from values_dict where value can be raw or database KPIFieldValue/KpiMultiLineCell model."""
    val_obj = values_dict.get(field_id)
    if val_obj is None:
        return None
    # Check if it is a database model instance (has value attributes)
    if hasattr(val_obj, "value_boolean") or hasattr(val_obj, "value_number") or hasattr(val_obj, "value_text"):
        if getattr(val_obj, "value_boolean", None) is not None:
            return val_obj.value_boolean
        if getattr(val_obj, "value_number", None) is not None:
            return val_obj.value_number
        if getattr(val_obj, "value_date", None) is not None:
            return val_obj.value_date
        if getattr(val_obj, "value_json", None) is not None:
            return val_obj.value_json
        return val_obj.value_text
    return val_obj

def is_field_visible(field, fields_dict: dict, values_dict: dict, visiting: Set[int] | None = None) -> bool:
    """
    Recursively check conditional visibility of a scalar or parent field.
    - field: field object to check visibility for
    - fields_dict: dict of {field_id: field}
    - values_dict: dict of {field_id: value_or_model}
    """
    if visiting is None:
        visiting = set()

    if field.id in visiting:
        return True  # prevent loops

    visiting.add(field.id)

    # 1. Check legacy rule configured on this field itself
    if field.config and isinstance(field.config, dict):
        legacy_trigger_id = field.config.get("condition_trigger_field_id")
        if legacy_trigger_id is not None:
            try:
                legacy_trigger_id = int(legacy_trigger_id)
            except (ValueError, TypeError):
                legacy_trigger_id = None

            if legacy_trigger_id is not None:
                trigger_field = fields_dict.get(legacy_trigger_id)
                if trigger_field:
                    if not is_field_visible(trigger_field, fields_dict, values_dict, visiting):
                        visiting.remove(field.id)
                        return False

                    legacy_val = field.config.get("condition_trigger_value")
                    if legacy_val is not None:
                        current_trigger_val = get_value_from_dict_or_object(legacy_trigger_id, values_dict)
                        if not check_condition("eq", legacy_val, current_trigger_val):
                            visiting.remove(field.id)
                            return False

    # 2. Check new rules configured on other fields that target this field
    for trigger_field in fields_dict.values():
        if not trigger_field.config or not isinstance(trigger_field.config, dict):
            continue

        rules = trigger_field.config.get("conditional_rules")
        if not rules or not isinstance(rules, list):
            continue

        targeting_rules = []
        for r in rules:
            if not isinstance(r, dict):
                continue
            dep_fields = r.get("dependent_fields") or r.get("dependent_field_ids") or []
            dep_str_set = {str(x) for x in dep_fields}
            if (field.id is not None and str(field.id) in dep_str_set) or (field.key is not None and str(field.key) in dep_str_set):
                targeting_rules.append(r)

        if targeting_rules:
            # Trigger field must be visible first
            if not is_field_visible(trigger_field, fields_dict, values_dict, visiting):
                visiting.remove(field.id)
                return False

            # At least one rule on this trigger field targeting this field must be satisfied
            current_trigger_val = get_value_from_dict_or_object(trigger_field.id, values_dict)
            satisfied = False
            for r in targeting_rules:
                op = r.get("operator", "eq")
                val = r.get("value")
                rule_satisfied = check_condition(op, val, current_trigger_val)
                
                logical_op = r.get("logical_operator", "or").lower()
                add_conds = r.get("additional_conditions", [])
                for ac in add_conds:
                    ac_op = ac.get("operator", "eq")
                    ac_val = ac.get("value")
                    ac_sat = check_condition(ac_op, ac_val, current_trigger_val)
                    if logical_op == "and":
                        rule_satisfied = rule_satisfied and ac_sat
                    else:
                        rule_satisfied = rule_satisfied or ac_sat
                
                if rule_satisfied:
                    satisfied = True
                    break

            if not satisfied:
                visiting.remove(field.id)
                return False

    visiting.remove(field.id)
    return True

def is_subfield_visible(sf, subfields_dict: dict, row_dict: dict, visiting: Set[Union[int, str]] | None = None) -> bool:
    """
    Recursively check conditional visibility of an MLI subfield in a row context.
    - sf: subfield definition to check
    - subfields_dict: dict of {subfield_id_or_key: subfield_def}
    - row_dict: dict of {subfield_key: raw_value}
    """
    if visiting is None:
        visiting = set()

    sf_identifier = sf.id if getattr(sf, "id", None) is not None else sf.key
    if sf_identifier in visiting:
        return True  # prevent loops

    visiting.add(sf_identifier)

    # 1. Check legacy rule configured on this subfield itself
    if sf.config and isinstance(sf.config, dict):
        legacy_trigger_id = sf.config.get("condition_trigger_field_id")
        legacy_trigger_key = sf.config.get("condition_trigger_field_key")

        if legacy_trigger_id is not None or legacy_trigger_key is not None:
            trigger_sf = None
            if legacy_trigger_id is not None:
                try:
                    tid_str = str(legacy_trigger_id)
                    for cand in subfields_dict.values():
                        if getattr(cand, "id", None) is not None and str(cand.id) == tid_str:
                            trigger_sf = cand
                            break
                except Exception:
                    pass
            if trigger_sf is None and legacy_trigger_key is not None:
                trigger_sf = subfields_dict.get(legacy_trigger_key)

            if trigger_sf:
                if not is_subfield_visible(trigger_sf, subfields_dict, row_dict, visiting):
                    visiting.remove(sf_identifier)
                    return False

                legacy_val = sf.config.get("condition_trigger_value")
                if legacy_val is not None:
                    current_trigger_val = row_dict.get(trigger_sf.key)
                    if not check_condition("eq", legacy_val, current_trigger_val):
                        visiting.remove(sf_identifier)
                        return False

    # 2. Check new rules configured on other subfields that target this subfield
    for trigger_sf in subfields_dict.values():
        if not trigger_sf.config or not isinstance(trigger_sf.config, dict):
            continue

        rules = trigger_sf.config.get("conditional_rules")
        if not rules or not isinstance(rules, list):
            continue

        targeting_rules = []
        for r in rules:
            if not isinstance(r, dict):
                continue
            dep_fields = r.get("dependent_fields") or r.get("dependent_field_ids") or []
            dep_str_set = {str(x) for x in dep_fields}
            sf_id = getattr(sf, "id", None)
            sf_key = sf.key
            if (sf_id is not None and str(sf_id) in dep_str_set) or (sf_key is not None and str(sf_key) in dep_str_set):
                targeting_rules.append(r)

        if targeting_rules:
            # Trigger subfield must be visible
            if not is_subfield_visible(trigger_sf, subfields_dict, row_dict, visiting):
                visiting.remove(sf_identifier)
                return False

            # At least one rule on this trigger subfield must be satisfied
            current_trigger_val = row_dict.get(trigger_sf.key)
            satisfied = False
            for r in targeting_rules:
                op = r.get("operator", "eq")
                val = r.get("value")
                rule_satisfied = check_condition(op, val, current_trigger_val)
                
                logical_op = r.get("logical_operator", "or").lower()
                add_conds = r.get("additional_conditions", [])
                for ac in add_conds:
                    ac_op = ac.get("operator", "eq")
                    ac_val = ac.get("value")
                    ac_sat = check_condition(ac_op, ac_val, current_trigger_val)
                    if logical_op == "and":
                        rule_satisfied = rule_satisfied and ac_sat
                    else:
                        rule_satisfied = rule_satisfied or ac_sat
                
                if rule_satisfied:
                    satisfied = True
                    break

            if not satisfied:
                visiting.remove(sf_identifier)
                return False

    visiting.remove(sf_identifier)
    return True
