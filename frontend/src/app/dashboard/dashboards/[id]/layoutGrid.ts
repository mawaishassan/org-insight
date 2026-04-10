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

/** Row / column segment for one widget, matching CSS grid auto-flow used in the dashboard. */
export type WidgetPlacement = {
  id: string;
  row: number;
  colStart: number;
  colEnd: number;
};

function columnOverlap(a: WidgetPlacement, b: WidgetPlacement): number {
  const lo = Math.max(a.colStart, b.colStart);
  const hi = Math.min(a.colEnd, b.colEnd);
  return Math.max(0, hi - lo);
}

export function computeWidgetPlacements(
  widgets: ReadonlyArray<{ id: string; full_width?: boolean; col_span?: number }>
): WidgetPlacement[] {
  let row = 0;
  let col = 0;
  const out: WidgetPlacement[] = [];
  for (const w of widgets) {
    const span = effectiveColSpan(w);
    if (w.full_width) {
      if (col > 0) {
        row++;
        col = 0;
      }
      out.push({ id: w.id, row, colStart: 0, colEnd: DASHBOARD_GRID_COLUMNS });
      row++;
      col = 0;
    } else {
      if (col + span > DASHBOARD_GRID_COLUMNS) {
        row++;
        col = 0;
      }
      out.push({ id: w.id, row, colStart: col, colEnd: col + span });
      col += span;
      if (col >= DASHBOARD_GRID_COLUMNS) {
        row++;
        col = 0;
      }
    }
  }
  return out;
}

const orderIndex = (widgets: ReadonlyArray<{ id: string }>, id: string) => widgets.findIndex((w) => w.id === id);

/**
 * Returns another widget id to swap with when moving in that direction, or null if none.
 * Uses the same 12-column placement model as the live grid.
 */
export function findNeighborSwapId(
  widgets: ReadonlyArray<{ id: string; full_width?: boolean; col_span?: number }>,
  widgetId: string,
  dir: "up" | "down" | "left" | "right"
): string | null {
  const placements = computeWidgetPlacements(widgets);
  const me = placements.find((p) => p.id === widgetId);
  if (!me) return null;

  if (dir === "left") {
    const left = placements.find((p) => p.row === me.row && p.colEnd === me.colStart);
    return left?.id ?? null;
  }
  if (dir === "right") {
    const right = placements.find((p) => p.row === me.row && p.colStart === me.colEnd);
    return right?.id ?? null;
  }
  if (dir === "up") {
    const above = placements
      .filter((p) => p.row === me.row - 1 && columnOverlap(p, me) > 0)
      .sort((a, b) => orderIndex(widgets, a.id) - orderIndex(widgets, b.id));
    return above[0]?.id ?? null;
  }
  const below = placements
    .filter((p) => p.row === me.row + 1 && columnOverlap(p, me) > 0)
    .sort((a, b) => orderIndex(widgets, a.id) - orderIndex(widgets, b.id));
  return below[0]?.id ?? null;
}
