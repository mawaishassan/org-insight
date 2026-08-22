import React, { useState, useEffect, useRef } from "react";

interface Column {
  key: string;
  name: string;
}

interface ColumnWidthConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  fieldName: string;
  columns: Column[];
  initialWidths?: Record<string, number> | null;
  sampleRows?: Record<string, any>[];
  h1Color?: string;
  onSave: (widths: Record<string, number> | null) => void;
}

const DEFAULT_SAMPLE_DATA = [
  { "0": "Computer Science & Engineering", "1": 25, "2": 12, "3": 8, "4": 6, "5": 4, "6": 2 },
  { "0": "Electrical & Electronics Eng.", "1": 18, "2": 9, "3": 5, "4": 4, "5": 3, "6": 1 },
  { "0": "Civil & Structural Engineering", "1": 31, "2": 15, "3": 11, "4": 9, "5": 5, "6": 3 },
  { "0": "Mechanical & Industrial Eng.", "1": 22, "2": 10, "3": 7, "4": 5, "5": 4, "6": 2 },
  { "0": "Textile & Materials Science", "1": 14, "2": 6, "3": 4, "4": 3, "5": 2, "6": 1 },
];

export function ColumnWidthConfigModal({
  isOpen,
  onClose,
  fieldName,
  columns,
  initialWidths,
  sampleRows,
  h1Color = "#1e3a8a",
  onSave,
}: ColumnWidthConfigModalProps) {
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [draggingColKey, setDraggingColKey] = useState<string | null>(null);
  const dragStartXRef = useRef<number>(0);
  const dragStartWidthRef = useRef<number>(0);

  // Initialize widths
  useEffect(() => {
    if (initialWidths && Object.keys(initialWidths).length > 0) {
      setWidths({ ...initialWidths });
    } else {
      // Default initial widths based on column names
      const defs: Record<string, number> = { "S.No": 60 };
      columns.forEach((col, idx) => {
        const k = col.key.toLowerCase();
        const n = (col.name || col.key).toLowerCase();
        if (idx === 0 || k.includes("department") || n.includes("department") || k.includes("name") || n.includes("name")) {
          defs[col.key] = 240;
        } else {
          defs[col.key] = 120;
        }
      });
      setWidths(defs);
    }
  }, [initialWidths, columns, isOpen]);

  if (!isOpen) return null;

  const handleWidthChange = (key: string, val: number) => {
    const safeVal = Math.max(30, Math.min(800, val || 30));
    setWidths((prev) => ({ ...prev, [key]: safeVal }));
  };

  const handleMouseDownResize = (e: React.MouseEvent, colKey: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDraggingColKey(colKey);
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = widths[colKey] || 120;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - dragStartXRef.current;
      const newWidth = Math.max(40, Math.min(800, dragStartWidthRef.current + deltaX));
      setWidths((prev) => ({ ...prev, [colKey]: newWidth }));
    };

    const handleMouseUp = () => {
      setDraggingColKey(null);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const handleResetToDefault = () => {
    onSave(null);
    onClose();
  };

  const handleSave = () => {
    onSave(widths);
    onClose();
  };

  // Build sample rows data
  const displayRows = Array.from({ length: 5 }, (_, rIdx) => {
    const rawRow = sampleRows && sampleRows[rIdx] ? sampleRows[rIdx] : null;
    const defRow = DEFAULT_SAMPLE_DATA[rIdx % DEFAULT_SAMPLE_DATA.length];

    const rowObj: Record<string, any> = { "S.No": rIdx + 1 };
    columns.forEach((col, cIdx) => {
      if (rawRow && rawRow[col.key] !== undefined && rawRow[col.key] !== null) {
        rowObj[col.key] = rawRow[col.key];
      } else {
        const fallbackVal = (defRow as any)[String(cIdx)] ?? (cIdx === 0 ? "Sample Item " + (rIdx + 1) : (rIdx + 1) * (cIdx + 2));
        rowObj[col.key] = fallbackVal;
      }
    });
    return rowObj;
  });

  return (
    <div style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0, 0, 0, 0.5)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: "1rem" }}>
      <div className="card" style={{ width: "100%", maxWidth: "1020px", maxHeight: "90vh", display: "flex", flexDirection: "column", background: "white", borderRadius: 14, boxShadow: "0 25px 50px -12px rgba(0,0,0,0.25)", overflow: "hidden", border: "1px solid var(--border)" }}>
        
        {/* Modal Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.25rem 1.5rem", borderBottom: "1px solid var(--border)", background: "#f8fafc" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 700, color: "#1e3a8a" }}>
              📐 Configure Column Widths — {fieldName}
            </h3>
            <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.85rem", color: "#64748b" }}>
              Set precise column widths or drag boundary handles directly in the live report preview below.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", fontSize: "1.4rem", cursor: "pointer", color: "#94a3b8" }}>&times;</button>
        </div>

        {/* Modal Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          
          {/* Controls List Grid */}
          <div style={{ background: "#f8fafc", padding: "1rem", borderRadius: 10, border: "1px solid var(--border)" }}>
            <h4 style={{ margin: "0 0 0.75rem 0", fontSize: "0.9rem", color: "#334155", fontWeight: 650 }}>
              Width Values (px)
            </h4>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "0.75rem" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", background: "white", padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)" }}>
                <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#475569" }}>S.No</span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                  <input
                    type="number"
                    min={40}
                    max={300}
                    value={widths["S.No"] || 60}
                    onChange={(e) => handleWidthChange("S.No", Number(e.target.value))}
                    style={{ width: "65px", padding: "0.2rem 0.4rem", fontSize: "0.85rem", borderRadius: 4, border: "1px solid var(--border)", textAlign: "right", fontWeight: 600 }}
                  />
                  <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>px</span>
                </div>
              </div>

              {columns.map((col) => (
                <div key={col.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", background: "white", padding: "0.4rem 0.6rem", borderRadius: 6, border: "1px solid var(--border)" }}>
                  <span style={{ fontSize: "0.82rem", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={col.name}>
                    {col.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", flexShrink: 0 }}>
                    <input
                      type="number"
                      min={40}
                      max={800}
                      value={widths[col.key] || 120}
                      onChange={(e) => handleWidthChange(col.key, Number(e.target.value))}
                      style={{ width: "70px", padding: "0.2rem 0.4rem", fontSize: "0.85rem", borderRadius: 4, border: "1px solid var(--border)", textAlign: "right", fontWeight: 600 }}
                    />
                    <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>px</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Live Report Preview Section */}
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", color: "#1e3a8a", fontWeight: 700, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <span>👁️ Live Report Preview</span>
                <span style={{ fontSize: "0.75rem", fontWeight: 500, color: "#64748b", background: "#eff6ff", padding: "0.1rem 0.5rem", borderRadius: 4, border: "1px solid #bfdbfe" }}>
                  Drag column borders to resize
                </span>
              </h4>
            </div>

            {/* Live Table Container */}
            <div style={{ border: "1px solid #d1d5db", borderRadius: 8, overflowX: "auto", background: "white", boxShadow: "0 2px 4px rgba(0,0,0,0.04)" }}>
              <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%", tableLayout: "fixed" }}>
                <thead>
                  <tr style={{ backgroundColor: h1Color, color: "#ffffff" }}>
                    {/* S.No Header */}
                    <th
                      style={{
                        width: widths["S.No"] || 60,
                        border: "1px solid #d1d5db",
                        padding: "6px 5px",
                        textAlign: "center",
                        fontWeight: 600,
                        color: "#ffffff",
                        fontSize: "0.85rem",
                        position: "relative",
                        wordBreak: "normal",
                        overflowWrap: "normal",
                        whiteSpace: "normal",
                        hyphens: "none",
                        verticalAlign: "middle",
                        boxSizing: "border-box",
                      }}
                    >
                      S.No
                      <div
                        onMouseDown={(e) => handleMouseDownResize(e, "S.No")}
                        style={{ position: "absolute", top: 0, right: -3, bottom: 0, width: 6, cursor: "col-resize", zIndex: 10 }}
                      />
                    </th>

                    {/* Subfield Headers */}
                    {columns.map((col, idx) => {
                      const isFreezeCol = idx === 0;
                      const colW = widths[col.key] || (isFreezeCol ? 240 : 120);
                      return (
                        <th
                          key={col.key}
                          style={{
                            width: colW,
                            border: "1px solid #d1d5db",
                            padding: "6px 5px",
                            textAlign: isFreezeCol ? "left" : "center",
                            fontWeight: 600,
                            color: "#ffffff",
                            fontSize: "0.85rem",
                            position: "relative",
                            wordBreak: "normal",
                            overflowWrap: "normal",
                            whiteSpace: "normal",
                            hyphens: "none",
                            verticalAlign: "middle",
                            boxSizing: "border-box",
                          }}
                        >
                          {col.name}
                          <div
                            onMouseDown={(e) => handleMouseDownResize(e, col.key)}
                            style={{ position: "absolute", top: 0, right: -3, bottom: 0, width: 6, cursor: "col-resize", zIndex: 10, background: draggingColKey === col.key ? "#2563eb" : "transparent" }}
                          />
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((row, rIdx) => {
                    const bg = rIdx % 2 === 1 ? "#f9fafb" : "#ffffff";
                    return (
                      <tr key={rIdx} style={{ backgroundColor: bg, fontSize: "0.85rem" }}>
                        <td
                          style={{
                            width: widths["S.No"] || 60,
                            border: "1px solid #d1d5db",
                            padding: "8px 5px",
                            textAlign: "center",
                            color: "#4b5563",
                            boxSizing: "border-box",
                          }}
                        >
                          {row["S.No"]}
                        </td>
                        {columns.map((col, idx) => {
                          const isFreezeCol = idx === 0;
                          const colW = widths[col.key] || (isFreezeCol ? 240 : 120);
                          return (
                            <td
                              key={col.key}
                              style={{
                                width: colW,
                                border: "1px solid #d1d5db",
                                padding: "8px 5px",
                                textAlign: isFreezeCol ? "left" : "center",
                                color: "#111827",
                                wordBreak: "normal",
                                overflowWrap: "normal",
                                whiteSpace: "normal",
                                boxSizing: "border-box",
                              }}
                            >
                              {String(row[col.key] ?? "—")}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem 1.5rem", borderTop: "1px solid var(--border)", background: "#f8fafc" }}>
          <button
            type="button"
            className="btn"
            onClick={handleResetToDefault}
            style={{ color: "#dc2626", border: "1px solid #fca5a5", background: "#fff5f5", fontWeight: 600, padding: "0.5rem 1rem" }}
          >
            🔄 Reset to Default Widths
          </button>
          
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <button
              type="button"
              className="btn"
              onClick={onClose}
              style={{ fontWeight: 500 }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSave}
              style={{ fontWeight: 600, padding: "0.5rem 1.25rem" }}
            >
              Save Width Configuration
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
