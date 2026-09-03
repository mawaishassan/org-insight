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
  thenResult?: string;
}

interface MliFormulaBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetSubField: SubFieldItem;
  allSubFields: SubFieldItem[];
  onSave: (updatedConfig: any) => void;
  orgId?: number | null;
  parentFieldKey?: string;
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

const FETCH_OPERATORS = [
  { label: "Equals (=)", value: "op_eq" },
  { label: "Not Equals (!=)", value: "op_neq" },
  { label: "Contains", value: "op_contains" },
  { label: "Not Contains", value: "op_not_contains" },
  { label: "Starts With", value: "op_starts_with" },
  { label: "Ends With", value: "op_ends_with" },
  { label: "Greater Than (>)", value: "op_gt" },
  { label: "Less Than (<)", value: "op_lt" },
  { label: "Greater or Equal (>=)", value: "op_gte" },
  { label: "Less or Equal (<=)", value: "op_lte" },
];

export interface FetchConditionRow {
  colKey: string;
  operator: string;
  valType: "current_row" | "static";
  value: string;
}

export function MliFormulaBuilderModal({
  isOpen,
  onClose,
  targetSubField: initialTargetSubField,
  allSubFields,
  onSave,
  orgId,
  parentFieldKey,
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

  const [formulaType, setFormulaType] = useState<"math" | "conditional" | "comparison" | "fetch">(
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

  // Fetch Operator States
  const [fetchSourceType, setFetchSourceType] = useState<"current" | "other">("current");
  const [fetchKpiId, setFetchKpiId] = useState<number | "">("");
  const [fetchMliKey, setFetchMliKey] = useState<string>("");
  const [fetchReturnCol, setFetchReturnCol] = useState<string>("");
  const [fetchSeparator, setFetchSeparator] = useState<string>(", ");
  const [fetchRemoveDuplicates, setFetchRemoveDuplicates] = useState<boolean>(true);
  const [fetchSortOrder, setFetchSortOrder] = useState<"none" | "asc" | "desc">("none");
  const [fetchEmptyFallback, setFetchEmptyFallback] = useState<string>("");
  const [fetchConditions, setFetchConditions] = useState<FetchConditionRow[]>([
    { colKey: "", operator: "op_eq", valType: "current_row", value: "" },
  ]);

  const [kpiList, setKpiList] = useState<Array<{ id: number; name: string }>>([]);
  const [sourceMliList, setSourceMliList] = useState<Array<{ id: number; name: string; key: string; sub_fields: any[] }>>([]);
  const [sourceSubFields, setSourceSubFields] = useState<Array<{ key: string; name: string }>>([]);

  const resolvedOrgId = orgId || (() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const oId = params.get("organization_id");
      return oId ? Number(oId) : null;
    }
    return null;
  })();

  // 1. Fetch organization KPIs
  useEffect(() => {
    if (isOpen && resolvedOrgId && formulaType === "fetch") {
      api<Array<{ id: number; name: string }>>(`/kpis?organization_id=${resolvedOrgId}`)
        .then(setKpiList)
        .catch((err) => console.error("Failed to load KPIs", err));
    }
  }, [isOpen, resolvedOrgId, formulaType]);

  // 2. Fetch MLI fields for selected KPI
  const currentKpiId = (() => {
    if (typeof window !== "undefined") {
      const match = window.location.pathname.match(/\/dashboard\/kpis\/(\d+)/);
      return match ? Number(match[1]) : null;
    }
    return null;
  })();

  const selectedKpiIdForFields = fetchSourceType === "current" ? currentKpiId : fetchKpiId;

  useEffect(() => {
    if (isOpen && selectedKpiIdForFields && resolvedOrgId && formulaType === "fetch") {
      api<any[]>(`/fields?kpi_id=${selectedKpiIdForFields}&organization_id=${resolvedOrgId}`)
        .then((fields) => {
          const mlis = fields.filter((f) => f.field_type === "multi_line_items");
          setSourceMliList(mlis);
          if (fetchSourceType === "current" && parentFieldKey) {
            setFetchMliKey(parentFieldKey);
          } else if (mlis.length > 0 && !mlis.some(m => m.key === fetchMliKey)) {
            setFetchMliKey(mlis[0].key);
          }
        })
        .catch((err) => console.error("Failed to load KPI fields", err));
    }
  }, [isOpen, selectedKpiIdForFields, resolvedOrgId, formulaType, fetchSourceType, parentFieldKey]);

  // 3. Update source subfields when source MLI field changes
  useEffect(() => {
    if (fetchMliKey && sourceMliList.length > 0) {
      const selectedMli = sourceMliList.find((m) => m.key === fetchMliKey);
      if (selectedMli) {
        const subs = selectedMli.sub_fields || [];
        setSourceSubFields(subs);
        if (subs.length > 0 && !subs.some((s: any) => s.key === fetchReturnCol)) {
          setFetchReturnCol(subs[0].key);
        }
      }
    }
  }, [fetchMliKey, sourceMliList]);

  // Sync existing config on open
  useEffect(() => {
    if (isOpen && currentTargetSubField) {
      const cfg = currentTargetSubField.config || {};
      const expr = cfg.formula_expression || "";

      setSelectedTargetKey(currentTargetSubField.key);
      setIsEnabled(Boolean(cfg.is_formula || currentTargetSubField.field_type === "formula" || true));
      setDecimalPlaces(cfg.decimal_places !== undefined ? cfg.decimal_places : 2);
      setTrueResult(cfg.true_result ?? "1");
      setFalseResult(cfg.false_result ?? "0");
      setValidationResult(null);

      // Detect if fetch formula or set formula mode
      if (expr.startsWith("FETCH_ITEMS_WHERE") || expr.startsWith("FETCH_KPI_ITEMS_WHERE")) {
        setFormulaType("fetch");
        setFetchSourceType(cfg.fetch_source_type || (expr.startsWith("FETCH_KPI_ITEMS_WHERE") ? "other" : "current"));
        setFetchKpiId(cfg.fetch_kpi_id || "");
        setFetchMliKey(cfg.fetch_mli_key || "");
        setFetchReturnCol(cfg.fetch_return_col || "");
        setFetchSeparator(cfg.fetch_separator ?? ", ");
        setFetchRemoveDuplicates(cfg.fetch_remove_duplicates !== undefined ? cfg.fetch_remove_duplicates : true);
        setFetchSortOrder(cfg.fetch_sort_order || "none");
        setFetchEmptyFallback(cfg.fetch_empty_fallback || "");
        if (cfg.fetch_conditions && Array.isArray(cfg.fetch_conditions) && cfg.fetch_conditions.length > 0) {
          setFetchConditions(cfg.fetch_conditions);
        } else {
          setFetchConditions([{ colKey: "", operator: "op_eq", valType: "current_row", value: "" }]);
        }
      } else {
        setFormulaType(cfg.formula_type || "math");
        setExpression(expr);
        if (cfg.conditions && Array.isArray(cfg.conditions) && cfg.conditions.length > 0) {
          setConditions(cfg.conditions);
        } else {
          const firstCol = allSubFields.find((sf) => sf.key !== currentTargetSubField.key);
          setConditions([{ colKey: firstCol?.key || "", operator: "==", value: "" }]);
        }
      }
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

  const buildFetchExpression = () => {
    const isCurrent = fetchSourceType === "current";
    const separatorQuote = `"${(fetchSeparator || "").replace(/"/g, '\\"')}"`;
    const removeDupsVal = fetchRemoveDuplicates ? "yes" : "no";
    const sortVal = `"${fetchSortOrder}"`;
    const fallbackQuote = `"${(fetchEmptyFallback || "").replace(/"/g, '\\"')}"`;
    
    const condArgs: string[] = [];
    fetchConditions.forEach((c, idx) => {
      if (!c.colKey || !c.operator) return;
      if (idx > 0) {
        condArgs.push(`"op_and"`);
      }
      condArgs.push(`"${c.colKey}"`);
      condArgs.push(`"${c.operator}"`);
      if (c.valType === "current_row") {
        condArgs.push(`CurrentRow.${c.value}`);
      } else {
        const valNum = Number(c.value);
        const isNum = !isNaN(valNum) && c.value.trim() !== "";
        condArgs.push(isNum ? c.value : `"${c.value.replace(/"/g, '\\"')}"`);
      }
    });

    const argsStr = [
      isCurrent ? `"${parentFieldKey || fetchMliKey}"` : `"${fetchMliKey}"`,
      `"${fetchReturnCol}"`,
      separatorQuote,
      `"${removeDupsVal}"`,
      sortVal,
      fallbackQuote,
      ...condArgs
    ].join(", ");

    if (isCurrent) {
      return `FETCH_ITEMS_WHERE(${argsStr})`;
    } else {
      return `FETCH_KPI_ITEMS_WHERE(${fetchKpiId}, ${argsStr})`;
    }
  };

  const buildGeneratedExpression = () => {
    if (formulaType === "fetch") {
      return buildFetchExpression();
    }
    if (formulaType === "math") {
      return expression;
    }

    const validConds = conditions.filter((c) => c.colKey && c.operator);
    if (validConds.length === 0) return "";

    const falseVal = isNaN(Number(falseResult)) ? `"${falseResult}"` : falseResult || "0";

    let expr = falseVal;
    for (let i = validConds.length - 1; i >= 0; i--) {
      const c = validConds[i];
      const colRef = c.colKey;
      const valQuote = isNaN(Number(c.value)) ? `"${c.value}"` : c.value;
      let condClause = `${colRef} ${c.operator} ${valQuote}`;
      if (c.operator === "contains") {
        condClause = `contains(${colRef}, ${valQuote})`;
      } else if (c.operator === "starts_with") {
        condClause = `starts_with(${colRef}, ${valQuote})`;
      } else if (c.operator === "ends_with") {
        condClause = `ends_with(${colRef}, ${valQuote})`;
      }

      const resText = c.thenResult !== undefined && c.thenResult !== "" ? c.thenResult : (i === 0 ? trueResult : "1");
      const thenVal = isNaN(Number(resText)) ? `"${resText}"` : resText || "1";

      expr = `IF(${condClause}, ${thenVal}, ${expr})`;
    }
    return expr;
  };

  const activeExpression =
    formulaType === "math"
      ? expression
      : buildGeneratedExpression();

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
      conditions: isEnabled && formulaType !== "fetch" ? conditions : [],
      true_result: trueResult,
      false_result: falseResult,
      decimal_places: decimalPlaces,
      fetch_source_type: fetchSourceType,
      fetch_kpi_id: fetchKpiId,
      fetch_mli_key: fetchMliKey,
      fetch_return_col: fetchReturnCol,
      fetch_separator: fetchSeparator,
      fetch_remove_duplicates: fetchRemoveDuplicates,
      fetch_sort_order: fetchSortOrder,
      fetch_empty_fallback: fetchEmptyFallback,
      fetch_conditions: fetchConditions,
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
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem" }}>
                  {[
                    { id: "math", label: "Math Calculation", desc: "e.g. Total Faculty + Faculty Submitted" },
                    { id: "conditional", label: "Conditional IF / ELSE", desc: "IF Column = X THEN Value" },
                    { id: "comparison", label: "Text Comparison", desc: "Compare extracted strings" },
                    { id: "fetch", label: "Fetch Filtered MLI", desc: "Fetch values from MLI table by filter" },
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
                      Conditional Rules (IF / ELSE IF / ELSE)
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
                      + Add Else If Condition
                    </button>
                  </div>

                  {conditions.map((cond, idx) => (
                    <div key={idx} style={{ backgroundColor: "#ffffff", padding: "0.6rem", borderRadius: "6px", border: "1px solid #d1d5db", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.4rem", borderRadius: "4px", background: idx === 0 ? "#e0f2fe" : "#f1f5f9", color: idx === 0 ? "#0369a1" : "#475569" }}>
                          {idx === 0 ? "IF" : "ELSE IF"}
                        </span>
                        <select
                          value={cond.colKey}
                          onChange={(e) => handleConditionChange(idx, "colKey", e.target.value)}
                          style={{ flex: 1, padding: "0.35rem 0.45rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.775rem" }}
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
                          style={{ flex: 1, padding: "0.35rem 0.45rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.775rem", fontFamily: "monospace" }}
                        />

                        {conditions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveCondition(idx)}
                            style={{ background: "none", border: "none", color: "#dc2626", fontWeight: 700, fontSize: "1rem", cursor: "pointer", padding: "0 0.25rem" }}
                            title="Remove condition"
                          >
                            ×
                          </button>
                        )}
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", paddingLeft: "0.2rem" }}>
                        <span style={{ fontSize: "0.7rem", fontWeight: 600, color: "#6b7280" }}>THEN Output:</span>
                        <input
                          type="text"
                          value={cond.thenResult !== undefined ? cond.thenResult : (idx === 0 ? trueResult : "1")}
                          onChange={(e) => {
                            if (idx === 0) setTrueResult(e.target.value);
                            handleConditionChange(idx, "thenResult", e.target.value);
                          }}
                          placeholder='e.g. "Below 60" or 1'
                          style={{ flex: 1, padding: "0.3rem 0.45rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.775rem", fontFamily: "monospace" }}
                        />
                      </div>
                    </div>
                  ))}

                  <div style={{ backgroundColor: "#ffffff", padding: "0.6rem", borderRadius: "6px", border: "1px solid #d1d5db", marginTop: "0.2rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span style={{ fontSize: "0.7rem", fontWeight: 700, padding: "0.15rem 0.4rem", borderRadius: "4px", background: "#fef3c7", color: "#92400e" }}>
                        ELSE
                      </span>
                      <span style={{ fontSize: "0.725rem", fontWeight: 600, color: "#4b5563" }}>
                        Default Output (If No Conditions Match):
                      </span>
                      <input
                        type="text"
                        value={falseResult}
                        onChange={(e) => setFalseResult(e.target.value)}
                        placeholder='e.g. "Satisfactory" or 0'
                        style={{ flex: 1, padding: "0.3rem 0.45rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.775rem", fontFamily: "monospace" }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Fetch Filtered MLI Mode */}
              {formulaType === "fetch" && (
                <div style={{ padding: "0.85rem", borderRadius: "8px", backgroundColor: "#f9fafb", border: "1px solid #e5e7eb", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                  
                  {/* Source KPI configuration */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Source KPI
                      </label>
                      <select
                        value={fetchSourceType}
                        onChange={(e) => {
                          setFetchSourceType(e.target.value as any);
                          setFetchKpiId("");
                          setFetchMliKey("");
                          setFetchReturnCol("");
                          setSourceMliList([]);
                          setSourceSubFields([]);
                          setValidationResult(null);
                        }}
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", backgroundColor: "#ffffff" }}
                      >
                        <option value="current">Current KPI</option>
                        <option value="other">Other KPI</option>
                      </select>
                    </div>

                    {fetchSourceType === "other" && (
                      <div>
                        <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                          Select KPI
                        </label>
                        <select
                          value={fetchKpiId}
                          onChange={(e) => {
                            setFetchKpiId(Number(e.target.value) || "");
                            setFetchMliKey("");
                            setFetchReturnCol("");
                            setSourceMliList([]);
                            setSourceSubFields([]);
                            setValidationResult(null);
                          }}
                          style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", backgroundColor: "#ffffff" }}
                        >
                          <option value="">— Select KPI —</option>
                          {kpiList.map((k) => (
                            <option key={k.id} value={k.id}>
                              {k.name} (ID: {k.id})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* MLI Field & Return Column selection */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Source MLI Table
                      </label>
                      <select
                        value={fetchMliKey}
                        onChange={(e) => {
                          setFetchMliKey(e.target.value);
                          setFetchReturnCol("");
                          setSourceSubFields([]);
                          setValidationResult(null);
                        }}
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", backgroundColor: "#ffffff" }}
                      >
                        <option value="">— Select MLI —</option>
                        {sourceMliList.map((m) => (
                          <option key={m.key} value={m.key}>
                            {m.name || m.key} ({m.key})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Column to Retrieve (Return Value)
                      </label>
                      <select
                        value={fetchReturnCol}
                        onChange={(e) => {
                          setFetchReturnCol(e.target.value);
                          setValidationResult(null);
                        }}
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", backgroundColor: "#ffffff" }}
                      >
                        <option value="">— Select Column —</option>
                        {sourceSubFields.map((s) => (
                          <option key={s.key} value={s.key}>
                            {s.name || s.key} ({s.key})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Settings: Separator, Sort Order, Duplicates, Fallback */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "0.4rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Separator
                      </label>
                      <input
                        type="text"
                        value={fetchSeparator}
                        onChange={(e) => {
                          setFetchSeparator(e.target.value);
                          setValidationResult(null);
                        }}
                        placeholder="e.g. , "
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", boxSizing: "border-box" }}
                      />
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Remove Duplicates
                      </label>
                      <select
                        value={fetchRemoveDuplicates ? "yes" : "no"}
                        onChange={(e) => {
                          setFetchRemoveDuplicates(e.target.value === "yes");
                          setValidationResult(null);
                        }}
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", backgroundColor: "#ffffff" }}
                      >
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Sort Order
                      </label>
                      <select
                        value={fetchSortOrder}
                        onChange={(e) => {
                          setFetchSortOrder(e.target.value as any);
                          setValidationResult(null);
                        }}
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", backgroundColor: "#ffffff" }}
                      >
                        <option value="none">Source Order</option>
                        <option value="asc">Ascending</option>
                        <option value="desc">Descending</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.725rem", fontWeight: 600, color: "#4b5563", marginBottom: "0.2rem" }}>
                        Empty Fallback
                      </label>
                      <input
                        type="text"
                        value={fetchEmptyFallback}
                        onChange={(e) => {
                          setFetchEmptyFallback(e.target.value);
                          setValidationResult(null);
                        }}
                        placeholder="e.g. N/A"
                        style={{ width: "100%", padding: "0.35rem 0.5rem", borderRadius: "6px", border: "1px solid #d1d5db", fontSize: "0.8rem", boxSizing: "border-box" }}
                      />
                    </div>
                  </div>

                  {/* Filter Conditions Builder */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.25rem" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <label style={{ fontSize: "0.75rem", fontWeight: 600, color: "#4b5563", textTransform: "uppercase" }}>
                        Filter Conditions
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const firstCol = sourceSubFields[0]?.key || "";
                          setFetchConditions((prev) => [...prev, { colKey: firstCol, operator: "op_eq", valType: "current_row", value: "" }]);
                        }}
                        style={{ padding: "0.2rem 0.5rem", borderRadius: "6px", backgroundColor: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe", fontSize: "0.725rem", fontWeight: 600, cursor: "pointer" }}
                      >
                        + Add Condition
                      </button>
                    </div>

                    {fetchConditions.map((cond, idx) => (
                      <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr 1.2fr auto", gap: "0.35rem", alignItems: "center", backgroundColor: "#ffffff", padding: "0.45rem", borderRadius: "6px", border: "1px solid #d1d5db" }}>
                        {/* Source Column dropdown */}
                        <select
                          value={cond.colKey}
                          onChange={(e) => {
                            setFetchConditions((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], colKey: e.target.value };
                              return next;
                            });
                            setValidationResult(null);
                          }}
                          style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.75rem", width: "100%" }}
                        >
                          <option value="">— Source Col —</option>
                          {sourceSubFields.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.name || s.key}
                            </option>
                          ))}
                        </select>

                        {/* Operator */}
                        <select
                          value={cond.operator}
                          onChange={(e) => {
                            setFetchConditions((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], operator: e.target.value };
                              return next;
                            });
                            setValidationResult(null);
                          }}
                          style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.75rem", width: "100%" }}
                        >
                          {FETCH_OPERATORS.map((op) => (
                            <option key={op.value} value={op.value}>
                              {op.label}
                            </option>
                          ))}
                        </select>

                        {/* Value Type: Current Row vs Static */}
                        <select
                          value={cond.valType}
                          onChange={(e) => {
                            setFetchConditions((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], valType: e.target.value as any, value: "" };
                              return next;
                            });
                            setValidationResult(null);
                          }}
                          style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.75rem", width: "100%" }}
                        >
                          <option value="current_row">Current Row Col</option>
                          <option value="static">Static Value</option>
                        </select>

                        {/* Value Input/Dropdown */}
                        {cond.valType === "current_row" ? (
                          <select
                            value={cond.value}
                            onChange={(e) => {
                              setFetchConditions((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], value: e.target.value };
                                return next;
                              });
                              setValidationResult(null);
                            }}
                            style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.75rem", width: "100%" }}
                          >
                            <option value="">— Select Col —</option>
                            {allSubFields.map((s) => (
                              <option key={s.key} value={s.key}>
                                {s.name || s.key}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={cond.value}
                            onChange={(e) => {
                              setFetchConditions((prev) => {
                                const next = [...prev];
                                next[idx] = { ...next[idx], value: e.target.value };
                                return next;
                              });
                              setValidationResult(null);
                            }}
                            placeholder="Static Value"
                            style={{ padding: "0.3rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.75rem", width: "100%", boxSizing: "border-box" }}
                          />
                        )}

                        {/* Delete condition button */}
                        {fetchConditions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => {
                              setFetchConditions((prev) => prev.filter((_, i) => i !== idx));
                              setValidationResult(null);
                            }}
                            style={{ background: "none", border: "none", color: "#dc2626", fontWeight: 700, fontSize: "0.95rem", cursor: "pointer", padding: "0 0.15rem" }}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
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
