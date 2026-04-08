"use client";

import { useEffect, useMemo, useState } from "react";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

export type Widget =
  | { id: string; type: "text"; title?: string; text?: string; full_width?: boolean }
  | { id: string; type: "kpi_single_value"; title?: string; kpi_id: number; year: number; period_key?: string | null; field_key: string; full_width?: boolean }
  | { id: string; type: "kpi_table"; title?: string; kpi_id: number; year: number; period_key?: string | null; field_keys?: string[]; full_width?: boolean }
  | {
      id: string;
      type: "kpi_line_chart";
      title?: string;
      kpi_id: number;
      field_key: string;
      start_year: number;
      end_year: number;
      period_key?: string | null;
      full_width?: boolean;
    }
  | {
      id: string;
      type: "kpi_bar_chart";
      title?: string;
      kpi_id: number;
      year: number;
      period_key?: string | null;
      chart_type?: "bar" | "pie";
      mode?: "fields" | "multi_line_items";
      field_keys?: string[];
      // multi_line_items mode
      source_field_key?: string;
      agg?: "count_rows" | "sum" | "avg";
      group_by_sub_field_key?: string;
      value_sub_field_key?: string;
      filter_sub_field_key?: string;
      full_width?: boolean;
    };

type KpiFieldMap = { idByKey: Record<string, number>; keyById: Record<number, string>; nameByKey: Record<string, string> };
const _kpiFieldMapCache: Record<string, Promise<KpiFieldMap> | undefined> = {};

async function getKpiFieldMap(token: string, organizationId: number, kpiId: number): Promise<KpiFieldMap> {
  const cacheKey = `${organizationId}:${kpiId}`;
  if (_kpiFieldMapCache[cacheKey]) return _kpiFieldMapCache[cacheKey];
  _kpiFieldMapCache[cacheKey] = api<Array<{ id: number; key: string; name: string }>>(
    `/fields?kpi_id=${kpiId}&organization_id=${organizationId}`,
    { token }
  )
    .then((fields) => {
      const idByKey: Record<string, number> = {};
      const keyById: Record<number, string> = {};
      const nameByKey: Record<string, string> = {};
      fields.forEach((f) => {
        idByKey[f.key] = f.id;
        keyById[f.id] = f.key;
        nameByKey[f.key] = f.name;
      });
      return { idByKey, keyById, nameByKey };
    })
    .catch(() => ({ idByKey: {}, keyById: {}, nameByKey: {} }));
  return _kpiFieldMapCache[cacheKey];
}

function Card({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "1rem" }}>
      {title && <h3 style={{ marginTop: 0, marginBottom: "0.75rem" }}>{title}</h3>}
      {children}
    </div>
  );
}

export function WidgetRenderer({ widget, organizationId }: { widget: Widget; organizationId: number }) {
  if (widget.type === "text") {
    return (
      <Card title={widget.title}>
        <div style={{ whiteSpace: "pre-wrap" }}>{widget.text || ""}</div>
      </Card>
    );
  }
  if (widget.type === "kpi_single_value") {
    return <KpiSingleValueWidget widget={widget} organizationId={organizationId} />;
  }
  if (widget.type === "kpi_table") {
    return <KpiTableWidget widget={widget} organizationId={organizationId} />;
  }
  if (widget.type === "kpi_line_chart") {
    return <KpiLineChartWidget widget={widget} organizationId={organizationId} />;
  }
  if (widget.type === "kpi_bar_chart") {
    return <KpiBarChartWidget widget={widget} organizationId={organizationId} />;
  }
  return (
    <Card title="Unknown widget">
      <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(widget, null, 2)}</pre>
    </Card>
  );
}

function rawFieldFromEntry(entry: any, fieldId: number): unknown {
  const field = (entry?.values ?? []).find((v: any) => v?.field_id === fieldId);
  return field?.value_text ?? field?.value_number ?? field?.value_boolean ?? field?.value_date ?? field?.value_json;
}

