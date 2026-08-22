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

interface MliFormulaBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetSubField: SubFieldItem;
  allSubFields: SubFieldItem[];
  onSave: (updatedConfig: any) => void;
}

export function MliFormulaBuilderModal({
  isOpen,
  onClose,
  targetSubField,
  allSubFields,
  onSave,
}: MliFormulaBuilderModalProps) {
  const existingConfig = targetSubField.config || {};
  const [isEnabled, setIsEnabled] = useState<boolean>(
    Boolean(existingConfig.is_formula || targetSubField.field_type === "formula")
  );
  const [expression, setExpression] = useState<string>(
    existingConfig.formula_expression || ""
  );
  
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [validationResult, setValidationResult] = useState<{
    is_valid?: boolean;
    error?: string | null;
    sample_result?: any;
    sample_equation?: string | null;
  } | null>(null);

  // Available source columns (excluding target column to prevent self-reference)
  const availableColumns = allSubFields.filter(
    (sf) => sf.key !== targetSubField.key && sf.key.trim() !== ""
  );

  useEffect(() => {
    if (isOpen) {
      const cfg = targetSubField.config || {};
      setIsEnabled(Boolean(cfg.is_formula || targetSubField.field_type === "formula"));
      setExpression(cfg.formula_expression || "");
      setValidationResult(null);
    }
  }, [isOpen, targetSubField]);

  if (!isOpen) return null;

  const insertToken = (token: string) => {
    setExpression((prev) => {
      if (!prev) return token;
      // Add spaces around arithmetic operators if needed
      const needSpace = ["+", "-", "*", "/", "=="].includes(token);
      return prev + (needSpace ? ` ${token} ` : token);
    });
    setValidationResult(null);
  };

  const handleTestFormula = async () => {
    if (!expression.trim()) {
      setValidationResult({
        is_valid: false,
        error: "Formula expression cannot be empty.",
      });
      return;
    }

    setIsValidating(true);
    setValidationResult(null);

    try {
      const payload = {
        target_sub_key: targetSubField.key,
        formula_expression: expression,
        sub_fields: allSubFields.map((sf) => ({
          key: sf.key,
          name: sf.name || sf.key,
          field_type: sf.field_type || "number",
          config: sf.config || null,
        })),
      };

      const res = await api.post<any>("/api/kpis/subfields/validate-formula", payload);
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
    if (isEnabled && expression.trim()) {
      // Validate before saving if not already tested
      if (!validationResult || !validationResult.is_valid) {
        try {
          const payload = {
            target_sub_key: targetSubField.key,
            formula_expression: expression,
            sub_fields: allSubFields.map((sf) => ({
              key: sf.key,
              name: sf.name || sf.key,
              field_type: sf.field_type || "number",
              config: sf.config || null,
            })),
          };

          const res = await api.post<any>("/api/kpis/subfields/validate-formula", payload);

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
      ...(targetSubField.config || {}),
      is_formula: isEnabled,
      formula_expression: isEnabled ? expression.trim() : "",
    };

    onSave({
      is_formula: isEnabled,
      formula_expression: isEnabled ? expression.trim() : "",
      field_type: isEnabled ? "formula" : (targetSubField.field_type === "formula" ? "number" : targetSubField.field_type || "number"),
      config: updatedConfig,
    });

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-gray-100 flex flex-col gap-5 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4">
          <div>
            <h3 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 font-mono text-sm">fx</span>
              Formula Configuration
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              Configure row-level formula calculation for <span className="font-semibold text-gray-800">[{targetSubField.name || targetSubField.key}]</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Enable Formula Toggle */}
        <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-200">
          <div>
            <span className="font-medium text-gray-900">Enable Formula</span>
            <p className="text-xs text-gray-500">Automatically calculate value for each row using other columns</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isEnabled}
              onChange={(e) => {
                setIsEnabled(e.target.checked);
                setValidationResult(null);
              }}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
        </div>

        {isEnabled && (
          <div className="space-y-4">
            {/* Target Column Info */}
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="font-medium text-gray-700">Target Column:</span>
              <span className="px-2.5 py-1 rounded-md bg-indigo-100 text-indigo-800 font-semibold font-mono text-xs">
                {targetSubField.name || targetSubField.key} ({targetSubField.key})
              </span>
            </div>

            {/* Formula Expression Textarea */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Formula Expression
              </label>
              <textarea
                value={expression}
                onChange={(e) => {
                  setExpression(e.target.value);
                  setValidationResult(null);
                }}
                rows={3}
                placeholder="e.g. Q1 + Q2 + Q3 or Quantity * Price"
                className="w-full font-mono text-sm p-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-sm"
              />
            </div>

            {/* Operations Bar */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Operations
              </label>
              <div className="flex flex-wrap gap-1.5">
                {["+", "-", "*", "/", "(", ")", "SUM", "AVG", "MIN", "MAX"].map((op) => (
                  <button
                    key={op}
                    type="button"
                    onClick={() => insertToken(op === "SUM" || op === "AVG" || op === "MIN" || op === "MAX" ? `${op}(` : op)}
                    className="px-3 py-1.5 text-xs font-semibold font-mono rounded-lg bg-gray-100 hover:bg-indigo-50 hover:text-indigo-600 border border-gray-200 transition-colors"
                  >
                    {op}
                  </button>
                ))}
              </div>
            </div>

            {/* Available Source Columns */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Available Columns (Click to Insert)
              </label>
              {availableColumns.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableColumns.map((sf) => (
                    <button
                      key={sf.key}
                      type="button"
                      onClick={() => insertToken(sf.name || sf.key)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 transition-colors flex items-center gap-1.5"
                    >
                      <span className="font-semibold">{sf.name || sf.key}</span>
                      <span className="text-[10px] text-indigo-400 font-mono">({sf.key})</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No other columns available in this MLI.</p>
              )}
            </div>

            {/* Preview & Validation Status */}
            <div className="pt-2">
              {validationResult && (
                <div
                  className={`p-4 rounded-xl text-sm border ${
                    validationResult.is_valid
                      ? "bg-emerald-50 text-emerald-900 border-emerald-200"
                      : "bg-rose-50 text-rose-900 border-rose-200"
                  }`}
                >
                  {validationResult.is_valid ? (
                    <div className="space-y-1">
                      <div className="font-semibold flex items-center gap-1.5 text-emerald-700">
                        <span>✓ Formula Valid</span>
                      </div>
                      {validationResult.sample_equation && (
                        <div className="mt-2 text-xs font-mono bg-emerald-100/60 p-2 rounded-lg text-emerald-900">
                          <span className="font-semibold text-emerald-800">Sample Result: </span>
                          {validationResult.sample_equation}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="font-semibold flex items-center gap-1.5 text-rose-700">
                        <span>⚠ Validation Error</span>
                      </div>
                      <p className="text-xs text-rose-800 mt-1 font-mono">{validationResult.error}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between border-t pt-4 mt-2">
          {isEnabled ? (
            <button
              type="button"
              onClick={handleTestFormula}
              disabled={isValidating || !expression.trim()}
              className="px-4 py-2 text-xs font-semibold rounded-xl bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50 border border-gray-300 transition-colors flex items-center gap-2"
            >
              {isValidating ? (
                <>
                  <span className="w-3 h-3 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></span>
                  Validating...
                </>
              ) : (
                "Test Formula"
              )}
            </button>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium rounded-xl text-gray-600 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-5 py-2 text-sm font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-md shadow-indigo-200 transition-colors"
            >
              Save Configuration
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
