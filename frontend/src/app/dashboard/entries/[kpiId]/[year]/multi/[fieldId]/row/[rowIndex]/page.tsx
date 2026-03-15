"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
import { toast } from "react-toastify";

type SubField = {
  key: string;
  name: string;
  field_type?: string | null;
  is_required?: boolean;
  can_view?: boolean;
  can_edit?: boolean;
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

  // Load reference allowed values for reference sub-fields (same logic as inline editor)
  useEffect(() => {
    if (!token || effectiveOrgId == null || !field || !field.sub_fields?.length) return;
    const keys: { k: string; sid: number; skey: string; subKey?: string }[] = [];
    field.sub_fields.forEach((s) => {
      if (
        s.field_type === "reference" &&
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
        await api<MultiItemsRow>(
          `/entries/multi-items/rows/${rowIndex}?${new URLSearchParams({
            entry_id: String(entryId),
            field_id: String(fieldId),
            organization_id: String(effectiveOrgId ?? ""),
          }).toString()}`,
          {
            method: "PUT",
            body: JSON.stringify(editData),
            token,
          }
        );
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
    <div style={{ padding: "0.75rem 1rem 1rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
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
                  } else {
                    display = val != null && String(val).trim() !== "" ? String(val) : "—";
                  }
                  return (
                    <div key={key} style={{ minWidth: 0 }}>
                      <div style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--muted)" }}>
                        {sf.name}
                      </div>
                      <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--text)" }}>
                        {display}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
              {subFields.map((sf) => {
                const key = sf.key;
                const val = editData[key];
                const canEdit = sf.can_edit !== false;
                const displayVal =
                  sf.field_type === "boolean"
                    ? Boolean(val) ? "Yes" : "No"
                    : sf.field_type === "date"
                      ? (typeof val === "string" && val ? val : "—")
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
                    <div
                      key={key}
                      className="form-group"
                      style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(val)}
                        onChange={(e) => handleChangeCell(key, e.target.checked)}
                      />
                      <label>{sf.name}</label>
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
                if (sf.field_type === "attachment") {
                  const urlVal = typeof val === "string" ? val : val != null ? String(val) : "";
                  const href = urlVal && (
                    urlVal.startsWith("http") ? urlVal
                    : urlVal.startsWith("/") ? urlVal
                    : getApiUrl(urlVal)
                  );
                  return (
                    <div key={key} className="form-group">
                      <label>
                        {sf.name}
                        {sf.is_required ? " *" : ""}
                      </label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                        <label
                          className="btn"
                          style={{ padding: "0.35rem 0.65rem", fontSize: "0.9rem", whiteSpace: "nowrap" }}
                        >
                          Upload file
                          <input
                            type="file"
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (!file) return;
                              if (!token) {
                                toast.error("Session expired. Please log in again.");
                                router.push("/login");
                                return;
                              }
                              if (!entryId) {
                                toast.error("Entry is still loading. Please wait a moment and try again.");
                                return;
                              }
                              try {
                                const form = new FormData();
                                form.append("files", file);
                                form.append("entry_id", String(entryId));
                                form.append("year", String(year));
                                const url = getApiUrl(`/kpis/${kpiId}/files`);
                                const res = await fetch(url, {
                                  method: "POST",
                                  headers: { Authorization: `Bearer ${token}` },
                                  body: form,
                                });
                                if (!res.ok) {
                                  toast.error("File upload failed");
                                  return;
                                }
                                const uploaded = (await res.json()) as Array<{ download_url?: string }>;
                                const latest = uploaded[0];
                                if (!latest || !latest.download_url) {
                                  toast.error("File upload failed");
                                  return;
                                }
                                handleChangeCell(key, latest.download_url);
                                toast.success("File uploaded. Click Save to store the file link in this row.");
                              } catch {
                                toast.error("File upload failed");
                              }
                            }}
                          />
                        </label>
                        {href ? (
                          <a
                            href={href.startsWith("http") ? href : (typeof window !== "undefined" ? window.location.origin : "") + href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn"
                            style={{
                              fontSize: "0.9rem",
                              padding: "0.35rem 0.65rem",
                              color: "var(--accent)",
                              textDecoration: "none",
                              border: "1px solid var(--accent)",
                              borderRadius: 6,
                            }}
                            onClick={token ? async (e) => {
                              if (!href.startsWith("http") && (href.startsWith("/api") || href.startsWith("/api/"))) {
                                e.preventDefault();
                                try {
                                  const fullUrl = href.startsWith("http") ? href : (typeof window !== "undefined" ? window.location.origin : "") + href;
                                  const res = await fetch(fullUrl, { headers: { Authorization: `Bearer ${token}` } });
                                  if (!res.ok) throw new Error("Download failed");
                                  const blob = await res.blob();
                                  const blobUrl = URL.createObjectURL(blob);
                                  window.open(blobUrl, "_blank", "noopener,noreferrer");
                                  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
                                } catch {
                                  window.open(href.startsWith("http") ? href : (typeof window !== "undefined" ? window.location.origin : "") + href, "_blank", "noopener,noreferrer");
                                }
                              }
                            } : undefined}
                          >
                            Open current file
                          </a>
                        ) : null}
                      </div>
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

