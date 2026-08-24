"use client";

import React, { useCallback, useEffect, useState } from "react";

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface Symbol {
  id: number;
  label: string;
  value: string;
  is_active: boolean;
}

interface SubFieldDef {
  key: string;
  name: string;
}

export type ExtractionMethod = "between_symbols" | "remove_only" | "full_cell_format";
export type WrapMode = "none" | "prefix" | "suffix" | "wrap" | "pattern";

interface ExtractionRule {
  id: number;
  field_id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
  source_sub_field_key: string;
  target_sub_field_key: string | null;
  extraction_method: ExtractionMethod;
  start_symbol: string;
  end_symbol: string;
  remove_delimiters_too: boolean;
  occurrence: "first" | "last" | "all";
  all_separator: string | null;
  target_action: "replace" | "append" | "populate_if_empty" | null;
  remove_from_source: boolean;
  wrap_mode?: WrapMode | null;
  wrap_symbol?: string | null;
  wrap_end_symbol?: string | null;
  output_pattern?: string | null;
}

type RuleForm = Omit<ExtractionRule, "id" | "field_id">;

const EMPTY_FORM: RuleForm = {
  name: "",
  is_active: true,
  sort_order: 0,
  source_sub_field_key: "",
  target_sub_field_key: null,
  extraction_method: "between_symbols",
  start_symbol: "(",
  end_symbol: ")",
  remove_delimiters_too: true,
  occurrence: "first",
  all_separator: null,
  target_action: "replace",
  remove_from_source: false,
  wrap_mode: "none",
  wrap_symbol: "(",
  wrap_end_symbol: ")",
  output_pattern: "",
};

