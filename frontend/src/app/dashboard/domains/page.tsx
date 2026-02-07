"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken, canEditDomainsAndCategories, type UserRole } from "@/lib/auth";
import { api } from "@/lib/api";

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
    const params = new URLSearchParams({ with_summary: "true" });
    if (!canEdit) params.set("year", String(summaryYear));
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
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
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  if (loading && list.length === 0) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Domains</h1>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          {!canEdit && (
            <div className="form-group" style={{ marginBottom: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <label htmlFor="domains-summary-year" style={{ marginBottom: 0, color: "var(--muted)", fontSize: "0.9rem" }}>Data entry year</label>
              <select
                id="domains-summary-year"
                value={summaryYear}
                onChange={(e) => setSummaryYear(Number(e.target.value))}
                style={{ width: "auto", minWidth: 100 }}
              >
                {Array.from({ length: 11 }, (_, i) => currentYear - 5 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {canEdit && (
            <button type="button" className="btn btn-primary" onClick={() => setShowCreate((s) => !s)}>
              {showCreate ? "Cancel" : "Add domain"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create domain</h2>
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
        {list.map((d) => (
          <div key={d.id} className="card" style={{ marginBottom: 0 }}>
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
                  style={{ textDecoration: "none", color: "inherit", display: "block", marginBottom: "0.75rem" }}
                >
                  <strong style={{ fontSize: "1.1rem" }}>{d.name}</strong>
                  {d.description && (
                    <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0.25rem 0 0", lineHeight: 1.3 }}>
                      {d.description}
                    </p>
                  )}
                  <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Categories">
                      {d.summary.category_count} categories
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="KPIs">
                      {d.summary.kpi_count} KPIs
                    </span>
                  </div>
                  {!canEdit && d.summary.kpi_count > 0 && (
                    <div style={{ marginTop: "0.5rem", paddingTop: "0.5rem", borderTop: "1px solid var(--border)", fontSize: "0.85rem" }}>
                      <span style={{ color: "var(--muted)", fontWeight: 600 }}>Data entry ({summaryYear}):</span>
                      <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
                        <span style={{ color: "var(--success)" }} title="Submitted">
                          {(d.summary.entries_submitted ?? 0)} submitted
                        </span>
                        <span style={{ color: "var(--warning)" }} title="Draft">
                          {(d.summary.entries_draft ?? 0)} draft
                        </span>
                        <span style={{ color: "var(--muted)" }} title="Not entered">
                          {(d.summary.entries_not_entered ?? 0)} not entered
                        </span>
                      </div>
                    </div>
                  )}
                </Link>
                <div style={{ display: "flex", gap: "0.5rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
                  {canEdit && (
                    <>
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

      {list.length === 0 && !showCreate && (
        <p style={{ color: "var(--muted)" }}>No domains yet. Add one above to get started.</p>
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
