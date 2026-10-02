"use client";

/**
 * Unified spinner loader shown while a report is loading for view/print.
 * Use wherever the user triggers "View report" or "Print / Export PDF".
 */

interface ReportLoadProgressProps {
  /** Short label, e.g. "Loading report…" or "Preparing report for view/print…" */
  label?: string;
  /** Optional extra class for the wrapper */
  className?: string;
  /** Compact: inline with small spinner */
  compact?: boolean;
}

export function ReportLoadProgress({
  label = "Loading report…",
  className = "",
  compact = false,
}: ReportLoadProgressProps) {
  if (compact) {
    return (
      <div
        className={`report-load-progress-inline ${className}`.trim()}
        role="status"
        aria-live="polite"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.5rem",
          flexWrap: "wrap",
        }}
      >
        <div className="effective-spinner effective-spinner--sm" style={{ width: 16, height: 16 }} />
        <span style={{ fontSize: "0.875rem", color: "var(--muted)", fontWeight: 500 }}>{label}</span>
      </div>
    );
  }

  return (
    <div
      className={`report-load-progress ${className}`.trim()}
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.75rem",
        padding: "0.75rem 1rem",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "8px",
        maxWidth: 420,
      }}
    >
      <div className="effective-spinner effective-spinner--sm" style={{ width: 20, height: 20 }} />
      <span style={{ fontSize: "0.9rem", color: "var(--text)", fontWeight: 500 }}>{label}</span>
    </div>
  );
}
