export interface FieldDef {
  id: number;
  name: string;
  key: string;
  field_type: string;
  config?: Record<string, any>;
  sub_fields?: SubFieldDef[];
  options?: any[];
}

export interface SubFieldDef {
  id?: number | string;
  name: string;
  key: string;
  field_type: string;
  config?: Record<string, any>;
}

export function coerceToBool(val: any): boolean {
  if (typeof val === "boolean") return val;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "y";
  }
  if (typeof val === "number") return val !== 0;
  return false;
}

export function coerceToNum(val: any): number | null {
  if (val === null || val === undefined || val === "") return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

export function checkCondition(operator: string, ruleValue: any, currentVal: any): boolean {
  if (currentVal === undefined || currentVal === null || currentVal === "") {
    return false;
  }

  const op = operator.toLowerCase();

  if (op === "eq") {
    if (typeof ruleValue === "boolean") {
      return coerceToBool(currentVal) === ruleValue;
    }
    return String(currentVal).trim() === String(ruleValue).trim();
  }

  if (op === "neq") {
    if (typeof ruleValue === "boolean") {
      return coerceToBool(currentVal) !== ruleValue;
    }
    return String(currentVal).trim() !== String(ruleValue).trim();
  }

  const curNum = coerceToNum(currentVal);
  if (curNum === null) return false;

  if (op === "gt") {
    const refNum = coerceToNum(ruleValue);
    return refNum !== null && curNum > refNum;
  }
  if (op === "lt") {
    const refNum = coerceToNum(ruleValue);
    return refNum !== null && curNum < refNum;
  }
  if (op === "gte") {
    const refNum = coerceToNum(ruleValue);
    return refNum !== null && curNum >= refNum;
  }
  if (op === "lte") {
    const refNum = coerceToNum(ruleValue);
    return refNum !== null && curNum <= refNum;
  }
  if (op === "between") {
    if (!Array.isArray(ruleValue) || ruleValue.length < 2) return false;
    const numMin = coerceToNum(ruleValue[0]);
    const numMax = coerceToNum(ruleValue[1]);
    if (numMin === null || numMax === null) return false;
    return curNum >= numMin && curNum <= numMax;
  }
  if (op === "outside") {
    if (!Array.isArray(ruleValue) || ruleValue.length < 2) return false;
    const numMin = coerceToNum(ruleValue[0]);
    const numMax = coerceToNum(ruleValue[1]);
    if (numMin === null || numMax === null) return false;
    return curNum < numMin || curNum > numMax;
  }

  return false;
}

export function getScalarFieldValue(
  fieldId: number,
  formValues: Record<number, any>,
  valuesByFieldId: Map<number, any> | Record<number, any>,
  isEditing: boolean
): any {
  if (isEditing) {
    const valObj = formValues[fieldId];
    if (!valObj) return null;
    if (valObj.value_boolean !== undefined && valObj.value_boolean !== null) return valObj.value_boolean;
    if (valObj.value_number !== undefined && valObj.value_number !== null) return valObj.value_number;
    if (valObj.value_json !== undefined && valObj.value_json !== null) return valObj.value_json;
    return valObj.value_text;
  } else {
    const valObj = valuesByFieldId instanceof Map ? valuesByFieldId.get(fieldId) : (valuesByFieldId as any)[fieldId];
    if (!valObj) return null;
    if (typeof valObj !== "object" || valObj === null) return valObj;
    if (valObj.value_boolean !== undefined && valObj.value_boolean !== null) return valObj.value_boolean;
    if (valObj.value_number !== undefined && valObj.value_number !== null) return valObj.value_number;
    if (valObj.value_json !== undefined && valObj.value_json !== null) return valObj.value_json;
    return valObj.value_text;
  }
}

export function isFieldVisible(
  field: FieldDef,
  allFields: FieldDef[],
  formValues: Record<number, any>,
  valuesByFieldId: Map<number, any> | Record<number, any>,
  isEditing: boolean,
  visiting: Set<number> = new Set()
): boolean {
  if (visiting.has(field.id)) return true;
  visiting.add(field.id);

  // 1. Check legacy rule
  if (field.config) {
    const legacyTriggerId = field.config.condition_trigger_field_id;
    if (legacyTriggerId != null) {
      const triggerField = allFields.find((x) => String(x.id) === String(legacyTriggerId));
      if (triggerField) {
        if (!isFieldVisible(triggerField, allFields, formValues, valuesByFieldId, isEditing, visiting)) {
          visiting.delete(field.id);
          return false;
        }

        const legacyTriggerVal = field.config.condition_trigger_value;
        if (legacyTriggerVal !== undefined && legacyTriggerVal !== null) {
          const currentTriggerVal = getScalarFieldValue(triggerField.id, formValues, valuesByFieldId, isEditing);
          if (!checkCondition("eq", legacyTriggerVal, currentTriggerVal)) {
            visiting.delete(field.id);
            return false;
          }
        }
      }
    }
  }

  // 2. Check new rules on other fields that target this field
  for (const triggerField of allFields) {
    if (!triggerField.config || !Array.isArray(triggerField.config.conditional_rules)) {
      continue;
    }

    const targetingRules = triggerField.config.conditional_rules.filter((r: any) => {
      const depFields = r.dependent_fields || r.dependent_field_ids || [];
      const depStrList = depFields.map((d: any) => String(d));
      return (
        (field.id != null && depStrList.includes(String(field.id))) ||
        (field.key != null && depStrList.includes(String(field.key)))
      );
    });

    if (targetingRules.length > 0) {
      if (!isFieldVisible(triggerField, allFields, formValues, valuesByFieldId, isEditing, visiting)) {
        visiting.delete(field.id);
        return false;
      }

      const currentTriggerVal = getScalarFieldValue(triggerField.id, formValues, valuesByFieldId, isEditing);
      let satisfied = false;
      for (const r of targetingRules) {
        const op = r.operator || "eq";
        const val = r.value;
        let ruleSatisfied = checkCondition(op, val, currentTriggerVal);

        const logicalOp = (r.logical_operator || "or").toLowerCase();
        const addConds = r.additional_conditions || [];
        for (const ac of addConds) {
          const acOp = ac.operator || "eq";
          const acVal = ac.value;
          const acSat = checkCondition(acOp, acVal, currentTriggerVal);
          if (logicalOp === "and") {
            ruleSatisfied = ruleSatisfied && acSat;
          } else {
            ruleSatisfied = ruleSatisfied || acSat;
          }
        }

        if (ruleSatisfied) {
          satisfied = true;
          break;
        }
      }

      if (!satisfied) {
        visiting.delete(field.id);
        return false;
      }
    }
  }

  visiting.delete(field.id);
  return true;
}

export function isSubFieldVisible(
  sf: SubFieldDef,
  allSubFields: SubFieldDef[],
  rowData: Record<string, any>,
  visiting: Set<string | number> = new Set()
): boolean {
  const sfId = sf.id != null ? sf.id : sf.key;
  if (visiting.has(sfId)) return true;
  visiting.add(sfId);

  // 1. Check legacy rule
  if (sf.config) {
    const legacyTriggerId = sf.config.condition_trigger_field_id;
    const legacyTriggerKey = sf.config.condition_trigger_field_key;
    if (legacyTriggerId != null || legacyTriggerKey != null) {
      const triggerSf = allSubFields.find(
        (p: any) =>
          (legacyTriggerId != null && String(p.id) === String(legacyTriggerId)) ||
          (legacyTriggerKey != null && String(p.key) === String(legacyTriggerKey))
      );
      if (triggerSf) {
        if (!isSubFieldVisible(triggerSf, allSubFields, rowData, visiting)) {
          visiting.delete(sfId);
          return false;
        }

        const legacyTriggerVal = sf.config.condition_trigger_value;
        if (legacyTriggerVal !== undefined && legacyTriggerVal !== null) {
          const currentTriggerVal = rowData[triggerSf.key];
          if (!checkCondition("eq", legacyTriggerVal, currentTriggerVal)) {
            visiting.delete(sfId);
            return false;
          }
        }
      }
    }
  }

  // 2. Check new rules on other subfields that target this subfield
  for (const triggerSf of allSubFields) {
    if (!triggerSf.config || !Array.isArray(triggerSf.config.conditional_rules)) {
      continue;
    }

    const targetingRules = triggerSf.config.conditional_rules.filter((r: any) => {
      const depFields = r.dependent_fields || r.dependent_field_ids || [];
      const depStrList = depFields.map((d: any) => String(d));
      return (
        (sf.id != null && depStrList.includes(String(sf.id))) ||
        (sf.key != null && depStrList.includes(String(sf.key)))
      );
    });

    if (targetingRules.length > 0) {
      if (!isSubFieldVisible(triggerSf, allSubFields, rowData, visiting)) {
        visiting.delete(sfId);
        return false;
      }

      const currentTriggerVal = rowData[triggerSf.key];
      let satisfied = false;
      for (const r of targetingRules) {
        const op = r.operator || "eq";
        const val = r.value;
        let ruleSatisfied = checkCondition(op, val, currentTriggerVal);

        const logicalOp = (r.logical_operator || "or").toLowerCase();
        const addConds = r.additional_conditions || [];
        for (const ac of addConds) {
          const acOp = ac.operator || "eq";
          const acVal = ac.value;
          const acSat = checkCondition(acOp, acVal, currentTriggerVal);
          if (logicalOp === "and") {
            ruleSatisfied = ruleSatisfied && acSat;
          } else {
            ruleSatisfied = ruleSatisfied || acSat;
          }
        }

        if (ruleSatisfied) {
          satisfied = true;
          break;
        }
      }

      if (!satisfied) {
        visiting.delete(sfId);
        return false;
      }
    }
  }

  visiting.delete(sfId);
  return true;
}
