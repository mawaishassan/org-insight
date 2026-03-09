"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

/** Settings icon (gear) for organization card - links to org Settings tab. */
function SettingsIcon({ orgId }: { orgId: number }) {
  return (
    <Link
      href={`/dashboard/organizations/${orgId}?tab=settings&sub=organization`}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 8, color: "var(--muted)", textDecoration: "none" }}
      title="Settings"
      aria-label="Settings"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    </Link>
  );
}

interface OrgSummary {
  user_count: number;
  domain_count: number;
  kpi_count: number;
}

interface OrgWithSummary {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  summary: OrgSummary;
}

const createSchema = z.object({
  name: z.string().min(1, "Name required"),
  description: z.string().optional(),
  admin_username: z.string().min(1, "Admin username required"),
  admin_password: z.string().min(8, "Password at least 8 characters"),
  admin_email: z.union([z.string().email(), z.literal("")]).optional(),
  admin_full_name: z.string().optional(),
});

type CreateFormData = z.infer<typeof createSchema>;

export default function OrganizationsPage() {
  const [list, setList] = useState<OrgWithSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const token = getAccessToken();

  const loadList = () => {
    if (!token) return;
    setLoading(true);
    api<OrgWithSummary[]>(`/organizations?with_summary=true`, { token })
      .then(setList)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadList();
  }, [token]);

  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      name: "",
      description: "",
      admin_username: "",
      admin_password: "",
      admin_email: "",
      admin_full_name: "",
    },
  });

  const onCreateSubmit = async (data: CreateFormData) => {
    if (!token) return;
    setError(null);
    try {
      await api("/organizations", {
        method: "POST",
        body: JSON.stringify({
          name: data.name,
          description: data.description || null,
          admin_username: data.admin_username,
          admin_password: data.admin_password,
          admin_email: data.admin_email || null,
          admin_full_name: data.admin_full_name || null,
        }),
        token,
      });
      createForm.reset();
      setShowCreate(false);
      setLoading(true);
      loadList();
      toast.success("Organization created successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
      toast.error(e instanceof Error ? e.message : "Create failed");
    }
  };

  if (loading && list.length === 0) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.5rem" }}>
        <h1 style={{ fontSize: "1.5rem" }}>Organizations</h1>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setShowCreate((s) => !s)}
        >
          {showCreate ? "Cancel" : "Add organization"}
        </button>
      </div>

      {error && <p className="form-error" style={{ marginBottom: "1rem" }}>{error}</p>}

      {showCreate && (
        <div className="card" style={{ marginBottom: "1rem" }}>
          <h2 style={{ marginBottom: "1rem", fontSize: "1.1rem" }}>Create organization</h2>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <div className="form-group">
              <label>Organization name *</label>
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
              <label>Admin username *</label>
              <input {...createForm.register("admin_username")} />
              {createForm.formState.errors.admin_username && (
                <p className="form-error">{createForm.formState.errors.admin_username.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Admin password * (min 8 characters)</label>
              <input type="password" {...createForm.register("admin_password")} />
              {createForm.formState.errors.admin_password && (
                <p className="form-error">{createForm.formState.errors.admin_password.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Admin email</label>
              <input type="email" {...createForm.register("admin_email")} />
              {createForm.formState.errors.admin_email && (
                <p className="form-error">{createForm.formState.errors.admin_email.message}</p>
              )}
            </div>
            <div className="form-group">
              <label>Admin full name</label>
              <input {...createForm.register("admin_full_name")} />
            </div>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary" disabled={createForm.formState.isSubmitting}>
                {createForm.formState.isSubmitting ? "Creating…" : "Create"}
              </button>
              <button type="button" className="btn" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1rem" }}>
        {list.map((o) => (
          <div key={o.id} className="card" style={{ marginBottom: 0, display: "flex", flexDirection: "column", minHeight: 200 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flex: 1, minWidth: 0 }}>
              <Link
                href={`/dashboard/organizations/${o.id}`}
                style={{ textDecoration: "none", color: "inherit", flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}
              >
                {/* Section 1: Title */}
                <div style={{ marginBottom: "0.5rem" }}>
                  <strong style={{ fontSize: "1.1rem", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.name}</strong>
                </div>
                {/* Section 2: Description - always 2 lines space, clamp */}
                <div
                  style={{
                    color: "var(--muted)",
                    fontSize: "0.9rem",
                    lineHeight: 1.35,
                    minHeight: "2.7em",
                    marginBottom: "0.5rem",
                    overflow: "hidden",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    wordBreak: "break-word",
                  }}
                  title={o.description ?? undefined}
                >
                  {o.description?.trim() || "\u00A0"}
                </div>
                {/* Section 3: Active status */}
                <div style={{ marginBottom: "0.75rem" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.2rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.8rem",
                      background: o.is_active ? "var(--success)" : "var(--muted)",
                      color: "white",
                    }}
                  >
                    {o.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                {/* Section 4: Summary */}
                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "auto" }}>
                  <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Users">
                    {o.summary.user_count} users
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="Domains">
                    {o.summary.domain_count} domains
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: "0.85rem" }} title="KPIs">
                    {o.summary.kpi_count} KPIs
                  </span>
                </div>
              </Link>
              <SettingsIcon orgId={o.id} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
