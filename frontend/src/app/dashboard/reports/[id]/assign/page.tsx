"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

interface TemplateRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  year: number;
}

interface AssignmentRow {
  user_id: number;
  email: string | null;
  full_name: string | null;
  can_view: boolean;
  can_print: boolean;
  can_export: boolean;
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
}

type Rights = { can_view: boolean; can_print: boolean; can_export: boolean };

export default function ReportAssignPage() {
  const params = useParams();
  const id = Number(params.id);
  const token = getAccessToken();

  const [template, setTemplate] = useState<TemplateRow | null>(null);
  const [orgUsers, setOrgUsers] = useState<UserRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const [rightsByUserId, setRightsByUserId] = useState<Record<number, Rights>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api<TemplateRow>(`/reports/templates/${id}`, { token }),
      api<AssignmentRow[]>(`/reports/templates/${id}/users`, { token }),
    ])
      .then(([t, a]) => {
        setTemplate(t);
        setAssignments(a);
        const orgId = t.organization_id;
        return api<UserRow[]>(`/users?${qs({ organization_id: orgId })}`, { token }).then((users) => {
          setOrgUsers(users);
          const initial: Record<number, Rights> = {};
          users.forEach((u) => {
            const existing = a.find((x) => x.user_id === u.id);
            initial[u.id] = existing
              ? { can_view: existing.can_view, can_print: existing.can_print, can_export: existing.can_export }
              : { can_view: false, can_print: false, can_export: false };
          });
          setRightsByUserId(initial);
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id, token]);

  const filteredUsers = useMemo(() => {
    const q = userFilter.trim().toLowerCase();
    if (!q) return orgUsers;
    return orgUsers.filter((u) => {
      const name = (u.full_name || "").toLowerCase();
      const email = (u.email || "").toLowerCase();
      const username = (u.username || "").toLowerCase();
      return name.includes(q) || email.includes(q) || username.includes(q);
    });
  }, [orgUsers, userFilter]);

  const setRights = (userId: number, patch: Partial<Rights>) => {
    setRightsByUserId((prev) => ({
      ...prev,
      [userId]: { ...(prev[userId] ?? { can_view: false, can_print: false, can_export: false }), ...patch },
    }));
  };

  const handleSave = async () => {
    if (!token || !template) return;
    setSaveError(null);
    setSaving(true);
    try {
      const orgId = template.organization_id;
      const base = `?${qs({ organization_id: orgId })}`;
      for (const u of orgUsers) {
        const r = rightsByUserId[u.id] ?? { can_view: false, can_print: false, can_export: false };
        const hadAssignment = assignments.some((a) => a.user_id === u.id);
        if (r.can_view || r.can_print || r.can_export) {
          await api(`/reports/templates/${id}/assign${base}`, {
            method: "POST",
            token,
            body: JSON.stringify({
              user_id: u.id,
              can_view: r.can_view,
              can_print: r.can_print,
              can_export: r.can_export,
            }),
          });
        } else if (hadAssignment) {
          await api(`/reports/templates/${id}/users/${u.id}${base}`, { method: "DELETE", token });
        }
      }
      const next = await api<AssignmentRow[]>(`/reports/templates/${id}/users`, { token });
      setAssignments(next);
      const updated: Record<number, Rights> = {};
      orgUsers.forEach((u) => {
        const a = next.find((x) => x.user_id === u.id);
        updated[u.id] = a
          ? { can_view: a.can_view, can_print: a.can_print, can_export: a.can_export }
          : { can_view: false, can_print: false, can_export: false };
      });
      setRightsByUserId(updated);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error) return <p className="form-error">{error}</p>;
  if (!template) return null;

  return (
    <div style={{ padding: "0 1rem 1rem" }}>
      <div style={{ marginBottom: "1rem" }}>
        <Link href="/dashboard/reports" style={{ color: "var(--muted)", fontSize: "0.9rem" }}>
          {"\u2190"} Back to reports
        </Link>
      </div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Assign users: {template.name}</h1>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        Set view, print, and export rights per user. Only users in this organization are listed. Save to apply changes.
      </p>

      <div className="card">
        <div style={{ marginBottom: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Filter by name, email, username…"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            style={{ minWidth: 220, padding: "0.5rem 0.6rem" }}
          />
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}
          </button>
          {saveError && <span className="form-error">{saveError}</span>}
        </div>

        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "0.5rem 0.75rem" }}>User</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>View</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Print</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Export</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
                const r = rightsByUserId[u.id] ?? { can_view: false, can_print: false, can_export: false };
                const display = u.full_name || u.email || u.username || `User #${u.id}`;
                return (
                  <tr key={u.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.5rem 0.75rem" }}>{display}</td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <input
                        type="checkbox"
                        checked={r.can_view}
                        onChange={(e) => setRights(u.id, { can_view: e.target.checked })}
                        aria-label={`View for ${display}`}
                      />
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <input
                        type="checkbox"
                        checked={r.can_print}
                        onChange={(e) => setRights(u.id, { can_print: e.target.checked })}
                        aria-label={`Print for ${display}`}
                      />
                    </td>
                    <td style={{ padding: "0.5rem 0.75rem" }}>
                      <input
                        type="checkbox"
                        checked={r.can_export}
                        onChange={(e) => setRights(u.id, { can_export: e.target.checked })}
                        aria-label={`Export for ${display}`}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredUsers.length === 0 && (
          <p style={{ color: "var(--muted)", padding: "1rem 0", margin: 0 }}>
            {userFilter.trim() ? "No users match the filter." : "No users in this organization."}
          </p>
        )}
      </div>
    </div>
  );
}
