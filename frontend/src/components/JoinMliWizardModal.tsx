"use client";

import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

// ─────────────── Types ───────────────

interface KpiItem {
  id: number;
  name: string;
}

interface SubField {
  key: string;
  name: string;
  field_type: string;
}

interface MliField {
  id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields: SubField[];
}

interface ColumnAlias {
  source_key: string;
  alias_key: string;
  alias_name: string;
  field_type: string;
}

export interface JoinMliWizardModalProps {
  orgId: number | null;
  token: string;
  onClose: () => void;
  onSuccess: (result: { kpi_id: number; kpi_name: string; mode: string }) => void;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "col";
}

// ─────────────── Steps ───────────────

type WizardStep = 1 | 2 | 3;

// ─────────────── Main Component ───────────────

export function JoinMliWizardModal({ orgId, token, onClose, onSuccess }: JoinMliWizardModalProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const [saving, setSaving] = useState(false);

  // KPI & field data
  const [kpiList, setKpiList] = useState<KpiItem[]>([]);
  const [fieldsMap, setFieldsMap] = useState<Record<number, MliField[]>>({});
  const [loadingKpis, setLoadingKpis] = useState(true);

  // Step 1 selections
  const [kpi1Id, setKpi1Id] = useState<number | "">("");
  const [kpi1FieldKey, setKpi1FieldKey] = useState("");
  const [kpi2Id, setKpi2Id] = useState<number | "">("");
  const [kpi2FieldKey, setKpi2FieldKey] = useState("");

  // Step 2 join config
  const [joinKeyKpi1, setJoinKeyKpi1] = useState("");
  const [joinKeyKpi2, setJoinKeyKpi2] = useState("");
  const [kpi1Columns, setKpi1Columns] = useState<ColumnAlias[]>([]);
  const [kpi2Columns, setKpi2Columns] = useState<ColumnAlias[]>([]);

  // Step 3 destination
  const [mode, setMode] = useState<"create_new" | "enrich_kpi1" | "enrich_kpi2">("create_new");
  const [newKpiName, setNewKpiName] = useState("");
  const [newFieldName, setNewFieldName] = useState("");

  // ─── Load KPIs ───
  useEffect(() => {
    if (!token) return;
    const q = orgId != null ? `?organization_id=${orgId}` : "";
    setLoadingKpis(true);
    api<KpiItem[]>(`/kpis${q}`, { token })
      .then((d) => setKpiList(Array.isArray(d) ? d : []))
      .catch(() => toast.error("Failed to load KPIs"))
      .finally(() => setLoadingKpis(false));
  }, [token, orgId]);

  const fetchFields = useCallback(async (kpiId: number) => {
    if (fieldsMap[kpiId]) return;
    try {
      const q = orgId != null ? `&organization_id=${orgId}` : "";
      const data = await api<MliField[]>(`/fields?kpi_id=${kpiId}${q}`, { token });
      const mliFields = (data || []).filter((f: MliField) => f.field_type === "multi_line_items");
      setFieldsMap((prev) => ({ ...prev, [kpiId]: mliFields }));
    } catch {
      toast.error("Failed to load KPI fields");
    }
  }, [fieldsMap, token, orgId]);

  useEffect(() => {
    if (kpi1Id) fetchFields(Number(kpi1Id));
  }, [kpi1Id]);

  useEffect(() => {
    if (kpi2Id) fetchFields(Number(kpi2Id));
  }, [kpi2Id]);

  // When fields are selected, auto-initialise column checkboxes
  const kpi1Field = kpi1Id ? (fieldsMap[Number(kpi1Id)] || []).find((f) => f.key === kpi1FieldKey) : null;
  const kpi2Field = kpi2Id ? (fieldsMap[Number(kpi2Id)] || []).find((f) => f.key === kpi2FieldKey) : null;

  // Initialise column alias arrays when field changes
  useEffect(() => {
    if (!kpi1Field) { setKpi1Columns([]); return; }
    setKpi1Columns(
      kpi1Field.sub_fields.map((sf) => ({
        source_key: sf.key,
        alias_key: sf.key,
        alias_name: sf.name || sf.key,
        field_type: sf.field_type || "single_line_text",
      }))
    );
  }, [kpi1Field?.key]);

  useEffect(() => {
    if (!kpi2Field) { setKpi2Columns([]); return; }
    const kpi2Name = kpiList.find((k) => k.id === Number(kpi2Id))?.name || "KPI2";
    setKpi2Columns(
      kpi2Field.sub_fields.map((sf) => ({
        source_key: sf.key,
        alias_key: slugify(`${kpi2Name}_${sf.key}`),
        alias_name: `[${kpi2Name}] ${sf.name || sf.key}`,
        field_type: sf.field_type || "single_line_text",
      }))
    );
  }, [kpi2Field?.key]);

  // Auto-default new KPI name when entering step 3
  useEffect(() => {
    if (step === 3 && kpi1Id && kpi2Id) {
      const n1 = kpiList.find((k) => k.id === Number(kpi1Id))?.name || "KPI1";
      const n2 = kpiList.find((k) => k.id === Number(kpi2Id))?.name || "KPI2";
      if (!newKpiName) setNewKpiName(`${n1} & ${n2} (Joined)`);
      if (!newFieldName) setNewFieldName(`${kpi1Field?.name || "Table"} + ${kpi2Field?.name || "Table"}`);
    }
  }, [step]);

  // ─── Duplicate alias key check ───
  const allAliasKeys = [...kpi1Columns.map((c) => c.alias_key), ...kpi2Columns.map((c) => c.alias_key)];
  const dupKeys = allAliasKeys.filter((k, i) => k && allAliasKeys.indexOf(k) !== i);

  // ─── Step validation ───
  const step1Valid = kpi1Id && kpi1FieldKey && kpi2Id && kpi2FieldKey && kpi1Id !== kpi2Id;
  const step2Valid =
    joinKeyKpi1 &&
    joinKeyKpi2 &&
    kpi1Columns.some((c) => c.alias_key) &&
    kpi2Columns.some((c) => c.alias_key) &&
    dupKeys.length === 0;

  // ─── Submit ───
  const handleSubmit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const targetKpiId =
        mode === "enrich_kpi1" ? Number(kpi1Id)
        : mode === "enrich_kpi2" ? Number(kpi2Id)
        : undefined;

      const payload: Record<string, unknown> = {
        mode: mode === "create_new" ? "create_new" : "enrich_existing",
        kpi1_id: Number(kpi1Id),
        kpi1_field_key: kpi1FieldKey,
        kpi2_id: Number(kpi2Id),
        kpi2_field_key: kpi2FieldKey,
        join_key_kpi1: joinKeyKpi1,
        join_key_kpi2: joinKeyKpi2,
        kpi1_columns: kpi1Columns.filter((c) => c.alias_key),
        kpi2_columns: kpi2Columns.filter((c) => c.alias_key),
      };

      if (mode === "create_new") {
        payload.new_kpi_name = newKpiName;
        payload.new_kpi_field_name = newFieldName;
      } else {
        payload.target_kpi_id = targetKpiId;
      }

      const result = await api<{ success: boolean; kpi_id: number; kpi_name: string; mode: string; message: string }>(
        "/kpis/join-wizard",
        { method: "POST", body: JSON.stringify(payload), token }
      );
      toast.success(result.message || "Join created successfully!");
      onSuccess({ kpi_id: result.kpi_id, kpi_name: result.kpi_name || "", mode: result.mode });
      onClose();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create join");
    } finally {
      setSaving(false);
    }
  };

  // ─── Column alias row editor ───
  const renderColumnList = (
    columns: ColumnAlias[],
    onChange: (cols: ColumnAlias[]) => void,
    label: string,
    isVirtual: boolean
  ) => (
    <div style={{ marginBottom: "1rem" }}>
      <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: "0.4rem" }}>
        {label}
        {isVirtual && (
          <span style={{ marginLeft: "0.4rem", fontSize: "0.75rem", color: "var(--muted)", background: "rgba(0,0,0,0.06)", padding: "0.1rem 0.4rem", borderRadius: "4px" }}>
            Virtual (read-only)
          </span>
        )}
      </label>
      <div style={{ border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
          <thead>
            <tr style={{ background: "var(--bg-soft, rgba(0,0,0,0.04))" }}>
              <th style={{ padding: "0.4rem 0.6rem", textAlign: "left", width: 32 }}>✓</th>
              <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Source Column</th>
              <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Display Name</th>
              <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Key (slug)</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => {
              const isDup = col.alias_key && dupKeys.includes(col.alias_key);
              return (
                <tr key={col.source_key} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "0.35rem 0.6rem" }}>
                    <input
                      type="checkbox"
                      checked={!!col.alias_key}
                      onChange={(e) => {
                        const next = [...columns];
                        next[idx] = { ...col, alias_key: e.target.checked ? slugify(col.alias_name) : "" };
                        onChange(next);
                      }}
                    />
                  </td>
                  <td style={{ padding: "0.35rem 0.6rem", color: "var(--muted)" }}>{col.source_key}</td>
                  <td style={{ padding: "0.35rem 0.3rem" }}>
                    <input
                      type="text"
                      value={col.alias_name}
                      onChange={(e) => {
                        const next = [...columns];
                        const prev = next[idx];
                        const wasAutoSlug = !prev.alias_key || prev.alias_key === slugify(prev.alias_name);
                        next[idx] = {
                          ...prev,
                          alias_name: e.target.value,
                          alias_key: wasAutoSlug ? slugify(e.target.value) : prev.alias_key,
                        };
                        onChange(next);
                      }}
                      style={{ width: "100%", padding: "0.25rem 0.35rem", fontSize: "0.82rem" }}
                    />
                  </td>
                  <td style={{ padding: "0.35rem 0.3rem" }}>
                    <input
                      type="text"
                      value={col.alias_key}
                      onChange={(e) => {
                        const next = [...columns];
                        next[idx] = { ...col, alias_key: slugify(e.target.value) };
                        onChange(next);
                      }}
                      style={{
                        width: "100%",
                        padding: "0.25rem 0.35rem",
                        fontSize: "0.82rem",
                        fontFamily: "monospace",
                        outline: isDup ? "2px solid var(--error, red)" : undefined,
                        background: isDup ? "rgba(255,0,0,0.06)" : undefined,
                      }}
                    />
                    {isDup && <div style={{ color: "var(--error, red)", fontSize: "0.72rem" }}>Duplicate key</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // ─── Render ───
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--card-bg, #fff)",
          color: "var(--text)",
          borderRadius: "12px",
          width: "100%",
          maxWidth: 760,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700 }}>Join MLI Wizard</h2>
            <p style={{ margin: "0.2rem 0 0", fontSize: "0.82rem", color: "var(--muted)" }}>
              Combine Multi-Line Item columns from two KPIs
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.3rem", color: "var(--muted)", lineHeight: 1 }}
            aria-label="Close wizard"
          >✕</button>
        </div>

        {/* Step indicator */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border)", padding: "0 1.5rem" }}>
          {(["1. Select Sources", "2. Configure Join", "3. Destination"] as const).map((label, i) => {
            const s = (i + 1) as WizardStep;
            return (
              <div
                key={s}
                style={{
                  padding: "0.6rem 1rem",
                  fontSize: "0.82rem",
                  fontWeight: step === s ? 700 : 400,
                  color: step === s ? "var(--primary)" : "var(--muted)",
                  borderBottom: step === s ? "2px solid var(--primary)" : "2px solid transparent",
                  cursor: s < step ? "pointer" : "default",
                  marginBottom: -1,
                }}
                onClick={() => { if (s < step) setStep(s); }}
              >
                {label}
              </div>
            );
          })}
        </div>

        {/* Body */}
        <div style={{ padding: "1.5rem", flex: 1 }}>
          {loadingKpis ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>Loading KPIs…</div>
          ) : (
            <>
              {/* ── STEP 1 ── */}
              {step === 1 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* KPI 1 */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem" }}>
                    <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 700 }}>KPI 1 (Primary / Left Table)</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>KPI</label>
                        <select
                          value={kpi1Id}
                          onChange={(e) => { setKpi1Id(Number(e.target.value) || ""); setKpi1FieldKey(""); }}
                          style={{ width: "100%", padding: "0.35rem" }}
                        >
                          <option value="">-- Select KPI --</option>
                          {kpiList.map((k) => (
                            <option key={k.id} value={k.id}>{k.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>MLI Field</label>
                        <select
                          value={kpi1FieldKey}
                          onChange={(e) => setKpi1FieldKey(e.target.value)}
                          disabled={!kpi1Id}
                          style={{ width: "100%", padding: "0.35rem" }}
                        >
                          <option value="">-- Select Field --</option>
                          {(fieldsMap[Number(kpi1Id)] || []).map((f) => (
                            <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* KPI 2 */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem" }}>
                    <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 700 }}>KPI 2 (Right / Lookup Table)</h4>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>KPI</label>
                        <select
                          value={kpi2Id}
                          onChange={(e) => { setKpi2Id(Number(e.target.value) || ""); setKpi2FieldKey(""); }}
                          style={{ width: "100%", padding: "0.35rem" }}
                        >
                          <option value="">-- Select KPI --</option>
                          {kpiList.filter((k) => k.id !== Number(kpi1Id)).map((k) => (
                            <option key={k.id} value={k.id}>{k.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>MLI Field</label>
                        <select
                          value={kpi2FieldKey}
                          onChange={(e) => setKpi2FieldKey(e.target.value)}
                          disabled={!kpi2Id}
                          style={{ width: "100%", padding: "0.35rem" }}
                        >
                          <option value="">-- Select Field --</option>
                          {(fieldsMap[Number(kpi2Id)] || []).map((f) => (
                            <option key={f.key} value={f.key}>{f.name} ({f.key})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {!step1Valid && (
                    <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: 0 }}>
                      Select two different KPIs and an MLI field for each to continue.
                    </p>
                  )}
                </div>
              )}

              {/* ── STEP 2 ── */}
              {step === 2 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* Join keys */}
                  <div style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "1rem" }}>
                    <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9rem", fontWeight: 700 }}>Join Condition</h4>
                    <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--muted)" }}>
                      Rows are matched where the value in <strong>KPI 1&apos;s key column</strong> equals the value in <strong>KPI 2&apos;s key column</strong>.
                    </p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: "0.75rem", alignItems: "end" }}>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>KPI 1 Join Key</label>
                        <select
                          value={joinKeyKpi1}
                          onChange={(e) => setJoinKeyKpi1(e.target.value)}
                          style={{ width: "100%", padding: "0.35rem" }}
                        >
                          <option value="">-- Select column --</option>
                          {(kpi1Field?.sub_fields || []).map((sf) => (
                            <option key={sf.key} value={sf.key}>{sf.name || sf.key} ({sf.key})</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ textAlign: "center", paddingBottom: "0.4rem", fontSize: "1.2rem", color: "var(--muted)" }}>=</div>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>KPI 2 Join Key</label>
                        <select
                          value={joinKeyKpi2}
                          onChange={(e) => setJoinKeyKpi2(e.target.value)}
                          style={{ width: "100%", padding: "0.35rem" }}
                        >
                          <option value="">-- Select column --</option>
                          {(kpi2Field?.sub_fields || []).map((sf) => (
                            <option key={sf.key} value={sf.key}>{sf.name || sf.key} ({sf.key})</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Columns from KPI 1 */}
                  {kpi1Columns.length > 0 && renderColumnList(kpi1Columns, setKpi1Columns, `Columns from KPI 1 — ${kpi1Field?.name || ""}`, false)}

                  {/* Columns from KPI 2 */}
                  {kpi2Columns.length > 0 && renderColumnList(kpi2Columns, setKpi2Columns, `Columns from KPI 2 — ${kpi2Field?.name || ""}`, true)}

                  {dupKeys.length > 0 && (
                    <p style={{ color: "var(--error, red)", fontSize: "0.82rem", margin: 0 }}>
                      Duplicate column keys detected: {dupKeys.join(", ")}. Please fix before continuing.
                    </p>
                  )}
                </div>
              )}

              {/* ── STEP 3 ── */}
              {step === 3 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  <div>
                    <h4 style={{ margin: "0 0 0.5rem", fontSize: "0.9rem", fontWeight: 700 }}>Choose Destination</h4>
                    <p style={{ fontSize: "0.82rem", color: "var(--muted)", margin: "0 0 0.75rem" }}>
                      How should the joined columns be applied?
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                      {([
                        {
                          value: "create_new" as const,
                          label: "Create a new 3rd Joined KPI",
                          desc: "A new Virtual KPI containing both table's columns will be created. Original KPIs stay unchanged.",
                        },
                        {
                          value: "enrich_kpi1" as const,
                          label: `Enrich KPI 1: "${kpiList.find((k) => k.id === Number(kpi1Id))?.name || ""}"`,
                          desc: `Columns from KPI 2 appear as read-only virtual columns in KPI 1's ${kpi1Field?.name || "field"} table. No data is copied.`,
                        },
                        {
                          value: "enrich_kpi2" as const,
                          label: `Enrich KPI 2: "${kpiList.find((k) => k.id === Number(kpi2Id))?.name || ""}"`,
                          desc: `Columns from KPI 1 appear as read-only virtual columns in KPI 2's ${kpi2Field?.name || "field"} table. No data is copied.`,
                        },
                      ] as const).map((opt) => (
                        <label
                          key={opt.value}
                          style={{
                            display: "flex",
                            gap: "0.75rem",
                            padding: "0.85rem 1rem",
                            border: `1.5px solid ${mode === opt.value ? "var(--primary)" : "var(--border)"}`,
                            borderRadius: "8px",
                            cursor: "pointer",
                            background: mode === opt.value ? "rgba(var(--primary-rgb, 59,130,246), 0.06)" : "var(--card-bg, #fff)",
                          }}
                        >
                          <input
                            type="radio"
                            name="mode"
                            value={opt.value}
                            checked={mode === opt.value}
                            onChange={() => setMode(opt.value)}
                            style={{ marginTop: "0.15rem" }}
                          />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{opt.label}</div>
                            <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginTop: "0.2rem" }}>{opt.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {mode === "create_new" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>New KPI Name *</label>
                        <input
                          type="text"
                          value={newKpiName}
                          onChange={(e) => setNewKpiName(e.target.value)}
                          placeholder="e.g. Sales with Customer Info"
                          style={{ width: "100%", padding: "0.4rem" }}
                        />
                      </div>
                      <div className="form-group">
                        <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>MLI Field Name *</label>
                        <input
                          type="text"
                          value={newFieldName}
                          onChange={(e) => setNewFieldName(e.target.value)}
                          placeholder="e.g. Enriched Sales"
                          style={{ width: "100%", padding: "0.4rem" }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Schema preview */}
                  <div>
                    <h5 style={{ fontSize: "0.85rem", fontWeight: 600, margin: "0 0 0.4rem" }}>Result Column Schema Preview</h5>
                    <div style={{ border: "1px solid var(--border)", borderRadius: "6px", overflow: "hidden" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                        <thead>
                          <tr style={{ background: "var(--bg-soft, rgba(0,0,0,0.04))" }}>
                            <th style={{ padding: "0.35rem 0.6rem", textAlign: "left" }}>Column Name</th>
                            <th style={{ padding: "0.35rem 0.6rem", textAlign: "left" }}>Key</th>
                            <th style={{ padding: "0.35rem 0.6rem", textAlign: "left" }}>Source</th>
                          </tr>
                        </thead>
                        <tbody>
                          {kpi1Columns.filter((c) => mode !== "enrich_kpi2" && c.alias_key).map((c) => (
                            <tr key={c.source_key} style={{ borderTop: "1px solid var(--border)" }}>
                              <td style={{ padding: "0.3rem 0.6rem" }}>{c.alias_name}</td>
                              <td style={{ padding: "0.3rem 0.6rem", fontFamily: "monospace", fontSize: "0.78rem" }}>{c.alias_key}</td>
                              <td style={{ padding: "0.3rem 0.6rem", color: "var(--muted)" }}>KPI 1</td>
                            </tr>
                          ))}
                          {kpi2Columns.filter((c) => mode !== "enrich_kpi1" || true).filter((c) => c.alias_key).map((c) => (
                            <tr key={c.source_key} style={{ borderTop: "1px solid var(--border)", background: "rgba(59,130,246,0.04)" }}>
                              <td style={{ padding: "0.3rem 0.6rem" }}>{c.alias_name}</td>
                              <td style={{ padding: "0.3rem 0.6rem", fontFamily: "monospace", fontSize: "0.78rem" }}>{c.alias_key}</td>
                              <td style={{ padding: "0.3rem 0.6rem", color: "var(--muted)" }}>KPI 2 (virtual)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "1rem 1.5rem", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button
            type="button"
            className="btn"
            onClick={() => step > 1 ? setStep((s) => (s - 1) as WizardStep) : onClose()}
          >
            {step > 1 ? "← Back" : "Cancel"}
          </button>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {step < 3 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={step === 1 ? !step1Valid : !step2Valid}
                onClick={() => setStep((s) => (s + 1) as WizardStep)}
              >
                Next →
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || (mode === "create_new" && !newKpiName)}
                onClick={handleSubmit}
              >
                {saving ? "Applying…" : "Apply Join"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
