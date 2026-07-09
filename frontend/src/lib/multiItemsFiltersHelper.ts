export type SubField = {
  id?: number;
  key: string;
  name: string;
  field_type?: string | null;
  is_required?: boolean;
  config?: { reference_source_kpi_id?: number; reference_source_field_key?: string; reference_source_sub_field_key?: string } | null;
};

export type FieldSummary = {
  id: number;
  key: string;
  name: string;
  field_type: string;
  full_page_multi_items?: boolean;
  sub_fields?: SubField[];
  config?: Record<string, unknown> | null;
};

export type KpiInfo = {
  name: string;
};

export type MultiItemsFilterPayloadV2 = {
  _version: 2;
  conditions: Array<{
    logic?: "and" | "or";
    field: string;
    op: string;
    value?: unknown;
    values?: string[];
    /** Walk reference fields then read the final scalar field (chain) or legacy single compare. */
    reference_resolution?: {
      compare_field_key?: string;
      compare_sub_field_key?: string;
      chain?: Array<{ compare_field_key: string; compare_sub_field_key?: string }>;
    };
  }>;
};

export type MultiFilterConditionRow = {
  field: string;
  op: string;
  value: string;
  multiValues: string[];
  logicWithPrev: "and" | "or";
  /** Paths on each KPI in the reference chain: `fieldKey` or `fieldKey|subKey`. Empty = use configured default label path only. */
  referenceChainPaths: string[];
};

