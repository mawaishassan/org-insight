"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface UserOption {
  id: number;
  username: string;
  full_name: string | null;
  role: string;
}

interface CustomReportAssignment {
  id: number;
  custom_report_id: number;
  user_id: number;
  can_view: boolean;
  can_print: boolean;
  can_export: boolean;
}

interface CustomReportDetail {
  id: number;
  name: string;
  organization_id: number;
}

export default function CustomReportAssignPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgId = Number(searchParams.get("organization_id"));

  const [report, setReport] = useState<CustomReportDetail | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [assignments, setAssignments] = useState<Record<number, CustomReportAssignment>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !id || !orgId) return;

    setLoading(true);
    Promise.all([
      api<CustomReportDetail>(`/custom-reports/${id}?organization_id=${orgId}`, { token }),
      api<UserOption[]>(`/users?organization_id=${orgId}`, { token }),
      api<any[]>(`/custom-reports/${id}/users?organization_id=${orgId}`, { token }),
    ])
      .then(([reportData, usersData, assignData]) => {
        setReport(reportData);
        // Exclude Super Admins and Org Admins from direct assignments if appropriate,
        // or list all users. Let's list everyone who is not a Super Admin (since Super Admin always has full access).
        setUsers(usersData.filter((u) => u.role !== "SUPER_ADMIN"));

        const initialAssigns: Record<number, CustomReportAssignment> = {};
        assignData.forEach((a) => {
          initialAssigns[a.user_id] = a;
        });
        setAssignments(initialAssigns);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load assignment configuration"))
      .finally(() => setLoading(false));
  }, [id, orgId]);

  const handlePermissionChange = async (
    userId: number,
    key: "can_view" | "can_print" | "can_export",
    checked: boolean
  ) => {
    const token = getAccessToken();
    if (!token || !id) return;

    const existing = assignments[userId];
    const currentView = existing ? existing.can_view : false;
    const currentPrint = existing ? existing.can_print : false;
    const currentExport = existing ? existing.can_export : false;

    const nextPerms = {
      can_view: key === "can_view" ? checked : currentView,
      can_print: key === "can_print" ? checked : currentPrint,
      can_export: key === "can_export" ? checked : currentExport,
    };

    // If all are turned off, unassign
    if (!nextPerms.can_view && !nextPerms.can_print && !nextPerms.can_export) {
      try {
        await api(`/custom-reports/${id}/users/${userId}?organization_id=${orgId}`, {
          method: "DELETE",
          token,
        });
        setAssignments((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
        toast.success("Assignment removed");
      } catch (e) {
        toast.error("Failed to update permission");
      }
    } else {
      // Create or update assignment
      try {
        const payload = {
          user_id: userId,
          ...nextPerms,
        };
        const updated = await api<CustomReportAssignment>(`/custom-reports/${id}/assign?organization_id=${orgId}`, {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        });
        setAssignments((prev) => ({
          ...prev,
          [userId]: updated,
        }));
        toast.success("Permissions updated");
      } catch (e) {
        toast.error("Failed to update permissions");
      }
    }
  };

  const handleRemoveAll = async (userId: number) => {
    const token = getAccessToken();
    if (!token || !id) return;

    try {
      await api(`/custom-reports/${id}/users/${userId}?organization_id=${orgId}`, {
        method: "DELETE",
        token,
      });
      setAssignments((prev) => {
        const next = { ...prev };
        delete next[userId];
        return next;
      });
      toast.success("Permissions cleared");
    } catch (e) {
      toast.error("Failed to clear permissions");
    }
  };

  if (loading) return <p style={{ padding: "1.5rem" }}>Loading user access rules...</p>;
  if (error) return <p className="form-error" style={{ margin: "1.5rem" }}>{error}</p>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 1rem 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", fontWeight: 700, margin: 0 }}>Assign Access: {report?.name}</h1>
          <p style={{ color: "var(--muted)", margin: "0.25rem 0 0 0", fontSize: "0.9rem" }}>
            Authorize organization users to view, print, or export this custom report template.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          onClick={() => router.push(`/dashboard/custom-reports?organization_id=${orgId}`)}
        >
          Back to list
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden", background: "var(--surface)", border: "1px solid var(--border)" }}>
        {users.length === 0 ? (
          <p style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", margin: 0 }}>
            No users found in this organization.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f8fafc", borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "1rem", fontSize: "0.85rem", textTransform: "uppercase", color: "var(--muted)", width: "35%" }}>User</th>
                <th style={{ textAlign: "center", padding: "1rem", fontSize: "0.85rem", textTransform: "uppercase", color: "var(--muted)" }}>View</th>
                <th style={{ textAlign: "center", padding: "1rem", fontSize: "0.85rem", textTransform: "uppercase", color: "var(--muted)" }}>Print</th>
                <th style={{ textAlign: "center", padding: "1rem", fontSize: "0.85rem", textTransform: "uppercase", color: "var(--muted)" }}>Export</th>
                <th style={{ textAlign: "right", padding: "1rem", fontSize: "0.85rem", textTransform: "uppercase", color: "var(--muted)" }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const assign = assignments[user.id];
                return (
                  <tr key={user.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "1rem" }}>
                      <div style={{ fontWeight: 600, color: "var(--text)" }}>
                        {user.full_name || user.username}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.1rem" }}>
                        Role: {user.role} | Username: {user.username}
                      </div>
                    </td>
                    <td style={{ padding: "1rem", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={assign ? assign.can_view : false}
                        onChange={(e) => handlePermissionChange(user.id, "can_view", e.target.checked)}
                        style={{ transform: "scale(1.2)" }}
                      />
                    </td>
                    <td style={{ padding: "1rem", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={assign ? assign.can_print : false}
                        onChange={(e) => handlePermissionChange(user.id, "can_print", e.target.checked)}
                        style={{ transform: "scale(1.2)" }}
                      />
                    </td>
                    <td style={{ padding: "1rem", textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={assign ? assign.can_export : false}
                        onChange={(e) => handlePermissionChange(user.id, "can_export", e.target.checked)}
                        style={{ transform: "scale(1.2)" }}
                      />
                    </td>
                    <td style={{ padding: "1rem", textAlign: "right" }}>
                      {assign ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => handleRemoveAll(user.id)}
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "var(--error)" }}
                        >
                          Unassign
                        </button>
                      ) : (
                        <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>No Access</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
