"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";
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
  created_at: string;
  user_name?: string | null;
  user_role?: string | null;
}

interface CustomReportField {
  id: number;
  kpi_field_id: number;
  field_key: string;
  field_name: string;
  field_type: string;
  kpi_id: number;
}

interface CustomReportSection {
  id: number;
  kpi_id: number | null;
  kpi_name: string;
  fields: CustomReportField[];
}

interface CustomReportDetail {
  id: number;
  name: string;
  organization_id: number;
  sections: CustomReportSection[];
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
  const [userRole, setUserRole] = useState<string | null>(null);

  // Search, filter & selection states
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // Bulk permissions
  const [bulkView, setBulkView] = useState(true);
  const [bulkPrint, setBulkPrint] = useState(true);
  const [bulkExport, setBulkExport] = useState(true);

  // User-based dynamic filtering states
  const [filteringEnabled, setFilteringEnabled] = useState(false);
  const [selectedKpiId, setSelectedKpiId] = useState<number | null>(null);
  const [selectedMliId, setSelectedMliId] = useState<number | null>(null);
  const [selectedFieldId, setSelectedFieldId] = useState<number | null>(null); // sub-field ID
  const [subFields, setSubFields] = useState<any[]>([]);
  const [subFieldsLoading, setSubFieldsLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const token = getAccessToken();

  useEffect(() => {
    if (!token || !id || !orgId) return;

    setLoading(true);
    Promise.all([
      api<CustomReportDetail>(`/custom-reports/${id}/detail?organization_id=${orgId}`, { token }),
      api<UserOption[]>(`/users?organization_id=${orgId}`, { token }),
      api<CustomReportAssignment[]>(`/custom-reports/${id}/users?organization_id=${orgId}`, { token }),
      api<any>(`/custom-reports/${id}/filter-config?organization_id=${orgId}`, { token }).catch(() => null),
      api<{ role: string }>("/auth/me", { token }).catch(() => null),
    ])
      .then(([reportData, usersData, assignData, filterConfig, meData]) => {
        setReport(reportData);
        setUsers(usersData.filter((u) => u.role !== "SUPER_ADMIN"));
        if (meData) {
          setUserRole(meData.role);
        }

        const initialAssigns: Record<number, CustomReportAssignment> = {};
        assignData.forEach((a) => {
          initialAssigns[a.user_id] = a;
        });
        setAssignments(initialAssigns);

        if (filterConfig) {
          setFilteringEnabled(filterConfig.enabled);
          setSelectedKpiId(filterConfig.kpi_id);
          setSelectedMliId(filterConfig.mli_id);
          setSelectedFieldId(filterConfig.field_id);
        }

        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load assignment configuration"))
      .finally(() => setLoading(false));
  }, [id, orgId, token]);

  // Fetch MLI sub-fields dynamically when MLI field changes
  useEffect(() => {
    if (!selectedMliId || !token) {
      setSubFields([]);
      return;
    }
    setSubFieldsLoading(true);
    api<any>(`/fields/${selectedMliId}?organization_id=${orgId}`, { token })
      .then((data) => {
        setSubFields(data.sub_fields || []);
      })
      .catch(() => toast.error("Failed to load multi-line item columns"))
      .finally(() => setSubFieldsLoading(false));
  }, [selectedMliId, token, orgId]);

  // Filter users in client side search
  const filteredUsers = users.filter((u) => {
    const matchSearch =
      u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (u.full_name || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchRole = roleFilter === "all" || u.role === roleFilter;
    return matchSearch && matchRole;
  });

  const handleSelectUser = (userId: number, checked: boolean) => {
    if (checked) {
      setSelectedUserIds((prev) => [...prev, userId]);
    } else {
      setSelectedUserIds((prev) => prev.filter((uid) => uid !== userId));
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedUserIds(filteredUsers.map((u) => u.id));
    } else {
      setSelectedUserIds([]);
    }
  };

  const handleRemoveAll = async (userId: number) => {
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

  const handleAssignBulk = async () => {
    if (selectedUserIds.length === 0) {
      toast.error("Please select at least one user to assign.");
      return;
    }
    if (filteringEnabled && (!selectedKpiId || !selectedMliId || !selectedFieldId)) {
      toast.error("Please fill all user-based filtering selections or disable it.");
      return;
    }

    setSavingConfig(true);
    try {
      // 1. Save Bulk Assignments
      const payload = {
        user_ids: selectedUserIds,
        can_view: bulkView,
        can_print: bulkPrint,
        can_export: bulkExport,
      };
      const newAssigns = await api<CustomReportAssignment[]>(
        `/custom-reports/${id}/bulk-assign?organization_id=${orgId}`,
        {
          method: "POST",
          token,
          body: JSON.stringify(payload),
        }
      );

      setAssignments((prev) => {
        const next = { ...prev };
        newAssigns.forEach((a) => {
          next[a.user_id] = a;
        });
        return next;
      });

      // 2. Save Filter Configuration
      const filterPayload = {
        enabled: filteringEnabled,
        kpi_id: selectedKpiId,
        mli_id: selectedMliId,
        field_id: selectedFieldId,
        operator: "=",
        dynamic_value_source: "CURRENT_USER_UNIQUE_KEY",
      };
      await api(`/custom-reports/${id}/filter-config?organization_id=${orgId}`, {
        method: "POST",
        token,
        body: JSON.stringify(filterPayload),
      });

      toast.success(`Access assigned and filter config saved for ${selectedUserIds.length} users.`);
      setSelectedUserIds([]);
    } catch (e) {
      toast.error("Failed to save assignment configuration");
    } finally {
      setSavingConfig(false);
    }
  };

  if (loading) return <p style={{ padding: "1.5rem" }}>Loading user access rules...</p>;
  if (error) return <p className="form-error" style={{ margin: "1.5rem" }}>{error}</p>;

  // Get MLI options based on selected KPI
  const activeSection = report?.sections.find((s) => s.kpi_id === selectedKpiId);
  const mliFields = activeSection?.fields.filter((f) => f.field_type === "multi_line_items") || [];

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 1rem 1.5rem" }}>
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
          onClick={() => router.push(userRole === "SUPER_ADMIN" ? `/dashboard/custom-reports?organization_id=${orgId}` : "/dashboard/reports")}
        >
          Back to list
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem", alignItems: "start", marginBottom: "1.5rem" }}>
        {/* Left Panel: Bulk User Selection */}
        <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Step 1: Select Users</h2>
          
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-control"
              style={{ flex: 1 }}
            />
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="form-control"
              style={{ width: "130px" }}
            >
              <option value="all">All Roles</option>
              <option value="ORG_ADMIN">Org Admin</option>
              <option value="USER">User</option>
              <option value="REPORT_VIEWER">Report Viewer</option>
            </select>
          </div>

          <div
            style={{
              maxHeight: "300px",
              overflowY: "auto",
              border: "1px solid var(--border)",
              borderRadius: "6px",
              padding: "0.5rem",
              background: "#fafafa"
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem",
                borderBottom: "1px solid var(--border)",
                fontWeight: 600
              }}
            >
              <input
                type="checkbox"
                checked={filteredUsers.length > 0 && selectedUserIds.length === filteredUsers.length}
                onChange={(e) => handleSelectAll(e.target.checked)}
                style={{ transform: "scale(1.1)" }}
              />
              <span>Select All Visible ({filteredUsers.length})</span>
            </div>
            {filteredUsers.length === 0 ? (
              <p style={{ padding: "1rem", textAlign: "center", color: "var(--muted)", margin: 0 }}>
                No users match your filters.
              </p>
            ) : (
              filteredUsers.map((user) => (
                <label
                  key={user.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.5rem",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    fontSize: "0.9rem"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedUserIds.includes(user.id)}
                    onChange={(e) => handleSelectUser(user.id, e.target.checked)}
                    style={{ transform: "scale(1.1)" }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{user.full_name || user.username}</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                      {user.role} | Username: {user.username}
                    </div>
                  </div>
                  {assignments[user.id] && (
                    <span style={{ fontSize: "0.75rem", backgroundColor: "rgba(37, 99, 235, 0.1)", color: "#2563eb", padding: "2px 6px", borderRadius: "4px", fontWeight: 500 }}>
                      Assigned
                    </span>
                  )}
                </label>
              ))
            )}
          </div>
          <div style={{ fontSize: "0.9rem", fontWeight: 600, color: "#475569" }}>
            {selectedUserIds.length} users selected for bulk action
          </div>
        </div>

        {/* Right Panel: Permissions & User-Based Filtering */}
        <div className="card" style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>Step 2: Permissions & Filtering</h2>

          {/* Bulk Permissions */}
          <div>
            <h3 style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.5rem", color: "#475569" }}>Select Permissions</h3>
            <div style={{ display: "flex", gap: "1.5rem" }}>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={bulkView}
                  onChange={(e) => setBulkView(e.target.checked)}
                  style={{ transform: "scale(1.1)" }}
                />
                View
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={bulkPrint}
                  onChange={(e) => setBulkPrint(e.target.checked)}
                  style={{ transform: "scale(1.1)" }}
                />
                Print
              </label>
              <label style={{ display: "flex", gap: "0.5rem", alignItems: "center", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={bulkExport}
                  onChange={(e) => setBulkExport(e.target.checked)}
                  style={{ transform: "scale(1.1)" }}
                />
                Export
              </label>
            </div>
          </div>

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: 0 }} />

          {/* User-Based Data Filtering section */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <h3 style={{ fontSize: "0.9rem", fontWeight: 600, color: "#475569", margin: 0 }}>User-Based Data Filtering</h3>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setFilteringEnabled(true)}
                  className={`btn ${filteringEnabled ? "btn-primary" : ""}`}
                  style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilteringEnabled(false);
                    setSelectedKpiId(null);
                    setSelectedMliId(null);
                    setSelectedFieldId(null);
                  }}
                  className={`btn ${!filteringEnabled ? "btn-primary" : ""}`}
                  style={{ padding: "0.25rem 0.75rem", fontSize: "0.8rem" }}
                >
                  No
                </button>
              </div>
            </div>

            {filteringEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "0.75rem", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0", marginTop: "0.5rem" }}>
                
                {/* Select KPI */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Select KPI Data Source</label>
                  <select
                    value={selectedKpiId || ""}
                    onChange={(e) => {
                      setSelectedKpiId(Number(e.target.value) || null);
                      setSelectedMliId(null);
                      setSelectedFieldId(null);
                    }}
                    className="form-control"
                  >
                    <option value="">-- Choose KPI --</option>
                    {report?.sections.filter(s => s.kpi_id !== null).map((sec) => (
                      <option key={sec.kpi_id} value={sec.kpi_id!}>
                        {sec.kpi_name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Select MLI Field */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Select Multi-Line Item (MLI)</label>
                  <select
                    value={selectedMliId || ""}
                    onChange={(e) => {
                      setSelectedMliId(Number(e.target.value) || null);
                      setSelectedFieldId(null);
                    }}
                    className="form-control"
                    disabled={!selectedKpiId}
                  >
                    <option value="">-- Choose MLI --</option>
                    {mliFields.map((f) => (
                      <option key={f.kpi_field_id} value={f.kpi_field_id}>
                        {f.field_name} ({f.field_key})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Select Filter Subfield Column */}
                <div className="form-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>
                    Select Filter Column (Sub-field)
                  </label>
                  <select
                    value={selectedFieldId || ""}
                    onChange={(e) => setSelectedFieldId(Number(e.target.value) || null)}
                    className="form-control"
                    disabled={!selectedMliId || subFieldsLoading}
                  >
                    <option value="">
                      {subFieldsLoading ? "Loading columns..." : "-- Choose Column --"}
                    </option>
                    {subFields.map((sf) => (
                      <option key={sf.id} value={sf.id}>
                        {sf.label} ({sf.key})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedFieldId && (
                  <div
                    style={{
                      padding: "0.5rem 0.75rem",
                      backgroundColor: "rgba(37, 99, 235, 0.05)",
                      border: "1px dashed rgba(37, 99, 235, 0.2)",
                      borderRadius: "6px",
                      fontSize: "0.8rem",
                      color: "#1e3a8a",
                    }}
                  >
                    <strong>Preview Dynamic Condition:</strong>
                    <div style={{ fontFamily: "monospace", marginTop: "0.25rem", fontSize: "0.85rem" }}>
                      {mliFields.find(f => f.kpi_field_id === selectedMliId)?.field_key}.
                      {subFields.find(sf => sf.id === selectedFieldId)?.key} = loggedInUser.unique_user_key
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Confirm Button */}
          <button
            type="button"
            className="btn btn-primary"
            disabled={selectedUserIds.length === 0 || savingConfig}
            onClick={handleAssignBulk}
            style={{ width: "100%", padding: "0.75rem" }}
          >
            {savingConfig ? "Saving Config..." : `Assign Report to ${selectedUserIds.length} Users`}
          </button>
        </div>
      </div>

      {/* Currently Assigned Users List */}
      <div className="card" style={{ padding: "1.25rem" }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>Currently Assigned Users</h2>
        {Object.keys(assignments).length === 0 ? (
          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem" }}>
            No users have been assigned access to this report yet.
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.75rem 1rem", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--muted)" }}>User</th>
                  <th style={{ textAlign: "center", padding: "0.75rem 1rem", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--muted)" }}>View</th>
                  <th style={{ textAlign: "center", padding: "0.75rem 1rem", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--muted)" }}>Print</th>
                  <th style={{ textAlign: "center", padding: "0.75rem 1rem", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--muted)" }}>Export</th>
                  <th style={{ textAlign: "right", padding: "0.75rem 1rem", fontSize: "0.8rem", textTransform: "uppercase", color: "var(--muted)" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(assignments).map((assign) => (
                  <tr key={assign.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.75rem 1rem" }}>
                      <div style={{ fontWeight: 600 }}>{assign.user_name || `User ID: ${assign.user_id}`}</div>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Role: {assign.user_role || "USER"}</div>
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                      <input type="checkbox" checked={assign.can_view} disabled style={{ transform: "scale(1.1)" }} />
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                      <input type="checkbox" checked={assign.can_print} disabled style={{ transform: "scale(1.1)" }} />
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "center" }}>
                      <input type="checkbox" checked={assign.can_export} disabled style={{ transform: "scale(1.1)" }} />
                    </td>
                    <td style={{ padding: "0.75rem 1rem", textAlign: "right" }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => handleRemoveAll(assign.user_id)}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "var(--error)" }}
                      >
                        Unassign
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
