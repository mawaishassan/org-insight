"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

interface DashboardRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
}

interface AssignmentRow {
  user_id: number;
  email: string | null;
  full_name: string | null;
  can_view: boolean;
  can_edit: boolean;
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
}

type Rights = { can_view: boolean; can_edit: boolean };

export default function DashboardAssignPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const token = getAccessToken();
  const orgIdFromQuery = searchParams.get("organization_id");

  const [dashboard, setDashboard] = useState<DashboardRow | null>(null);
  const [meRole, setMeRole] = useState<string | null>(null);
  const [orgUsers, setOrgUsers] = useState<UserRow[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [rightsByUserId, setRightsByUserId] = useState<Record<number, Rights>>({});
  const [userFilter, setUserFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!id || !token) return;
    setLoading(true);
    setError(null);
    const query = orgIdFromQuery ? `?organization_id=${orgIdFromQuery}` : "";
    Promise.all([
      api<{ role: string }>("/auth/me", { token }).catch(() => null),
      api<DashboardRow>(`/dashboards/${id}${query}`, { token }),
      api<AssignmentRow[]>(`/dashboards/${id}/users${query}`, { token }),
    ])
      .then(([me, d, a]) => {
        setMeRole(me?.role ?? null);
        setDashboard(d);
        setAssignments(a);
        return api<UserRow[]>(`/users?${qs({ organization_id: d.organization_id })}`, { token }).then((users) => {
          setOrgUsers(users);
          const initial: Record<number, Rights> = {};
          users.forEach((u) => {
            const existing = a.find((x) => x.user_id === u.id);
            initial[u.id] = existing ? { can_view: existing.can_view, can_edit: existing.can_edit } : { can_view: false, can_edit: false };
          });
          setRightsByUserId(initial);
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [id, token, orgIdFromQuery]);

  const canGrantEdit = meRole === "SUPER_ADMIN";

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
      [userId]: { ...(prev[userId] ?? { can_view: false, can_edit: false }), ...patch },
    }));
  };

  const handleSave = async () => {
    if (!token || !dashboard) return;
    setSaveError(null);
    setSaving(true);
    try {
      const base = `?${qs({ organization_id: dashboard.organization_id })}`;
      for (const u of orgUsers) {
        const r = rightsByUserId[u.id] ?? { can_view: false, can_edit: false };
        const hadAssignment = assignments.some((a) => a.user_id === u.id);
        const effective = canGrantEdit ? r : { ...r, can_edit: false };
        if (effective.can_view || effective.can_edit) {
          await api(`/dashboards/${id}/assign${base}`, {
            method: "POST",
            token,
            body: JSON.stringify({ user_id: u.id, can_view: effective.can_view, can_edit: effective.can_edit }),
          });
        } else if (hadAssignment) {
          await api(`/dashboards/${id}/users/${u.id}${base}`, { method: "DELETE", token });
        }
      }
      const next = await api<AssignmentRow[]>(`/dashboards/${id}/users${base}`, { token });
      setAssignments(next);
      const updated: Record<number, Rights> = {};
      orgUsers.forEach((u) => {
        const a = next.find((x) => x.user_id === u.id);
        updated[u.id] = a ? { can_view: a.can_view, can_edit: a.can_edit } : { can_view: false, can_edit: false };
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
  if (!dashboard) return null;

  return (
    <div style={{ padding: "0 1rem 1rem" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Assign users: {dashboard.name}</h1>
      <p style={{ color: "var(--muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
        Set view rights per user. Only users in this organization are listed. Save to apply changes.
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
                {canGrantEdit && <th style={{ padding: "0.5rem 0.75rem" }}>Edit</th>}
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => {
                const r = rightsByUserId[u.id] ?? { can_view: false, can_edit: false };
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
                    {canGrantEdit && (
                      <td style={{ padding: "0.5rem 0.75rem" }}>
                        <input
                          type="checkbox"
                          checked={r.can_edit}
                          onChange={(e) => setRights(u.id, { can_edit: e.target.checked })}
                          aria-label={`Edit for ${display}`}
                        />
                      </td>
                    )}
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