interface Props {
  token: string;
  fieldId: number;
  subFields: SubFieldDef[];
  /** Optional: first few rows from the latest entry (used for live preview) */
  sampleRows?: Record<string, unknown>[];
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

async function apiFetch<T>(path: string, token: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

/** Client-side cycle detection (mirrors backend logic). */
function hasCycle(rules: RuleForm[]): boolean {
  const active = rules.filter((r) => r.is_active && r.extraction_method !== "remove_only");
  const targets = new Map<string, string>();
  for (const r of active) {
    if (r.target_sub_field_key) targets.set(r.target_sub_field_key, r.source_sub_field_key);
  }
  for (const r of active) {
    const visited = new Set<string>();
    let cur = r.source_sub_field_key;
    while (targets.has(cur)) {
      if (visited.has(cur)) return true;
      visited.add(cur);
      cur = targets.get(cur)!;
    }
  }
  return false;
}

const DEFAULT_SYMBOLS = [
  { label: "Opening Paren (", value: "(" },
  { label: "Closing Paren )", value: ")" },
  { label: "Opening Bracket [", value: "[" },
  { label: "Closing Bracket ]", value: "]" },
  { label: "Opening Brace {", value: "{" },
  { label: "Closing Brace }", value: "}" },
  { label: "Angle Open <", value: "<" },
  { label: "Angle Close >", value: ">" },
  { label: "Double Quote \"", value: "\"" },
  { label: "Single Quote '", value: "'" },
  { label: "Parentheses ()", value: "()" },
  { label: "Square Brackets []", value: "[]" },
  { label: "Curly Braces {}", value: "{}" },
  { label: "Angle Brackets <>", value: "<>" },
  { label: "Hyphen / Dash -", value: "-" },
  { label: "Slash /", value: "/" },
  { label: "Pipe |", value: "|" },
  { label: "Colon :", value: ":" },
  { label: "Semicolon ;", value: ";" },
  { label: "Comma ,", value: "," },
];

/** Auto-lookup closing pair for opening symbol */
function getMatchingPair(start: string): string {
  if (start === "(" || start === "()") return ")";
  if (start === "[" || start === "[]") return "]";
  if (start === "{" || start === "{}") return "}";
  if (start === "<" || start === "<>") return ">";
  if (start === "\"\"" || start === "\"") return "\"";
  if (start === "''" || start === "'") return "'";
  return start;
}

/** Live client-side preview calculator */
function computeLivePreview(form: RuleForm, sampleVal: string, targetColValue: string = ""): string {
  if (!sampleVal && sampleVal !== "0") return "";
  let val = sampleVal.trim();

  // Extraction phase
  if (form.extraction_method === "between_symbols") {
    const start = form.start_symbol || "(";
    const end = form.end_symbol || ")";
    const sPos = val.indexOf(start);
    if (sPos !== -1) {
      const ePos = val.indexOf(end, sPos + start.length);
      if (ePos !== -1) {
        val = val.substring(sPos + start.length, ePos).trim();
      }
    }
  }

  // Formatting phase
  const mode = form.wrap_mode || "none";
  let formatted = val;

  if (mode === "prefix") {
    const sym = form.wrap_symbol || "";
    formatted = `${sym}${val}`;
  } else if (mode === "suffix") {
    const sym = form.wrap_end_symbol || form.wrap_symbol || "";
    formatted = `${val}${sym}`;
  } else if (mode === "wrap") {
    let start = form.wrap_symbol || "(";
    let end = form.wrap_end_symbol || "";
    if (start === "()") { start = "("; end = ")"; }
    else if (start === "[]") { start = "["; end = "]"; }
    else if (start === "{}") { start = "{"; end = "}"; }
    else if (start === "<>") { start = "<"; end = ">"; }
    else if (start === "\"\"") { start = "\""; end = "\""; }
    else if (start === "''") { start = "'"; end = "'"; }

    if (!end) {
      end = getMatchingPair(start);
    }
    formatted = `${start}${val}${end}`;
  } else if (mode === "pattern" || form.output_pattern) {
    const pattern = form.output_pattern || "{CELL_VALUE}";
    formatted = pattern.replace("{CELL_VALUE}", val);
  }

  // Target Action
  if (form.target_action === "append" && targetColValue) {
    const sep = form.all_separator || " ";
    return `${targetColValue}${sep}${formatted}`;
  }

  return formatted;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────

export function MLIExtractionRulesPanel({ token, fieldId, subFields, sampleRows }: Props) {
  const [rules, setRules] = useState<ExtractionRule[]>([]);
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Live test preview state
  const [testSourceVal, setTestSourceVal] = useState<string>("Computer Science");
  const [testTargetVal, setTestTargetVal] = useState<string>("Faculty of Computing");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rulesData, symsData] = await Promise.all([
        apiFetch<ExtractionRule[]>(`/mli/fields/${fieldId}/extraction-rules`, token),
        apiFetch<Symbol[]>("/mli/symbols", token),
      ]);
      setRules(rulesData);
      setSymbols(symsData.filter((s) => s.is_active));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token, fieldId]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, sort_order: rules.length * 10 });
    setFormError(null);
    setPreviewRows(null);
    setPreviewError(null);
    setTestSourceVal("Computer Science");
    setTestTargetVal("Faculty of Computing");
    setShowForm(true);
  };

  const openEdit = (rule: ExtractionRule) => {
    const startSym = rule.wrap_symbol || "(";
    const endSym = rule.wrap_end_symbol || getMatchingPair(startSym);
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      is_active: rule.is_active,
      sort_order: rule.sort_order,
      source_sub_field_key: rule.source_sub_field_key,
      target_sub_field_key: rule.target_sub_field_key,
      extraction_method: rule.extraction_method,
      start_symbol: rule.start_symbol || "(",
      end_symbol: rule.end_symbol || ")",
      remove_delimiters_too: rule.remove_delimiters_too,
      occurrence: rule.occurrence,
      all_separator: rule.all_separator,
      target_action: rule.target_action || "replace",
      remove_from_source: rule.remove_from_source,
      wrap_mode: rule.wrap_mode || "none",
      wrap_symbol: startSym,
      wrap_end_symbol: endSym,
      output_pattern: rule.output_pattern || "",
    });
    setFormError(null);
    setPreviewRows(null);
    setPreviewError(null);
    setTestSourceVal("Computer Science");
    setTestTargetVal("Faculty of Computing");
    setShowForm(true);
  };

  const validateForm = (): string | null => {
    if (!form.name.trim()) return "Name is required";
    if (!form.source_sub_field_key) return "Source column is required";

    if (form.extraction_method === "between_symbols") {
      if (!form.start_symbol) return "Start symbol is required";
      if (!form.end_symbol) return "End symbol is required";
      if (!form.target_sub_field_key) return "Target column is required for Between Symbols";
    }

    if (form.extraction_method === "full_cell_format") {
      if (!form.target_sub_field_key) return "Target column is required";
    }

    // Client-side cycle check
    const rulesForCheck: RuleForm[] = [
      ...rules
        .filter((r) => r.id !== editingId)
        .map((r) => ({
          name: r.name,
          is_active: r.is_active,
          sort_order: r.sort_order,
          source_sub_field_key: r.source_sub_field_key,
          target_sub_field_key: r.target_sub_field_key,
          extraction_method: r.extraction_method,
          start_symbol: r.start_symbol,
          end_symbol: r.end_symbol,
          remove_delimiters_too: r.remove_delimiters_too,
          occurrence: r.occurrence,
          all_separator: r.all_separator,
          target_action: r.target_action,
          remove_from_source: r.remove_from_source,
          wrap_mode: r.wrap_mode,
          wrap_symbol: r.wrap_symbol,
          wrap_end_symbol: r.wrap_end_symbol,
          output_pattern: r.output_pattern,
        })),
      form,
    ];
    if (hasCycle(rulesForCheck)) return "Circular dependency detected: this rule creates a loop";
    return null;
  };

  const save = async () => {
    const err = validateForm();
    if (err) { setFormError(err); return; }
    setSaving(true);
    setFormError(null);
    try {
      if (editingId !== null) {
        await apiFetch(`/mli/fields/${fieldId}/extraction-rules/${editingId}`, token, {
          method: "PATCH",
          body: JSON.stringify(form),
        });
      } else {
        await apiFetch(`/mli/fields/${fieldId}/extraction-rules`, token, {
          method: "POST",
          body: JSON.stringify(form),
        });
      }
      setShowForm(false);
      setEditingId(null);
      await load();
    } catch (e: any) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const deleteRule = async (rule: ExtractionRule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await apiFetch(`/mli/fields/${fieldId}/extraction-rules/${rule.id}`, token, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const toggleActive = async (rule: ExtractionRule) => {
    try {
      await apiFetch(`/mli/fields/${fieldId}/extraction-rules/${rule.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({
          ...rule,
          field_id: undefined,
          id: undefined,
          is_active: !rule.is_active,
        }),
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const runPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewRows(null);
    const rows = sampleRows?.length ? sampleRows.slice(0, 10) : [{}];
    try {
      const res = await apiFetch<{ result_rows: Record<string, unknown>[]; error?: string }>(
        `/mli/fields/${fieldId}/extraction-rules/preview`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ rows, rules: [form] }),
        }
      );
      if (res.error) { setPreviewError(res.error); }
      else { setPreviewRows(res.result_rows); }
    } catch (e: any) {
      setPreviewError(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const f = form;
  const setF = (partial: Partial<RuleForm>) => setForm((prev) => ({ ...prev, ...partial }));
  const activeSymbols = symbols.filter((s) => s.is_active);

  // Available symbol dropdown items
  const symbolOptions = [
    ...activeSymbols.map((s) => ({ label: `${s.label} (${s.value})`, value: s.value })),
    ...DEFAULT_SYMBOLS.filter((ds) => !activeSymbols.some((s) => s.value === ds.value)),
  ];

  const livePreviewResult = computeLivePreview(
    f,
    testSourceVal,
    f.target_action === "append" ? testTargetVal : ""
  );

  if (loading) return <div style={{ color: "var(--muted)", padding: "0.75rem 0" }}>Loading extraction rules…</div>;

  return (
    <div>
      {error && (
        <div style={{ background: "var(--error-subtle, #fef2f2)", border: "1px solid var(--error)", borderRadius: 8, padding: "0.6rem 0.9rem", marginBottom: "0.75rem", color: "var(--error)", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Rule list */}
      {!showForm && (
        <>
          {rules.length === 0 ? (
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "0.75rem" }}>
              No extraction rules yet. Rules run in order and format/extract values in-memory — raw stored data is never changed.
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: "0 0 0.75rem", padding: 0 }}>
              {rules.map((rule, idx) => (
                <li key={rule.id} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem",
                  padding: "0.6rem 0.75rem", borderRadius: 8, marginBottom: "0.4rem", flexWrap: "wrap",
                  border: "1px solid var(--border)",
                  background: rule.is_active ? "var(--bg-subtle, #f9fafb)" : "transparent",
                  opacity: rule.is_active ? 1 : 0.55,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontWeight: 600, minWidth: 20 }}>#{idx + 1}</span>
                    <span style={{ fontWeight: 600 }}>{rule.name}</span>
                    <span style={{ color: "var(--muted)", fontSize: "0.82rem" }}>
                      {rule.extraction_method === "remove_only" ? (
                        <><code>{rule.source_sub_field_key}</code> — remove <code>{rule.start_symbol}…{rule.end_symbol}</code></>
                      ) : rule.extraction_method === "full_cell_format" ? (
                        <><code>{rule.source_sub_field_key}</code> <span style={{ color: "#2563eb", fontWeight: 600 }}>[Full Cell {rule.wrap_mode || "format"}]</span> → <code>{rule.target_sub_field_key}</code></>
                      ) : (
                        <><code>{rule.source_sub_field_key}</code> <span style={{ fontFamily: "monospace" }}>{rule.start_symbol}…{rule.end_symbol}</span> → <code>{rule.target_sub_field_key}</code></>
                      )}
                    </span>
                    {rule.wrap_mode && rule.wrap_mode !== "none" && (
                      <span style={{ fontSize: "0.72rem", padding: "0.1rem 0.4rem", borderRadius: 4, background: "#eff6ff", color: "#1d4ed8", fontWeight: 600 }}>
                        {rule.wrap_mode}: {rule.wrap_symbol} {rule.wrap_end_symbol ? `… ${rule.wrap_end_symbol}` : ""}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.82rem", color: "var(--muted)", cursor: "pointer" }}>
                      <input type="checkbox" checked={rule.is_active} onChange={() => toggleActive(rule)} /> Active
                    </label>
                    <button type="button" className="btn" style={{ padding: "0.2rem 0.55rem", fontSize: "0.8rem" }} onClick={() => openEdit(rule)}>Edit</button>
                    <button type="button" className="btn" style={{ padding: "0.2rem 0.55rem", fontSize: "0.8rem", color: "var(--error)" }} onClick={() => deleteRule(rule)}>Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <button id={`mli-rule-add-btn-${fieldId}`} type="button" className="btn btn-primary" onClick={openCreate}>
            + Add extraction rule
          </button>
        </>
      )}

      {/* Rule form */}
      {showForm && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "1.1rem", background: "var(--bg-subtle, #f9fafb)" }}>
          <h4 style={{ margin: "0 0 1rem", fontSize: "1rem" }}>
            {editingId !== null ? "Edit Rule" : "New Extraction Rule"}
          </h4>

          {formError && (
            <div style={{ background: "var(--error-subtle, #fef2f2)", border: "1px solid var(--error)", borderRadius: 8, padding: "0.55rem 0.8rem", marginBottom: "0.85rem", color: "var(--error)", fontSize: "0.875rem" }}>
              {formError}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.65rem 1rem" }}>
            {/* Name */}
            <div className="form-group" style={{ margin: 0, gridColumn: "1 / -1" }}>
              <label>Rule name *</label>
              <input id={`mli-rule-name-${fieldId}`} className="form-control" value={f.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. Append department wrapped in parentheses" />
            </div>

            {/* Method */}
            <div className="form-group" style={{ margin: 0, gridColumn: "1 / -1" }}>
              <label>Extraction method *</label>
              <select
                id={`mli-rule-method-${fieldId}`}
                className="form-control"
                value={f.extraction_method}
                onChange={(e) => {
                  const m = e.target.value as ExtractionMethod;
                  setF({
                    extraction_method: m,
                    target_sub_field_key: m === "remove_only" ? null : (f.target_sub_field_key || f.source_sub_field_key),
                    target_action: m === "remove_only" ? null : (f.target_action ?? "replace"),
                  });
                }}
              >
                <option value="between_symbols">Between Symbols — Extract (copy text between delimiters)</option>
                <option value="remove_only">Between Symbols — Remove Only (delete text from source column)</option>
                <option value="full_cell_format">Full Cell Value — Format / Wrap / Append (entire complete value)</option>
              </select>
            </div>

            {/* Source column */}
            <div className="form-group" style={{ margin: 0 }}>
              <label>Source column *</label>
              <select id={`mli-rule-src-${fieldId}`} className="form-control" value={f.source_sub_field_key} onChange={(e) => setF({ source_sub_field_key: e.target.value })}>
                <option value="">— select —</option>
                {subFields.map((sf) => <option key={sf.key} value={sf.key}>{sf.name} ({sf.key})</option>)}
              </select>
            </div>

            {/* Target column — for between_symbols and full_cell_format */}
            {f.extraction_method !== "remove_only" && (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Target column *</label>
                <select id={`mli-rule-tgt-${fieldId}`} className="form-control" value={f.target_sub_field_key ?? ""} onChange={(e) => setF({ target_sub_field_key: e.target.value || null })}>
                  <option value="">— select —</option>
                  {subFields.map((sf) => <option key={sf.key} value={sf.key}>{sf.name} ({sf.key})</option>)}
                </select>
              </div>
            )}

            {/* Start & End symbols — only for between_symbols / remove_only */}
            {f.extraction_method !== "full_cell_format" && (
              <>
                <div className="form-group" style={{ margin: 0 }}>
                  <label>Start symbol *</label>
                  <select id={`mli-rule-start-${fieldId}`} className="form-control" value={f.start_symbol} onChange={(e) => setF({ start_symbol: e.target.value })}>
                    <option value="">— select —</option>
                    {symbolOptions.map((s, idx) => <option key={idx} value={s.value}>{s.label}</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label>End symbol *</label>
                  <select id={`mli-rule-end-${fieldId}`} className="form-control" value={f.end_symbol} onChange={(e) => setF({ end_symbol: e.target.value })}>
                    <option value="">— select —</option>
                    {symbolOptions.map((s, idx) => <option key={idx} value={s.value}>{s.label}</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ margin: 0 }}>
                  <label>Occurrence</label>
                  <select id={`mli-rule-occ-${fieldId}`} className="form-control" value={f.occurrence} onChange={(e) => setF({ occurrence: e.target.value as any })}>
                    <option value="first">First match</option>
                    <option value="last">Last match</option>
                    <option value="all">All matches</option>
                  </select>
                </div>
              </>
            )}

            {/* Separator */}
            {f.extraction_method !== "remove_only" && (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Separator / Space</label>
                <input className="form-control" value={f.all_separator ?? ""} onChange={(e) => setF({ all_separator: e.target.value || null })} placeholder="Default space ( )" />
              </div>
            )}

            {/* Target action — for between_symbols and full_cell_format */}
            {f.extraction_method !== "remove_only" && (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Target action *</label>
                <select id={`mli-rule-action-${fieldId}`} className="form-control" value={f.target_action ?? "replace"} onChange={(e) => setF({ target_action: e.target.value as any })}>
                  <option value="replace">Replace target cell</option>
                  <option value="append">Append to existing target cell</option>
                  <option value="populate_if_empty">Populate only if target is empty</option>
                </select>
              </div>
            )}

            {/* Symbol Application / Formatting Section */}
            {f.extraction_method !== "remove_only" && (
              <div style={{ gridColumn: "1 / -1", background: "#fff", padding: "0.85rem 1rem", borderRadius: 8, border: "1px solid var(--border)", marginTop: "0.5rem" }}>
                <div style={{ fontWeight: 600, fontSize: "0.9rem", marginBottom: "0.6rem", color: "#1e293b" }}>
                  Symbol Application & Wrapping
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.65rem 1rem" }}>
                  <div className="form-group" style={{ margin: 0 }}>
                    <label>Symbol Application Mode</label>
                    <select className="form-control" value={f.wrap_mode || "none"} onChange={(e) => setF({ wrap_mode: e.target.value as WrapMode })}>
                      <option value="none">None (Plain Extracted Value)</option>
                      <option value="wrap">Wrap with Start & End Symbols (e.g. ( Value ))</option>
                      <option value="prefix">Prefix Symbol (e.g. [ Value)</option>
                      <option value="suffix">Suffix Symbol (e.g. Value ])</option>
                      <option value="pattern">Custom Output Pattern Template</option>
                    </select>
                  </div>

                  {f.wrap_mode === "wrap" && (
                    <>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label>Start Symbol (Opening)</label>
                        <select
                          className="form-control"
                          value={f.wrap_symbol || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            const pair = getMatchingPair(val);
                            setF({ wrap_symbol: val, wrap_end_symbol: pair });
                          }}
                        >
                          <option value="">— select start symbol —</option>
                          {symbolOptions.map((s, idx) => <option key={idx} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>

                      <div className="form-group" style={{ margin: 0 }}>
                        <label>End Symbol (Closing)</label>
                        <select
                          className="form-control"
                          value={f.wrap_end_symbol || ""}
                          onChange={(e) => setF({ wrap_end_symbol: e.target.value })}
                        >
                          <option value="">— select end symbol —</option>
                          {symbolOptions.map((s, idx) => <option key={idx} value={s.value}>{s.label}</option>)}
                        </select>
                      </div>
                    </>
                  )}

                  {f.wrap_mode === "prefix" && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Prefix Symbol</label>
                      <select className="form-control" value={f.wrap_symbol || ""} onChange={(e) => setF({ wrap_symbol: e.target.value })}>
                        <option value="">— select symbol —</option>
                        {symbolOptions.map((s, idx) => <option key={idx} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  )}

                  {f.wrap_mode === "suffix" && (
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Suffix Symbol</label>
                      <select className="form-control" value={f.wrap_end_symbol || f.wrap_symbol || ""} onChange={(e) => setF({ wrap_end_symbol: e.target.value, wrap_symbol: e.target.value })}>
                        <option value="">— select symbol —</option>
                        {symbolOptions.map((s, idx) => <option key={idx} value={s.value}>{s.label}</option>)}
                      </select>
                    </div>
                  )}

                  {(f.wrap_mode === "pattern" || f.output_pattern) && (
                    <div className="form-group" style={{ margin: 0, gridColumn: "1 / -1" }}>
                      <label>Custom Output Pattern</label>
                      <input
                        className="form-control"
                        value={f.output_pattern || ""}
                        onChange={(e) => setF({ output_pattern: e.target.value })}
                        placeholder="e.g. [ {CELL_VALUE} ]  or  {faculty} [{CELL_VALUE}]"
                      />
                      <div style={{ fontSize: "0.78rem", color: "var(--muted)", marginTop: "0.3rem", display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                        <span>Click placeholder to insert:</span>
                        <button type="button" className="btn" style={{ padding: "0.1rem 0.35rem", fontSize: "0.75rem" }} onClick={() => setF({ output_pattern: (f.output_pattern || "") + "{CELL_VALUE}" })}>
                          {"{CELL_VALUE}"}
                        </button>
                        {subFields.map((sf) => (
                          <button key={sf.key} type="button" className="btn" style={{ padding: "0.1rem 0.35rem", fontSize: "0.75rem" }} onClick={() => setF({ output_pattern: (f.output_pattern || "") + `{${sf.key}}` })}>
                            {`{${sf.key}}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Real-time Interactive Preview Section */}
          {f.extraction_method !== "remove_only" && (
            <div style={{ marginTop: "1rem", background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 8, padding: "0.85rem 1rem" }}>
              <div style={{ fontWeight: 700, fontSize: "0.85rem", color: "#0369a1", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>⚡ Real-Time Live Preview</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.6rem 1rem" }}>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#0369a1" }}>Test Source Value:</label>
                  <input className="form-control" style={{ fontSize: "0.82rem", background: "#fff" }} value={testSourceVal} onChange={(e) => setTestSourceVal(e.target.value)} placeholder="Enter test source cell value" />
                </div>
                {f.target_action === "append" && (
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#0369a1" }}>Existing Target Value:</label>
                    <input className="form-control" style={{ fontSize: "0.82rem", background: "#fff" }} value={testTargetVal} onChange={(e) => setTestTargetVal(e.target.value)} placeholder="Enter target cell existing value" />
                  </div>
                )}
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ fontSize: "0.78rem", fontWeight: 600, color: "#0369a1" }}>Resulting Stored Target Value:</label>
                  <div style={{ background: "#fff", border: "1px solid #7dd3fc", padding: "0.45rem 0.75rem", borderRadius: 6, fontWeight: 700, fontSize: "0.95rem", color: "#0c4a6e" }}>
                    {livePreviewResult || <span style={{ color: "var(--muted)", fontWeight: 400 }}>(empty)</span>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Boolean flags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.9rem" }}>
            <span style={{ fontSize: "0.85rem", color: "#166534", background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "0.2rem 0.55rem", borderRadius: 6, fontWeight: 600 }}>
              ✓ Source cell value is preserved intact (never erased)
            </span>

            {f.extraction_method !== "full_cell_format" && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", cursor: "pointer" }}>
                <input type="checkbox" checked={f.remove_delimiters_too} onChange={(e) => setF({ remove_delimiters_too: e.target.checked })} />
                Also remove delimiter characters ({f.start_symbol} and {f.end_symbol})
              </label>
            )}

            {f.extraction_method === "between_symbols" && (
              <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", cursor: "pointer" }}>
                <input type="checkbox" checked={f.remove_from_source} onChange={(e) => setF({ remove_from_source: e.target.checked })} />
                Remove extracted text from source column
              </label>
            )}

            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", cursor: "pointer" }}>
              <input type="checkbox" checked={f.is_active} onChange={(e) => setF({ is_active: e.target.checked })} />
              Rule is active
            </label>
          </div>

          {/* Backend sample preview */}
          <div style={{ marginTop: "1.1rem" }}>
            <button
              id={`mli-rule-preview-${fieldId}`}
              type="button"
              className="btn"
              onClick={runPreview}
              disabled={previewLoading}
              style={{ marginRight: "0.5rem" }}
            >
              {previewLoading ? "Running preview…" : "▶ Preview on entry rows"}
            </button>
            {previewError && <span style={{ color: "var(--error)", fontSize: "0.85rem" }}>{previewError}</span>}
          </div>

          {previewRows && previewRows.length > 0 && (
            <div style={{ marginTop: "0.75rem" }}>
              <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--muted)", marginBottom: "0.35rem" }}>
                Preview result (first {previewRows.length} row{previewRows.length !== 1 ? "s" : ""}):
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ fontSize: "0.8rem", borderCollapse: "collapse", minWidth: "100%" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      {Object.keys(previewRows[0]).map((k) => (
                        <th key={k} style={{ padding: "0.25rem 0.5rem", textAlign: "left", color: "var(--muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} style={{ padding: "0.25rem 0.5rem", whiteSpace: "nowrap", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {v === null || v === undefined ? <span style={{ color: "var(--muted)" }}>—</span> : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Form actions */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.1rem", borderTop: "1px solid var(--border)", paddingTop: "0.85rem" }}>
            <button id={`mli-rule-save-${fieldId}`} type="button" className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editingId !== null ? "Save changes" : "Create rule"}
            </button>
            <button type="button" className="btn" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
