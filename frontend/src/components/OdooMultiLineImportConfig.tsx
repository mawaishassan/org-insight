"use client";

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { api, getApiUrl } from "@/lib/api";

type ReferenceConfig = {
  reference_source_kpi_id?: number;
  reference_source_field_key?: string;
  reference_source_sub_field_key?: string;
};

type SubField = {
  key: string;
  name: string;
  field_type?: string;
  config?: ReferenceConfig | Record<string, unknown> | null;
};

type OdooListColumnPart = {
  index: number;
  sample: string;
};

type OdooPreview = {
  columns: string[];
  sample_rows: Record<string, string>[];
  total_rows: number;
  preview_row_count: number;
  preview_column_count: number;
  list_columns?: Record<string, OdooListColumnPart[]>;
};

type KpiMeta = {
  name: string;
  categoryPath: string;
};

type FieldSummary = {
  key: string;
  name: string;
  field_type: string;
  sub_fields?: Array<{ key: string; name: string; field_type?: string }>;
};

function isReferenceLike(ft: string | undefined): boolean {
  return ft === "reference" || ft === "multi_reference";
}

function buildKpiCategoryPath(tags?: Array<{ domain_name?: string | null; name: string }>): string {
  if (!tags?.length) return "";
  const c = tags[0];
  return c.domain_name ? `${c.domain_name} → ${c.name}` : c.name;
}

function formatSourceFieldPath(fields: FieldSummary[], fieldKey: string, subFieldKey?: string): string {
  const f = fields.find((x) => x.key === fieldKey);
  if (!f) return fieldKey;
  if (subFieldKey && f.field_type === "multi_line_items" && f.sub_fields?.length) {
    const s = f.sub_fields.find((x) => x.key === subFieldKey);
    return s ? `${f.name} → ${s.name}` : `${f.name} → ${subFieldKey}`;
  }
  return f.name || fieldKey;
}

function buildFullReferencePath(
  kpiMeta: KpiMeta | undefined,
  fields: FieldSummary[],
  fieldKey: string,
  subFieldKey?: string
): string {
  const kpiLabel = kpiMeta
    ? kpiMeta.categoryPath
      ? `${kpiMeta.categoryPath} → ${kpiMeta.name}`
      : kpiMeta.name
    : "Unknown KPI";
  const fieldLabel = formatSourceFieldPath(fields, fieldKey, subFieldKey);
  return `${kpiLabel} → ${fieldLabel}`;
}

function fieldTypeRequirementHint(fieldType: string | undefined): string {
  switch (fieldType) {
    case "number":
      return "Numeric values (e.g. 42, 1500.5)";
    case "date":
      return "Date values (e.g. 2024-06-15)";
    case "boolean":
      return "Boolean: true or false";
    case "reference":
      return "Single text value that must exist in the linked KPI field below";
    case "multi_reference":
      return "One or more values (comma-separated) that must exist in the linked KPI field below";
    case "single_line_text":
      return "Short text";
    case "multi_line_text":
      return "Longer text";
    default:
      return fieldType ? fieldType.replace(/_/g, " ") : "Text or structured value";
  }
}

