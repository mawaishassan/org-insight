"use client";

/**
 * Indeterminate progress bar shown while a report is loading for view/print.
 * Use wherever the user triggers "View report" or "Print / Export PDF".
 */

interface ReportLoadProgressProps {
  /** Short label, e.g. "Loading report…" or "Preparing report for view/print…" */
  label?: string;
  /** Optional extra class for the wrapper */
  className?: string;
  /** Compact: single line with small bar; default false = label above bar */
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
        <div className="report-load-progress-bar" style={{ flex: "0 0 120px" }}>
          <div className="report-load-progress-bar__fill" />
        </div>
        <span style={{ fontSize: "0.9rem", color: "var(--muted)" }}>{label}</span>
      </div>
    );
  }

  return (
    <div
      className={`report-load-progress ${className}`.trim()}
      role="status"
      aria-live="polite"
      style={{
        padding: "0.75rem 0",
        maxWidth: 360,
      }}
    >
      <p style={{ margin: "0 0 0.5rem 0", fontSize: "0.9rem", color: "var(--muted)" }}>{label}</p>
      <div className="report-load-progress-bar" style={{ width: "100%" }}>
        <div className="report-load-progress-bar__fill" />
      </div>
    </div>
  );
}
