"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, canEditDomainsAndCategories, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface DomainSummary {
  category_count: number;
  kpi_count: number;
  entries_submitted?: number;
  entries_draft?: number;
  entries_not_entered?: number;
}

interface DomainWithSummary {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  sort_order: number;
  summary: DomainSummary;
}

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  sort_order: z.coerce.number().int().min(0),
});

const updateSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  sort_order: z.coerce.number().int().min(0),
});

type CreateFormData = z.infer<typeof createSchema>;
type UpdateFormData = z.infer<typeof updateSchema>;

export default function DomainsPage() {
  const [list, setList] = useState<DomainWithSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const currentYear = new Date().getFullYear();
  const [summaryYear, setSummaryYear] = useState(currentYear);

  const token = getAccessToken();
  const canEdit = userRole !== null && canEditDomainsAndCategories(userRole);

  const loadList = () => {
    if (!token) return;
    setError(null);
    const params = new URLSearchParams({ with_summary: "true", year: String(summaryYear) });
    api<DomainWithSummary[]>(`/domains?${params.toString()}`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadList();
  }, [summaryYear, canEdit]);

  useEffect(() => {
    if (!token) return;
    api<{ role: UserRole }>("/auth/me", { token })
      .then((me) => setUserRole(me.role))
      .catch(() => setUserRole(null));
  }, [token]);

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", description: "", sort_order: 0 },
  });

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token) return;
    setError(null);
    try {
      await api("/domains", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          sort_order: data.sort_order,
        }),
        token,
      });
      createForm.reset({ name: "", description: "", sort_order: 0 });
      setShowCreate(false);
      loadList();
      toast.success("Domain created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  const onUpdateSubmit = async (domainId: number, data: UpdateFormData) => {
    if (!token) return;
    setError(null);
    try {
      await api(`/domains/${domainId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          sort_order: data.sort_order,
        }),
        token,
      });
      setEditingId(null);
      loadList();
      toast.success("Domain updated successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const onDelete = async (domainId: number) => {
    if (!token) return;
    if (!confirm("Delete this domain? Categories and KPIs under it will also be removed.")) return;
    setError(null);
    try {
      await api(`/domains/${domainId}`, { method: "DELETE", token });
      setEditingId(null);
      loadList();
      toast.success("Domain deleted successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div>
      <header style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, marginBottom: "0.25rem" }}>Domains</h1>
        <p style={{ color: "var(--muted)", fontSize: "0.95rem", margin: 0 }}>
          Browse domains and their KPI summaries. Open a domain to manage categories and data entry.
        </p>
      </header>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <div className="form-group" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <label htmlFor="domains-summary-year" style={{ marginBottom: 0, color: "var(--muted)", fontSize: "0.9rem" }}>Data entry year</label>
            <select
              id="domains-summary-year"
              value={summaryYear}
              onChange={(e) => setSummaryYear(Number(e.target.value))}
              style={{ width: "auto", minWidth: 100 }}
              aria-label="Data entry year for summaries"
            >
              {Array.from({ length: 11 }, (_, i) => currentYear - 5 + i).map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
              {showCreate ? "Cancel" : "Add domain"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            marginBottom: "1rem",
            padding: "0.75rem 1rem",
            background: "rgba(220, 38, 38, 0.08)",
            border: "1px solid var(--error)",
            borderRadius: 8,
            color: "var(--error)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.75rem",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              padding: "0.25rem",
              fontSize: "1.25rem",
              lineHeight: 1,
              opacity: 0.8,
            }}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1.5rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem", fontWeight: 600 }}>Create domain</h2>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Name *</label>
              <input {...createForm.register("name")} />
              {createForm.formState.errors.name && (
                <p className="form-error">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea {...createForm.register("description")} rows={2} />
            </div>
            <div className="form-group">
              <label>Sort order</label>
              <input type="number" min={0} {...createForm.register("sort_order")} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Creating…" : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading && list.length === 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="card"
              style={{
                minHeight: 260,
                marginBottom: 0,
                opacity: 0.7,
              }}
            >
              <div style={{ height: "1.25rem", width: "60%", background: "var(--border)", borderRadius: 4, marginBottom: "0.75rem" }} />
              <div style={{ height: "2.6em", background: "var(--bg-subtle)", borderRadius: 4, marginBottom: "0.75rem" }} />
              <div style={{ display: "flex", gap: "1rem", marginBottom: "0.5rem" }}>
                <div style={{ height: "1rem", width: 80, background: "var(--border)", borderRadius: 4 }} />
                <div style={{ height: "1rem", width: 60, background: "var(--border)", borderRadius: 4 }} />
              </div>
              <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)" }}>
                <div style={{ height: "1rem", width: "40%", background: "var(--border)", borderRadius: 4, marginBottom: "0.5rem" }} />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <div style={{ height: "0.875rem", width: 70, background: "var(--bg-subtle)", borderRadius: 4 }} />
                  <div style={{ height: "0.875rem", width: 50, background: "var(--bg-subtle)", borderRadius: 4 }} />
                  <div style={{ height: "0.875rem", width: 75, background: "var(--bg-subtle)", borderRadius: 4 }} />
                </div>
              </div>
              <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)", display: "flex", gap: "0.5rem" }}>
                <div style={{ height: 36, width: 90, background: "var(--border)", borderRadius: 8 }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem", alignItems: "stretch" }}>
          {list.map((d) => (
            <div
              key={d.id}
              className="card"
              style={{
                marginBottom: 0,
                minHeight: 260,
                display: "flex",
                flexDirection: "column",
                transition: "box-shadow 0.2s ease, border-color 0.2s ease, transform 0.2s ease",
              }}
              onMouseEnter={(e) => {
                if (editingId !== d.id) {
                  e.currentTarget.style.boxShadow = "var(--shadow-md)";
                  e.currentTarget.style.borderColor = "var(--border-focus)";
                  e.currentTarget.style.transform = "translateY(-2px)";
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "var(--shadow)";
                e.currentTarget.style.borderColor = "";
                e.currentTarget.style.transform = "";
              }}
            >
              {editingId === d.id ? (
                <DomainEditForm
                  domain={d}
                  onSave={(data) => onUpdateSubmit(d.id, data)}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <Link
                    href={`/dashboard/entries?domain_id=${d.id}&year=${summaryYear}`}
                    style={{
                      textDecoration: "none",
                      color: "inherit",
                      display: "flex",
                      flexDirection: "column",
                      flex: 1,
                      minHeight: 0,
                      marginBottom: "0.75rem",
                    }}
                  >
                    <strong style={{ fontSize: "1.1rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>{d.name}</strong>
                    <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: 0, lineHeight: 1.3, minHeight: "2.6em" }}>
                      {d.description && d.description.trim() ? d.description : "No description"}
                    </p>
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Categories">
                        <strong style={{ color: "var(--text)" }}>{(d.summary?.category_count ?? 0)}</strong> categories
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="KPIs">
                        <strong style={{ color: "var(--text)" }}>{(d.summary?.kpi_count ?? 0)}</strong> KPIs
                      </span>
                    </div>
                    <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", fontSize: "0.85rem" }}>
                      <span style={{ color: "var(--muted)", fontWeight: 600 }}>Data entry ({summaryYear}):</span>
                      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                        <span style={{ color: "var(--success)" }} title="Submitted">
                          {(d.summary?.entries_submitted ?? 0)} submitted
                        </span>
                        <span style={{ color: "var(--warning)" }} title="Draft">
                          {(d.summary?.entries_draft ?? 0)} draft
                        </span>
                        <span style={{ color: "var(--muted)" }} title="Not entered">
                          {(d.summary?.entries_not_entered ?? 0)} not entered
                        </span>
                      </div>
                    </div>
                  </Link>
                  <div style={{ display: "flex", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)", marginTop: "auto", flexWrap: "wrap", alignItems: "center" }}>
                    {canEdit && (
                      <>
                        <Link href={`/dashboard/domains/${d.id}?organization_id=${d.organization_id}`} className="btn" style={{ textDecoration: "none" }}>
                          Manage
                        </Link>
                        <button type="button" className="btn" onClick={() => setEditingId(d.id)}>Edit</button>
                        <button type="button" className="btn" onClick={() => onDelete(d.id)} style={{ color: "var(--error)" }}>Delete</button>
                      </>
                    )}
                    <Link href={`/dashboard/entries?domain_id=${d.id}&year=${summaryYear}`} className="btn btn-primary" style={{ textDecoration: "none", marginLeft: canEdit ? undefined : "auto" }}>
                      View KPIs
                    </Link>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {!loading && list.length === 0 && !showCreate && (
        <div
          className="card"
          style={{
            textAlign: "center",
            padding: "2.5rem 1.5rem",
            maxWidth: 420,
            margin: "0 auto",
          }}
        >
          <p style={{ color: "var(--muted)", fontSize: "1rem", marginBottom: "1rem" }}>
            No domains yet. Create one to organize KPIs and categories.
          </p>
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate(true)}>
              Add your first domain
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function DomainEditForm({
  domain,
  onSave,
  onCancel,
}: {
  domain: DomainWithSummary;
  onSave: (data: UpdateFormData) => void;
  onCancel: () => void;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<UpdateFormData>({
    resolver: zodResolver(updateSchema),
    defaultValues: {
      name: domain.name,
      description: domain.description ?? "",
      sort_order: domain.sort_order,
    },
  });

  return (
    <form onSubmit={handleSubmit(onSave)} style={{ width: "100%" }}>
      <div className="form-group">
        <label>Name *</label>
        <input {...register("name")} />
        {errors.name && <p className="form-error">{errors.name.message}</p>}
      </div>
      <div className="form-group">
        <label>Description</label>
        <textarea {...register("description")} rows={2} />
      </div>
      <div className="form-group">
        <label>Sort order</label>
        <input type="number" min={0} {...register("sort_order")} />
      </div>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <button type="submit" className="btn btn-primary" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Save"}</button>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
