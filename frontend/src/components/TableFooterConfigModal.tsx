"use client";

import React, { useState, useEffect } from "react";

export interface FooterCellConfig {
  id: string;
  colspan: number;
  content_type: "text" | "formula";
  text?: string;
  formula_op?: "SUM" | "COUNT" | "AVG" | "MIN" | "MAX";
  column_key?: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  decimal_places?: number | "auto";
}

export interface FooterRowConfig {
  id: string;
  cells: FooterCellConfig[];
}

export interface TableFooterConfig {
  enabled: boolean;
  rows: FooterRowConfig[];
}

interface KPISubFieldItem {
  key: string;
  name: string;
}

interface TableFooterConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  fieldName: string;
  allSubFields: KPISubFieldItem[];
  existingFooterConfig?: TableFooterConfig | null;
  onSave: (footerConfig: TableFooterConfig) => void;
}

export function TableFooterConfigModal({
  isOpen,
  onClose,
  fieldName,
  allSubFields,
  existingFooterConfig,
  onSave,
}: TableFooterConfigModalProps) {
  const [enabled, setEnabled] = useState<boolean>(false);
  const [rows, setRows] = useState<FooterRowConfig[]>([]);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number>(0);
  const [selectedCellIndices, setSelectedCellIndices] = useState<number[]>([0]);

  // Helper to create default row matching allSubFields
  const createDefaultRow = (rowIdStr: string): FooterRowConfig => {
    if (!allSubFields || allSubFields.length === 0) {
      return {
        id: rowIdStr,
        cells: [
          {
            id: `${rowIdStr}_c0`,
            colspan: 1,
            content_type: "text",
            text: "Grand Total",
            align: "left",
            bold: true,
          },
        ],
      };
    }

    const cells: FooterCellConfig[] = allSubFields.map((sf, idx) => {
      if (idx === 0) {
        return {
          id: `${rowIdStr}_c0`,
          colspan: 1,
          content_type: "text",
          text: "Grand Total",
          align: "left",
          bold: true,
        };
      }
      return {
        id: `${rowIdStr}_c${idx}`,
        colspan: 1,
        content_type: "formula",
        formula_op: "SUM",
        column_key: sf.key,
        align: "center",
        bold: true,
        decimal_places: 2,
      };
    });

    return { id: rowIdStr, cells };
  };

  useEffect(() => {
    if (isOpen) {
      if (existingFooterConfig) {
        setEnabled(Boolean(existingFooterConfig.enabled));
        if (Array.isArray(existingFooterConfig.rows) && existingFooterConfig.rows.length > 0) {
          setRows(existingFooterConfig.rows);
        } else {
          setRows([createDefaultRow("row_1")]);
        }
      } else {
        setEnabled(true);
        setRows([createDefaultRow("row_1")]);
      }
      setSelectedRowIdx(0);
      setSelectedCellIndices([0]);
    }
  }, [isOpen, existingFooterConfig, allSubFields.length]);

  if (!isOpen) return null;

  const activeRow = rows[selectedRowIdx] || rows[0];
  const firstSelectedIdx = selectedCellIndices[0] ?? 0;
  const activeCell = activeRow?.cells[firstSelectedIdx] || activeRow?.cells[0];

  // Cell modification handler
  const updateActiveCells = (updates: Partial<FooterCellConfig>) => {
    setRows((prevRows) => {
      const newRows = [...prevRows];
      const curRow = { ...newRows[selectedRowIdx] };
      const curCells = [...curRow.cells];
      selectedCellIndices.forEach((idx) => {
        if (curCells[idx]) {
          curCells[idx] = { ...curCells[idx], ...updates };
        }
      });
      curRow.cells = curCells;
      newRows[selectedRowIdx] = curRow;
      return newRows;
    });
  };

  // Merge selected cell with adjacent right cell
  const handleMergeRight = () => {
    const firstIdx = selectedCellIndices[0];
    if (selectedCellIndices.length !== 1 || firstIdx === undefined) return;
    if (!activeRow || firstIdx >= activeRow.cells.length - 1) return;

    setRows((prevRows) => {
      const newRows = [...prevRows];
      const curRow = { ...newRows[selectedRowIdx] };
      const curCells = [...curRow.cells];
      const curCell = curCells[firstIdx];
      const nextCell = curCells[firstIdx + 1];

      const mergedCell: FooterCellConfig = {
        ...curCell,
        colspan: curCell.colspan + nextCell.colspan,
      };

      curCells.splice(firstIdx, 2, mergedCell);
      curRow.cells = curCells;
      newRows[selectedRowIdx] = curRow;
      return newRows;
    });
  };

  // Unmerge selected cell if colspan > 1
  const handleUnmerge = () => {
    const firstIdx = selectedCellIndices[0];
    if (selectedCellIndices.length !== 1 || firstIdx === undefined) return;
    const cell = activeRow?.cells[firstIdx];
    if (!cell || cell.colspan <= 1) return;

    setRows((prevRows) => {
      const newRows = [...prevRows];
      const curRow = { ...newRows[selectedRowIdx] };
      const curCells = [...curRow.cells];
      const countToCreate = cell.colspan;

      const newCells: FooterCellConfig[] = Array.from({ length: countToCreate }, (_, idx) => ({
        id: `${cell.id}_unmerged_${idx}_${Date.now()}`,
        colspan: 1,
        content_type: idx === 0 ? cell.content_type : "text",
        text: idx === 0 ? cell.text : "",
        formula_op: cell.formula_op,
        column_key: cell.column_key,
        align: cell.align || "center",
        bold: cell.bold ?? true,
        decimal_places: cell.decimal_places ?? 2,
      }));

      curCells.splice(firstIdx, 1, ...newCells);
      curRow.cells = curCells;
      newRows[selectedRowIdx] = curRow;
      return newRows;
    });
  };

  // Add new footer row
  const handleAddRow = () => {
    const newRowId = `row_${rows.length + 1}_${Date.now()}`;
    const newRow = createDefaultRow(newRowId);
    setRows((prev) => [...prev, newRow]);
    setSelectedRowIdx(rows.length);
    setSelectedCellIndices([0]);
  };

  // Remove current footer row
  const handleRemoveRow = (rIdx: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, idx) => idx !== rIdx));
    if (selectedRowIdx >= rIdx) {
      setSelectedRowIdx(Math.max(0, selectedRowIdx - 1));
      setSelectedCellIndices([0]);
    }
  };

  // Save handler
  const handleSave = () => {
    onSave({
      enabled,
      rows: enabled ? rows : [],
    });
    onClose();
  };

  // Mock data evaluation for Live Preview
  const sampleValues: Record<string, number[]> = {
    male: [120, 150, 100],
    female: [100, 80, 90],
    total: [220, 230, 190],
  };

  const evaluatePreviewCell = (cell: FooterCellConfig): string => {
    if (cell.content_type === "text") {
      return cell.text || "";
    }
    const op = cell.formula_op || "SUM";
    const colKey = cell.column_key || "";
    const arr = sampleValues[colKey.toLowerCase()] || [10, 20, 30];
    let val = 0;
    if (op === "SUM") val = arr.reduce((a, b) => a + b, 0);
    else if (op === "COUNT") val = arr.length;
    else if (op === "AVG") val = arr.reduce((a, b) => a + b, 0) / arr.length;
    else if (op === "MIN") val = Math.min(...arr);
    else if (op === "MAX") val = Math.max(...arr);

    const dp = cell.decimal_places;
    if (dp !== undefined && dp !== "auto") {
      const numDp = Number(dp);
      return val.toFixed(numDp);
    }
    return String(val);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(15, 23, 42, 0.5)",
        backdropFilter: "blur(4px)",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "940px",
          maxHeight: "90vh",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #e2e8f0",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "1rem 1.25rem",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#f8fafc",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                fontSize: "0.85rem",
                fontWeight: 700,
                color: "#2563eb",
                backgroundColor: "#eff6ff",
                padding: "0.2rem 0.5rem",
                borderRadius: "6px",
                fontFamily: "monospace",
              }}
            >
              ∑
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "#0f172a" }}>
                Table Footer Configuration
              </h3>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#64748b" }}>
                Field: {fieldName}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.2rem",
              color: "#94a3b8",
              cursor: "pointer",
              padding: "0.25rem",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div
          style={{
            padding: "1.25rem",
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: "1.25rem",
            backgroundColor: "#ffffff",
          }}
        >
          {/* Top Enable Switch */}
          <div
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "8px",
              backgroundColor: "#f8fafc",
              border: "1px solid #e2e8f0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div>
              <span style={{ display: "block", fontSize: "0.9rem", fontWeight: 600, color: "#0f172a" }}>
                Enable Table Footer
              </span>
              <span style={{ fontSize: "0.775rem", color: "#64748b" }}>
                Appears as the final summary row at the bottom of the table (isolated to Custom Reports)
              </span>
            </div>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: "20px", height: "20px", accentColor: "#2563eb", cursor: "pointer" }}
            />
          </div>

          {enabled && (
            <>
              {/* Row Tabs & Add Row */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", overflowX: "auto" }}>
                  {rows.map((r, rIdx) => (
                    <div
                      key={r.id}
                      onClick={() => {
                        setSelectedRowIdx(rIdx);
                        setSelectedCellIndices([0]);
                      }}
                      style={{
                        padding: "0.35rem 0.75rem",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                        fontWeight: selectedRowIdx === rIdx ? 600 : 500,
                        backgroundColor: selectedRowIdx === rIdx ? "#2563eb" : "#f1f5f9",
                        color: selectedRowIdx === rIdx ? "#ffffff" : "#475569",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.4rem",
                      }}
                    >
                      <span>Footer Row {rIdx + 1}</span>
                      {rows.length > 1 && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveRow(rIdx);
                          }}
                          style={{ fontSize: "0.75rem", opacity: 0.7, cursor: "pointer" }}
                        >
                          ✕
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleAddRow}
                  style={{
                    padding: "0.35rem 0.65rem",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: "#ffffff",
                    fontSize: "0.8rem",
                    fontWeight: 600,
                    color: "#2563eb",
                    cursor: "pointer",
                  }}
                >
                  + Add Row
                </button>
              </div>

              {/* Grid Visual Builder */}
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", textTransform: "uppercase", marginBottom: "0.5rem" }}>
                  Footer Grid Builder (Click cell to configure)
                </label>
                <div
                  style={{
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    overflowX: "auto",
                    overflowY: "hidden",
                    backgroundColor: "#ffffff",
                    maxWidth: "100%",
                  }}
                >
                  <table style={{ width: "100%", minWidth: "max-content", borderCollapse: "collapse", fontSize: "0.825rem", whiteSpace: "nowrap" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#1e3a8a", color: "#ffffff" }}>
                        <th style={{ padding: "8px", border: "1px solid #cbd5e1", textTransform: "uppercase", width: "45px" }}>S.No</th>
                        {allSubFields.map((sf) => (
                          <th key={sf.key} style={{ padding: "8px", border: "1px solid #cbd5e1", textTransform: "uppercase" }}>
                            {sf.name || sf.key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ padding: "8px", border: "1px solid #cbd5e1", textAlign: "center", color: "#64748b" }}>*</td>
                        {activeRow?.cells.map((cell, cIdx) => {
                          const isSelected = selectedCellIndices.includes(cIdx);
                          return (
                            <td
                              key={cell.id}
                              colSpan={cell.colspan}
                              onClick={() => setSelectedCellIndices([cIdx])}
                              style={{
                                padding: "10px",
                                border: isSelected ? "2px solid #2563eb" : "1px solid #cbd5e1",
                                backgroundColor: isSelected ? "#eff6ff" : cell.content_type === "formula" ? "#f0fdf4" : "#f8fafc",
                                cursor: "pointer",
                                textAlign: cell.align || "center",
                                fontWeight: cell.bold ? 700 : 400,
                                color: isSelected ? "#1e40af" : "#0f172a",
                                transition: "all 0.15s ease",
                                position: "relative"
                              }}
                            >
                              <div style={{ position: "absolute", top: 2, right: 2, display: "flex", gap: "2px", alignItems: "center" }} onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedCellIndices(prev => [...new Set([...prev, cIdx])]);
                                    } else {
                                      setSelectedCellIndices(prev => prev.filter(idx => idx !== cIdx));
                                    }
                                  }}
                                  style={{ cursor: "pointer", width: 14, height: 14 }}
                                />
                              </div>
                              <div style={{ fontSize: "0.8rem", paddingTop: "6px" }}>
                                {cell.content_type === "text"
                                  ? cell.text || "<Empty Text>"
                                  : `${cell.formula_op || "SUM"}(${cell.column_key || ""})`}
                              </div>
                              {cell.colspan > 1 && (
                                <span style={{ fontSize: "0.675rem", color: "#2563eb", fontWeight: 600, display: "block" }}>
                                  (merged {cell.colspan} cols)
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Cell Merge & Unmerge Actions */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", backgroundColor: "#f8fafc", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #e2e8f0" }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#334155" }}>Cell Actions:</span>
                <button
                  type="button"
                  onClick={handleMergeRight}
                  disabled={selectedCellIndices.length !== 1 || !activeRow || selectedCellIndices[0] >= activeRow.cells.length - 1}
                  style={{
                    padding: "0.3rem 0.6rem",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: (selectedCellIndices.length === 1 && selectedCellIndices[0] < (activeRow?.cells.length || 0) - 1) ? "#ffffff" : "#f1f5f9",
                    color: (selectedCellIndices.length === 1 && selectedCellIndices[0] < (activeRow?.cells.length || 0) - 1) ? "#2563eb" : "#94a3b8",
                    fontSize: "0.775rem",
                    fontWeight: 600,
                    cursor: (selectedCellIndices.length === 1 && selectedCellIndices[0] < (activeRow?.cells.length || 0) - 1) ? "pointer" : "not-allowed",
                  }}
                >
                  + Merge Right
                </button>
                <button
                  type="button"
                  onClick={handleUnmerge}
                  disabled={selectedCellIndices.length !== 1 || !activeCell || activeCell.colspan <= 1}
                  style={{
                    padding: "0.3rem 0.6rem",
                    borderRadius: "6px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: (selectedCellIndices.length === 1 && (activeCell?.colspan || 1) > 1) ? "#ffffff" : "#f1f5f9",
                    color: (selectedCellIndices.length === 1 && (activeCell?.colspan || 1) > 1) ? "#dc2626" : "#94a3b8",
                    fontSize: "0.775rem",
                    fontWeight: 600,
                    cursor: (selectedCellIndices.length === 1 && (activeCell?.colspan || 1) > 1) ? "pointer" : "not-allowed",
                  }}
                >
                  Unmerge Cell
                </button>
              </div>

              {/* Selected Cell Configuration Panel */}
              {activeCell && (
                <div
                  style={{
                    padding: "1rem",
                    borderRadius: "8px",
                    backgroundColor: "#f8fafc",
                    border: "1px solid #cbd5e1",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.85rem",
                  }}
                >
                  <h4 style={{ margin: 0, fontSize: "0.875rem", fontWeight: 600, color: "#0f172a" }}>
                    Configure Selected Cells ({selectedCellIndices.length === 1 ? `Column Position ${selectedCellIndices[0] + 1}, Colspan: ${activeCell.colspan}` : `${selectedCellIndices.length} cells selected`})
                  </h4>

                  {/* Content Type Selector */}
                  <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
                    <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "#475569" }}>Content Type:</span>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.825rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="contentType"
                        checked={activeCell.content_type === "text"}
                        onChange={() => updateActiveCells({ content_type: "text" })}
                      />
                      Static Text
                    </label>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.825rem", cursor: "pointer" }}>
                      <input
                        type="radio"
                        name="contentType"
                        checked={activeCell.content_type === "formula"}
                        onChange={() => updateActiveCells({ content_type: "formula" })}
                      />
                      Formula
                    </label>
                  </div>

                  {/* Content Details */}
                  {activeCell.content_type === "text" ? (
                    <div>
                      <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                        Static Text / Label
                      </label>
                      <input
                        type="text"
                        value={activeCell.text || ""}
                        onChange={(e) => updateActiveCells({ text: e.target.value })}
                        placeholder="e.g. Grand Total, Overall Average"
                        style={{
                          width: "100%",
                          padding: "0.45rem 0.65rem",
                          borderRadius: "6px",
                          border: "1px solid #cbd5e1",
                          fontSize: "0.85rem",
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.75rem" }}>
                      <div>
                        <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                          Formula Type
                        </label>
                        <select
                          value={activeCell.formula_op || "SUM"}
                          onChange={(e) => updateActiveCells({ formula_op: e.target.value as any })}
                          style={{
                            width: "100%",
                            padding: "0.45rem 0.65rem",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "0.85rem",
                            backgroundColor: "#ffffff",
                          }}
                        >
                          <option value="SUM">SUM (Total)</option>
                          <option value="COUNT">COUNT (Non-empty rows)</option>
                          <option value="AVG">AVERAGE (Mean value)</option>
                          <option value="MIN">MIN (Minimum)</option>
                          <option value="MAX">MAX (Maximum)</option>
                        </select>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                          Target Column
                        </label>
                        <select
                          value={activeCell.column_key || ""}
                          onChange={(e) => updateActiveCells({ column_key: e.target.value })}
                          style={{
                            width: "100%",
                            padding: "0.45rem 0.65rem",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "0.85rem",
                            backgroundColor: "#ffffff",
                          }}
                        >
                          {allSubFields.map((sf) => (
                            <option key={sf.key} value={sf.key}>
                              {sf.name || sf.key} ({sf.key})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", marginBottom: "0.25rem" }}>
                          Decimal Digits
                        </label>
                        <select
                          value={activeCell.decimal_places ?? 2}
                          onChange={(e) =>
                             updateActiveCells({
                              decimal_places: e.target.value === "auto" ? "auto" : Number(e.target.value),
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "0.45rem 0.65rem",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "0.85rem",
                            backgroundColor: "#ffffff",
                          }}
                        >
                          <option value={2}>2 (e.g. 14.43)</option>
                          <option value={0}>0 (e.g. 14)</option>
                          <option value={1}>1 (e.g. 14.4)</option>
                          <option value={3}>3 (e.g. 14.429)</option>
                          <option value={4}>4 (e.g. 14.4286)</option>
                          <option value="auto">Auto (Full precision)</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Alignment & Bold */}
                  <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", borderTop: "1px dashed #cbd5e1", paddingTop: "0.65rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <span style={{ fontSize: "0.775rem", fontWeight: 600, color: "#475569" }}>Align:</span>
                      {(["left", "center", "right"] as const).map((a) => (
                        <button
                          key={a}
                          type="button"
                          onClick={() => updateActiveCells({ align: a })}
                          style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "4px",
                            border: "1px solid #cbd5e1",
                            fontSize: "0.75rem",
                            fontWeight: activeCell.align === a ? 700 : 400,
                            backgroundColor: activeCell.align === a ? "#2563eb" : "#ffffff",
                            color: activeCell.align === a ? "#ffffff" : "#334155",
                            cursor: "pointer",
                            textTransform: "capitalize",
                          }}
                        >
                          {a}
                        </button>
                      ))}
                    </div>

                    <label style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", color: "#334155" }}>
                      <input
                        type="checkbox"
                        checked={activeCell.bold ?? true}
                        onChange={(e) => updateActiveCells({ bold: e.target.checked })}
                      />
                      Bold Font
                    </label>
                  </div>
                </div>
              )}

              {/* Footer Preview */}
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#475569", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                  Live Footer Output Preview
                </label>
                <div style={{ border: "1px solid #e2e8f0", borderRadius: "8px", overflowX: "auto", overflowY: "hidden", backgroundColor: "#ffffff", padding: "0.5rem", maxWidth: "100%" }}>
                  <table style={{ width: "100%", minWidth: "max-content", borderCollapse: "collapse", fontSize: "0.825rem", whiteSpace: "nowrap" }}>
                    <thead>
                      <tr style={{ backgroundColor: "#1e3a8a", color: "#ffffff" }}>
                        <th style={{ border: "1px solid #cbd5e1", padding: "6px" }}>S.No</th>
                        {allSubFields.map((sf) => (
                          <th key={sf.key} style={{ border: "1px solid #cbd5e1", padding: "6px" }}>{sf.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td style={{ border: "1px solid #e2e8f0", padding: "6px", textAlign: "center" }}>1</td>
                        {allSubFields.map((sf, idx) => (
                          <td key={sf.key} style={{ border: "1px solid #e2e8f0", padding: "6px", textAlign: idx === 0 ? "left" : "right" }}>
                            {idx === 0 ? "Computer Science" : idx === 1 ? "120" : idx === 2 ? "100" : "220"}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td style={{ border: "1px solid #e2e8f0", padding: "6px", textAlign: "center" }}>2</td>
                        {allSubFields.map((sf, idx) => (
                          <td key={sf.key} style={{ border: "1px solid #e2e8f0", padding: "6px", textAlign: idx === 0 ? "left" : "right" }}>
                            {idx === 0 ? "Electrical Engineering" : idx === 1 ? "150" : idx === 2 ? "80" : "230"}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                    <tfoot>
                      {rows.map((r) => (
                        <tr key={r.id} style={{ backgroundColor: "#f8fafc" }}>
                          <td style={{ border: "1px solid #cbd5e1", padding: "8px", textAlign: "center", fontWeight: "bold" }}>*</td>
                          {r.cells.map((c) => (
                            <td
                              key={c.id}
                              colSpan={c.colspan}
                              style={{
                                border: "1px solid #cbd5e1",
                                padding: "8px",
                                textAlign: c.align || "center",
                                fontWeight: c.bold ? "bold" : "normal",
                                color: "#0f172a",
                              }}
                            >
                              {evaluatePreviewCell(c)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer Buttons */}
        <div
          style={{
            padding: "0.85rem 1.25rem",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: "0.75rem",
            backgroundColor: "#f8fafc",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "0.45rem 0.85rem",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              backgroundColor: "#ffffff",
              fontSize: "0.85rem",
              fontWeight: 500,
              color: "#475569",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: "0.45rem 1.1rem",
              borderRadius: "6px",
              border: "none",
              backgroundColor: "#2563eb",
              fontSize: "0.85rem",
              fontWeight: 600,
              color: "#ffffff",
              cursor: "pointer",
              boxShadow: "0 1px 2px 0 rgba(0, 0, 0, 0.05)",
            }}
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
