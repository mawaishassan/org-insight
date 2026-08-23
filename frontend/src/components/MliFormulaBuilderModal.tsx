"use client";

import React, { useState, useEffect } from "react";
import { api } from "@/lib/api";

export interface SubFieldItem {
  id?: number;
  key: string;
  name: string;
  field_type?: string;
  config?: any;
}

interface ConditionRow {
  colKey: string;
  operator: string;
  value: string;
}

interface MliFormulaBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetSubField: SubFieldItem;
  allSubFields: SubFieldItem[];
  onSave: (updatedConfig: any) => void;
}

const COMPARISON_OPERATORS = [
  { label: "Equals (=)", value: "==" },
  { label: "Not Equals (!=)", value: "!=" },
  { label: "Contains", value: "contains" },
  { label: "Starts With", value: "starts_with" },
  { label: "Ends With", value: "ends_with" },
  { label: "Greater Than (>)", value: ">" },
  { label: "Less Than (<)", value: "<" },
  { label: "Greater or Equal (>=)", value: ">=" },
  { label: "Less or Equal (<=)", value: "<=" },
];

export function MliFormulaBuilderModal({
  isOpen,
  onClose,
  targetSubField: initialTargetSubField,
  allSubFields,
  onSave,
}: MliFormulaBuilderModalProps) {
  const [selectedTargetKey, setSelectedTargetKey] = useState<string>(
    initialTargetSubField?.key || ""
  );

  const currentTargetSubField =
    allSubFields.find((sf) => sf.key === selectedTargetKey) || initialTargetSubField;

  const existingConfig = currentTargetSubField?.config || {};
  const [isEnabled, setIsEnabled] = useState<boolean>(
    Boolean(existingConfig.is_formula || currentTargetSubField?.field_type === "formula" || true)
  );

  const [formulaType, setFormulaType] = useState<"math" | "conditional" | "comparison">(
    existingConfig.formula_type || "math"
  );

  const [expression, setExpression] = useState<string>(
    existingConfig.formula_expression || ""
  );

  // Condition Builder State
  const [conditions, setConditions] = useState<ConditionRow[]>([
    { colKey: "", operator: "==", value: "" },
  ]);

  const [trueResult, setTrueResult] = useState<string>("1");
  const [falseResult, setFalseResult] = useState<string>("0");
  const [decimalPlaces, setDecimalPlaces] = useState<number | "auto">(
    existingConfig.decimal_places !== undefined ? existingConfig.decimal_places : 2
  );

  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<{
    is_valid?: boolean;
    error?: string | null;
    sample_result?: any;
    sample_equation?: string | null;
  } | null>(null);

  useEffect(() => {
    if (isOpen && currentTargetSubField) {
      const cfg = currentTargetSubField.config || {};
      setSelectedTargetKey(currentTargetSubField.key);
      setIsEnabled(Boolean(cfg.is_formula || currentTargetSubField.field_type === "formula" || true));
      setFormulaType(cfg.formula_type || "math");
      setExpression(cfg.formula_expression || "");
      setDecimalPlaces(cfg.decimal_places !== undefined ? cfg.decimal_places : 2);
      if (cfg.conditions && Array.isArray(cfg.conditions) && cfg.conditions.length > 0) {
        setConditions(cfg.conditions);
      } else {
        const firstCol = allSubFields.find((sf) => sf.key !== currentTargetSubField.key);
        setConditions([{ colKey: firstCol?.key || "", operator: "==", value: "" }]);
      }
      setTrueResult(cfg.true_result ?? "1");
      setFalseResult(cfg.false_result ?? "0");
      setValidationResult(null);
    }
  }, [isOpen, currentTargetSubField?.key]);

  if (!isOpen || !currentTargetSubField) return null;

  // Available source columns (excluding current target column)
  const availableSourceColumns = allSubFields.filter(
    (sf) => sf.key !== selectedTargetKey && sf.key.trim() !== ""
  );

  const insertToken = (token: string) => {
    setExpression((prev) => {
      if (!prev) return token;
      const needSpace = ["+", "-", "*", "/", "==", "!="].includes(token);
      return prev + (needSpace ? ` ${token} ` : token);
    });
    setValidationResult(null);
  };

  const handleAddCondition = () => {
    const firstCol = availableSourceColumns[0]?.key || "";
    setConditions((prev) => [...prev, { colKey: firstCol, operator: "==", value: "" }]);
  };

  const handleRemoveCondition = (idx: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleConditionChange = (idx: number, field: keyof ConditionRow, val: string) => {
    setConditions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: val };
      return next;
    });
    setValidationResult(null);
  };

  const buildGeneratedExpression = () => {
    if (formulaType === "math") {
      return expression;
    }

    const condStrs = conditions
      .filter((c) => c.colKey && c.operator)
      .map((c) => {
        const colRef = c.colKey;
        const valQuote = isNaN(Number(c.value)) ? `"${c.value}"` : c.value;
        if (c.operator === "contains") {
          return `contains(${colRef}, ${valQuote})`;
        }
        if (c.operator === "starts_with") {
          return `starts_with(${colRef}, ${valQuote})`;
        }
        if (c.operator === "ends_with") {
          return `ends_with(${colRef}, ${valQuote})`;
        }
        return `${colRef} ${c.operator} ${valQuote}`;
      });

    if (condStrs.length === 0) return "";

    const combinedCond = condStrs.join(" AND ");
    const trueVal = isNaN(Number(trueResult)) ? `"${trueResult}"` : trueResult || "1";
    const falseVal = isNaN(Number(falseResult)) ? `"${falseResult}"` : falseResult || "0";

    return `IF(${combinedCond}, ${trueVal}, ${falseVal})`;
  };

  const activeExpression = formulaType === "math" ? expression : buildGeneratedExpression();

  const handleTestFormula = async () => {
    const exprToTest = activeExpression.trim();
    if (!exprToTest) {
      setValidationResult({
        is_valid: false,
        error: "Formula expression is empty.",
      });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      const payload = {
        target_sub_key: selectedTargetKey,
        formula_expression: exprToTest,
        sub_fields: allSubFields.map((sf) => ({
          key: sf.key,
          name: sf.name || sf.key,
          field_type: sf.field_type || "number",
          config: sf.config || null,
        })),
      };

      const res = await api.post<any>("/kpis/subfields/validate-formula", payload);
      setValidationResult(res);
    } catch (err: any) {
      setValidationResult({
        is_valid: false,
        error: err.detail || err.message || "Failed to validate formula with backend engine.",
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    const finalExpr = activeExpression.trim();

    if (isEnabled && finalExpr) {
      if (!validationResult || !validationResult.is_valid) {
        try {
          const payload = {
            target_sub_key: selectedTargetKey,
            formula_expression: finalExpr,
            sub_fields: allSubFields.map((sf) => ({
              key: sf.key,
              name: sf.name || sf.key,
              field_type: sf.field_type || "number",
              config: sf.config || null,
            })),
          };

          const res = await api.post<any>("/kpis/subfields/validate-formula", payload);

          if (!res.is_valid) {
            setValidationResult(res);
            return;
          }
        } catch (err: any) {
          setValidationResult({
            is_valid: false,
            error: err.detail || err.message || "Validation failed.",
          });
          return;
        }
      }
    }

    const updatedConfig = {
      ...(currentTargetSubField.config || {}),
      is_formula: isEnabled,
      formula_type: formulaType,
      formula_expression: isEnabled ? finalExpr : "",
      conditions: isEnabled ? conditions : [],
      true_result: trueResult,
      false_result: falseResult,
      decimal_places: decimalPlaces,
    };

    onSave({
      target_key: selectedTargetKey,
      is_formula: isEnabled,
      formula_expression: isEnabled ? finalExpr : "",
      field_type: isEnabled ? "formula" : (currentTargetSubField.field_type === "formula" ? "number" : currentTargetSubField.field_type || "number"),
      config: updatedConfig,
    });

    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.4)",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "720px",
          maxHeight: "90vh",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: "1px solid #e5e7eb",
        }}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: "1rem 1.25rem",
            borderBottom: "1px solid #e5e7eb",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: "#ffffff",
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
              fx
            </span>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600, color: "#111827" }}>
              Configure Row-Level Formula
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: "1.2rem",
              color: "#9ca3af",
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
            gap: "1rem",
            backgroundColor: "#ffffff",
          }}
        >
          {/* Target Column Selection & Enable Toggle */}
          <div
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "8px",
              backgroundColor: "#f9fafb",
              border: "1px solid #e5e7eb",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: "1rem",
              alignItems: "center",
            }}
          >
            <div>
              <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", marginBottom: "0.25rem" }}>
                Target Column (Cell to Calculate)
              </label>
              <select
                value={selectedTargetKey}
                onChange={(e) => {
                  setSelectedTargetKey(e.target.value);
                  setValidationResult(null);
                }}
                style={{
                  width: "100%",
                  padding: "0.45rem 0.65rem",
                  borderRadius: "6px",
                  border: "1px solid #d1d5db",
                  backgroundColor: "#ffffff",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  color: "#111827",
                  outline: "none",
                }}
              >
                {allSubFields.map((sf) => (
                  <option key={sf.key} value={sf.key}>
                    {sf.name || sf.key} ({sf.key})
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "1rem", paddingLeft: "1rem", borderLeft: "1px solid #e5e7eb" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                  Decimal Digits
                </label>
                <select
                  value={decimalPlaces}
                  onChange={(e) => setDecimalPlaces(e.target.value === "auto" ? "auto" : Number(e.target.value))}
                  style={{
                    padding: "0.3rem 0.5rem",
                    borderRadius: "6px",
                    border: "1px solid #d1d5db",
                    backgroundColor: "#ffffff",
                    fontSize: "0.8rem",
                    fontWeight: 500,
                    color: "#111827",
                    outline: "none",
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

              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <div>
                  <span style={{ display: "block", fontSize: "0.825rem", fontWeight: 600, color: "#111827" }}>Formula Enabled</span>
                  <span style={{ fontSize: "0.725rem", color: "#6b7280" }}>Auto-calc per row</span>
                </div>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => {
                    setIsEnabled(e.target.checked);
                    setValidationResult(null);
                  }}
                  style={{ width: "18px", height: "18px", accentColor: "#2563eb", cursor: "pointer" }}
                />
              </div>
            </div>
          </div>

          {isEnabled && (
            <>
              {/* Formula Type Selection */}
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", marginBottom: "0.4rem" }}>
                  Formula Mode
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.5rem" }}>
                  {[
                    { id: "math", label: "Math Calculation", desc: "e.g. Total Faculty + Faculty Submitted" },
                    { id: "conditional", label: "Conditional IF / ELSE", desc: "IF Column = X THEN Value" },
                    { id: "comparison", label: "Text Comparison", desc: "Compare extracted strings" },
                  ].map((ft) => (
                    <button
                      key={ft.id}
                      type="button"
                      onClick={() => {
                        setFormulaType(ft.id as any);
                        setValidationResult(null);
                      }}
                      style={{
                        padding: "0.65rem",
                        borderRadius: "8px",
                        textAlign: "left",
                        border: formulaType === ft.id ? "2px solid #2563eb" : "1px solid #e5e7eb",
                        backgroundColor: formulaType === ft.id ? "#eff6ff" : "#ffffff",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: "0.825rem", fontWeight: 600, color: formulaType === ft.id ? "#1d4ed8" : "#374151" }}>
                        {ft.label}
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "#6b7280", marginTop: "0.1rem" }}>
                        {ft.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Math / Calculation Mode */}
              {formulaType === "math" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                  {/* Clickable Column Pills */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                      Available Source Columns (Click to Insert)
                    </label>
                    {availableSourceColumns.length > 0 ? (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                        {availableSourceColumns.map((sf) => (
                          <button
                            key={sf.key}
                            type="button"
                            onClick={() => insertToken(sf.key)}
                            style={{
                              padding: "0.35rem 0.65rem",
                              borderRadius: "6px",
                              backgroundColor: "#eff6ff",
                              color: "#1d4ed8",
                              border: "1px solid #bfdbfe",
                              fontSize: "0.8rem",
                              fontWeight: 500,
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: "0.3rem",
                            }}
                          >
                            <span>+ {sf.name || sf.key}</span>
                            <span style={{ fontSize: "0.7rem", opacity: 0.65, fontFamily: "monospace" }}>({sf.key})</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: "0.775rem", color: "#9ca3af", fontStyle: "italic", margin: 0 }}>
                        No other columns available in this table.
                      </p>
                    )}
                  </div>

                  {/* Math Operations */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase", marginBottom: "0.35rem" }}>
                      Operations
                    </label>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
                      {["+", "-", "*", "/", "(", ")", "SUM", "AVG", "MIN", "MAX"].map((op) => (
                        <button
                          key={op}
                          type="button"
                          onClick={() => insertToken(op === "SUM" || op === "AVG" || op === "MIN" || op === "MAX" ? `${op}(` : op)}
                          style={{
                            padding: "0.3rem 0.6rem",
                            borderRadius: "6px",
                            backgroundColor: "#f3f4f6",
                            color: "#374151",
                            border: "1px solid #d1d5db",
                            fontSize: "0.8rem",
                            fontWeight: 600,
                            fontFamily: "monospace",
                            cursor: "pointer",
                          }}
                        >
                          {op}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Formula Expression Field */}
                  <div>
                    <label style={{ display: "block", fontSize: "0.825rem", fontWeight: 600, color: "#374151", marginBottom: "0.3rem" }}>
                      Formula Expression
                    </label>
                    <textarea
                      value={expression}
                      onChange={(e) => {
                        setExpression(e.target.value);
                        setValidationResult(null);
                      }}
                      rows={3}
                      placeholder="e.g. Total Faculty + Faculty Who Submitted Publications"
                      style={{
                        width: "100%",
                        padding: "0.6rem 0.75rem",
                        borderRadius: "6px",
                        border: "1px solid #d1d5db",
                        fontFamily: "monospace",
                        fontSize: "0.875rem",
                        color: "#111827",
                        backgroundColor: "#ffffff",
                        boxSizing: "border-box",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Conditional / Text Comparison Mode */}
              {(formulaType === "conditional" || formulaType === "comparison") && (
                <div style={{ padding: "0.85rem", borderRadius: "8px", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase" }}>
                      Conditions
                    </label>
                    <button
                      type="button"
                      onClick={handleAddCondition}
                      style={{
                        padding: "0.25rem 0.55rem",
                        borderRadius: "6px",
                        backgroundColor: "#eff6ff",
                        color: "#2563eb",
                        border: "1px solid #bfdbfe",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      + Add Condition
                    </button>
                  </div>

                  {conditions.map((cond, idx) => (
                    <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0.4rem", alignItems: "center", backgroundColor: "#ffffff", padding: "0.5rem", borderRadius: "6px", border: "1px solid #d1d5db" }}>
                      <select
                        value={cond.colKey}
                        onChange={(e) => handleConditionChange(idx, "colKey", e.target.value)}
                        style={{ padding: "0.35rem 0.45rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.775rem" }}
                      >
                        <option value="">— Select Column —</option>
                        {availableSourceColumns.map((sf) => (
                          <option key={sf.key} value={sf.key}>
                            {sf.name || sf.key} ({sf.key})
                          </option>
                        ))}
                      </select>

                      <select
                        value={cond.operator}
                        onChange={(e) => handleConditionChange(idx, "operator", e.target.value)}
                        style={{ padding: "0.35rem 0.45rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.775rem", fontFamily: "monospace" }}
                      >
                        {COMPARISON_OPERATORS.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </select>

                      <input
                        type="text"
                        value={cond.value}
                        onChange={(e) => handleConditionChange(idx, "value", e.target.value)}
                        placeholder='Value'
                        style={{ padding: "0.35rem 0.45rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.775rem", fontFamily: "monospace" }}
                      />

                      {conditions.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveCondition(idx)}
                          style={{ background: "none", border: "none", color: "#dc2626", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", padding: "0 0.25rem" }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginTop: "0.2rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Result if TRUE
                      </label>
                      <input
                        type="text"
                        value={trueResult}
                        onChange={(e) => setTrueResult(e.target.value)}
                        placeholder='e.g. 1'
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.775rem", fontFamily: "monospace" }}
                      />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Result if FALSE
                      </label>
                      <input
                        type="text"
                        value={falseResult}
                        onChange={(e) => setFalseResult(e.target.value)}
                        placeholder='e.g. 0'
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.775rem", fontFamily: "monospace" }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Validation Status */}
              {validationResult && (
                <div
                  style={{
                    padding: "0.65rem 0.85rem",
                    borderRadius: "6px",
                    fontSize: "0.8rem",
                    border: validationResult.is_valid ? "1px solid #bbf7d0" : "1px solid #fecaca",
                    backgroundColor: validationResult.is_valid ? "#f0fdf4" : "#fef2f2",
                    color: validationResult.is_valid ? "#166534" : "#991b1b",
                  }}
                >
                  {validationResult.is_valid ? (
                    <div>
                      <div style={{ fontWeight: 600 }}>✓ Formula Valid</div>
                      {validationResult.sample_equation && (
                        <div style={{ marginTop: "0.25rem", fontSize: "0.75rem", fontFamily: "monospace" }}>
                          Sample Result: {validationResult.sample_equation}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 600 }}>⚠ Formula Error</div>
                      <div style={{ fontSize: "0.75rem", fontFamily: "monospace", marginTop: "0.15rem" }}>{validationResult.error}</div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "0.85rem 1.25rem",
            borderTop: "1px solid #e5e7eb",
            backgroundColor: "#ffffff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {isEnabled ? (
            <button
              type="button"
              onClick={handleTestFormula}
              disabled={isValidating || !activeExpression.trim()}
              style={{
                padding: "0.45rem 0.85rem",
                borderRadius: "6px",
                backgroundColor: "#f3f4f6",
                color: "#374151",
                border: "1px solid #d1d5db",
                fontSize: "0.8rem",
                fontWeight: 500,
                cursor: isValidating || !activeExpression.trim() ? "not-allowed" : "pointer",
                opacity: isValidating || !activeExpression.trim() ? 0.6 : 1,
              }}
            >
              {isValidating ? "Validating..." : "Test Formula"}
            </button>
          ) : (
            <div />
          )}

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "0.45rem 1rem",
                borderRadius: "6px",
                backgroundColor: "#ffffff",
                color: "#4b5563",
                border: "1px solid #d1d5db",
                fontSize: "0.825rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              style={{
                padding: "0.45rem 1.15rem",
                borderRadius: "6px",
                backgroundColor: "#2563eb",
                color: "#ffffff",
                border: "none",
                fontSize: "0.825rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Save Formula
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
