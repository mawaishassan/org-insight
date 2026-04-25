/**
 * Load relational multi_line_items rows from `/entries/multi-items/rows`.
 * KPIFieldValue.value_json is not populated for multi-line after relational migration.
 */
import { api } from "@/lib/api";
import type { MultiItemsFilterPayloadV2 } from "@/lib/multi-line-filter-payload";

export type KpiFieldWithSubs = {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields?: Array<{ id: number; key: string; name: string; field_type: string }>;
};

type MultiItemsRowsResponse = {
  rows: Array<{ index: number; data: Record<string, unknown> }>;
  total: number;
  page: number;
  page_size: number;
};

const _kpiFieldsDetailCache: Record<string, Promise<KpiFieldWithSubs[]> | undefined> = {};

export async function getKpiFieldsWithSubs(token: string, organizationId: number, kpiId: number): Promise<KpiFieldWithSubs[]> {
  const cacheKey = `${organizationId}:${kpiId}:subs`;
  if (_kpiFieldsDetailCache[cacheKey]) return _kpiFieldsDetailCache[cacheKey]!;
  _kpiFieldsDetailCache[cacheKey] = api<KpiFieldWithSubs[]>(`/entries/fields?kpi_id=${kpiId}&organization_id=${organizationId}`, { token })
    .then((rows) =>
      Array.isArray(rows) && rows.length
        ? rows
        : api<KpiFieldWithSubs[]>(`/fields?kpi_id=${kpiId}&organization_id=${organizationId}`, { token })
    )
    .catch(() => []);
  return _kpiFieldsDetailCache[cacheKey]!;
}

async function fetchEntryForPeriod(
  token: string,
  organizationId: number,
  kpiId: number,
  year: number,
  periodKey: string | null | undefined
): Promise<{ id?: number } | null> {
  const q = new URLSearchParams({
    kpi_id: String(kpiId),
    year: String(year),
    organization_id: String(organizationId),
  });
  if (periodKey) q.set("period_key", periodKey);
  return api<{ id?: number }>(`/entries/for-period?${q.toString()}`, { token }).catch(() => null);
}

/** Page through `/entries/multi-items/rows` for a known entry + field id. */
export async function fetchMultiLineRowsForEntry(opts: {
  token: string;
  organizationId: number;
  entryId: number;
  fieldId: number;
  filters?: MultiItemsFilterPayloadV2 | null;
}): Promise<Record<string, unknown>[]> {
  const { token, organizationId, entryId, fieldId, filters } = opts;

  const hasStructuredFilters =
    filters != null &&
    typeof filters === "object" &&
    Array.isArray((filters as MultiItemsFilterPayloadV2).conditions) &&
    ((filters as MultiItemsFilterPayloadV2).conditions?.length ?? 0) > 0;

  const pageSize = 200;
  let page = 1;
  const out: Array<{ index: number; data: Record<string, unknown> }> = [];

  while (true) {
    const params = new URLSearchParams({
      entry_id: String(entryId),
      field_id: String(fieldId),
      organization_id: String(organizationId),
      page: String(page),
      page_size: String(pageSize),
    });
    if (hasStructuredFilters) {
      params.set("filters", JSON.stringify(filters));
    }
    const res = await api<MultiItemsRowsResponse>(`/entries/multi-items/rows?${params.toString()}`, { token });
    const rows = Array.isArray(res?.rows) ? res.rows : [];
    rows.forEach((r) => out.push(r));
    const total = typeof res?.total === "number" ? res.total : out.length;
    if (out.length >= total) break;
    if (rows.length === 0) break;
    page += 1;
  }

  out.sort((a, b) => a.index - b.index);
  return out.map((r) => r.data || {});
}

export async function fetchAllMultiItemsRows(opts: {
  token: string;
  organizationId: number;
  kpiId: number;
  year: number;
  periodKey?: string | null;
  sourceFieldKey: string;
  filters?: MultiItemsFilterPayloadV2 | null;
}): Promise<Record<string, unknown>[]> {
  const { token, organizationId, kpiId, year, periodKey, sourceFieldKey, filters } = opts;
  const sk = (sourceFieldKey || "").trim();
  if (!sk) return [];

  const fields = await getKpiFieldsWithSubs(token, organizationId, kpiId);
  const sourceField = fields.find((f) => f.key === sk && f.field_type === "multi_line_items");
  const fieldId = sourceField?.id;
  if (!fieldId) return [];

  const entry = await fetchEntryForPeriod(token, organizationId, kpiId, year, periodKey);
  const entryId = entry?.id;
  if (!entryId) return [];

  return fetchMultiLineRowsForEntry({ token, organizationId, entryId, fieldId, filters });
}
