"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { WidgetSpinnerLoader } from "@/components/WidgetSpinnerLoader";

interface DashboardRow {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
}

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  unique_user_key: string | null;
}

interface FilterColumnItem {
  kpi_id: number;
  kpi_title: string;
  mli_id: number;
  mli_title: string;
  sub_field_id: number;
  sub_field_key: string;
  label: string;
}

function qs(params: Record<string, string | number | undefined>) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v)] as [string, string]);
  return new URLSearchParams(entries).toString();
}

export default function BulkDashboardAssignPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preSelectedDashboardId = searchParams.get("dashboard_id")
    ? Number(searchParams.get("dashboard_id"))
    : null;
  const token = getAccessToken();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dashboards, setDashboards] = useState<DashboardRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);

  // Selection states
  const [selectedDashboardIds, setSelectedDashboardIds] = useState<number[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // Filtering / Search states
  const [dashboardQuery, setDashboardQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState("ALL");

  // Step 3 & 4: Permission & Filtering Config
  const [canLoadLms, setCanLoadLms] = useState(true);
  const [canChangePeriod, setCanChangePeriod] = useState(true);
  const [canUseUniqueValue, setCanUseUniqueValue] = useState(false);

  // Available filter columns across selected dashboards
  const [availableColumns, setAvailableColumns] = useState<FilterColumnItem[]>([]);
  const [selectedFilterColumns, setSelectedFilterColumns] = useState<Record<string, string>>({});
  const [loadingColumns, setLoadingColumns] = useState(false);

  // Current active step (1 to 6)
  const [currentStep, setCurrentStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);

    Promise.all([
      api<DashboardRow[]>("/dashboards", { token }),
      api<UserRow[]>("/users", { token }),
    ])
      .then(([dList, uList]) => {
        setDashboards(dList);
        setUsers(uList);
        if (preSelectedDashboardId && dList.some((d) => d.id === preSelectedDashboardId)) {
          setSelectedDashboardIds([preSelectedDashboardId]);
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load assignment data"))
      .finally(() => setLoading(false));
  }, [token, preSelectedDashboardId]);

  // Fetch filterable columns when selected dashboards change
  useEffect(() => {
    if (!token || selectedDashboardIds.length === 0) {
      setAvailableColumns([]);
      return;
    }
    setLoadingColumns(true);

    Promise.all(
      selectedDashboardIds.map((dId) =>
        api<FilterColumnItem[]>(`/dashboards/${dId}/filter-columns`, { token }).catch(() => [])
      )
    )
      .then((colLists) => {
        const merged: FilterColumnItem[] = [];
        const seen = new Set<string>();
        colLists.forEach((list) => {
          list.forEach((col) => {
            const key = `${col.kpi_id}_${col.mli_id}_${col.sub_field_key}`;
            if (!seen.has(key)) {
              seen.add(key);
              merged.push(col);
            }
          });
        });
        setAvailableColumns(merged);
        setSelectedFilterColumns((prev) => {
          const next = { ...prev };
          merged.forEach((col) => {
            const groupKey = `${col.kpi_id}_${col.mli_id}`;
            if (!next[groupKey]) {
              const k = col.sub_field_key.toLowerCase();
              if (k === "department" || k === "department_name" || k.includes("dept") || k === "campus") {
                next[groupKey] = col.sub_field_key;
              }
            }
          });
          return next;
        });
      })
      .finally(() => setLoadingColumns(false));
  }, [token, selectedDashboardIds]);

  const filteredDashboards = useMemo(() => {
    const q = dashboardQuery.trim().toLowerCase();
    if (!q) return dashboards;
    return dashboards.filter((d) => d.name.toLowerCase().includes(q));
  }, [dashboards, dashboardQuery]);

  const filteredUsers = useMemo(() => {
    let list = users;
    if (userRoleFilter !== "ALL") {
      list = list.filter((u) => u.role === userRoleFilter);
    }
    const q = userQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) =>
          (u.full_name || "").toLowerCase().includes(q) ||
          (u.email || "").toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          (u.unique_user_key || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, userQuery, userRoleFilter]);

  const mliGroups = useMemo(() => {
    const map = new Map<string, { kpi_title: string; mli_title: string; kpi_id: number; mli_id: number; columns: FilterColumnItem[] }>();
    availableColumns.forEach((col) => {
      const key = `${col.kpi_id}_${col.mli_id}`;
      if (!map.has(key)) {
        map.set(key, {
          kpi_title: col.kpi_title,
          mli_title: col.mli_title,
          kpi_id: col.kpi_id,
          mli_id: col.mli_id,
          columns: [],
        });
      }
      map.get(key)!.columns.push(col);
    });
    return Array.from(map.values());
  }, [availableColumns]);

  const handleToggleDashboard = (id: number) => {
    setSelectedDashboardIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllDashboards = () => {
    if (selectedDashboardIds.length === filteredDashboards.length) {
      setSelectedDashboardIds([]);
    } else {
      setSelectedDashboardIds(filteredDashboards.map((d) => d.id));
    }
  };

  const handleToggleUser = (id: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllUsers = () => {
    if (selectedUserIds.length === filteredUsers.length) {
      setSelectedUserIds([]);
    } else {
      setSelectedUserIds(filteredUsers.map((u) => u.id));
    }
  };

  const handleAssignSubmit = async () => {
    if (selectedDashboardIds.length === 0) {
      toast.error("Please select at least one dashboard");
      return;
    }
    if (selectedUserIds.length === 0) {
      toast.error("Please select at least one user");
      return;
    }

    setSubmitting(true);
    try {
      let targetKpiId: number | null = null;
      let targetMliId: number | null = null;
      let primaryFilterCol: string | null = null;
      if (canUseUniqueValue) {
        for (const [groupKey, colKey] of Object.entries(selectedFilterColumns)) {
          if (colKey) {
            const col = availableColumns.find(
              (c) => `${c.kpi_id}_${c.mli_id}` === groupKey && c.sub_field_key === colKey
            );
            if (col && !primaryFilterCol) {
              primaryFilterCol = colKey;
              targetKpiId = col.kpi_id;
              targetMliId = col.mli_id;
            }
          }
        }
      }

      const res = await api<{ message: string; assigned_count: number }>("/dashboards/bulk-assign", {
        method: "POST",
        token,
        body: JSON.stringify({
          dashboard_ids: selectedDashboardIds,
          user_ids: selectedUserIds,
          can_view: true,
          can_edit: false,
          can_load_lms: canLoadLms,
          can_change_period: canChangePeriod,
          can_use_unique_value: canUseUniqueValue,
          filter_kpi_id: targetKpiId,
          filter_mli_id: targetMliId,
          filter_sub_field_key: canUseUniqueValue ? primaryFilterCol : null,
          filter_column_configs: canUseUniqueValue ? selectedFilterColumns : null,
          filter_operator: "=",
        }),
      });

      toast.success(res.message || "Dashboards assigned successfully!");
      router.push("/dashboard/dashboards");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk assignment failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <WidgetSpinnerLoader text="Loading assignment wizard..." minHeight={300} />;
  if (error) return <p className="form-error">{error}</p>;

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.5rem" }}>
        <Link href="/dashboard/dashboards" style={{ fontSize: "0.875rem", color: "var(--primary)" }}>
          ← Back to Dashboards
        </Link>
        <h1 style={{ marginTop: "0.5rem", fontSize: "1.65rem", fontWeight: 700 }}>
          👥 Bulk Dashboard Assignment & Access Control
        </h1>
        <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.9rem" }}>
          Assign dashboards to multiple end users in bulk with user-specific data filtering and configurable permissions.
        </p>
      </div>

      {/* Step Indicator Header */}
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          marginBottom: "1.5rem",
          overflowX: "auto",
          paddingBottom: "0.5rem",
        }}
      >
        {[
          { step: 1, title: "1. Select Dashboards" },
          { step: 2, title: "2. Select Users" },
          { step: 3, title: "3. Allow Unique User Key Based Filtering" },
          { step: 4, title: "4. Permissions" },
          { step: 5, title: "5. Review" },
          { step: 6, title: "6. Assign" },
        ].map((s) => {
          const isActive = currentStep === s.step;
          const isDone = currentStep > s.step;
          return (
            <button
              key={s.step}
              type="button"
              onClick={() => setCurrentStep(s.step)}
              style={{
                flex: "1 1 0",
                minWidth: 120,
                padding: "0.5rem 0.75rem",
                borderRadius: 8,
                border: "1px solid",
                borderColor: isActive ? "var(--primary)" : isDone ? "#10b981" : "var(--border)",
                background: isActive ? "var(--primary-bg, #eff6ff)" : isDone ? "#f0fdf4" : "var(--surface)",
                color: isActive ? "var(--primary)" : isDone ? "#047857" : "var(--muted)",
                fontWeight: isActive || isDone ? 600 : 500,
                fontSize: "0.825rem",
                cursor: "pointer",
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {isDone ? "✓ " : ""}{s.title}
            </button>
          );
        })}
      </div>

      {/* Step 1: Select Dashboards */}
      {currentStep === 1 && (
        <div className="card">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Step 1: Select Dashboard(s)
          </h2>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <input
              type="text"
              className="form-control"
              placeholder="Search dashboards by name..."
              value={dashboardQuery}
              onChange={(e) => setDashboardQuery(e.target.value)}
              style={{ flex: "1 1 240px", padding: "0.45rem 0.75rem" }}
            />
            <button type="button" className="btn btn-secondary" onClick={handleSelectAllDashboards}>
              {selectedDashboardIds.length === filteredDashboards.length ? "Deselect All" : "Select All"}
            </button>
          </div>

          <div style={{ display: "grid", gap: "0.5rem", maxHeight: 340, overflowY: "auto" }}>
            {filteredDashboards.map((d) => {
              const isSelected = selectedDashboardIds.includes(d.id);
              return (
                <label
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    padding: "0.75rem 1rem",
                    borderRadius: 8,
                    border: "1px solid",
                    borderColor: isSelected ? "var(--primary)" : "var(--border)",
                    background: isSelected ? "var(--primary-bg, #eff6ff)" : "var(--surface)",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleDashboard(d.id)}
                    style={{ width: 18, height: 18 }}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>{d.name}</div>
                    {d.description && <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{d.description}</div>}
                  </div>
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
              Selected: <strong>{selectedDashboardIds.length}</strong> dashboard(s)
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedDashboardIds.length === 0}
              onClick={() => setCurrentStep(2)}
            >
              Next: Select Users →
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Select Users */}
      {currentStep === 2 && (
        <div className="card">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Step 2: Select End Users
          </h2>
          <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
            <input
              type="text"
              className="form-control"
              placeholder="Search by name, email, username, or key..."
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              style={{ flex: "1 1 240px", padding: "0.45rem 0.75rem" }}
            />
            <select
              value={userRoleFilter}
              onChange={(e) => setUserRoleFilter(e.target.value)}
              style={{ padding: "0.45rem 0.75rem", borderRadius: 6, border: "1px solid var(--border)" }}
            >
              <option value="ALL">All Roles</option>
              <option value="USER">USER</option>
              <option value="ORG_ADMIN">ORG_ADMIN</option>
            </select>
            <button type="button" className="btn btn-secondary" onClick={handleSelectAllUsers}>
              {selectedUserIds.length === filteredUsers.length ? "Deselect All" : "Select All"}
            </button>
          </div>

          <div style={{ maxHeight: 340, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "0.6rem 0.75rem", width: 40 }}>Select</th>
                  <th style={{ padding: "0.6rem 0.75rem" }}>Full Name / Username</th>
                  <th style={{ padding: "0.6rem 0.75rem" }}>Email</th>
                  <th style={{ padding: "0.6rem 0.75rem" }}>Role</th>
                  <th style={{ padding: "0.6rem 0.75rem" }}>Unique User Key</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((u) => {
                  const isSelected = selectedUserIds.includes(u.id);
                  return (
                    <tr
                      key={u.id}
                      onClick={() => handleToggleUser(u.id)}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background: isSelected ? "#eff6ff" : "transparent",
                        cursor: "pointer",
                      }}
                    >
                      <td style={{ padding: "0.6rem 0.75rem" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ width: 16, height: 16 }}
                        />
                      </td>
                      <td style={{ padding: "0.6rem 0.75rem", fontWeight: 500 }}>
                        {u.full_name || u.username}
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>@{u.username}</div>
                      </td>
                      <td style={{ padding: "0.6rem 0.75rem" }}>{u.email || "—"}</td>
                      <td style={{ padding: "0.6rem 0.75rem" }}>{u.role}</td>
                      <td style={{ padding: "0.6rem 0.75rem" }}>
                        {u.unique_user_key ? (
                          <span
                            style={{
                              background: "#e0f2fe",
                              color: "#0369a1",
                              padding: "0.15rem 0.5rem",
                              borderRadius: 4,
                              fontSize: "0.8rem",
                              fontWeight: 600,
                            }}
                          >
                            {u.unique_user_key}
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "0.8rem" }}>None</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(1)}>
              ← Back
            </button>
            <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
              Selected: <strong>{selectedUserIds.length}</strong> user(s)
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={selectedUserIds.length === 0}
              onClick={() => setCurrentStep(3)}
            >
              Next: Configure Key Filtering →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Configure Unique User Key Filtering */}
      {currentStep === 3 && (
        <div className="card">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Step 3: Allow Unique User Key Based Filtering
          </h2>
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", marginBottom: "1.25rem" }}>
            Automatically restrict dashboard data rows so end users only view graphs and numbers matching their assigned Unique User Key.
          </p>

          <div
            style={{
              padding: "1rem",
              background: "#f8fafc",
              borderRadius: 8,
              border: "1px solid var(--border)",
              marginBottom: "1.25rem",
            }}
          >
            <label style={{ display: "flex", alignItems: "center", gap: "0.75rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={canUseUniqueValue}
                onChange={(e) => setCanUseUniqueValue(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              <span style={{ fontWeight: 600, fontSize: "0.95rem" }}>
                Allow Unique User Key Based Filtering
              </span>
            </label>
          </div>

          {canUseUniqueValue && (
            <div style={{ display: "grid", gap: "1rem" }}>
              <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#1e293b" }}>
                Multi-Line Items (MLIs) in selected dashboard(s) — select matching column per MLI:
              </div>
              {loadingColumns ? (
                <p style={{ fontSize: "0.875rem", color: "var(--muted)" }}>Analyzing dashboard KPI multi-line fields...</p>
              ) : mliGroups.length === 0 ? (
                <p style={{ fontSize: "0.875rem", color: "#dc2626" }}>
                  No multi-line fields found in selected dashboard(s).
                </p>
              ) : (
                mliGroups.map((group) => (
                  <div
                    key={`${group.kpi_id}_${group.mli_id}`}
                    style={{
                      padding: "1rem",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      background: "var(--surface)",
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--primary)", marginBottom: "0.5rem" }}>
                      📊 KPI: {group.kpi_title} | Multi-Line Field: {group.mli_title}
                    </div>
                    <label style={{ display: "block", fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.4rem" }}>
                      Select column to match against user's Unique User Key:
                    </label>
                    <select
                      value={selectedFilterColumns[`${group.kpi_id}_${group.mli_id}`] || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        const gKey = `${group.kpi_id}_${group.mli_id}`;
                        setSelectedFilterColumns((prev) => ({
                          ...prev,
                          [gKey]: val,
                        }));
                      }}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        fontSize: "0.875rem",
                        background: "var(--bg)",
                      }}
                    >
                      <option value="">Do not filter (Show all data for this MLI)</option>
                      {group.columns.map((col) => (
                        <option key={col.sub_field_key} value={col.sub_field_key}>
                          {col.sub_field_key} — ({col.label})
                        </option>
                      ))}
                    </select>
                  </div>
                ))
              )}

              <div
                style={{
                  marginTop: "0.5rem",
                  padding: "0.75rem 1rem",
                  background: "#eff6ff",
                  border: "1px solid #bfdbfe",
                  borderRadius: 8,
                  fontSize: "0.85rem",
                  color: "#1e40af",
                }}
              >
                💡 <strong>How it works:</strong> When logged-in end users view this dashboard, all graphs, calculations, averages, and totals will be calculated ONLY using rows where the selected MLI column equals the user's <strong>Unique User Key</strong>.
              </div>
            </div>
          )}

          <div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(2)}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCurrentStep(4)}>
              Next: Configure Permissions →
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Configure Permissions */}
      {currentStep === 4 && (
        <div className="card">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Step 4: Dashboard Feature Permissions
          </h2>
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", marginBottom: "1.25rem" }}>
            Configure dashboard permissions for end users during assignment.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Permission A: LMS Load Button */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "1rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>A. LMS Load Button Allowed</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Allow end users to click "Load Latest LMS Data" button to trigger LMS sync.
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={canLoadLms}
                  onChange={(e) => setCanLoadLms(e.target.checked)}
                  style={{ width: 20, height: 20 }}
                />
                <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{canLoadLms ? "Allowed" : "Disallowed"}</span>
              </label>
            </div>

            {/* Permission B: Period Shifting */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "1rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>B. Period Shifting Allowed</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Allow end users to select different reporting types & years. If disallowed, user is locked to Super Admin default period.
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={canChangePeriod}
                  onChange={(e) => setCanChangePeriod(e.target.checked)}
                  style={{ width: 20, height: 20 }}
                />
                <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{canChangePeriod ? "Allowed" : "Disallowed"}</span>
              </label>
            </div>

            {/* Permission C: Unique Cell Value */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "1rem",
                border: "1px solid var(--border)",
                borderRadius: 8,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.95rem" }}>C. Unique Cell Value Filtering Allowed</div>
                <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Apply user-specific unique key value for automatic data filtering.
                </div>
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={canUseUniqueValue}
                  onChange={(e) => setCanUseUniqueValue(e.target.checked)}
                  style={{ width: 20, height: 20 }}
                />
                <span style={{ fontWeight: 600, fontSize: "0.875rem" }}>{canUseUniqueValue ? "Allowed" : "Disallowed"}</span>
              </label>
            </div>
          </div>

          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(3)}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCurrentStep(5)}>
              Next: Review Summary →
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Review Assignment Summary */}
      {currentStep === 5 && (
        <div className="card">
          <h2 style={{ fontSize: "1.15rem", fontWeight: 600, marginBottom: "0.75rem" }}>
            Step 5: Review Assignment Summary
          </h2>
          <p style={{ fontSize: "0.875rem", color: "var(--muted)", marginBottom: "1.25rem" }}>
            Verify your bulk assignment configuration before finalizing.
          </p>

          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                Selected Dashboard(s) ({selectedDashboardIds.length}):
              </h3>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.875rem" }}>
                {dashboards
                  .filter((d) => selectedDashboardIds.includes(d.id))
                  .map((d) => (
                    <li key={d.id}>
                      <strong>{d.name}</strong> (ID: {d.id})
                    </li>
                  ))}
              </ul>
            </div>

            <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                Selected End User(s) ({selectedUserIds.length}):
              </h3>
              <ul style={{ margin: 0, paddingLeft: "1.2rem", fontSize: "0.875rem", maxHeight: 150, overflowY: "auto" }}>
                {users
                  .filter((u) => selectedUserIds.includes(u.id))
                  .map((u) => (
                    <li key={u.id}>
                      {u.full_name || u.username} ({u.email || "No email"}) — Key:{" "}
                      <strong>{u.unique_user_key || "None"}</strong>
                    </li>
                  ))}
              </ul>
            </div>

            <div style={{ padding: "1rem", background: "#f8fafc", borderRadius: 8, border: "1px solid var(--border)" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 600, marginBottom: "0.5rem" }}>Configured Permissions:</h3>
              <table style={{ width: "100%", fontSize: "0.875rem" }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "0.25rem 0", color: "var(--muted)" }}>LMS Load Button:</td>
                    <td style={{ fontWeight: 600 }}>{canLoadLms ? "✅ Allowed" : "❌ Disallowed"}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "0.25rem 0", color: "var(--muted)" }}>Period Shifting:</td>
                    <td style={{ fontWeight: 600 }}>{canChangePeriod ? "✅ Allowed" : "❌ Locked to Default"}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "0.25rem 0", color: "var(--muted)" }}>Unique Cell Value Filter:</td>
                    <td style={{ fontWeight: 600 }}>
                      {canUseUniqueValue
                        ? `✅ Active (${Object.values(selectedFilterColumns).filter(Boolean).length} MLIs configured)`
                        : "❌ Disabled"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(4)}>
              ← Back
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setCurrentStep(6)}>
              Proceed to Assign →
            </button>
          </div>
        </div>
      )}

      {/* Step 6: Assign Dashboard */}
      {currentStep === 6 && (
        <div className="card" style={{ textAlign: "center", padding: "2.5rem 1.5rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>🚀</div>
          <h2 style={{ fontSize: "1.35rem", fontWeight: 700, marginBottom: "0.5rem" }}>Ready to Assign Dashboards</h2>
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", maxWidth: 520, margin: "0 auto 1.5rem" }}>
            Clicking the button below will create and update dashboard access permissions for{" "}
            <strong>{selectedUserIds.length} users</strong> across <strong>{selectedDashboardIds.length} dashboards</strong>.
          </p>

          <div style={{ display: "flex", justifyContent: "center", gap: "1rem" }}>
            <button type="button" className="btn btn-secondary" onClick={() => setCurrentStep(5)} disabled={submitting}>
              ← Review Plan
            </button>
            <button type="button" className="btn btn-primary" onClick={handleAssignSubmit} disabled={submitting}>
              {submitting ? "Assigning Dashboards..." : "Submit & Assign Dashboards"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
