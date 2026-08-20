import { useState, useRef, useMemo, UIEvent } from "react";

interface Column {
  key: string;
  name: string;
}

interface MergedHeader {
  title: string;
  start_key: string;
  end_key: string;
}

interface VirtualTableProps {
  columns: Column[];
  rows: Record<string, any>[];
  maxHeight?: number;
  rowHeight?: number;
  totalCount?: number;
  mergedHeaders?: MergedHeader[];
}

const getColWidth = (key: string) => {
  const k = key.toLowerCase();
  if (k.includes("department") || k.includes("name") || k.includes("title")) {
    return 260;
  }
  return 150;
};

export function VirtualTable({
  columns,
  rows,
  maxHeight = 400,
  rowHeight = 42,
  totalCount,
  mergedHeaders,
}: VirtualTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const headerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalRows = rows.length;
  const totalHeight = totalRows * rowHeight;

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
    if (headerRef.current) {
      headerRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  const visibleRowCount = Math.ceil(maxHeight / rowHeight);
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - 2);
  const endIndex = Math.min(totalRows, startIndex + visibleRowCount + 4);

  const visibleRows = useMemo(() => {
    return rows.slice(startIndex, endIndex).map((row, idx) => ({
      row,
      index: startIndex + idx,
    }));
  }, [rows, startIndex, endIndex]);

  const parsedHeaderCells = useMemo(() => {
    if (!mergedHeaders || mergedHeaders.length === 0) return null;

    const cells: { title: string; width: number; isGroup: boolean }[] = [];
    cells.push({ title: "S.No", width: 60, isGroup: false });

    const colKeys = columns.map(c => c.key);
    const colIndices = new Map(colKeys.map((k, idx) => [k, idx]));

    let i = 0;
    while (i < columns.length) {
      const col = columns[i];
      const group = mergedHeaders.find(g => g.start_key === col.key);
      if (group && colIndices.has(group.end_key)) {
        const endIdx = colIndices.get(group.end_key)!;
        if (endIdx >= i) {
          let groupWidth = 0;
          for (let k = i; k <= endIdx; k++) {
            groupWidth += getColWidth(columns[k].key);
          }
          cells.push({ title: group.title, width: groupWidth, isGroup: true });
          i = endIdx + 1;
          continue;
        }
      }
      cells.push({ title: col.name, width: getColWidth(col.key), isGroup: false });
      i++;
    }
    return cells;
  }, [columns, mergedHeaders]);

  const coveredKeys = useMemo(() => {
    const set = new Set<string>();
    if (!mergedHeaders) return set;
    const colKeys = columns.map(c => c.key);
    const colIndices = new Map(colKeys.map((k, idx) => [k, idx]));

    for (const group of mergedHeaders) {
      if (colIndices.has(group.start_key) && colIndices.has(group.end_key)) {
        const startIdx = colIndices.get(group.start_key)!;
        const endIdx = colIndices.get(group.end_key)!;
        for (let k = startIdx; k <= endIdx; k++) {
          set.add(columns[k].key);
        }
      }
    }
    return set;
  }, [columns, mergedHeaders]);

  return (
    <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 8, background: "white", overflow: "hidden", margin: "0.5rem 0" }}>
      {/* Header Container (hidden scrollbar, synced via JS) */}
      <div ref={headerRef} style={{ overflow: "hidden" }}>
        {parsedHeaderCells && (
          <div style={{ display: "flex", background: "#f8fafc", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", width: "max-content", minWidth: "100%" }}>
            {parsedHeaderCells.map((cell, idx) => (
              <div
                key={idx}
                style={{
                  width: cell.width,
                  padding: "0.75rem 1rem",
                  borderRight: "1px solid var(--border)",
                  textAlign: "center",
                  flexShrink: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: cell.isGroup ? "#1e40af" : "var(--muted)",
                  background: cell.isGroup ? "#eff6ff" : "transparent",
                }}
              >
                {cell.title}
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", background: "#f8fafc", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", width: "max-content", minWidth: "100%" }}>
          <div style={{ width: 60, padding: "0.75rem 1rem", borderRight: "1px solid var(--border)", textAlign: "center", flexShrink: 0 }}>
            {parsedHeaderCells ? "" : "S.No"}
          </div>
          {columns.map((col) => {
            const showTitle = !parsedHeaderCells || coveredKeys.has(col.key);
            return (
              <div key={col.key} style={{ width: getColWidth(col.key), padding: "0.75rem 1rem", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderRight: "1px solid var(--border)" }}>
                {showTitle ? col.name : ""}
              </div>
            );
          })}
        </div>
      </div>

      {/* Scrollable body container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        style={{
          maxHeight,
          overflowY: "auto",
          overflowX: "auto",
          position: "relative",
          background: "#fff",
        }}
      >
        {totalRows === 0 ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--muted)", fontStyle: "italic" }}>
            No records found.
          </div>
        ) : (
          <div style={{ height: totalHeight, width: "max-content", minWidth: "100%", position: "relative" }}>
            {/* Dummy row to establish max-content width of the parent container for absolute positioned children */}
            <div style={{ display: "flex", height: 0, visibility: "hidden", overflow: "hidden" }}>
              <div style={{ width: 60, flexShrink: 0 }}>S.No</div>
              {columns.map((col) => (
                <div key={col.key} style={{ width: getColWidth(col.key), flexShrink: 0 }}></div>
              ))}
            </div>
            {visibleRows.map(({ row, index }) => (
              <div
                key={index}
                style={{
                  position: "absolute",
                  top: index * rowHeight,
                  left: 0,
                  width: "100%",
                  height: rowHeight,
                  display: "flex",
                  alignItems: "center",
                  borderBottom: "1px solid #f1f5f9",
                  background: index % 2 === 1 ? "#fafafa" : "#ffffff",
                  fontSize: "0.9rem",
                  color: "#1e293b",
                }}
              >
                <div style={{ width: 60, padding: "0 1rem", color: "#64748b", textAlign: "center", borderRight: "1px solid #f1f5f9", fontWeight: 500, flexShrink: 0 }}>
                  {index + 1}
                </div>
                {columns.map((col) => {
                  const val = row[col.key];
                  return (
                    <div
                      key={col.key}
                      style={{
                        width: getColWidth(col.key),
                        padding: "0 1rem",
                        flexShrink: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={val !== null && val !== undefined ? String(val) : "—"}
                    >
                      {val !== null && val !== undefined ? String(val) : "—"}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer / Count Info */}
      <div style={{ padding: "0.5rem 1rem", borderTop: "1px solid var(--border)", background: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.8rem", color: "#64748b" }}>
        <div>
          Showing {totalRows} records
          {totalCount && totalCount > totalRows && ` (loaded progressively out of ${totalCount})`}
        </div>
      </div>
    </div>
  );
}
