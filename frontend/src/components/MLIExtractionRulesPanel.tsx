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

interface ExtractionRule {
  id: number;
  field_id: number;
  name: string;
  is_active: boolean;
  sort_order: number;
  source_sub_field_key: string;
  target_sub_field_key: string | null;
  extraction_method: "between_symbols" | "remove_only";
  start_symbol: string;
  end_symbol: string;
  remove_delimiters_too: boolean;
  occurrence: "first" | "last" | "all";
  all_separator: string | null;
  target_action: "replace" | "append" | "populate_if_empty" | null;
  remove_from_source: boolean;
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
  const active = rules.filter((r) => r.is_active && r.extraction_method === "between_symbols");
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

const TARGET_ACTION_LABELS: Record<string, string> = {
  replace: "Replace",
  append: "Append",
  populate_if_empty: "Populate only if empty",
};

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
    setShowForm(true);
  };

  const openEdit = (rule: ExtractionRule) => {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      is_active: rule.is_active,
      sort_order: rule.sort_order,
      source_sub_field_key: rule.source_sub_field_key,
      target_sub_field_key: rule.target_sub_field_key,
      extraction_method: rule.extraction_method,
      start_symbol: rule.start_symbol,
      end_symbol: rule.end_symbol,
      remove_delimiters_too: rule.remove_delimiters_too,
      occurrence: rule.occurrence,
      all_separator: rule.all_separator,
      target_action: rule.target_action,
      remove_from_source: rule.remove_from_source,
    });
    setFormError(null);
    setPreviewRows(null);
    setPreviewError(null);
    setShowForm(true);
  };

  const validateForm = (): string | null => {
    if (!form.name.trim()) return "Name is required";
    if (!form.source_sub_field_key) return "Source column is required";
    if (!form.start_symbol) return "Start symbol is required";
    if (!form.end_symbol) return "End symbol is required";
    if (form.extraction_method === "between_symbols") {
      if (!form.target_sub_field_key) return "Target column is required for Between Symbols — Extract";
      if (!form.target_action) return "Target action is required for Between Symbols — Extract";
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
              No extraction rules yet. Rules run in order and are applied in-memory — raw stored data is never changed.
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
                      ) : (
                        <><code>{rule.source_sub_field_key}</code> <span style={{ fontFamily: "monospace" }}>{rule.start_symbol}…{rule.end_symbol}</span> → <code>{rule.target_sub_field_key}</code></>
                      )}
                    </span>
                    <span style={{ fontSize: "0.75rem", padding: "0.1rem 0.45rem", borderRadius: 9999, border: "1px solid var(--border)", color: "var(--muted)" }}>
                      {rule.occurrence}
                    </span>
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
              <input id={`mli-rule-name-${fieldId}`} className="form-control" value={f.name} onChange={(e) => setF({ name: e.target.value })} placeholder="e.g. Extract patent code" />
            </div>

            {/* Method */}
            <div className="form-group" style={{ margin: 0, gridColumn: "1 / -1" }}>
              <label>Extraction method *</label>
              <select
                id={`mli-rule-method-${fieldId}`}
                className="form-control"
                value={f.extraction_method}
                onChange={(e) => {
                  const m = e.target.value as "between_symbols" | "remove_only";
                  setF({ extraction_method: m, target_sub_field_key: m === "remove_only" ? null : f.target_sub_field_key, target_action: m === "remove_only" ? null : (f.target_action ?? "replace") });
                }}
              >
                <option value="between_symbols">Between Symbols — Extract (copy text to target column)</option>
                <option value="remove_only">Between Symbols — Remove Only (delete text from source column)</option>
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

            {/* Target column — only for between_symbols */}
            {f.extraction_method === "between_symbols" && (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Target column *</label>
                <select id={`mli-rule-tgt-${fieldId}`} className="form-control" value={f.target_sub_field_key ?? ""} onChange={(e) => setF({ target_sub_field_key: e.target.value || null })}>
                  <option value="">— select —</option>
                  {subFields.map((sf) => <option key={sf.key} value={sf.key}>{sf.name} ({sf.key})</option>)}
                </select>
              </div>
            )}

            {/* Start symbol */}
            <div className="form-group" style={{ margin: 0 }}>
              <label>Start symbol *</label>
              <select id={`mli-rule-start-${fieldId}`} className="form-control" value={f.start_symbol} onChange={(e) => setF({ start_symbol: e.target.value })}>
                <option value="">— select —</option>
                {activeSymbols.map((s) => <option key={s.id} value={s.value}>{s.label} ({s.value})</option>)}
              </select>
            </div>

            {/* End symbol */}
            <div className="form-group" style={{ margin: 0 }}>
              <label>End symbol *</label>
              <select id={`mli-rule-end-${fieldId}`} className="form-control" value={f.end_symbol} onChange={(e) => setF({ end_symbol: e.target.value })}>
                <option value="">— select —</option>
                {activeSymbols.map((s) => <option key={s.id} value={s.value}>{s.label} ({s.value})</option>)}
              </select>
            </div>

            {/* Occurrence */}
            <div className="form-group" style={{ margin: 0 }}>
              <label>Occurrence</label>
              <select id={`mli-rule-occ-${fieldId}`} className="form-control" value={f.occurrence} onChange={(e) => setF({ occurrence: e.target.value as any })}>
                <option value="first">First match</option>
                <option value="last">Last match</option>
                <option value="all">All matches</option>
              </select>
            </div>

            {/* Separator — only when occurrence=all and extracting */}
            {f.occurrence === "all" && f.extraction_method === "between_symbols" && (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Separator (when joining all matches)</label>
                <input className="form-control" value={f.all_separator ?? ""} onChange={(e) => setF({ all_separator: e.target.value || null })} placeholder=", " />
              </div>
            )}

            {/* Target action — only for between_symbols */}
            {f.extraction_method === "between_symbols" && (
              <div className="form-group" style={{ margin: 0 }}>
                <label>Target action *</label>
                <select id={`mli-rule-action-${fieldId}`} className="form-control" value={f.target_action ?? "replace"} onChange={(e) => setF({ target_action: e.target.value as any })}>
                  <option value="replace">Replace</option>
                  <option value="append">Append</option>
                  <option value="populate_if_empty">Populate only if empty</option>
                </select>
              </div>
            )}
          </div>

          {/* Boolean flags */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.9rem" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.9rem", cursor: "pointer" }}>
              <input type="checkbox" checked={f.remove_delimiters_too} onChange={(e) => setF({ remove_delimiters_too: e.target.checked })} />
              Also remove delimiter characters (the <code style={{ margin: "0 0.15rem" }}>{f.start_symbol}</code> and <code style={{ margin: "0 0.15rem" }}>{f.end_symbol}</code> themselves)
            </label>

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

          {/* Preview */}
          <div style={{ marginTop: "1.1rem" }}>
            <button
              id={`mli-rule-preview-${fieldId}`}
              type="button"
              className="btn"
              onClick={runPreview}
              disabled={previewLoading}
              style={{ marginRight: "0.5rem" }}
            >
              {previewLoading ? "Running preview…" : "▶ Preview on sample rows"}
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