export const MULTI_ITEM_WHERE_OPS = [
  { value: "eq", label: "equals (=)" },
  { value: "neq", label: "not equals (≠)" },
  { value: "gt", label: "greater than (>)" },
  { value: "gte", label: "greater or equal (≥)" },
  { value: "lt", label: "less than (<)" },
  { value: "lte", label: "less or equal (≤)" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
] as const;

export function truncateLabel(label: string, max = 48): string {
  const s = String(label ?? "");
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

export function operatorsForMultiItemSubField(fieldType: string | undefined): readonly { value: string; label: string }[] {
  const ft = fieldType ?? "";
  const cmp = MULTI_ITEM_WHERE_OPS.filter((o) =>
    ["eq", "neq", "gt", "gte", "lt", "lte"].includes(o.value)
  );
  const text = MULTI_ITEM_WHERE_OPS.filter((o) =>
    ["eq", "neq", "contains", "not_contains", "starts_with", "ends_with"].includes(o.value)
  );
  if (ft === "number" || ft === "date") return cmp;
  if (ft === "boolean") return MULTI_ITEM_WHERE_OPS.filter((o) => ["eq", "neq"].includes(o.value));
  if (ft === "reference" || ft === "multi_reference") return text;
  return text;
}

export function isReferenceLikeFieldType(ft: string | undefined): boolean {
  return ft === "reference" || ft === "multi_reference";
}

export function getNextSourceKpiIdForPath(fields: FieldSummary[], path: string): number | undefined {
  const { fieldKey, subKey } = parseComparePath(path);
  const f = fields.find((x) => x.key === fieldKey);
  if (!f) return undefined;
  if (subKey && f.field_type === "multi_line_items" && f.sub_fields?.length) {
    const sub = f.sub_fields.find((s) => s.key === subKey);
    if (!sub) return undefined;
    if (!isReferenceLikeFieldType(sub.field_type ?? undefined)) return undefined;
    const cfg = (sub.config ?? {}) as { reference_source_kpi_id?: number };
    return cfg.reference_source_kpi_id;
  }
  if (isReferenceLikeFieldType(f.field_type)) {
    const cfg = (f.config ?? {}) as { reference_source_kpi_id?: number };
    return cfg.reference_source_kpi_id;
  }
  return undefined;
}

export function getFieldTypeAtPath(fields: FieldSummary[], path: string): string | undefined {
  const { fieldKey, subKey } = parseComparePath(path);
  const f = fields.find((x) => x.key === fieldKey);
  if (!f) return undefined;
  if (subKey && f.field_type === "multi_line_items" && f.sub_fields?.length) {
    return f.sub_fields.find((s) => s.key === subKey)?.field_type ?? undefined;
  }
  return f.field_type;
}

export function computeChainKpiIds(
  startKpiId: number,
  paths: string[],
  cache: Record<number, FieldSummary[]>
): number[] {
  const ids: number[] = [startKpiId];
  for (let i = 0; i < paths.length; i++) {
    const flds = cache[ids[i]] ?? [];
    const nextId = getNextSourceKpiIdForPath(flds, paths[i]);
    if (nextId == null) break;
    ids.push(nextId);
  }
  return ids;
}

export function pathsForChainComputation(row: MultiFilterConditionRow, sub: SubField | undefined): string[] {
  const raw = row.referenceChainPaths ?? [];
  const def = sub ? defaultReferenceComparePath(sub) : "";
  if (raw.length === 0) return def ? [def] : [];
  return [...raw];
}

export function shouldOmitReferenceResolution(paths: string[], sub: SubField | undefined): boolean {
  const def = sub ? defaultReferenceComparePath(sub) : "";
  return paths.length === 1 && paths[0] === def;
}

export function terminalRefAllowedValuesKey(
  chainKpiIds: number[],
  pathsComp: string[],
  fieldCache: Record<number, FieldSummary[]>
): { cacheKey: string } | null {
  if (!chainKpiIds.length || !pathsComp.length) return null;
  const last = pathsComp.length - 1;
  const kpiId = chainKpiIds[last];
  const path = pathsComp[last];
  const fields = fieldCache[kpiId] ?? [];
  const ft = getFieldTypeAtPath(fields, path);
  if (isReferenceLikeFieldType(ft)) return null;
  const { fieldKey, subKey } = parseComparePath(path);
  if (!fieldKey) return null;
  const cacheKey = `${kpiId}-${fieldKey}${subKey ? `-${subKey}` : ""}`;
  return { cacheKey };
}

export function parseComparePath(path: string): { fieldKey: string; subKey?: string } {
  const p = path.trim();
  if (!p) return { fieldKey: "" };
  const idx = p.indexOf("|");
  if (idx === -1) return { fieldKey: p };
  return { fieldKey: p.slice(0, idx), subKey: p.slice(idx + 1).trim() || undefined };
}

export function defaultReferenceComparePath(sub: SubField): string {
  const cfg = (sub.config ?? {}) as {
    reference_source_field_key?: string;
    reference_source_sub_field_key?: string;
  };
  const fk = cfg.reference_source_field_key ?? "";
  const sk = cfg.reference_source_sub_field_key;
  return sk ? `${fk}|${sk}` : fk;
}

export function emptyMultiFilterRow(): MultiFilterConditionRow {
  return { field: "", op: "eq", value: "", multiValues: [], logicWithPrev: "and", referenceChainPaths: [] };
}

export function rrToPathStrings(rr: MultiItemsFilterPayloadV2["conditions"][0]["reference_resolution"]): string[] {
  if (!rr) return [];
  const ch = rr.chain;
  if (Array.isArray(ch) && ch.length > 0) {
    return ch.map((s) =>
      s.compare_sub_field_key ? `${s.compare_field_key}|${s.compare_sub_field_key}` : s.compare_field_key
    );
  }
  if (rr.compare_field_key) {
    return [rr.compare_sub_field_key ? `${rr.compare_field_key}|${rr.compare_sub_field_key}` : rr.compare_field_key];
  }
  return [];
}

export function payloadToFilterDraft(payload: MultiItemsFilterPayloadV2 | null): MultiFilterConditionRow[] {
  if (!payload?.conditions?.length) return [emptyMultiFilterRow()];
  return payload.conditions.map((c, i) => {
    const vals = Array.isArray(c.values) ? c.values.map(String) : [];
    const multiVals = vals.length > 1 ? [...vals] : [];
    let valueStr = "";
    if (vals.length === 1) valueStr = vals[0] ?? "";
    else if (!multiVals.length && c.value !== undefined && c.value !== null) {
      if (typeof c.value === "boolean") valueStr = c.value ? "true" : "false";
      else valueStr = String(c.value);
    }
    return {
      field: String(c.field ?? ""),
      op: String(c.op ?? "eq"),
      value: valueStr,
      multiValues: multiVals,
      logicWithPrev: i === 0 ? "and" : c.logic === "or" ? "or" : "and",
      referenceChainPaths: rrToPathStrings(c.reference_resolution),
    };
  });
}

export function filterDraftToPayload(rows: MultiFilterConditionRow[], subFields: SubField[]): MultiItemsFilterPayloadV2 | null {
  const conditions: MultiItemsFilterPayloadV2["conditions"] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fk = r.field.trim();
    if (!fk) continue;
    const sf = subFields.find((s) => s.key === fk);
    const ft = sf?.field_type ?? "";
    let valueOut: unknown = r.value.trim();
    let valuesOut: string[] | undefined;

    if (ft === "number" && String(valueOut) !== "") {
      const n = Number(valueOut);
      valueOut = Number.isNaN(n) ? valueOut : n;
    }
    if (ft === "boolean") {
      const vs = String(valueOut).trim().toLowerCase();
      if (vs === "true") valueOut = true;
      else if (vs === "false") valueOut = false;
    }

    const allowedOps = operatorsForMultiItemSubField(ft);
    const resolvedOp = allowedOps.some((o) => o.value === r.op) ? r.op : (allowedOps[0]?.value ?? "eq");

    const isMultiRef = ft === "multi_reference";
    const multi = (r.multiValues ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (isMultiRef && multi.length > 1 && (resolvedOp === "eq" || resolvedOp === "neq")) {
      valuesOut = multi;
    }

    const base: MultiItemsFilterPayloadV2["conditions"][0] = {
      field: fk,
      op: resolvedOp,
      ...(valuesOut ? { values: valuesOut } : { value: valueOut }),
    };
    if (i > 0) base.logic = r.logicWithPrev;

    if (ft === "reference" || ft === "multi_reference") {
      const rawPaths = r.referenceChainPaths ?? [];
      if (rawPaths.length > 0 && !shouldOmitReferenceResolution(rawPaths, sf)) {
        base.reference_resolution = {
          chain: rawPaths.map((p) => {
            const { fieldKey, subKey } = parseComparePath(p);
            return {
              compare_field_key: fieldKey,
              ...(subKey ? { compare_sub_field_key: subKey } : {}),
            };
          }),
        };
      }
    }
    const hasValue =
      valuesOut != null ||
      (typeof valueOut === "boolean") ||
      (typeof valueOut === "number" && !Number.isNaN(valueOut)) ||
      (typeof valueOut === "string" && valueOut !== "");
    if (!hasValue) continue;
    conditions.push(base);
  }
  if (conditions.length === 0) return null;
  return { _version: 2, conditions };
}

export function removeConditionFromPayload(payload: MultiItemsFilterPayloadV2, idx: number): MultiItemsFilterPayloadV2 | null {
  const next = payload.conditions.filter((_, i) => i !== idx);
  if (next.length === 0) return null;
  const normalized: MultiItemsFilterPayloadV2["conditions"] = next.map((c, i) => {
    const row: MultiItemsFilterPayloadV2["conditions"][0] = {
      field: String(c.field),
      op: String(c.op),
      ...(Array.isArray(c.values) && c.values.length > 0 ? { values: [...c.values] } : { value: c.value }),
    };
    const rr = c.reference_resolution;
    if (rr?.chain && Array.isArray(rr.chain) && rr.chain.length > 0) {
      row.reference_resolution = {
        chain: rr.chain.map((s) => ({
          compare_field_key: String(s.compare_field_key),
          ...(s.compare_sub_field_key ? { compare_sub_field_key: String(s.compare_sub_field_key) } : {}),
        })),
      };
    } else if (rr?.compare_field_key) {
      row.reference_resolution = {
        compare_field_key: String(rr.compare_field_key),
        ...(rr.compare_sub_field_key ? { compare_sub_field_key: String(rr.compare_sub_field_key) } : {}),
      };
    }
    if (i > 0) row.logic = c.logic === "or" ? "or" : "and";
    return row;
  });
  return { _version: 2, conditions: normalized };
}

export function buildReferenceAttributeOptions(fields: FieldSummary[]): { value: string; label: string }[] {
  const scalarTypes = [
    "single_line_text",
    "multi_line_text",
    "number",
    "date",
    "boolean",
    "reference",
    "multi_reference",
    "mixed_list",
  ];
  const out: { value: string; label: string }[] = [];
  for (const f of fields) {
    if (!f?.key) continue;
    if (scalarTypes.includes(f.field_type)) {
      out.push({ value: f.key, label: truncateLabel(`${f.name} (${f.key})`, 56) });
    }
    if (f.field_type === "multi_line_items" && f.sub_fields?.length) {
      for (const s of f.sub_fields) {
        out.push({
          value: `${f.key}|${s.key}`,
          label: truncateLabel(`${f.name} → ${s.name} (${s.key})`, 56),
        });
      }
    }
  }
  return out;
}

export function formatComparePathLabel(fields: FieldSummary[], path: string): string {
  const { fieldKey, subKey } = parseComparePath(path);
  const f = fields.find((x) => x.key === fieldKey);
  if (!f) return path;
  if (subKey && f.field_type === "multi_line_items" && f.sub_fields?.length) {
    const s = f.sub_fields.find((x) => x.key === subKey);
    if (!s) return `${f.name} → ${subKey}`;
    return `${f.name} → ${s.name}`;
  }
  return f.name || fieldKey;
}

export function appliedReferencePathsForChip(cond: MultiItemsFilterPayloadV2["conditions"][0], sub: SubField | undefined): string[] {
  const rr = cond.reference_resolution;
  if (rr?.chain && Array.isArray(rr.chain) && rr.chain.length > 0) {
    return rr.chain.map((s) => (s.compare_sub_field_key ? `${s.compare_field_key}|${s.compare_sub_field_key}` : s.compare_field_key));
  }
  if (rr?.compare_field_key) {
    return [rr.compare_sub_field_key ? `${rr.compare_field_key}|${rr.compare_sub_field_key}` : rr.compare_field_key];
  }
  const def = sub ? defaultReferenceComparePath(sub) : "";
  return def ? [def] : [];
}
