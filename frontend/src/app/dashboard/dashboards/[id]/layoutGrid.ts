import type { CSSProperties } from "react";

/** Tracks for CSS grid; widgets use `col_span` (1–12) or `full_width` for a full row. */
export const DASHBOARD_GRID_COLUMNS = 12;

export function widgetGridColumnStyle(widget: { full_width?: boolean; col_span?: number }): CSSProperties {
  if (widget.full_width) return { gridColumn: "1 / -1" };
  const raw = typeof widget.col_span === "number" ? widget.col_span : 6;
  const span = Math.max(1, Math.min(DASHBOARD_GRID_COLUMNS, Math.round(raw)));
  return { gridColumn: `span ${span}` };
}

export function effectiveColSpan(widget: { full_width?: boolean; col_span?: number }): number {
  if (widget.full_width) return DASHBOARD_GRID_COLUMNS;
  const raw = typeof widget.col_span === "number" ? widget.col_span : 6;
  return Math.max(1, Math.min(DASHBOARD_GRID_COLUMNS, Math.round(raw)));
}
