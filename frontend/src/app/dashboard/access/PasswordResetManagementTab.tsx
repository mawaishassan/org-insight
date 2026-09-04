"use client";

import { useEffect, useState, useMemo } from "react";
import toast from "react-hot-toast";
import { api } from "@/lib/api";
import { PasswordResetAuditModal } from "./PasswordResetAuditModal";

export interface PasswordResetItem {
  user_id: number;
  username: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean;
  force_password_reset: boolean;
  reset_required: boolean;
  reset_status: "Pending" | "Completed" | "Not Required";
  requested_at: string | null;
  completed_at: string | null;
  requested_by_admin_name: string | null;
  requested_by_admin_id: number | null;
}

interface Props {
  token: string;
  orgId: number | null;
}

export function PasswordResetManagementTab({ token, orgId }: Props) {
  const [items, setItems] = useState<PasswordResetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "COMPLETED" | "NOT_REQUIRED" | "ALL_USERS">("ALL_USERS");
  const [searchQuery, setSearchQuery] = useState("");

  // Selection
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // Modals & Action States
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalAction, setConfirmModalAction] = useState<"force" | "cancel">("force");
  const [targetUserIds, setTargetUserIds] = useState<number[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Audit History Modal
  const [auditUser, setAuditUser] = useState<{ id: number; name: string } | null>(null);

  const fetchItems = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      let url = `/users/password-resets?status=${statusFilter}`;
      if (orgId) url += `&organization_id=${orgId}`;
      if (searchQuery.trim()) url += `&search=${encodeURIComponent(searchQuery.trim())}`;

      const res = await api<PasswordResetItem[]>(url, { token });
      setItems(res);
      // Clean selected ids that no longer exist
      setSelectedUserIds((prev) => prev.filter((id) => res.some((u) => u.user_id === id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load password resets.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchItems();
    }, searchQuery.trim() ? 300 : 0);
    return () => clearTimeout(timer);
  }, [token, orgId, statusFilter, searchQuery]);

  // Metrics calculation
  const metrics = useMemo(() => {
    const pending = items.filter((i) => i.reset_status === "Pending").length;
    const completed = items.filter((i) => i.reset_status === "Completed").length;
    const totalEnforced = items.filter((i) => i.reset_status !== "Not Required").length;
    return { pending, completed, totalEnforced, total: items.length };
  }, [items]);

  // Selection toggles
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedUserIds(items.map((i) => i.user_id));
    } else {
      setSelectedUserIds([]);
    }
  };

  const handleToggleSelect = (userId: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Trigger Force / Cancel confirmation
  const initiateAction = (userIds: number[], action: "force" | "cancel") => {
    setTargetUserIds(userIds);
    setConfirmModalAction(action);
    setShowConfirmModal(true);
  };

  const handleExecuteAction = async () => {
    if (!token || targetUserIds.length === 0) return;
    setIsProcessing(true);
    try {
      const res = await api<{ message: string; updated_count: number }>(
        "/users/force-password-reset",
        {
          method: "POST",
          body: JSON.stringify({
            user_ids: targetUserIds,
            force: confirmModalAction === "force",
            organization_id: orgId || null,
          }),
          token,
        }
      );
      toast.success(res.message || "Action completed successfully");
      setShowConfirmModal(false);
      setSelectedUserIds([]);
      fetchItems();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to execute action");
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-US", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {/* Header & Subtitle */}
      <div>
        <h2 style={{ fontSize: "1.2rem", fontWeight: 600, margin: "0 0 0.35rem 0" }}>
          Password Reset Management
        </h2>
        <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>
          Enforce mandatory password resets on user accounts, monitor pending vs completed resets, and maintain audit logs.
        </p>
      </div>

      {/* Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "1rem",
        }}
      >
        <div
          className="card"
          style={{
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            borderLeft: "4px solid var(--accent, #6366f1)",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Total Users
          </span>
          <span style={{ fontSize: "1.6rem", fontWeight: 700 }}>{metrics.total}</span>
        </div>

        <div
          className="card"
          style={{
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            borderLeft: "4px solid #f59e0b",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Pending Resets
          </span>
          <span style={{ fontSize: "1.6rem", fontWeight: 700, color: "#f59e0b" }}>
            {metrics.pending}
          </span>
        </div>

        <div
          className="card"
          style={{
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            borderLeft: "4px solid #10b981",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Completed Resets
          </span>
          <span style={{ fontSize: "1.6rem", fontWeight: 700, color: "#10b981" }}>
            {metrics.completed}
          </span>
        </div>

        <div
          className="card"
          style={{
            padding: "1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.25rem",
            borderLeft: "4px solid #8b5cf6",
          }}
        >
          <span style={{ fontSize: "0.8rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Total Enforced History
          </span>
          <span style={{ fontSize: "1.6rem", fontWeight: 700, color: "#8b5cf6" }}>
            {metrics.totalEnforced}
          </span>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        className="card"
        style={{
          padding: "0.85rem 1rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        {/* Status Filter Buttons */}
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {(
            [
              { key: "ALL_USERS", label: "All Users" },
              { key: "ALL", label: "All Reset Requests" },
              { key: "PENDING", label: "Pending" },
              { key: "COMPLETED", label: "Completed" },
              { key: "NOT_REQUIRED", label: "Not Required" },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className="btn"
                onClick={() => setStatusFilter(tab.key)}
                style={{
                  fontSize: "0.8rem",
                  padding: "0.3rem 0.65rem",
                  borderRadius: "6px",
                  background: active ? "var(--accent, #6366f1)" : "transparent",
                  color: active ? "var(--on-muted, #fff)" : "var(--text-secondary)",
                  border: active ? "1px solid var(--accent, #6366f1)" : "1px solid var(--border)",
                  fontWeight: active ? 600 : 500,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div style={{ minWidth: "240px", flex: "1 1 240px", maxWidth: "340px" }}>
          <input
            type="text"
            placeholder="Search by name, email, or username..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: "100%",
              padding: "0.4rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              fontSize: "0.85rem",
            }}
          />
        </div>
      </div>

      {/* Bulk Action Notification Bar (Sticky when items selected) */}
      {selectedUserIds.length > 0 && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            background: "rgba(99, 102, 241, 0.12)",
            border: "1px solid rgba(99, 102, 241, 0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "0.75rem",
          }}
        >
          <span style={{ fontSize: "0.9rem", fontWeight: 600, color: "var(--text)" }}>
            ✓ {selectedUserIds.length} user{selectedUserIds.length > 1 ? "s" : ""} selected
          </span>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
              onClick={() => initiateAction(selectedUserIds, "force")}
            >
              🔒 Force Password Reset
            </button>
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
              onClick={() => initiateAction(selectedUserIds, "cancel")}
            >
              Cancel Reset Requirement
            </button>
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.85rem", padding: "0.35rem 0.75rem" }}
              onClick={() => setSelectedUserIds([])}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* Main Table */}
      <section className="card" style={{ padding: 0, overflow: "hidden" }}>
        {error && (
          <div style={{ padding: "1rem", color: "#ef4444", background: "rgba(239, 68, 68, 0.06)", fontSize: "0.85rem", borderBottom: "1px solid var(--border)" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--muted)" }}>
            Loading user password reset data...
          </div>
        ) : error ? (
          <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--muted)" }}>
            <p style={{ margin: 0, fontSize: "0.95rem", color: "#ef4444" }}>Could not load data. Please try again or check permissions.</p>
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "3rem 1rem", textAlign: "center", color: "var(--muted)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔍</div>
            <p style={{ margin: 0, fontSize: "0.95rem" }}>No users match the current criteria.</p>
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ background: "var(--bg-subtle, rgba(255, 255, 255, 0.02))", borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "0.65rem 0.75rem", width: "40px" }}>
                    <input
                      type="checkbox"
                      checked={selectedUserIds.length === items.length && items.length > 0}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                      title="Select all"
                    />
                  </th>
                  <th style={{ padding: "0.65rem 0.75rem" }}>User Name</th>
                  <th style={{ padding: "0.65rem 0.75rem" }}>Email / Username</th>
                  <th style={{ padding: "0.65rem 0.75rem" }}>Reset Required</th>
                  <th style={{ padding: "0.65rem 0.75rem" }}>Reset Status</th>
                  <th style={{ padding: "0.65rem 0.75rem" }}>Reset Requested On</th>
                  <th style={{ padding: "0.65rem 0.75rem" }}>Reset Completed On</th>
                  <th style={{ padding: "0.65rem 0.75rem", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isSelected = selectedUserIds.includes(item.user_id);
                  let statusBg = "rgba(100, 116, 139, 0.15)";
                  let statusColor = "#94a3b8";

                  if (item.reset_status === "Pending") {
                    statusBg = "rgba(245, 158, 11, 0.15)";
                    statusColor = "#f59e0b";
                  } else if (item.reset_status === "Completed") {
                    statusBg = "rgba(16, 185, 129, 0.15)";
                    statusColor = "#10b981";
                  }

                  return (
                    <tr
                      key={item.user_id}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        background: isSelected ? "rgba(99, 102, 241, 0.05)" : undefined,
                      }}
                    >
                      <td style={{ padding: "0.65rem 0.75rem" }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(item.user_id)}
                        />
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem" }}>
                        <div style={{ fontWeight: 600 }}>{item.full_name || item.username}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>{item.role}</div>
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem" }}>
                        <div>{item.email || "—"}</div>
                        <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>@{item.username}</div>
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem" }}>
                        <span
                          style={{
                            padding: "0.15rem 0.45rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: item.reset_required ? "rgba(245, 158, 11, 0.15)" : "var(--border)",
                            color: item.reset_required ? "#f59e0b" : "var(--muted)",
                          }}
                        >
                          {item.reset_required ? "Yes" : "No"}
                        </span>
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.35rem",
                            padding: "0.2rem 0.55rem",
                            borderRadius: "999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: statusBg,
                            color: statusColor,
                          }}
                        >
                          <span
                            style={{
                              width: "6px",
                              height: "6px",
                              borderRadius: "50%",
                              background: statusColor,
                            }}
                          />
                          {item.reset_status}
                        </span>
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {formatDate(item.requested_at)}
                        {item.requested_by_admin_name && (
                          <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
                            by {item.requested_by_admin_name}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem", color: "var(--text-secondary)", whiteSpace: "nowrap" }}>
                        {formatDate(item.completed_at)}
                      </td>
                      <td style={{ padding: "0.65rem 0.75rem", textAlign: "right" }}>
                        <div style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
                          {item.reset_status === "Pending" ? (
                            <button
                              type="button"
                              className="btn"
                              style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem", color: "#ef4444" }}
                              onClick={() => initiateAction([item.user_id], "cancel")}
                              title="Cancel mandatory password reset"
                            >
                              Cancel Reset
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn"
                              style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
                              onClick={() => initiateAction([item.user_id], "force")}
                              title={item.reset_status === "Completed" ? "Force password reset again" : "Require password reset"}
                            >
                              {item.reset_status === "Completed" ? "Force Again" : "Force Reset"}
                            </button>
                          )}

                          <button
                            type="button"
                            className="btn"
                            style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
                            onClick={() => setAuditUser({ id: item.user_id, name: item.full_name || item.username })}
                            title="View audit trail"
                          >
                            History
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Confirmation Dialog Modal */}
      {showConfirmModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "1rem",
          }}
          onClick={() => !isProcessing && setShowConfirmModal(false)}
        >
          <div
            className="card"
            style={{
              width: "100%",
              maxWidth: "460px",
              padding: "1.75rem",
              borderRadius: "14px",
              background: "#ffffff",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
              border: "1px solid var(--border, #e2e8f0)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "1.2rem", fontWeight: 700, color: "#0f172a" }}>
              {confirmModalAction === "force"
                ? "Force Password Reset Confirmation"
                : "Cancel Password Reset Confirmation"}
            </h3>
            <p style={{ margin: "0 0 1.5rem 0", fontSize: "0.95rem", color: "#475569", lineHeight: 1.5 }}>
              {confirmModalAction === "force"
                ? `Are you sure you want to require the ${targetUserIds.length} selected user(s) to reset their passwords on their next login?`
                : `Are you sure you want to cancel the mandatory password reset requirement for the ${targetUserIds.length} selected user(s)?`}
            </p>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.6rem" }}>
              <button
                type="button"
                className="btn"
                disabled={isProcessing}
                onClick={() => setShowConfirmModal(false)}
                style={{
                  fontSize: "0.9rem",
                  padding: "0.45rem 1rem",
                  borderColor: "#cbd5e1",
                  color: "#334155",
                  background: "#ffffff",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isProcessing}
                onClick={handleExecuteAction}
                style={{
                  fontSize: "0.9rem",
                  padding: "0.45rem 1.1rem",
                  background: confirmModalAction === "force" ? "var(--primary, #2563eb)" : "#ef4444",
                  borderColor: confirmModalAction === "force" ? "var(--primary, #2563eb)" : "#ef4444",
                  color: "#ffffff",
                  fontWeight: 600,
                }}
              >
                {isProcessing ? "Processing..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Audit History Modal */}
      {auditUser && (
        <PasswordResetAuditModal
          userId={auditUser.id}
          userName={auditUser.name}
          token={token}
          orgId={orgId}
          onClose={() => setAuditUser(null)}
        />
      )}
    </div>
  );
}