function samplePreviewValues(preview: OdooPreview | null, column: string, limit = 4): string[] {
  if (!preview || !column) return [];
  const out: string[] = [];
  for (const row of preview.sample_rows) {
    const v = (row[column] ?? "").trim();
    if (!v || out.includes(v)) continue;
    out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

const hintBlockStyle: React.CSSProperties = {
  marginTop: "0.4rem",
  fontSize: "0.78rem",
  color: "var(--muted)",
  lineHeight: 1.45,
};

/** Super Admin: KPI Odoo JSON request body + fetch preview + field mappings (channel always Odoo). */
export function OdooMultiLineImportAdmin({
  kpiId,
  orgId,
  token,
  fieldId,
  subFields,
  fieldConfig,
  onFieldConfigChange,
}: {
  kpiId: number;
  orgId: number | null;
  token: string;
  fieldId?: number;
  subFields?: SubField[];
  fieldConfig?: Record<string, unknown> | null;
  onFieldConfigChange?: (cfg: Record<string, unknown>) => void;
}) {
  const currentYear = new Date().getFullYear();
  const [requestBodyText, setRequestBodyText] = useState('{\n  "jsonrpc": "2.0",\n  "params": {}\n}');
  const [responsePath, setResponsePath] = useState("");
  const [previewYear, setPreviewYear] = useState(currentYear);
  const [savingKpi, setSavingKpi] = useState(false);
  const [fetchingPreview, setFetchingPreview] = useState(false);
  const [downloadingSample, setDownloadingSample] = useState(false);
  const [savingMappings, setSavingMappings] = useState(false);
  const [kpiConfigured, setKpiConfigured] = useState(false);
  const [orgOdooConfigured, setOrgOdooConfigured] = useState<boolean | null>(null);
  const [odooColumns, setOdooColumns] = useState<string[]>([]);
  const [preview, setPreview] = useState<OdooPreview | null>(null);
  const [mappingBySubKey, setMappingBySubKey] = useState<Record<string, string>>({});
  const [listIndexBySubKey, setListIndexBySubKey] = useState<Record<string, number | "">>({});
  const [kpiMetaById, setKpiMetaById] = useState<Record<number, KpiMeta>>({});
  const [fieldsByKpiId, setFieldsByKpiId] = useState<Record<number, FieldSummary[]>>({});
  const [refSamplesByKey, setRefSamplesByKey] = useState<Record<string, string[]>>({});

  const oq = orgId != null ? `?organization_id=${orgId}` : "";
  const hasMultiLineField = fieldId != null;
  const subFieldList = subFields ?? [];

  const previewTableColumns = useMemo(
    () => (preview ? preview.columns.slice(0, preview.preview_column_count) : []),
    [preview]
  );

  const unmappedOdooColumns = useMemo(() => {
    const used = new Set(Object.values(mappingBySubKey).filter(Boolean));
    return odooColumns.filter((c) => !used.has(c));
  }, [odooColumns, mappingBySubKey]);

  const listColumnPartsByOdooCol = useMemo(() => {
    const src = preview?.list_columns ?? {};
    return src;
  }, [preview?.list_columns]);

  const referenceSourceKpiIds = useMemo(() => {
    const ids = new Set<number>();
    for (const sf of subFieldList) {
      if (!isReferenceLike(sf.field_type)) continue;
      const cfg = (sf.config ?? {}) as ReferenceConfig;
      if (cfg.reference_source_kpi_id) ids.add(cfg.reference_source_kpi_id);
    }
    return [...ids];
  }, [subFieldList]);

  const referenceSourceKpiSig = referenceSourceKpiIds.join(",");

  const refSampleTargets = useMemo(() => {
    const targets: Array<{ cacheKey: string; sid: number; skey: string; subkey?: string }> = [];
    for (const sf of subFieldList) {
      if (!isReferenceLike(sf.field_type)) continue;
      const cfg = (sf.config ?? {}) as ReferenceConfig;
      const sid = cfg.reference_source_kpi_id;
      const skey = cfg.reference_source_field_key;
      if (!sid || !skey) continue;
      const subkey = cfg.reference_source_sub_field_key;
      targets.push({
        cacheKey: `${sid}-${skey}${subkey ? `-${subkey}` : ""}@${previewYear}`,
        sid,
        skey,
        subkey,
      });
    }
    return targets;
  }, [subFieldList, previewYear]);

  const refSampleTargetsSig = refSampleTargets.map((t) => t.cacheKey).join("|");

  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#odoo-bulk-import") return;
    const el = document.getElementById("odoo-bulk-import");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!token || !kpiId) return;
    api<{ configured: boolean; request_body?: unknown; response_items_path?: string | null }>(
      `/kpis/${kpiId}/odoo-config${oq}`,
      { token }
    )
      .then((c) => {
        setKpiConfigured(!!c.configured);
        if (c.configured && c.request_body != null) {
          setRequestBodyText(JSON.stringify(c.request_body, null, 2));
          setResponsePath(c.response_items_path || "");
        }
      })
      .catch(() => setKpiConfigured(false));
  }, [token, kpiId, oq]);

  useEffect(() => {
    if (!token || orgId == null) return;
    api<{ configured: boolean }>(`/organizations/${orgId}/odoo-config/status`, { token })
      .then((s) => setOrgOdooConfigured(s.configured))
      .catch(() => setOrgOdooConfigured(false));
  }, [token, orgId]);

  const subFieldKeySig = useMemo(
    () => subFieldList.map((s) => s.key).sort().join("|"),
    [subFields]
  );

  useEffect(() => {
    const list = subFields ?? [];
    const m = fieldConfig?.odoo_field_mappings;
    const li = fieldConfig?.odoo_field_list_indices;
    const v2 = fieldConfig?.odoo_sub_field_mappings;
    const next: Record<string, string> = {};
    const nextListIdx: Record<string, number | ""> = {};
    for (const sf of list) {
      next[sf.key] = "";
      nextListIdx[sf.key] = "";
    }
    if (v2 && typeof v2 === "object" && !Array.isArray(v2)) {
      for (const [kpiKey, spec] of Object.entries(v2 as Record<string, { column?: string; list_index?: number | string }>)) {
        if (!(kpiKey in next)) continue;
        const col = spec?.column;
        if (typeof col === "string") next[kpiKey] = col;
        const idx = spec?.list_index;
        const n = typeof idx === "number" ? idx : typeof idx === "string" ? Number(idx) : NaN;
        if (Number.isInteger(n) && n >= 0) nextListIdx[kpiKey] = n;
      }
      setMappingBySubKey(next);
      setListIndexBySubKey(nextListIdx);
      return;
    }
    if (m && typeof m === "object" && !Array.isArray(m)) {
      for (const [odoo, kpi] of Object.entries(m as Record<string, string>)) {
        if (kpi && kpi in next) {
          next[kpi] = odoo;
        }
      }
    }
    if (li && typeof li === "object" && !Array.isArray(li)) {
      for (const [odooCol, idx] of Object.entries(li as Record<string, number | string>)) {
        const kpiKey = Object.entries(next).find(([, col]) => col === odooCol)?.[0];
        if (!kpiKey) continue;
        const n = typeof idx === "number" ? idx : Number(idx);
        if (Number.isInteger(n) && n >= 0) {
          nextListIdx[kpiKey] = n;
        }
      }
    }
    setMappingBySubKey(next);
    setListIndexBySubKey(nextListIdx);
  }, [fieldConfig, subFieldKeySig]);

  useEffect(() => {
    if (!token || orgId == null || !referenceSourceKpiSig) return;
    let cancelled = false;
    for (const sourceKpiId of referenceSourceKpiIds) {
      api<{
        name: string;
        category_tags?: Array<{ domain_name?: string | null; name: string }>;
      }>(`/kpis/${sourceKpiId}?organization_id=${orgId}`, { token })
        .then((kpi) => {
          if (cancelled) return;
          setKpiMetaById((prev) =>
            prev[sourceKpiId]
              ? prev
              : {
                  ...prev,
                  [sourceKpiId]: { name: kpi.name, categoryPath: buildKpiCategoryPath(kpi.category_tags) },
                }
          );
        })
        .catch(() => {
          if (cancelled) return;
          setKpiMetaById((prev) =>
            prev[sourceKpiId]
              ? prev
              : { ...prev, [sourceKpiId]: { name: `KPI #${sourceKpiId}`, categoryPath: "" } }
          );
        });

      api<FieldSummary[]>(`/fields?kpi_id=${sourceKpiId}&organization_id=${orgId}`, { token })
        .then((list) => {
          if (cancelled) return;
          setFieldsByKpiId((prev) => (prev[sourceKpiId] ? prev : { ...prev, [sourceKpiId]: list }));
        })
        .catch(() => {
          if (cancelled) return;
          setFieldsByKpiId((prev) => (prev[sourceKpiId] ? prev : { ...prev, [sourceKpiId]: [] }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [token, orgId, referenceSourceKpiSig, referenceSourceKpiIds]);

  useEffect(() => {
    if (!token || orgId == null || !refSampleTargetsSig) return;
    let cancelled = false;
    for (const t of refSampleTargets) {
      const params = new URLSearchParams({
        source_kpi_id: String(t.sid),
        source_field_key: t.skey,
        organization_id: String(orgId),
        year: String(previewYear),
      });
      if (t.subkey) params.set("source_sub_field_key", t.subkey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params.toString()}`, { token })
        .then((r) => {
          if (cancelled) return;
          setRefSamplesByKey((prev) =>
            prev[t.cacheKey] !== undefined
              ? prev
              : { ...prev, [t.cacheKey]: (r.values || []).slice(0, 8) }
          );
        })
        .catch(() => {
          if (cancelled) return;
          setRefSamplesByKey((prev) => (prev[t.cacheKey] !== undefined ? prev : { ...prev, [t.cacheKey]: [] }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [token, orgId, previewYear, refSampleTargetsSig, refSampleTargets]);

  function suggestMappings(columns: string[], base: Record<string, string>): Record<string, string> {
    const next = { ...base };
    for (const sf of subFieldList) {
      if (next[sf.key]) continue;
      const byKey = columns.find((c) => c.toLowerCase() === sf.key.toLowerCase());
      if (byKey) {
        next[sf.key] = byKey;
        continue;
      }
      const normalizedName = sf.name.toLowerCase().replace(/\s+/g, "_");
      const byName = columns.find((c) => c.toLowerCase() === normalizedName);
      if (byName) next[sf.key] = byName;
    }
    return next;
  }

  async function saveKpiBody(e: React.FormEvent) {
    e.preventDefault();
    setSavingKpi(true);
    try {
      const request_body = JSON.parse(requestBodyText);
      await api(`/kpis/${kpiId}/odoo-config${oq}`, {
        method: "PUT",
        token,
        body: JSON.stringify({
          request_body,
          response_items_path: responsePath.trim() || null,
        }),
      });
      toast.success("KPI Odoo request body saved");
      setKpiConfigured(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Invalid JSON or save failed");
    } finally {
      setSavingKpi(false);
    }
  }

  async function fetchOdooPreview() {
    if (!fieldId || !token) return;
    setFetchingPreview(true);
    try {
      let request_body: unknown | undefined;
      try {
        request_body = JSON.parse(requestBodyText);
      } catch {
        request_body = undefined;
      }
      const params = new URLSearchParams({
        field_id: String(fieldId),
        year: String(previewYear),
      });
      if (orgId != null) params.set("organization_id", String(orgId));

      const body: Record<string, unknown> = {};
      if (request_body !== undefined) {
        body.request_body = request_body;
        body.response_items_path = responsePath.trim() || null;
      }

      const result = await api<OdooPreview>(`/kpis/${kpiId}/odoo-preview?${params.toString()}`, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setPreview(result);
      setOdooColumns(result.columns);
      setMappingBySubKey((prev) => {
        const next = suggestMappings(result.columns, prev);
        const listCols = result.list_columns ?? {};
        setListIndexBySubKey((prevIdx) => {
          const idxNext = { ...prevIdx };
          for (const sf of subFieldList) {
            const col = next[sf.key];
            const parts = col ? listCols[col] : undefined;
            if (!parts?.length) {
              idxNext[sf.key] = "";
              continue;
            }
            const current = idxNext[sf.key];
            if (current === "" || !parts.some((p) => p.index === current)) {
              idxNext[sf.key] = parts[0].index;
            }
          }
          return idxNext;
        });
        return next;
      });
      toast.success(`Fetched ${result.total_rows} row(s), ${result.columns.length} column(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fetch Odoo sample data");
    } finally {
      setFetchingPreview(false);
    }
  }

  async function downloadOdooSampleExcel() {
    if (!fieldId || !token || !preview) return;
    setDownloadingSample(true);
    try {
      let request_body: unknown | undefined;
      try {
        request_body = JSON.parse(requestBodyText);
      } catch {
        request_body = undefined;
      }
      const params = new URLSearchParams({
        field_id: String(fieldId),
        year: String(previewYear),
      });
      if (orgId != null) params.set("organization_id", String(orgId));

      const body: Record<string, unknown> = {};
      if (request_body !== undefined) {
        body.request_body = request_body;
        body.response_items_path = responsePath.trim() || null;
      }

      const res = await fetch(getApiUrl(`/kpis/${kpiId}/odoo-preview-export?${params.toString()}`), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let detail = "Excel download failed";
        try {
          const err = await res.json();
          if (err?.detail) detail = String(err.detail);
        } catch {
          /* ignore */
        }
        throw new Error(detail);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] || `odoo_sample_kpi${kpiId}_${previewYear}.xlsx`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Odoo sample Excel downloaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Excel download failed");
    } finally {
      setDownloadingSample(false);
    }
  }

  function setOdooColumnForSubField(subKey: string, odooCol: string) {
    setMappingBySubKey((prev) => ({ ...prev, [subKey]: odooCol }));
    const parts = odooCol ? listColumnPartsByOdooCol[odooCol] : undefined;
    if (!parts?.length) {
      setListIndexBySubKey((prev) => ({ ...prev, [subKey]: "" }));
      return;
    }
    setListIndexBySubKey((prev) => {
      const current = prev[subKey];
      if (current !== "" && parts.some((p) => p.index === current)) {
        return prev;
      }
      return { ...prev, [subKey]: parts[0].index };
    });
  }

  async function saveFieldMappings() {
    if (!fieldId || !token) return;
    setSavingMappings(true);
    try {
      const odoo_field_mappings: Record<string, string> = {};
      const odoo_field_list_indices: Record<string, number> = {};
      const odoo_sub_field_mappings: Record<string, { column: string; list_index?: number }> = {};
      for (const [kpiKey, odooCol] of Object.entries(mappingBySubKey)) {
        const col = odooCol.trim();
        if (!col) continue;
        odoo_field_mappings[col] = kpiKey;
        const parts = listColumnPartsByOdooCol[col];
        const idx = listIndexBySubKey[kpiKey];
        if (parts?.length && idx !== "" && typeof idx === "number") {
          odoo_field_list_indices[col] = idx;
        }
        // v2: per-sub-field mapping (supports same Odoo column mapped to multiple sub-fields)
        if (parts?.length && idx !== "" && typeof idx === "number") {
          odoo_sub_field_mappings[kpiKey] = { column: col, list_index: idx };
        } else {
          odoo_sub_field_mappings[kpiKey] = { column: col };
        }
      }
      const cfg = {
        ...(fieldConfig || {}),
        multi_items_import_channel: "odoo",
        odoo_field_mappings,
        odoo_field_list_indices,
        odoo_sub_field_mappings,
      };
      onFieldConfigChange?.(cfg);
      await api(`/fields/${fieldId}${oq}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ config: cfg }),
      });
      toast.success("Odoo field mappings saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSavingMappings(false);
    }
  }

  function renderSubFieldContext(sf: SubField) {
    const cfg = (sf.config ?? {}) as ReferenceConfig;
    const isRef = isReferenceLike(sf.field_type);
    const sid = cfg.reference_source_kpi_id;
    const skey = cfg.reference_source_field_key;
    const subkey = cfg.reference_source_sub_field_key;
    const cacheKey = sid && skey ? `${sid}-${skey}${subkey ? `-${subkey}` : ""}@${previewYear}` : "";
    const refSamples = cacheKey ? refSamplesByKey[cacheKey] : undefined;

    return (
      <div style={hintBlockStyle}>
        <div>
          <span style={{ fontWeight: 500, color: "var(--text)" }}>Type:</span>{" "}
          {fieldTypeRequirementHint(sf.field_type)}
        </div>
        {isRef && sid && skey && (
          <div style={{ marginTop: "0.3rem" }}>
            <span style={{ fontWeight: 500, color: "var(--text)" }}>Linked to:</span>{" "}
            {buildFullReferencePath(
              kpiMetaById[sid],
              fieldsByKpiId[sid] ?? [],
              skey,
              subkey
            )}
          </div>
        )}
        {isRef && sid && skey && (
          <div style={{ marginTop: "0.3rem" }}>
            <span style={{ fontWeight: 500, color: "var(--text)" }}>Sample values from linked KPI</span>
            {refSamples === undefined ? (
              <span> (loading…)</span>
            ) : refSamples.length > 0 ? (
              <span>: {refSamples.join(", ")}</span>
            ) : (
              <span>: no values found for year {previewYear} — check that the source KPI has data</span>
            )}
          </div>
        )}
      </div>
    );
  }

  function renderOdooColumnContext(column: string) {
    const samples = samplePreviewValues(preview, column);
    if (!column) return null;
    return (
      <div style={hintBlockStyle}>
        {samples.length > 0 ? (
          <>
            <span style={{ fontWeight: 500, color: "var(--text)" }}>Odoo sample data:</span> {samples.join(", ")}
          </>
        ) : (
          <span>No sample values in preview for this column.</span>
        )}
      </div>
    );
  }

  const canFetchPreview =
    hasMultiLineField &&
    orgOdooConfigured === true &&
    (kpiConfigured || requestBodyText.trim().length > 0);

  return (
    <div id="odoo-bulk-import" className="card" style={{ padding: "1rem", marginBottom: "1rem" }}>
      <h3 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Odoo bulk import (Super Admin)</h3>
      <ul style={{ margin: "0 0 1rem", paddingLeft: "1.2rem", fontSize: "0.85rem", color: "var(--muted)" }}>
        <li>
          Organization Odoo connection:{" "}
          {orgOdooConfigured === null
            ? "…"
            : orgOdooConfigured
              ? "configured"
              : "not configured — ask a Super Admin to set Organization → Settings → Odoo integration"}
        </li>
        <li>KPI request body: {kpiConfigured ? "saved" : "not saved yet — complete Step 1 below"}</li>
        <li>Import channel for this field: <strong>Odoo</strong> (set automatically when mappings are saved)</li>
      </ul>

      <form onSubmit={saveKpiBody}>
        <h4 style={{ fontSize: "0.9rem", margin: "0 0 0.35rem" }}>Step 1 — KPI Odoo request body</h4>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          JSON sent to your organization&apos;s Odoo data fetch URL. Placeholders: __SESSION_ID__, __YEAR__, __KPI_ID__,
          __ORG_ID__, __ENTRY_ID__, __FIELD_ID__, __FIELD_KEY__.
        </p>
        <textarea
          value={requestBodyText}
          onChange={(e) => setRequestBodyText(e.target.value)}
          rows={8}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "0.8rem" }}
        />
        <div className="form-group" style={{ marginTop: "0.5rem" }}>
          <label>Response items path (optional, e.g. result.records)</label>
          <input value={responsePath} onChange={(e) => setResponsePath(e.target.value)} style={{ width: "100%" }} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={savingKpi} style={{ marginTop: "0.5rem" }}>
          {savingKpi ? "Saving…" : "Save KPI Odoo request body"}
        </button>
      </form>

      {hasMultiLineField ? (
        <>
          <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <h4 style={{ fontSize: "0.9rem", margin: "0 0 0.35rem" }}>Step 2 — Fetch Odoo columns &amp; sample data</h4>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
              Loads live data from Odoo using the request body above. The preview table shows up to 7 columns and 5 rows.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "flex-end", marginBottom: "0.75rem" }}>
              <div className="form-group" style={{ margin: 0 }}>
                <label htmlFor="odoo-preview-year">Year (__YEAR__)</label>
                <input
                  id="odoo-preview-year"
                  type="number"
                  min={2000}
                  max={2100}
                  value={previewYear}
                  onChange={(e) => setPreviewYear(Number(e.target.value) || currentYear)}
                  style={{ width: "7rem" }}
                />
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canFetchPreview || fetchingPreview}
                onClick={fetchOdooPreview}
              >
                {fetchingPreview ? "Fetching…" : "Fetch sample data"}
              </button>
              {preview && (
                <button
                  type="button"
                  className="btn"
                  disabled={downloadingSample || fetchingPreview}
                  onClick={downloadOdooSampleExcel}
                >
                  {downloadingSample ? "Downloading…" : "Download Excel (all columns)"}
                </button>
              )}
            </div>

            {preview && previewTableColumns.length > 0 && (
              <div style={{ overflowX: "auto", marginBottom: "0.5rem" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                  <thead>
                    <tr>
                      {previewTableColumns.map((col) => (
                        <th
                          key={col}
                          style={{
                            textAlign: "left",
                            padding: "0.4rem 0.5rem",
                            borderBottom: "1px solid var(--border)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_rows.map((row, i) => (
                      <tr key={i}>
                        {previewTableColumns.map((col) => (
                          <td
                            key={col}
                            style={{
                              padding: "0.4rem 0.5rem",
                              borderBottom: "1px solid var(--border)",
                              maxWidth: 160,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={row[col] ?? ""}
                          >
                            {row[col] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.35rem 0 0" }}>
                  {preview.total_rows} total row(s), {preview.columns.length} column(s).
                  {preview.columns.length > preview.preview_column_count &&
                    ` Showing first ${preview.preview_column_count} columns in preview.`}
                  {" "}
                  Use <strong>Download Excel (all columns)</strong> for the full dataset.
                </p>
              </div>
            )}
          </div>

          {odooColumns.length > 0 && subFieldList.length > 0 && (
            <div style={{ marginTop: "1.25rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <h4 style={{ fontSize: "0.9rem", margin: "0 0 0.35rem" }}>Step 3 — Map KPI sub-fields to Odoo columns</h4>
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
                Each row is one multi-line sub-field. Pick the Odoo column whose values match the expected data type and
                linked KPI (for reference fields).
              </p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)", minWidth: 280 }}>
                        KPI sub-field
                      </th>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)", minWidth: 260 }}>
                        Odoo column
                      </th>
                      <th style={{ textAlign: "left", padding: "0.5rem", borderBottom: "1px solid var(--border)", minWidth: 220 }}>
                        List value part
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {subFieldList.map((sf) => {
                      const selectedCol = mappingBySubKey[sf.key] ?? "";
                      const listParts = selectedCol ? listColumnPartsByOdooCol[selectedCol] : undefined;
                      const selectedListIdx = listIndexBySubKey[sf.key] ?? "";
                      return (
                        <tr key={sf.key}>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                            <div style={{ fontWeight: 500 }}>{sf.name}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--muted)", fontFamily: "monospace" }}>{sf.key}</div>
                            {isReferenceLike(sf.field_type) && (
                              <div
                                style={{
                                  display: "inline-block",
                                  marginTop: "0.25rem",
                                  fontSize: "0.7rem",
                                  fontWeight: 600,
                                  color: "var(--primary)",
                                  padding: "0.1rem 0.35rem",
                                  borderRadius: 4,
                                  background: "rgba(var(--primary-rgb, 59, 130, 246), 0.12)",
                                }}
                              >
                                External / linked field
                              </div>
                            )}
                            {renderSubFieldContext(sf)}
                          </td>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                            <select
                              value={selectedCol}
                              onChange={(e) => setOdooColumnForSubField(sf.key, e.target.value)}
                              style={{ width: "100%", maxWidth: 360 }}
                            >
                              <option value="">— Not mapped —</option>
                              {odooColumns.map((col) => (
                                <option key={col} value={col}>
                                  {col}
                                  {listColumnPartsByOdooCol[col]?.length ? " [list]" : ""}
                                </option>
                              ))}
                            </select>
                            {renderOdooColumnContext(selectedCol)}
                          </td>
                          <td style={{ padding: "0.5rem", borderBottom: "1px solid var(--border)", verticalAlign: "top" }}>
                            {listParts?.length ? (
                              <>
                                <select
                                  value={selectedListIdx === "" ? "" : String(selectedListIdx)}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setListIndexBySubKey((prev) => ({
                                      ...prev,
                                      [sf.key]: v === "" ? "" : Number(v),
                                    }));
                                  }}
                                  style={{ width: "100%", maxWidth: 360 }}
                                >
                                  <option value="">— Full list value —</option>
                                  {listParts.map((part) => (
                                    <option key={part.index} value={String(part.index)}>
                                      [{part.index}] {part.sample || "(empty)"}
                                    </option>
                                  ))}
                                </select>
                                <div style={hintBlockStyle}>
                                  Odoo returned a list for this column (e.g. many2one{" "}
                                  <code style={{ fontSize: "0.75rem" }}>[id, name]</code>). Choose which index maps to
                                  this KPI field.
                                </div>
                              </>
                            ) : (
                              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {unmappedOdooColumns.length > 0 && (
                <p style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.5rem" }}>
                  Unmapped Odoo columns: {unmappedOdooColumns.join(", ")}
                </p>
              )}
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: "0.75rem" }}
                disabled={savingMappings}
                onClick={saveFieldMappings}
              >
                {savingMappings ? "Saving…" : "Save field mappings"}
              </button>
            </div>
          )}

          {odooColumns.length > 0 && subFieldList.length === 0 && (
            <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
              Add sub-fields to this multi-line field before mapping Odoo columns.
            </p>
          )}
        </>
      ) : (
        <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--muted)" }}>
          Add a multi-line items field to this KPI to fetch Odoo data and configure field mappings.
        </p>
      )}
    </div>
  );
}
