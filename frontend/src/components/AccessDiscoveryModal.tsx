"use client";

import React from "react";
import Link from "next/link";
import { AccessibleItem } from "@/lib/accessTracker";

interface AccessDiscoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAcknowledgeAll: () => void;
  allDashboards: AccessibleItem[];
  newDashboards: AccessibleItem[];
  allReports: AccessibleItem[];
  newReports: AccessibleItem[];
  orgId?: number | null;
}

export function AccessDiscoveryModal({
  isOpen,
  onClose,
  onAcknowledgeAll,
  allDashboards,
  newDashboards,
  allReports,
  newReports,
  orgId,
}: AccessDiscoveryModalProps) {
  if (!isOpen) return null;

  const newDashIds = new Set(newDashboards.map((d) => d.id));
  const newReportIds = new Set(newReports.map((r) => r.id));
  const totalNew = newDashboards.length + newReports.length;

  const handleAcknowledgeAndClose = () => {
    onAcknowledgeAll();
    onClose();
  };

  const orgQuery = orgId ? `?organization_id=${orgId}` : "";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.55)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        padding: "1rem",
      }}
      onClick={handleAcknowledgeAndClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "540px",
          background: "var(--surface, #ffffff)",
          borderRadius: "14px",
          border: "1px solid var(--border, #e2e8f0)",
          boxShadow: "0 20px 40px -10px rgba(0, 0, 0, 0.22)",
          overflow: "hidden",
          animation: "modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: "1.25rem 1.5rem",
            borderBottom: "1px solid var(--border, #e2e8f0)",
            background: "linear-gradient(135deg, rgba(59, 130, 246, 0.08) 0%, rgba(99, 102, 241, 0.04) 100%)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "var(--text, #0f172a)" }}>
                Workspace Access Updates
              </h3>
              {totalNew > 0 && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    padding: "2px 8px",
                    borderRadius: "9999px",
                    background: "var(--accent, #2563eb)",
                    color: "#ffffff",
                    letterSpacing: "0.02em",
                  }}
                >
                  +{totalNew} New
                </span>
              )}
            </div>
            <p style={{ margin: "0.35rem 0 0", fontSize: "0.85rem", color: "var(--muted, #64748b)", lineHeight: 1.4 }}>
              Your administrator has updated your access permissions. Here are the items available in your workspace:
            </p>
          </div>
          <button
            type="button"
            onClick={handleAcknowledgeAndClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0.25rem",
              color: "var(--muted, #64748b)",
              fontSize: "1.2rem",
              lineHeight: 1,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: "1.25rem 1.5rem", maxHeight: "60vh", overflowY: "auto" }}>
          {/* Dashboards Section */}
          <div style={{ marginBottom: "1.25rem" }}>
            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted, #64748b)",
                marginBottom: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>Dashboards</span>
              <span style={{ fontWeight: 500, fontSize: "0.75rem" }}>({allDashboards.length})</span>
            </div>
            {allDashboards.length === 0 ? (
              <div style={{ fontSize: "0.85rem", color: "var(--muted, #64748b)", fontStyle: "italic", padding: "0.4rem 0" }}>
                No dashboards currently assigned.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {allDashboards.map((dash) => {
                  const isNew = newDashIds.has(dash.id);
                  return (
                    <Link
                      key={dash.id}
                      href={`/dashboard/dashboards/${dash.id}${orgQuery}`}
                      onClick={handleAcknowledgeAndClose}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.6rem 0.85rem",
                        borderRadius: "8px",
                        border: isNew ? "1px solid rgba(59, 130, 246, 0.4)" : "1px solid var(--border, #e2e8f0)",
                        background: isNew ? "rgba(59, 130, 246, 0.05)" : "var(--surface, #ffffff)",
                        textDecoration: "none",
                        color: "var(--text, #0f172a)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span style={{ fontSize: "0.88rem", fontWeight: isNew ? 600 : 500 }}>
                          {dash.name}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        {isNew && (
                          <span
                            style={{
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: "rgba(37, 99, 235, 0.12)",
                              color: "var(--accent, #2563eb)",
                            }}
                          >
                            NEW ACCESS
                          </span>
                        )}
                        <span style={{ fontSize: "0.8rem", color: "var(--accent, #2563eb)", fontWeight: 600 }}>
                          Open →
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {/* Reports Section */}
          <div>
            <div
              style={{
                fontSize: "0.78rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted, #64748b)",
                marginBottom: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
              }}
            >
              <span>Reports</span>
              <span style={{ fontWeight: 500, fontSize: "0.75rem" }}>({allReports.length})</span>
            </div>
            {allReports.length === 0 ? (
              <div style={{ fontSize: "0.85rem", color: "var(--muted, #64748b)", fontStyle: "italic", padding: "0.4rem 0" }}>
                No reports currently assigned.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {allReports.map((report) => {
                  const isNew = newReportIds.has(report.id);
                  return (
                    <Link
                      key={report.id}
                      href={`/dashboard/reports${orgQuery}`}
                      onClick={handleAcknowledgeAndClose}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "0.6rem 0.85rem",
                        borderRadius: "8px",
                        border: isNew ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid var(--border, #e2e8f0)",
                        background: isNew ? "rgba(16, 185, 129, 0.05)" : "var(--surface, #ffffff)",
                        textDecoration: "none",
                        color: "var(--text, #0f172a)",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                        <span style={{ fontSize: "0.88rem", fontWeight: isNew ? 600 : 500 }}>
                          {report.name}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                        {isNew && (
                          <span
                            style={{
                              fontSize: "0.68rem",
                              fontWeight: 700,
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: "rgba(16, 185, 129, 0.12)",
                              color: "#059669",
                            }}
                          >
                            NEW ACCESS
                          </span>
                        )}
                        <span style={{ fontSize: "0.8rem", color: "var(--accent, #2563eb)", fontWeight: 600 }}>
                          View →
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: "0.85rem 1.5rem",
            background: "rgba(0, 0, 0, 0.02)",
            borderTop: "1px solid var(--border, #e2e8f0)",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.75rem",
          }}
        >
          <button
            type="button"
            onClick={handleAcknowledgeAndClose}
            className="btn btn-primary btn-sm"
            style={{ minWidth: "120px" }}
          >
            Got it, continue
          </button>
        </div>
      </div>
    </div>
  );
}
