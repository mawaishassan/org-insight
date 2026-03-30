"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { makeAttachmentCellValue } from "@/lib/attachmentCellValue";
import { AttachmentFieldControl } from "@/components/AttachmentFieldControl";
import { toast } from "react-toastify";
import MultiReferenceInput from "@/components/MultiReferenceInput";

type SubField = {
  key: string;
  name: string;
  field_type?: string | null;
  is_required?: boolean;
  can_view?: boolean;
  can_edit?: boolean;
  sort_order?: number;
  config?: { ui_section?: string; [key: string]: unknown } | null;
};

interface FieldSummary {
  id: number;
  key: string;
  name: string;
  field_type: string;
  full_page_multi_items?: boolean;
  sub_fields?: SubField[];
}

interface KpiInfo {
  name: string;
}

interface MultiItemsRow {
  index: number;
  data: Record<string, unknown>;
}

export default function MultiItemRowDetail() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const kpiId = Number(params.kpiId);
  const year = Number(params.year);
  const fieldId = Number(params.fieldId);
  const rowIndexParam = params.rowIndex as string;
  const isNew = rowIndexParam === "new";
  const rowIndex = isNew ? null : Number(rowIndexParam);
  const organizationIdFromUrl = searchParams.get("organization_id");
  const periodKey = searchParams.get("period_key") || "";

  const token = getAccessToken();

  const [meOrgId, setMeOrgId] = useState<number | null>(null);
  const [kpiName, setKpiName] = useState<string>("");
  const [field, setField] = useState<FieldSummary | null>(null);
  const [entryId, setEntryId] = useState<number | null>(null);
  const [editData, setEditData] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refAllowedValues, setRefAllowedValues] = useState<Record<string, string[]>>({});
  const [activeSectionTab, setActiveSectionTab] = useState<string>("");

  const effectiveOrgId = useMemo(
    () => (organizationIdFromUrl ? Number(organizationIdFromUrl) : meOrgId ?? undefined),
    [organizationIdFromUrl, meOrgId]
  );

  useEffect(() => {
    if (!token) {
      router.push("/login");
      return;
    }
    api<{ organization_id: number | null }>("/auth/me", { token })
      .then((me) => setMeOrgId(me.organization_id ?? null))
      .catch(() => setMeOrgId(null));
  }, [token, router]);

  const loadContext = async () => {
    if (!token || !kpiId || effectiveOrgId == null || !fieldId) return;
    setError(null);
    try {
      const kpi = await api<KpiInfo>(
        `/kpis/${kpiId}?${new URLSearchParams({ organization_id: String(effectiveOrgId) }).toString()}`,
        { token }
      ).catch(() => null);
      if (kpi?.name) setKpiName(kpi.name);

      const fields = await api<FieldSummary[]>(
        `/entries/fields?${new URLSearchParams({
          kpi_id: String(kpiId),
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      ).catch(() => []);
      const f = fields.find((x) => x.id === fieldId && x.field_type === "multi_line_items") || null;
      setField(f);

      const forPeriod = await api<{ id: number }>(
        `/entries/for-period?${new URLSearchParams({
          kpi_id: String(kpiId),
          year: String(year),
          period_key: periodKey || "",
          organization_id: String(effectiveOrgId),
        }).toString()}`,
        { token }
      );
      setEntryId(forPeriod.id);

      if (!isNew && rowIndex != null) {
        // Fetch the specific row's page with a server-allowed page_size (<= 200)
        const pageSizeForFetch = 200;
        const pageForFetch = Math.floor(rowIndex / pageSizeForFetch) + 1;
        const params = new URLSearchParams({
          entry_id: String(forPeriod.id),
          field_id: String(fieldId),
          organization_id: String(effectiveOrgId),
          page: String(pageForFetch),
          page_size: String(pageSizeForFetch),
        });
        const res = await api<{
          rows: MultiItemsRow[];
        }>(`/entries/multi-items/rows?${params.toString()}`, { token });
        const found = res.rows.find((r) => r.index === rowIndex);
        if (found) {
          setEditData(found.data || {});
        } else {
          setError("Row not found");
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load row");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!token || effectiveOrgId == null) return;
    loadContext().catch(() => undefined);
  }, [token, effectiveOrgId, kpiId, year, fieldId, rowIndex, isNew, periodKey]);

  const subFields = field?.sub_fields ?? [];

  const sectionGroups = useMemo(() => {
    const hasAnyExplicit = subFields.some((sf) => {
      const section = (sf as any)?.config?.ui_section;
      return typeof section === "string" && section.trim().length > 0;
    });

    const groupMap = new Map<
      string,
      { label: string; fields: SubField[]; order: number; isOther: boolean }
    >();

    subFields.forEach((sf, idx) => {
      const rawSection = (sf as any)?.config?.ui_section;
      const section = typeof rawSection === "string" ? rawSection.trim() : "";
      const label = section.length > 0 ? section : hasAnyExplicit ? "Other" : "";
      const isOther = label === "Other" || label === "";
      const sortOrder = typeof (sf as any)?.sort_order === "number" ? (sf as any).sort_order : idx;

      const existing = groupMap.get(label);
      if (!existing) {
        groupMap.set(label, { label, fields: [sf], order: sortOrder, isOther });
      } else {
        existing.fields.push(sf);
        existing.order = Math.min(existing.order, sortOrder);
      }
    });

    const groups = Array.from(groupMap.values()).sort((a, b) => a.order - b.order);
    if (!hasAnyExplicit) {
      return [{ label: "", fields: subFields, showHeading: false }] as const;
    }

    return groups
      .filter((g) => g.fields.length > 0)
      .map((g) => ({
        label: g.isOther ? "Other" : g.label,
        fields: g.fields,
        showHeading: !g.isOther,
      }));
  }, [subFields]);

  const hasSectionTabs = sectionGroups.length > 1 || (sectionGroups.length === 1 && sectionGroups[0].label !== "");

  useEffect(() => {
    if (!hasSectionTabs) {
      setActiveSectionTab("");
      return;
    }
    const labels = sectionGroups.map((g) => g.label);
    // Keep current selection if still exists; otherwise default to first tab.
    setActiveSectionTab((prev) => (prev && labels.includes(prev) ? prev : labels[0] || ""));
  }, [hasSectionTabs, sectionGroups]);

  // Load reference allowed values for reference / multi_reference sub-fields (same logic as inline editor)
  useEffect(() => {
    if (!token || effectiveOrgId == null || !field || !field.sub_fields?.length) return;
    const keys: { k: string; sid: number; skey: string; subKey?: string }[] = [];
    field.sub_fields.forEach((s) => {
      if (
        (s.field_type === "reference" || s.field_type === "multi_reference") &&
        (s as any).config?.reference_source_kpi_id &&
        (s as any).config?.reference_source_field_key
      ) {
        const cfg = (s as any).config as {
          reference_source_kpi_id: number;
          reference_source_field_key: string;
          reference_source_sub_field_key?: string;
        };
        keys.push({
          k: `${cfg.reference_source_kpi_id}-${cfg.reference_source_field_key}${
            cfg.reference_source_sub_field_key ? `-${cfg.reference_source_sub_field_key}` : ""
          }`,
          sid: cfg.reference_source_kpi_id,
          skey: cfg.reference_source_field_key,
          subKey: cfg.reference_source_sub_field_key,
        });
      }
    });
    const uniq = Array.from(new Map(keys.map((x) => [x.k, x])).values());
    uniq.forEach(({ k, sid, skey, subKey }) => {
      const params = new URLSearchParams({
        source_kpi_id: String(sid),
        source_field_key: skey,
        organization_id: String(effectiveOrgId),
      });
      if (subKey) params.set("source_sub_field_key", subKey);
      api<{ values: string[] }>(`/fields/reference-allowed-values?${params.toString()}`, { token })
        .then((r) => setRefAllowedValues((prev) => ({ ...prev, [k]: r.values })))
        .catch(() => setRefAllowedValues((prev) => ({ ...prev, [k]: [] })));
    });
  }, [token, effectiveOrgId, field]);

  const handleChangeCell = (key: string, value: unknown) => {
    setEditData((prev) => ({ ...prev, [key]: value }));
  };

  const Toggle = ({
    checked,
    onChange,
    disabled,
    label,
  }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
    label?: string;
  }) => (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.6rem",
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
      }}
    >
      <span
        style={{
          position: "relative",
          width: 44,
          height: 24,
          borderRadius: 999,
          background: checked ? "var(--accent)" : "var(--border)",
          display: "inline-flex",
          alignItems: "center",
          padding: 2,
          opacity: disabled ? 0.6 : 1,
          transition: "background 140ms ease, opacity 140ms ease",
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "var(--surface)",
            transform: checked ? "translateX(20px)" : "translateX(0)",
            transition: "transform 140ms ease",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        style={{ display: "none" }}
        aria-label={label || "Toggle"}
      />
      {label ? <span style={{ fontSize: "0.9rem", color: "var(--text)" }}>{label}</span> : null}
    </label>
  );

  /** Persist row data for an existing row (no navigation). Used after attachment upload. */
  const persistExistingRow = async (data: Record<string, unknown>) => {
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    if (!entryId || !fieldId) {
      toast.error("Entry is still loading. Please wait and try again.");
      return;
    }
    if (isNew) return;
    await api<MultiItemsRow>(
      `/entries/multi-items/rows/${rowIndex}?${new URLSearchParams({
        entry_id: String(entryId),
        field_id: String(fieldId),
        organization_id: String(effectiveOrgId ?? ""),
      }).toString()}`,
      {
        method: "PUT",
        body: JSON.stringify(data),
        token,
      }
    );
  };

  /** Create the row on the server (same as Save on a new row), then go to the row URL so further edits use PUT. */
  const persistNewRow = async (data: Record<string, unknown>) => {
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    if (!entryId || !fieldId || !isNew) return;
    const created = await api<MultiItemsRow>(
      `/entries/multi-items/rows?${new URLSearchParams({
        entry_id: String(entryId),
        field_id: String(fieldId),
        organization_id: String(effectiveOrgId ?? ""),
      }).toString()}`,
      {
        method: "POST",
        body: JSON.stringify(data),
        token,
      }
    );
    toast.success("File attached and saved.");
    const backParams = new URLSearchParams({
      organization_id: String(effectiveOrgId ?? ""),
      ...(periodKey ? { period_key: periodKey } : {}),
    });
    router.replace(
      `/dashboard/entries/${kpiId}/${year}/multi/${fieldId}/row/${created.index}?${backParams.toString()}`
    );
  };

  const handleSave = async () => {
    if (!token) {
      toast.error("Session expired. Please log in again.");
      router.push("/login");
      return;
    }
    if (!entryId || !fieldId) {
      toast.error("Entry is still loading. Please wait and try again.");
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        await api<MultiItemsRow>(
          `/entries/multi-items/rows?${new URLSearchParams({
            entry_id: String(entryId),
            field_id: String(fieldId),
            organization_id: String(effectiveOrgId ?? ""),
          }).toString()}`,
          {
            method: "POST",
            body: JSON.stringify(editData),
            token,
          }
        );
        toast.success("Row added successfully");
      } else {
        await persistExistingRow(editData);
        toast.success("Row updated successfully");
      }
      const backParams = new URLSearchParams({
        organization_id: String(effectiveOrgId ?? ""),
        ...(periodKey ? { period_key: periodKey } : {}),
      });
      backParams.set(isNew ? "row_added" : "row_updated", "1");
      router.push(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}?${backParams.toString()}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
      return;
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    const backParams = new URLSearchParams({
      organization_id: String(effectiveOrgId ?? ""),
      ...(periodKey ? { period_key: periodKey } : {}),
    });
    router.push(`/dashboard/entries/${kpiId}/${year}/multi/${fieldId}?${backParams.toString()}`);
  };

  if (!token) {
    return null;
  }

  return (
    <div style={{ padding: "1rem 1.25rem 1.25rem", display: "flex", flexDirection: "column", gap: "1rem", maxWidth: 1120, margin: "0 auto" }}>
      {error && (
        <div className="card" style={{ padding: "0.75rem", color: "var(--error)" }}>
          {error}
        </div>
      )}

      <div className="card" style={{ padding: "1rem" }}>
        {loading ? (
          <p style={{ color: "var(--muted)" }}>Loading…</p>
        ) : (
          <>
            {/* Summary strip with a few key attributes */}
            {subFields.length > 0 && (
              <div
                style={{
                  marginBottom: "0.75rem",
                  padding: "0.5rem 0.75rem",
                  borderRadius: 6,
                  background: "var(--bg-subtle, #f9fafb)",
                  border: "1px solid var(--border)",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: "0.5rem 1rem",
                }}
              >
                {subFields.slice(0, 4).map((sf) => {
                  const key = sf.key;
                  const val = editData[key];
                  let display: string;
                  if (sf.field_type === "boolean") {
                    display = Boolean(val) ? "Yes" : "No";
                  } else if (sf.field_type === "date") {
                    display = typeof val === "string" && val ? val : "—";
                  } else if (sf.field_type === "number") {
                    display =
                      typeof val === "number"
                        ? String(val)
                        : val != null
                        ? String(val)
                        : "—";
                  } else if (sf.field_type === "multi_reference") {
                    const arr = Array.isArray(val) ? (val as unknown[]).filter((x) => x != null && String(x).trim() !== "") : [];
                    display = arr.length > 0 ? arr.map((x) => String(x)).join("; ") : "—";
                  } else {
                    display = val != null && String(val).trim() !== "" ? String(val) : "—";
                  }
                  return (
                    <div key={key} style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "0.75rem",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={sf.name}
                      >
                        {sf.name}
                      </div>
                      <div
                        style={{
                          fontSize: "0.9rem",
                          fontWeight: 500,
                          color: "var(--text)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={display}
                      >
                        {display}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {hasSectionTabs && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  marginBottom: "0.9rem",
                  paddingBottom: "0.75rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {sectionGroups.map((g) => {
                  const active = activeSectionTab === g.label;
                  return (
                    <button
                      key={g.label}
                      type="button"
                      className={active ? "btn btn-primary" : "btn"}
                      onClick={() => setActiveSectionTab(g.label)}
                      style={{
                        padding: "0.4rem 0.7rem",
                        fontSize: "0.9rem",
                        borderRadius: 999,
                      }}
                    >
                      {g.label || "Fields"}
                    </button>
                  );
                })}
              </div>
            )}

            {sectionGroups
              .filter((g) => !hasSectionTabs || activeSectionTab === g.label)
              .map((group, groupIdx) => (
              <div
                key={`${group.label || "default"}:${groupIdx}`}
                style={{
                  marginTop: groupIdx === 0 ? 0 : "1rem",
                  padding: "0.9rem",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  background: "var(--surface)",
                }}
              >
                {(() => {
                  const compactFields = group.fields.filter((sf) => sf.field_type !== "multi_line_text");
                  const multiLineFields = group.fields.filter((sf) => sf.field_type === "multi_line_text");

                  // Place multi-line textareas into two columns, 1 textarea per column cell (balanced).
                  const mlLeft: SubField[] = [];
                  const mlRight: SubField[] = [];
                  multiLineFields.forEach((sf, idx) => (idx % 2 === 0 ? mlLeft : mlRight).push(sf));

                  return (
                    <div style={{ display: "grid", gap: "1rem" }}>
                      {compactFields.length > 0 && (
                        <div
                          style={{
                            padding: "0.85rem",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            background: "var(--bg-subtle, #f9fafb)",
                          }}
                        >
                          <div style={{ display: "grid", gap: "0.9rem", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
                            {compactFields.map((sf) => {
                const key = sf.key;
                const val = editData[key];
                const canEdit = sf.can_edit !== false;
                const displayVal =
                  sf.field_type === "boolean"
                    ? Boolean(val) ? "Yes" : "No"
                    : sf.field_type === "date"
                      ? (typeof val === "string" && val ? val : "—")
                      : sf.field_type === "multi_reference"
                        ? (() => {
                            const arr = Array.isArray(val) ? (val as unknown[]).filter((x) => x != null && String(x).trim() !== "") : [];
                            return arr.length > 0 ? arr.map((x) => String(x)).join("; ") : "—";
                          })()
                      : val != null && String(val).trim() !== "" ? String(val) : "—";
                if (!canEdit) {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <div style={{ padding: "0.35rem 0", color: "var(--muted)" }}>{displayVal}</div>
                    </div>
                  );
                }
                if (sf.field_type === "number") {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <input
                        type="number"
                        value={typeof val === "number" ? val : val != null ? String(val) : ""}
                        onChange={(e) =>
                          handleChangeCell(key, e.target.value === "" ? undefined : Number(e.target.value))
                        }
                      />
                    </div>
                  );
                }
                if (sf.field_type === "date") {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <input
                        type="date"
                        value={typeof val === "string" ? val : ""}
                        onChange={(e) => handleChangeCell(key, e.target.value || undefined)}
                      />
                    </div>
                  );
                }
                if (sf.field_type === "boolean") {
                  return (
                    <div key={key} className="form-group">
                      <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.35rem" }}>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </div>
                      <Toggle
                        checked={Boolean(val)}
                        onChange={(next) => handleChangeCell(key, next)}
                        label={Boolean(val) ? "Yes" : "No"}
                      />
                    </div>
                  );
                }
                if (sf.field_type === "reference") {
                  const cfg = (sf as any).config as
                    | {
                        reference_source_kpi_id?: number;
                        reference_source_field_key?: string;
                        reference_source_sub_field_key?: string;
                      }
                    | undefined;
                  const refKey =
                    cfg?.reference_source_kpi_id && cfg?.reference_source_field_key
                      ? `${cfg.reference_source_kpi_id}-${cfg.reference_source_field_key}${
                          cfg.reference_source_sub_field_key ? `-${cfg.reference_source_sub_field_key}` : ""
                        }`
                      : "";
                  const options = refAllowedValues[refKey] ?? [];
                  const strVal = typeof val === "string" ? val : val != null ? String(val) : "";
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <select
                        value={strVal}
                        onChange={(e) => handleChangeCell(key, e.target.value || undefined)}
                        style={{ padding: "0.35rem 0.5rem", borderRadius: 6, border: "1px solid var(--border)" }}
                      >
                        <option value="">—</option>
                        {options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }
                if (sf.field_type === "multi_reference") {
                  const cfg = (sf as any).config as
                    | {
                        reference_source_kpi_id?: number;
                        reference_source_field_key?: string;
                        reference_source_sub_field_key?: string;
                      }
                    | undefined;
                  const refKey =
                    cfg?.reference_source_kpi_id && cfg?.reference_source_field_key
                      ? `${cfg.reference_source_kpi_id}-${cfg.reference_source_field_key}${
                          cfg.reference_source_sub_field_key ? `-${cfg.reference_source_sub_field_key}` : ""
                        }`
                      : "";
                  const options = refAllowedValues[refKey] ?? [];
                  const arr = Array.isArray(val) ? (val as string[]) : [];
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <MultiReferenceInput
                        options={options}
                        value={arr}
                        onChange={(next) => handleChangeCell(key, next)}
                      />
                    </div>
                  );
                }
                if (sf.field_type === "attachment") {
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <AttachmentFieldControl
                        value={val}
                        uploadSuccessAlert={false}
                        onUploaded={(downloadUrl, filename) => {
                          const cell = makeAttachmentCellValue(downloadUrl, filename);
                          setEditData((prev) => {
                            const merged = { ...prev, [key]: cell };
                            if (entryId && fieldId) {
                              if (isNew) {
                                void persistNewRow(merged).catch((e) =>
                                  toast.error(e instanceof Error ? e.message : "Could not save row"),
                                );
                              } else {
                                void persistExistingRow(merged)
                                  .then(() => toast.success("File attached and saved."))
                                  .catch((e) => toast.error(e instanceof Error ? e.message : "Could not save"));
                              }
                            }
                            return merged;
                          });
                        }}
                        onClear={() => handleChangeCell(key, "")}
                        token={token}
                        kpiId={kpiId}
                        entryId={entryId}
                        year={year}
                        onNotAuthenticated={() => {
                          toast.error("Session expired. Please log in again.");
                          router.push("/login");
                        }}
                        onError={(m) => toast.error(m)}
                      />
                    </div>
                  );
                }
                return (
                  <div key={key} className="form-group">
                    <label>
                      {sf.name}
                      {sf.is_required ? " *" : ""}
                    </label>
                    <input
                      type="text"
                      value={typeof val === "string" ? val : val != null ? String(val) : ""}
                      onChange={(e) => handleChangeCell(key, e.target.value)}
                    />
                  </div>
                );
              })}
                          </div>
                        </div>
                      )}

                      {multiLineFields.length > 0 && (
                        <div
                          style={{
                            padding: "0.85rem",
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            background: "var(--surface)",
                          }}
                        >
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "1rem" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                              {mlLeft.map((sf) => {
                                const key = sf.key;
                                const val = editData[key];
                                const canEdit = sf.can_edit !== false;
                                const displayVal = val != null && String(val).trim() !== "" ? String(val) : "—";
                                if (!canEdit) {
                                  return (
                                    <div key={key} className="form-group">
                                      <label>
                                        {sf.name}
                                        {sf.is_required ? " *" : ""}
                                      </label>
                                      <div style={{ padding: "0.35rem 0", color: "var(--muted)" }}>{displayVal}</div>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={key} className="form-group">
                                    <label>
                                      {sf.name}
                                      {sf.is_required ? " *" : ""}
                                    </label>
                                    <textarea
                                      rows={6}
                                      value={typeof val === "string" ? val : val != null ? String(val) : ""}
                                      onChange={(e) => handleChangeCell(key, e.target.value)}
                                      style={{ width: "100%", resize: "vertical", minHeight: 160 }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                              {mlRight.map((sf) => {
                                const key = sf.key;
                                const val = editData[key];
                                const canEdit = sf.can_edit !== false;
                                const displayVal = val != null && String(val).trim() !== "" ? String(val) : "—";
                                if (!canEdit) {
                                  return (
                                    <div key={key} className="form-group">
                                      <label>
                                        {sf.name}
                                        {sf.is_required ? " *" : ""}
                                      </label>
                                      <div style={{ padding: "0.35rem 0", color: "var(--muted)" }}>{displayVal}</div>
                                    </div>
                                  );
                                }
                                return (
                                  <div key={key} className="form-group">
                                    <label>
                                      {sf.name}
                                      {sf.is_required ? " *" : ""}
                                    </label>
                                    <textarea
                                      rows={6}
                                      value={typeof val === "string" ? val : val != null ? String(val) : ""}
                                      onChange={(e) => handleChangeCell(key, e.target.value)}
                                      style={{ width: "100%", resize: "vertical", minHeight: 160 }}
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem", justifyContent: "flex-end", alignItems: "center" }}>
              {!entryId && (
                <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Loading entry…</span>
              )}
              <button type="button" className="btn" onClick={handleCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || !entryId}
                onClick={handleSave}
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