function toNumeric(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

async function fetchEntryForPeriod(
  token: string,
  organizationId: number,
  kpiId: number,
  year: number,
  periodKey: string | null | undefined
): Promise<any> {
  const q = new URLSearchParams({
    kpi_id: String(kpiId),
    year: String(year),
    organization_id: String(organizationId),
  });
  if (periodKey) q.set("period_key", periodKey);
  return api<any>(`/entries/for-period?${q.toString()}`, { token });
}

function KpiSingleValueWidget({
  widget,
  organizationId,
}: {
  widget: Extract<Widget, { type: "kpi_single_value" }>;
  organizationId: number;
}) {
  const token = getAccessToken();
  const [value, setValue] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      (async () => {
        const q = new URLSearchParams({
          kpi_id: String(widget.kpi_id),
          year: String(widget.year),
          organization_id: String(organizationId),
        });
        if (widget.period_key) q.set("period_key", widget.period_key);
        return api<any>(`/entries/for-period?${q.toString()}`, { token });
      })(),
    ])
      .then(([map, entry]) => {
        const fid = map.idByKey[widget.field_key];
        const raw = fid ? rawFieldFromEntry(entry, fid) : null;
        setValue(raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load KPI value"))
      .finally(() => setLoading(false));
  }, [token, widget.kpi_id, widget.year, widget.period_key, widget.field_key, organizationId]);

  return (
    <Card title={widget.title}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : (
        <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{value || "—"}</div>
      )}
    </Card>
  );
}

