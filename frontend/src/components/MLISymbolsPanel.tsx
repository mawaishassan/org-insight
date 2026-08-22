"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

interface Symbol {
  id: number;
  label: string;
  value: string;
  sort_order: number;
  is_active: boolean;
}

interface Props {
  token: string;
}

async function apiFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
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

export function MLISymbolsPanel({ token }: Props) {
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<Symbol>>({});
  const [newLabel, setNewLabel] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Symbol[]>("/mli/symbols", token);
      setSymbols(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (sym: Symbol) => {
    setEditingId(sym.id);
    setEditDraft({ label: sym.label, value: sym.value, sort_order: sym.sort_order, is_active: sym.is_active });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await apiFetch(`/mli/symbols/${editingId}`, token, {
        method: "PATCH",
        body: JSON.stringify(editDraft),
      });
      setEditingId(null);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (sym: Symbol) => {
    try {
      await apiFetch(`/mli/symbols/${sym.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ is_active: !sym.is_active }),
      });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const deleteSym = async (sym: Symbol) => {
    if (!confirm(`Delete symbol "${sym.label}" (${sym.value})?`)) return;
    try {
      await apiFetch(`/mli/symbols/${sym.id}`, token, { method: "DELETE" });
      await load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addSymbol = async () => {
    setAddError(null);
    if (!newLabel.trim()) { setAddError("Label is required"); return; }
    if (!newValue.trim()) { setAddError("Symbol value is required"); return; }
    setSaving(true);
    try {
      await apiFetch("/mli/symbols", token, {
        method: "POST",
        body: JSON.stringify({ label: newLabel.trim(), value: newValue.trim(), sort_order: symbols.length * 10 }),
      });
      setNewLabel("");
      setNewValue("");
      await load();
    } catch (e: any) {
      setAddError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ color: "var(--muted)", padding: "1rem" }}>Loading symbols…</div>;

  return (
    <div>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1.25rem", lineHeight: 1.6 }}>
        Symbols defined here are available in MLI Text Extraction rules as start/end delimiters.
        These are global and shared across all KPIs and organisations.
      </p>

      {error && (
        <div style={{ background: "var(--error-subtle, #fef2f2)", border: "1px solid var(--error, #ef4444)", borderRadius: 8, padding: "0.65rem 0.9rem", marginBottom: "1rem", color: "var(--error, #dc2626)", fontSize: "0.875rem" }}>
          {error}
        </div>
      )}

      {/* Add row */}
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <div className="form-group" style={{ margin: 0, flex: "1 1 180px" }}>
          <label style={{ fontSize: "0.8rem" }}>Label *</label>
          <input
            id="mli-sym-new-label"
            className="form-control"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. Opening paren"
          />
        </div>
        <div className="form-group" style={{ margin: 0, flex: "0 0 100px" }}>
          <label style={{ fontSize: "0.8rem" }}>Symbol *</label>
          <input
            id="mli-sym-new-value"
            className="form-control"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="e.g. ("
            style={{ fontFamily: "monospace" }}
            maxLength={20}
          />
        </div>
        <button
          id="mli-sym-add-btn"
          type="button"
          className="btn btn-primary"
          onClick={addSymbol}
          disabled={saving}
          style={{ height: 38 }}
        >
          Add Symbol
        </button>
      </div>
      {addError && (
        <div style={{ color: "var(--error, #dc2626)", fontSize: "0.85rem", marginTop: "-0.75rem", marginBottom: "0.75rem" }}>
          {addError}
        </div>
      )}

      {/* Symbol table */}
      {symbols.length === 0 ? (
        <div style={{ color: "var(--muted)", fontSize: "0.9rem", padding: "1rem 0" }}>No symbols defined yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid var(--border)" }}>
              <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600, color: "var(--muted)" }}>Label</th>
              <th style={{ textAlign: "left", padding: "0.4rem 0.5rem", fontWeight: 600, color: "var(--muted)" }}>Symbol</th>
              <th style={{ textAlign: "center", padding: "0.4rem 0.5rem", fontWeight: 600, color: "var(--muted)" }}>Active</th>
              <th style={{ textAlign: "right", padding: "0.4rem 0.5rem", fontWeight: 600, color: "var(--muted)" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((sym) => (
              <tr key={sym.id} style={{ borderBottom: "1px solid var(--border)", opacity: sym.is_active ? 1 : 0.55 }}>
                {editingId === sym.id ? (
                  <>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <input
                        className="form-control"
                        style={{ padding: "0.25rem 0.4rem", fontSize: "0.875rem" }}
                        value={editDraft.label ?? ""}
                        onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                      />
                    </td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <input
                        className="form-control"
                        style={{ padding: "0.25rem 0.4rem", fontSize: "0.875rem", fontFamily: "monospace", width: 80 }}
                        value={editDraft.value ?? ""}
                        onChange={(e) => setEditDraft((d) => ({ ...d, value: e.target.value }))}
                        maxLength={20}
                      />
                    </td>
                    <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>
                      <input
                        type="checkbox"
                        checked={editDraft.is_active ?? true}
                        onChange={(e) => setEditDraft((d) => ({ ...d, is_active: e.target.checked }))}
                      />
                    </td>
                    <td style={{ textAlign: "right", padding: "0.4rem 0.5rem" }}>
                      <button type="button" className="btn btn-primary" style={{ marginRight: "0.35rem", padding: "0.2rem 0.6rem", fontSize: "0.8rem" }} onClick={saveEdit} disabled={saving}>Save</button>
                      <button type="button" className="btn" style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem" }} onClick={() => setEditingId(null)}>Cancel</button>
                    </td>
                  </>
                ) : (
                  <>
                    <td style={{ padding: "0.4rem 0.5rem" }}>{sym.label}</td>
                    <td style={{ padding: "0.4rem 0.5rem", fontFamily: "monospace", fontSize: "1rem", fontWeight: 600 }}>{sym.value}</td>
                    <td style={{ textAlign: "center", padding: "0.4rem 0.5rem" }}>
                      <input type="checkbox" checked={sym.is_active} onChange={() => toggleActive(sym)} title="Toggle active" />
                    </td>
                    <td style={{ textAlign: "right", padding: "0.4rem 0.5rem" }}>
                      <button type="button" className="btn" style={{ marginRight: "0.35rem", padding: "0.2rem 0.6rem", fontSize: "0.8rem" }} onClick={() => startEdit(sym)}>Edit</button>
                      <button type="button" className="btn" style={{ padding: "0.2rem 0.6rem", fontSize: "0.8rem", color: "var(--error)" }} onClick={() => deleteSym(sym)}>Delete</button>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
