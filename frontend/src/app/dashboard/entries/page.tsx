"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

interface OverviewItem {
  kpi_id: number;
  kpi_name: string;
  kpi_year: number;
  entry: {
    id: number;
    is_draft: boolean;
    is_locked: boolean;
    submitted_at: string | null;
    preview: Array<{ field_name: string; value: string }>;
  } | null;
}

const currentYear = new Date().getFullYear();

export default function EntriesPage() {
  const [year, setYear] = useState(currentYear);
  const [overview, setOverview] = useState<OverviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const token = getAccessToken();

  const loadOverview = () => {
    if (!token) return;
    setError(null);
    setLoading(true);
    api<OverviewItem[]>(`/entries/overview?year=${year}`, { token })
      .then(setOverview)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOverview();
  }, [year]);

  if (loading && overview.length === 0) return <p>Loading...</p>;

  const content = (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Data entry</h1>
        <div className="form-group" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <label htmlFor="entries-year" style={{ marginBottom: 0, color: "var(--muted)", fontSize: "0.9rem" }}>Year</label>
          <select
            id="entries-year"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: "auto", minWidth: 100 }}
          >
            {Array.from({ length: 11 }, (_, i) => currentYear - 5 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {overview.length === 0 ? (
        <div className="card">
          <p style={{ color: "var(--muted)" }}>You have no KPIs assigned for data entry. Ask your admin to assign KPIs to your user.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {overview.map((item) => {
            const hasEntry = item.entry != null;
            const status = !hasEntry ? "not_entered" : item.entry.is_locked ? "locked" : item.entry.is_draft ? "draft" : "submitted";
            const preview = hasEntry && item.entry.preview ? item.entry.preview : [];
            return (
              <Link
                key={item.kpi_id}
                href={item.entry?.is_locked ? "#" : `/dashboard/entries/${item.kpi_id}/${year}`}
                style={{ textDecoration: "none", color: "inherit" }}
                onClick={(e) => item.entry?.is_locked && e.preventDefault()}
              >
                <div
                  className="card"
                  style={{
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    cursor: item.entry?.is_locked ? "not-allowed" : "pointer",
                    opacity: item.entry?.is_locked ? 0.85 : 1,
                    borderWidth: 2,
                    borderColor: status === "not_entered" ? "var(--warning)" : "var(--border)",
                    borderStyle: "solid",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (!item.entry?.is_locked) {
                      e.currentTarget.style.borderColor = "var(--accent)";
                      e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.15)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = status === "not_entered" ? "var(--warning)" : "var(--border)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem", gap: "0.5rem" }}>
                    <h3 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0, flex: 1 }}>{item.kpi_name}</h3>
                    <span
                      style={{
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        padding: "0.25rem 0.5rem",
                        borderRadius: 4,
                        flexShrink: 0,
                        ...(status === "not_entered"
                          ? { background: "var(--warning)", color: "var(--on-muted)" }
                          : status === "draft"
                          ? { background: "var(--warning)", color: "var(--on-muted)" }
                          : status === "submitted"
                          ? { background: "var(--success)", color: "var(--on-muted)" }
                          : { background: "var(--muted)", color: "var(--text)" }),
                      }}
                    >
                      {status === "not_entered" ? "Not entered" : status === "draft" ? "Draft" : status === "submitted" ? "Submitted" : "Locked"}
                    </span>
                  </div>
                  <p style={{ color: "var(--muted)", fontSize: "0.85rem", marginBottom: "0.75rem" }}>Year {year}</p>
                  {preview.length > 0 ? (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, flex: 1 }}>
                      {preview.map((p, i) => (
                        <li key={i} style={{ fontSize: "0.9rem", marginBottom: "0.35rem", color: "var(--muted)" }}>
                          <strong style={{ color: "var(--text)" }}>{p.field_name}:</strong> {p.value || "—"}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p style={{ color: "var(--muted)", fontSize: "0.9rem", flex: 1 }}>{hasEntry ? "No field values yet" : "Click to add data"}</p>
                  )}
                  {!item.entry?.is_locked && (
                    <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "var(--accent)" }}>
                      {hasEntry ? "Edit entry →" : "Add entry →"}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
  return content;
}
