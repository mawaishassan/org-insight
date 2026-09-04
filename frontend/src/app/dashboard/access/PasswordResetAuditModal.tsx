"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface AuditRecord {
  id: number;
  user_id: number;
  username: string;
  admin_id: number | null;
  admin_name: string | null;
  status: string; // PENDING, COMPLETED, CANCELLED
  requested_at: string;
  completed_at: string | null;
  cancelled_at: string | null;
}

interface Props {
  userId: number;
  userName: string;
  token: string;
  orgId?: number | null;
  onClose: () => void;
}

export function PasswordResetAuditModal({
  userId,
  userName,
  token,
  orgId,
  onClose,
}: Props) {
  const [history, setHistory] = useState<AuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let url = `/users/${userId}/password-reset-history`;
    if (orgId) {
      url += `?organization_id=${orgId}`;
    }
    setLoading(true);
    setError(null);
    api<AuditRecord[]>(url, { token })
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load audit history."))
      .finally(() => setLoading(false));
  }, [userId, orgId, token]);

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
      onClick={onClose}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: "680px",
          maxHeight: "85vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "14px",
          padding: "1.5rem",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          border: "1px solid var(--border, #e2e8f0)",
          background: "#ffffff",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: "1.25rem",
            paddingBottom: "0.75rem",
            borderBottom: "1px solid var(--border)",
          }}
        >
          <div>
            <h3 style={{ margin: "0 0 0.25rem", fontSize: "1.15rem", fontWeight: 600 }}>
              Password Reset Audit Trail
            </h3>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
              Detailed event history for user: <strong style={{ color: "var(--text)" }}>{userName}</strong>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.25rem",
              cursor: "pointer",
              color: "var(--muted)",
              lineHeight: 1,
              padding: "0.25rem",
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Content */}
        <div style={{ flex: 1, overflowY: "auto", minHeight: "160px" }}>
          {loading && (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
              Loading audit history...
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "0.75rem",
                borderRadius: "8px",
                background: "rgba(239, 68, 68, 0.1)",
                color: "#ef4444",
                fontSize: "0.85rem",
                marginBottom: "1rem",
              }}
            >
              {error}
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--muted)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📋</div>
              <p style={{ margin: 0, fontSize: "0.9rem" }}>
                No password reset history recorded for this user yet.
              </p>
            </div>
          )}

          {!loading && !error && history.length > 0 && (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "0.85rem",
              }}
            >
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left", color: "var(--muted)" }}>
                  <th style={{ padding: "0.5rem" }}>Date Enforced</th>
                  <th style={{ padding: "0.5rem" }}>Initiated By</th>
                  <th style={{ padding: "0.5rem" }}>Status</th>
                  <th style={{ padding: "0.5rem" }}>Completed Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((record) => {
                  let badgeBg = "rgba(100, 116, 139, 0.15)";
                  let badgeColor = "#94a3b8";
                  let statusText = record.status;

                  if (record.status === "PENDING") {
                    badgeBg = "rgba(245, 158, 11, 0.15)";
                    badgeColor = "#f59e0b";
                    statusText = "Pending";
                  } else if (record.status === "COMPLETED") {
                    badgeBg = "rgba(16, 185, 129, 0.15)";
                    badgeColor = "#10b981";
                    statusText = "Completed";
                  } else if (record.status === "CANCELLED") {
                    badgeBg = "rgba(239, 68, 68, 0.12)";
                    badgeColor = "#ef4444";
                    statusText = "Cancelled";
                  }

                  return (
                    <tr key={record.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.6rem 0.5rem", whiteSpace: "nowrap" }}>
                        {formatDate(record.requested_at)}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem" }}>
                        {record.admin_name || "Organizational Admin"}
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem" }}>
                        <span
                          style={{
                            display: "inline-block",
                            padding: "0.15rem 0.5rem",
                            borderRadius: "999px",
                            fontSize: "0.75rem",
                            fontWeight: 600,
                            background: badgeBg,
                            color: badgeColor,
                          }}
                        >
                          {statusText}
                        </span>
                      </td>
                      <td style={{ padding: "0.6rem 0.5rem", whiteSpace: "nowrap", color: "var(--muted)" }}>
                        {record.status === "CANCELLED"
                          ? `Cancelled on ${formatDate(record.cancelled_at)}`
                          : formatDate(record.completed_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            marginTop: "1.25rem",
            paddingTop: "0.75rem",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <button type="button" className="btn" onClick={onClose} style={{ fontSize: "0.85rem", padding: "0.4rem 0.9rem" }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
