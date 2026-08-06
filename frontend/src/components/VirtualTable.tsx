import { useState, useRef, useMemo, UIEvent } from "react";

interface Column {
  key: string;
  name: string;
}

interface VirtualTableProps {
  columns: Column[];
  rows: Record<string, any>[];
  maxHeight?: number;
  rowHeight?: number;
  totalCount?: number;
}

export function VirtualTable({
  columns,
  rows,
  maxHeight = 400,
  rowHeight = 42,
  totalCount,
}: VirtualTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const totalRows = rows.length;
  const totalHeight = totalRows * rowHeight;

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--border)", borderRadius: 8, background: "white", overflow: "hidden", margin: "0.5rem 0" }}>
      {/* Header Container (non-scrollable horizontally unless matching body) */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ display: "flex", background: "#f8fafc", borderBottom: "2px solid var(--border)", fontWeight: 600, fontSize: "0.85rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", minWidth: "100%" }}>
          <div style={{ width: 60, padding: "0.75rem 1rem", borderRight: "1px solid var(--border)", textAlign: "center", flexShrink: 0 }}>S.No</div>
          {columns.map((col) => (
            <div key={col.key} style={{ flex: 1, padding: "0.75rem 1rem", minWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {col.name}
            </div>
          ))}
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
          <div style={{ height: totalHeight, width: "100%", position: "relative" }}>
            {visibleRows.map(({ row, index }) => (
              <div
                key={index}
                style={{
                  position: "absolute",
                  top: index * rowHeight,
                  left: 0,
                  right: 0,
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
                        flex: 1,
                        padding: "0 1rem",
                        minWidth: 150,
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