function KpiLineChartWidget({
  widget,
  organizationId,
}: {
  widget: Extract<Widget, { type: "kpi_line_chart" }>;
  organizationId: number;
}) {
  const token = getAccessToken();
  const [points, setPoints] = useState<Array<{ year: number; value: number | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const start = Math.min(widget.start_year, widget.end_year);
    const end = Math.max(widget.start_year, widget.end_year);
    const years: number[] = [];
    for (let y = start; y <= end; y++) years.push(y);
    Promise.all([getKpiFieldMap(token, organizationId, widget.kpi_id)]).then(([map]) => {
      const fid = map.idByKey[widget.field_key];
      if (!fid) {
        setPoints([]);
        setLoading(false);
        return;
      }
      return Promise.all(
        years.map((year) =>
          fetchEntryForPeriod(token, organizationId, widget.kpi_id, year, widget.period_key).then((entry) => ({
            year,
            value: toNumeric(rawFieldFromEntry(entry, fid)),
          }))
        )
      )
        .then(setPoints)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load chart data"))
        .finally(() => setLoading(false));
    });
  }, [token, organizationId, widget.kpi_id, widget.field_key, widget.start_year, widget.end_year, widget.period_key]);

  const numeric = points.filter((p) => p.value != null) as { year: number; value: number }[];
  const values = numeric.map((p) => p.value);
  const minV = values.length ? Math.min(...values) : 0;
  const maxV = values.length ? Math.max(...values) : 1;

  return (
    <Card title={widget.title}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : numeric.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>No numeric data for this field in the selected years.</p>
      ) : (
        <div style={{ width: "100%", maxWidth: 720 }}>
          <svg viewBox="0 0 640 240" role="img" aria-label="Line chart" style={{ width: "100%", height: "auto", display: "block" }}>
            <rect x="0" y="0" width="640" height="240" fill="var(--bg)" rx="6" />
            {(() => {
              const W = 640;
              const H = 240;
              const left = 44;
              const right = 16;
              const top = 16;
              const bottom = 36;
              const innerW = W - left - right;
              const innerH = H - top - bottom;
              const span = Math.max(maxV - minV, 1e-9);
              const n = numeric.length;
              const xs = numeric.map((_, i) => left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW));
              const ys = numeric.map((p) => top + innerH - ((p.value - minV) / span) * innerH);
              const pathD = xs.map((x, i) => `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(" ");
              return (
                <>
                  <text x={left} y={H - 10} fontSize="11" fill="var(--muted)">
                    {numeric[0].year}
                  </text>
                  <text x={W - right - 36} y={H - 10} fontSize="11" fill="var(--muted)" textAnchor="end">
                    {numeric[n - 1].year}
                  </text>
                  <text x={8} y={top + 10} fontSize="11" fill="var(--muted)">
                    {maxV.toLocaleString()}
                  </text>
                  <text x={8} y={top + innerH} fontSize="11" fill="var(--muted)">
                    {minV.toLocaleString()}
                  </text>
                  <path d={pathD} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                  {xs.map((x, i) => (
                    <circle key={numeric[i].year} cx={x} cy={ys[i]} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth="1" />
                  ))}
                </>
              );
            })()}
          </svg>
          <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: "0.5rem 0 0" }}>
            Field <code>{widget.field_key}</code> · {numeric.length} year{numeric.length !== 1 ? "s" : ""} with data
          </p>
        </div>
      )}
    </Card>
  );
}

function safeKey(x: unknown): string {
  const s = x == null ? "" : String(x).trim();
  return s || "(empty)";
}

function aggregateMultiLine(
  items: any[],
  opts: {
    groupByKey: string;
    agg: "count_rows" | "sum" | "avg";
    valueKey?: string;
  }
): Array<{ label: string; value: number }> {
  const { groupByKey, agg, valueKey } = opts;
  const map = new Map<string, { sum: number; count: number }>();
  for (const row of items) {
    if (!row || typeof row !== "object") continue;
    const g = safeKey((row as any)[groupByKey]);
    const cur = map.get(g) ?? { sum: 0, count: 0 };
    cur.count += 1;
    if (agg === "sum" || agg === "avg") {
      const n = toNumeric((row as any)[valueKey || ""]);
      if (n != null) cur.sum += n;
    }
    map.set(g, cur);
  }
  const out: Array<{ label: string; value: number }> = [];
  Array.from(map.entries()).forEach(([label, v]) => {
    if (agg === "count_rows") out.push({ label, value: v.count });
    else if (agg === "sum") out.push({ label, value: v.sum });
    else out.push({ label, value: v.count ? v.sum / v.count : 0 });
  });
  out.sort((a, b) => b.value - a.value);
  return out;
}

function polarToCartesian(cx: number, cy: number, r: number, angleRad: number) {
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function pieArcPath(cx: number, cy: number, r: number, start: number, end: number) {
  const p1 = polarToCartesian(cx, cy, r, start);
  const p2 = polarToCartesian(cx, cy, r, end);
  const largeArc = end - start > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 1 ${p2.x} ${p2.y} Z`;
}

function KpiBarChartWidget({
  widget,
  organizationId,
}: {
  widget: Extract<Widget, { type: "kpi_bar_chart" }>;
  organizationId: number;
}) {
  const token = getAccessToken();
  const [bars, setBars] = useState<Array<{ key: string; label: string; value: number | null }>>([]);
  const [groups, setGroups] = useState<Array<{ label: string; value: number }>>([]);
  const [filterValues, setFilterValues] = useState<string[]>([]);
  const [selectedFilterValues, setSelectedFilterValues] = useState<string[]>([]);
  const [filterSearch, setFilterSearch] = useState("");
  const [filterSuggestOpen, setFilterSuggestOpen] = useState(false);
  const [viewerChartType, setViewerChartType] = useState<"bar" | "pie">(widget.chart_type || "bar");
  const [hiddenSeriesKeys, setHiddenSeriesKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setViewerChartType(widget.chart_type || "bar");
    setHiddenSeriesKeys([]);
  }, [widget.id, widget.chart_type, widget.mode]);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([getKpiFieldMap(token, organizationId, widget.kpi_id), fetchEntryForPeriod(token, organizationId, widget.kpi_id, widget.year, widget.period_key)])
      .then(([map, entry]) => {
        const mode = widget.mode || "fields";
        if (mode === "multi_line_items") {
          const sourceKey = widget.source_field_key || "";
          const groupBy = widget.group_by_sub_field_key || "";
          const agg = widget.agg || "count_rows";
          const valueKey = widget.value_sub_field_key;
          const filterKey = widget.filter_sub_field_key || "";
          const sourceId = sourceKey ? map.idByKey[sourceKey] : undefined;
          if (!sourceId || !groupBy) {
            setGroups([]);
            return;
          }
          const raw = rawFieldFromEntry(entry, sourceId);
          const items = Array.isArray(raw) ? raw : [];
          if (filterKey) {
            const uniq = Array.from(new Set(items.map((r: any) => safeKey(r?.[filterKey])).filter((v) => v && v !== "(empty)"))).sort((a, b) =>
              a.localeCompare(b)
            );
            setFilterValues(uniq);
            setSelectedFilterValues((prev) => prev.filter((v) => uniq.includes(v)));
          } else {
            setFilterValues([]);
            setSelectedFilterValues([]);
          }
          const filtered =
            filterKey && selectedFilterValues.length > 0
              ? items.filter((r: any) => selectedFilterValues.includes(safeKey(r?.[filterKey])))
              : items;
          const aggRows = aggregateMultiLine(filtered, { groupByKey: groupBy, agg, valueKey });
          setGroups(aggRows);
          setBars([]);
          return;
        }
        const keys = widget.field_keys || [];
        setBars(
          keys.map((key) => {
            const fid = map.idByKey[key];
            return { key, label: map.nameByKey[key] ?? key, value: fid ? toNumeric(rawFieldFromEntry(entry, fid)) : null };
          })
        );
        setGroups([]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load chart data"))
      .finally(() => setLoading(false));
  }, [
    token,
    organizationId,
    widget.kpi_id,
    widget.year,
    widget.period_key,
    widget.mode,
    widget.chart_type,
    JSON.stringify(widget.field_keys || []),
    widget.source_field_key,
    widget.group_by_sub_field_key,
    widget.agg,
    widget.value_sub_field_key,
    widget.filter_sub_field_key,
    JSON.stringify(selectedFilterValues),
  ]);

  const mode = widget.mode || "fields";
  const chartType = viewerChartType;
  const numeric = bars.filter((b) => b.value != null) as { key: string; label: string; value: number }[];
  const vals = numeric.map((b) => b.value);
  const maxV = vals.length ? Math.max(...vals, 0) : 1;
  const groupVals = groups.map((g) => g.value);
  const maxG = groupVals.length ? Math.max(...groupVals, 0) : 1;

  const visibleGroups = useMemo(() => groups.filter((g) => !hiddenSeriesKeys.includes(g.label)), [groups, JSON.stringify(hiddenSeriesKeys)]);
  const visibleNumeric = useMemo(() => numeric.filter((b) => !hiddenSeriesKeys.includes(b.key)), [JSON.stringify(numeric), JSON.stringify(hiddenSeriesKeys)]);

  const toggleFilterValue = (v: string) => {
    setSelectedFilterValues((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));
  };

  const suggestedFilterValues = useMemo(() => {
    const q = filterSearch.trim().toLowerCase();
    if (!q) return [];
    return filterValues
      .filter((v) => !selectedFilterValues.includes(v))
      .filter((v) => v.toLowerCase().includes(q))
      .slice(0, 50);
  }, [filterValues, selectedFilterValues, filterSearch]);

  const addTypedFilterValue = () => {
    const raw = filterSearch.trim();
    if (!raw) return;
    const match = filterValues.find((v) => v.toLowerCase() === raw.toLowerCase());
    const toAdd = match ?? suggestedFilterValues[0];
    if (!toAdd) return;
    setSelectedFilterValues((prev) => (prev.includes(toAdd) ? prev : [...prev, toAdd]));
    setFilterSearch("");
  };

  const toggleHiddenSeries = (k: string) => {
    setHiddenSeriesKeys((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };

  return (
    <Card title={widget.title}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : mode === "multi_line_items" ? (
        <div style={{ display: "grid", gap: "0.75rem" }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Chart:</span>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setViewerChartType("bar")}
                style={{
                  padding: "0.25rem 0.55rem",
                  border: "none",
                  background: viewerChartType === "bar" ? "rgba(79,70,229,0.10)" : "transparent",
                  color: viewerChartType === "bar" ? "var(--accent)" : "var(--text)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
                aria-pressed={viewerChartType === "bar"}
              >
                Bar
              </button>
              <button
                type="button"
                onClick={() => setViewerChartType("pie")}
                style={{
                  padding: "0.25rem 0.55rem",
                  border: "none",
                  borderLeft: "1px solid var(--border)",
                  background: viewerChartType === "pie" ? "rgba(79,70,229,0.10)" : "transparent",
                  color: viewerChartType === "pie" ? "var(--accent)" : "var(--text)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
                aria-pressed={viewerChartType === "pie"}
              >
                Pie
              </button>
            </div>
            {hiddenSeriesKeys.length > 0 && (
              <button type="button" className="btn" onClick={() => setHiddenSeriesKeys([])} style={{ fontSize: "0.85rem" }}>
                Reset hidden
              </button>
            )}
          </div>

          {widget.filter_sub_field_key && (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Filter ({widget.filter_sub_field_key}):</span>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.35rem",
                    alignItems: "center",
                    padding: "0.35rem 0.45rem",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    minHeight: 40,
                  }}
                >
                  {selectedFilterValues.length === 0 ? (
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem", padding: "0.1rem 0.25rem" }}>All</span>
                  ) : (
                    selectedFilterValues.map((v) => (
                      <span
                        key={v}
                        style={{
                          display: "inline-flex",
                          gap: "0.25rem",
                          alignItems: "center",
                          padding: "0.1rem 0.4rem",
                          borderRadius: 999,
                          border: "1px solid var(--border)",
                          background: "var(--bg)",
                          color: "var(--text)",
                          fontSize: "0.78rem",
                          maxWidth: 180,
                        }}
                        title={v}
                      >
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                        <button
                          type="button"
                          onClick={() => toggleFilterValue(v)}
                          style={{ border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.9rem", lineHeight: 1, padding: 0 }}
                          aria-label={`Remove ${v}`}
                          title="Remove"
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}

                  <input
                    value={filterSearch}
                    onChange={(e) => setFilterSearch(e.target.value)}
                    placeholder={filterValues.length === 0 ? "No values" : "Type value, press Enter"}
                    onFocus={() => setFilterSuggestOpen(true)}
                    onBlur={() => window.setTimeout(() => setFilterSuggestOpen(false), 120)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTypedFilterValue();
                      }
                    }}
                    disabled={filterValues.length === 0}
                    style={{ flex: "1 1 120px", minWidth: 120, border: "none", outline: "none", background: "transparent", padding: "0.25rem 0.25rem", fontSize: "0.9rem" }}
                  />
                </div>

                {filterSuggestOpen && suggestedFilterValues.length > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      top: "calc(100% + 6px)",
                      left: 0,
                      right: 0,
                      zIndex: 20,
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      borderRadius: 12,
                      boxShadow: "0 10px 24px rgba(0,0,0,0.14)",
                      overflow: "hidden",
                    }}
                  >
                    <div style={{ maxHeight: 200, overflow: "auto" }}>
                      {suggestedFilterValues.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedFilterValues((prev) => (prev.includes(v) ? prev : [...prev, v]));
                            setFilterSearch("");
                          }}
                          style={{
                            width: "100%",
                            textAlign: "left",
                            border: "none",
                            background: "transparent",
                            color: "inherit",
                            padding: "0.45rem 0.7rem",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            fontSize: "0.9rem",
                          }}
                        >
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {visibleGroups.length === 0 ? (
            <p style={{ color: "var(--muted)", margin: 0 }}>No grouped data available for this multi-line field.</p>
          ) : chartType === "pie" ? (
            <div style={{ width: "100%", maxWidth: 720, display: "grid", gap: "0.75rem" }}>
              <svg viewBox="0 0 640 300" role="img" aria-label="Pie chart" style={{ width: "100%", height: "auto", display: "block" }}>
                <rect x="0" y="0" width="640" height="300" fill="var(--bg)" rx="6" />
                {(() => {
                  const total = visibleGroups.reduce((s, g) => s + g.value, 0) || 1;
                  const cx = 210;
                  const cy = 150;
                  const r = 110;
                  let a = -Math.PI / 2;
                  const colors = ["var(--accent)", "rgba(79,70,229,0.65)", "rgba(79,70,229,0.45)", "rgba(79,70,229,0.3)"];
                  return (
                    <>
                      {visibleGroups.slice(0, 12).map((g, i) => {
                        const frac = g.value / total;
                        const next = a + frac * Math.PI * 2;
                        const d = pieArcPath(cx, cy, r, a, next);
                        a = next;
                        return <path key={g.label} d={d} fill={colors[i % colors.length]} stroke="var(--surface)" strokeWidth="1" />;
                      })}
                      <text x="420" y="34" fontSize="12" fill="var(--muted)">
                        Top groups
                      </text>
                      {visibleGroups.slice(0, 8).map((g, i) => (
                        <g key={g.label}>
                          <rect x="420" y={52 + i * 26} width="10" height="10" fill={colors[i % colors.length]} />
                          <text x="436" y={61 + i * 26} fontSize="11" fill="var(--text)">
                            {g.label.length > 22 ? `${g.label.slice(0, 20)}…` : g.label} ({g.value.toLocaleString()})
                          </text>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                {groups.slice(0, 20).map((g) => {
                  const hidden = hiddenSeriesKeys.includes(g.label);
                  return (
                    <button
                      key={g.label}
                      type="button"
                      onClick={() => toggleHiddenSeries(g.label)}
                      style={{
                        padding: "0.12rem 0.45rem",
                        borderRadius: 999,
                        border: `1px solid ${hidden ? "var(--border)" : "var(--accent)"}`,
                        background: hidden ? "var(--surface)" : "rgba(79,70,229,0.10)",
                        color: hidden ? "var(--muted)" : "var(--accent)",
                        fontSize: "0.78rem",
                        cursor: "pointer",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={hidden ? "Hidden (click to show)" : "Visible (click to hide)"}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ width: "100%", maxWidth: 720 }}>
              <svg viewBox="0 0 640 260" role="img" aria-label="Bar chart" style={{ width: "100%", height: "auto", display: "block" }}>
                <rect x="0" y="0" width="640" height="260" fill="var(--bg)" rx="6" />
                {(() => {
                  const W = 640;
                  const H = 260;
                  const left = 40;
                  const right = 16;
                  const top = 16;
                  const bottom = 58;
                  const innerW = W - left - right;
                  const innerH = H - top - bottom;
                  const data = visibleGroups.slice(0, 12);
                  const n = data.length;
                  const gap = 8;
                  const barW = n > 0 ? Math.max(10, (innerW - gap * (n - 1)) / n) : 10;
                  return (
                    <>
                      <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                        {maxG.toLocaleString()}
                      </text>
                      {data.map((b, i) => {
                        const x = left + i * (barW + gap);
                        const h = maxG > 0 ? (b.value / maxG) * innerH : 0;
                        const y = top + innerH - h;
                        return (
                          <g key={b.label}>
                            <rect x={x} y={y} width={barW} height={h} fill="var(--accent)" opacity={0.85} rx={2} />
                            <text x={x + barW / 2} y={H - 10} fontSize="9" fill="var(--muted)" textAnchor="middle">
                              {b.label.length > 12 ? `${b.label.slice(0, 10)}…` : b.label}
                            </text>
                          </g>
                        );
                      })}
                    </>
                  );
                })()}
              </svg>
              <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                {groups.slice(0, 20).map((g) => {
                  const hidden = hiddenSeriesKeys.includes(g.label);
                  return (
                    <button
                      key={g.label}
                      type="button"
                      onClick={() => toggleHiddenSeries(g.label)}
                      style={{
                        padding: "0.12rem 0.45rem",
                        borderRadius: 999,
                        border: `1px solid ${hidden ? "var(--border)" : "var(--accent)"}`,
                        background: hidden ? "var(--surface)" : "rgba(79,70,229,0.10)",
                        color: hidden ? "var(--muted)" : "var(--accent)",
                        fontSize: "0.78rem",
                        cursor: "pointer",
                        maxWidth: 220,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={hidden ? "Hidden (click to show)" : "Visible (click to hide)"}
                    >
                      {g.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : visibleNumeric.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>No numeric data for the selected fields.</p>
      ) : (
        <div style={{ width: "100%", maxWidth: 720 }}>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ color: "var(--muted)", fontSize: "0.85rem" }}>Chart:</span>
            <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 999, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setViewerChartType("bar")}
                style={{
                  padding: "0.25rem 0.55rem",
                  border: "none",
                  background: viewerChartType === "bar" ? "rgba(79,70,229,0.10)" : "transparent",
                  color: viewerChartType === "bar" ? "var(--accent)" : "var(--text)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
                aria-pressed={viewerChartType === "bar"}
              >
                Bar
              </button>
              <button
                type="button"
                onClick={() => setViewerChartType("pie")}
                style={{
                  padding: "0.25rem 0.55rem",
                  border: "none",
                  borderLeft: "1px solid var(--border)",
                  background: viewerChartType === "pie" ? "rgba(79,70,229,0.10)" : "transparent",
                  color: viewerChartType === "pie" ? "var(--accent)" : "var(--text)",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
                aria-pressed={viewerChartType === "pie"}
              >
                Pie
              </button>
            </div>
            {hiddenSeriesKeys.length > 0 && (
              <button type="button" className="btn" onClick={() => setHiddenSeriesKeys([])} style={{ fontSize: "0.85rem" }}>
                Reset hidden
              </button>
            )}
          </div>

          {chartType === "pie" ? (
            <svg viewBox="0 0 640 300" role="img" aria-label="Pie chart" style={{ width: "100%", height: "auto", display: "block" }}>
              <rect x="0" y="0" width="640" height="300" fill="var(--bg)" rx="6" />
              {(() => {
                const data = visibleNumeric.slice(0, 12);
                const total = data.reduce((s, b) => s + b.value, 0) || 1;
                const cx = 210;
                const cy = 150;
                const r = 110;
                let a = -Math.PI / 2;
                const colors = ["var(--accent)", "rgba(79,70,229,0.65)", "rgba(79,70,229,0.45)", "rgba(79,70,229,0.3)"];
                return (
                  <>
                    {data.map((b, i) => {
                      const frac = b.value / total;
                      const next = a + frac * Math.PI * 2;
                      const d = pieArcPath(cx, cy, r, a, next);
                      a = next;
                      return <path key={b.key} d={d} fill={colors[i % colors.length]} stroke="var(--surface)" strokeWidth="1" />;
                    })}
                    <text x="420" y="34" fontSize="12" fill="var(--muted)">
                      Top fields
                    </text>
                    {data.slice(0, 8).map((b, i) => (
                      <g key={b.key}>
                        <rect x="420" y={52 + i * 26} width="10" height="10" fill={colors[i % colors.length]} />
                        <text x="436" y={61 + i * 26} fontSize="11" fill="var(--text)">
                          {b.key.length > 22 ? `${b.key.slice(0, 20)}…` : b.key} ({b.value.toLocaleString()})
                        </text>
                      </g>
                    ))}
                  </>
                );
              })()}
            </svg>
          ) : (
            <svg viewBox="0 0 640 260" role="img" aria-label="Bar chart" style={{ width: "100%", height: "auto", display: "block" }}>
              <rect x="0" y="0" width="640" height="260" fill="var(--bg)" rx="6" />
              {(() => {
                const W = 640;
                const H = 260;
                const left = 40;
                const right = 16;
                const top = 16;
                const bottom = 52;
                const innerW = W - left - right;
                const innerH = H - top - bottom;
                const n = visibleNumeric.length;
                const gap = 8;
                const barW = n > 0 ? Math.max(8, (innerW - gap * (n - 1)) / n) : 8;
                return (
                  <>
                    <text x={8} y={top + 12} fontSize="11" fill="var(--muted)">
                      {maxV.toLocaleString()}
                    </text>
                    {visibleNumeric.map((b, i) => {
                      const x = left + i * (barW + gap);
                      const h = maxV > 0 ? (b.value / maxV) * innerH : 0;
                      const y = top + innerH - h;
                      return (
                        <g key={b.key}>
                          <rect x={x} y={y} width={barW} height={h} fill="var(--accent)" opacity={0.85} rx={2} />
                          <text x={x + barW / 2} y={H - 8} fontSize="9" fill="var(--muted)" textAnchor="middle">
                            {b.key.length > 14 ? `${b.key.slice(0, 12)}…` : b.key}
                          </text>
                        </g>
                      );
                    })}
                  </>
                );
              })()}
            </svg>
          )}
          <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
            {numeric.slice(0, 20).map((b) => {
              const hidden = hiddenSeriesKeys.includes(b.key);
              return (
                <button
                  key={b.key}
                  type="button"
                  onClick={() => toggleHiddenSeries(b.key)}
                  style={{
                    padding: "0.12rem 0.45rem",
                    borderRadius: 999,
                    border: `1px solid ${hidden ? "var(--border)" : "var(--accent)"}`,
                    background: hidden ? "var(--surface)" : "rgba(79,70,229,0.10)",
                    color: hidden ? "var(--muted)" : "var(--accent)",
                    fontSize: "0.78rem",
                    cursor: "pointer",
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={hidden ? "Hidden (click to show)" : "Visible (click to hide)"}
                >
                  {b.key}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function KpiTableWidget({
  widget,
  organizationId,
}: {
  widget: Extract<Widget, { type: "kpi_table" }>;
  organizationId: number;
}) {
  const token = getAccessToken();
  const [rows, setRows] = useState<Array<{ label: string; value: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    Promise.all([
      getKpiFieldMap(token, organizationId, widget.kpi_id),
      (async () => {
        const q = new URLSearchParams({
          kpi_id: String(widget.kpi_id),
          year: String(widget.year),
          organization_id: String(organizationId),
        });
        if (widget.period_key) q.set("period_key", widget.period_key);
        return api<any>(`/entries/for-period?${q.toString()}`, { token });
      })(),
    ])
      .then(([map, entry]) => {
        const keys = widget.field_keys?.length ? widget.field_keys : Object.keys(map.idByKey);
        const out: Array<{ label: string; value: string }> = [];
        keys.forEach((k) => {
          const fid = map.idByKey[k];
          const raw = fid ? rawFieldFromEntry(entry, fid) : null;
          const val = raw == null ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
          out.push({ label: map.nameByKey[k] ?? k, value: val });
        });
        setRows(out);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load KPI entry"))
      .finally(() => setLoading(false));
  }, [token, widget.kpi_id, widget.year, widget.period_key, organizationId, JSON.stringify(widget.field_keys ?? [])]);

  return (
    <Card title={widget.title}>
      {loading ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>Loading…</p>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--muted)", margin: 0 }}>No data.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.5rem 0.25rem", fontWeight: 600, width: "40%" }}>{r.label}</td>
                  <td style={{ padding: "0.5rem 0.25rem" }}>{r.value || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

