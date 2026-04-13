/**
 * Sample values for documenting the multi_line_items field API response
 * (POST …/multi-items/sync-from-api). Aligns loosely with backend KPI api-contract examples.
 */

export type SubFieldForApiExample = {
  key: string;
  name?: string;
  field_type?: string | null;
};

function normType(ft: string | null | undefined): string {
  return (ft || "single_line_text").toLowerCase();
}

/** One sample cell value per sub-field type; varies by row for two distinct example rows. */
export function sampleValueForSubField(fieldType: string | null | undefined, rowIndex: number): unknown {
  const ft = normType(fieldType);
  const r = rowIndex % 2;

  switch (ft) {
    case "number":
      return 85 + rowIndex * 5;
    case "boolean":
      return r === 0;
    case "date":
      return r === 0 ? "2026-01-15" : "2026-06-30";
    case "reference":
      return r === 0 ? "example_ref_token_alpha" : "example_ref_token_beta";
    case "multi_reference":
      return r === 0 ? ["Alpha", "Beta"] : ["Gamma"];
    case "mixed_list":
      return r === 0 ? ["Sample text", 123, "2026-04-01"] : ["Other", 456, "2026-05-10"];
    case "attachment":
      return null;
    case "multi_line_text":
      return r === 0 ? "First paragraph.\n\nSecond line." : "Another block\nof text.";
    case "single_line_text":
    default:
      return r === 0 ? "Sample row A" : "Sample row B";
  }
}

export function buildSampleItemsRows(subFields: SubFieldForApiExample[], numRows = 2): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
    const row: Record<string, unknown> = {};
    for (const sf of subFields) {
      row[sf.key] = sampleValueForSubField(sf.field_type, rowIndex);
    }
    rows.push(row);
  }
  return rows;
}

export function buildMultiItemsApiResponseExample(year: number, subFields: SubFieldForApiExample[]): object {
  const keys = subFields.map((s) => s.key).filter(Boolean);
  if (keys.length === 0) {
    return {
      year,
      items: [
        { item_name: "Sample row A", quantity: 10 },
        { item_name: "Sample row B", quantity: 20 },
      ],
    };
  }
  return {
    year,
    items: buildSampleItemsRows(subFields, 2),
  };
}

/**
 * Use the first two actual row payloads for the docs example when present; otherwise demo rows.
 * Each item includes every sub-field key; missing keys are null so the shape matches the table.
 */
export function buildMultiItemsApiResponseExamplePreferActual(
  year: number,
  subFields: SubFieldForApiExample[],
  actualRowData: Record<string, unknown>[]
): object {
  const slice = actualRowData.slice(0, 2).filter((r) => r != null && typeof r === "object");
  if (slice.length === 0) {
    return buildMultiItemsApiResponseExample(year, subFields);
  }
  if (subFields.length === 0) {
    return { year, items: slice.map((raw) => ({ ...raw })) };
  }
  const items = slice.map((raw) =>
    Object.fromEntries(subFields.map((sf) => [sf.key, raw[sf.key] ?? null]))
  );
  return { year, items };
}

export function stringifyApiExample(obj: object): string {
  return JSON.stringify(obj, null, 2);
}

export type MultiItemsApiRequestExampleOpts = {
  year: number;
  kpiId: number;
  fieldId: number;
  fieldKey: string;
  organizationId: number;
  entryId: number | null;
};

export function buildMultiItemsApiRequestExample(opts: MultiItemsApiRequestExampleOpts): object {
  return {
    year: opts.year,
    kpi_id: opts.kpiId,
    field_id: opts.fieldId,
    field_key: opts.fieldKey,
    organization_id: opts.organizationId,
    entry_id: opts.entryId ?? null,
  };
}
