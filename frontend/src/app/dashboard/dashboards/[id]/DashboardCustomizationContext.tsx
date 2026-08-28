"use client";

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import toast from "react-hot-toast";

interface Customization {
  id: number;
  organization_id: number;
  dashboard_id: number;
  widget_id: string | null;
  original_label: string;
  customized_label: string;
}

function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

interface DashboardCustomizationContextProps {
  globalCustomizations: Record<string, string>;
  widgetCustomizations: Record<string, Record<string, string>>;
  isOrgAdmin: boolean;
  loading: boolean;
  registerWidgetLabels: (widgetId: string, labels: string[]) => void;
  getDisplayLabel: (originalLabel: string, widgetId?: string) => string;
  saveCustomization: (widgetId: string | null, originalLabel: string, customizedLabel: string) => Promise<void>;
  deleteCustomization: (widgetId: string | null, originalLabel: string) => Promise<void>;
  allPageLabels: string[];
  openEditModal: (originalLabel: string, widgetId?: string) => void;
  openGlobalModal: () => void;
  consistentColors?: boolean;
  colorMappings?: Record<string, string>;
  getColorForValue: (value: string, idx: number, total: number, defaultColor: string) => string;
  fetchDataWithDate?: boolean;
  periodOptions?: any[];
  selectedPeriod?: string;
  selectedPeriodType?: string;
  /** Increments every time selectedPeriod or selectedPeriodType changes. Widgets use this
   *  to associate requests with a configuration and discard stale responses. */
  requestGeneration: number;
  setWidgetLoading: (widgetId: string | number, isLoading: boolean) => void;
  isAnyWidgetLoading: boolean;
}

const DashboardCustomizationContext = createContext<DashboardCustomizationContextProps | null>(null);

export function useDashboardCustomization() {
  const context = useContext(DashboardCustomizationContext);
  if (!context) {
    return {
      globalCustomizations: {},
      widgetCustomizations: {},
      isOrgAdmin: false,
      loading: false,
      registerWidgetLabels: () => {},
      getDisplayLabel: (originalLabel: string) => originalLabel,
      saveCustomization: async () => {},
      deleteCustomization: async () => {},
      allPageLabels: [],
      openEditModal: () => {},
      openGlobalModal: () => {},
      consistentColors: false,
      colorMappings: {},
      getColorForValue: (value: string, idx: number, total: number, defaultColor: string) => defaultColor,
      fetchDataWithDate: false,
      periodOptions: [],
      selectedPeriod: "",
      requestGeneration: 0,
      setWidgetLoading: () => {},
      isAnyWidgetLoading: false,
    };
  }
  return context;
}

export function DashboardCustomizationProvider({
  children,
  dashboardId,
  organizationId,
  consistentColors = false,
  colorMappings = {},
  fetchDataWithDate = false,
  periodOptions = [],
  selectedPeriod = "",
  selectedPeriodType = "",
}: {
  children: React.ReactNode;
  dashboardId: number;
  organizationId: number;
  consistentColors?: boolean;
  colorMappings?: Record<string, string>;
  fetchDataWithDate?: boolean;
  periodOptions?: any[];
  selectedPeriod?: string;
  selectedPeriodType?: string;
}) {
  const token = getAccessToken();
  const [globalCustomizations, setGlobalCustomizations] = useState<Record<string, string>>({});
  const [widgetCustomizations, setWidgetCustomizations] = useState<Record<string, Record<string, string>>>({});
  const [isOrgAdmin, setIsOrgAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  // Monotonically increasing counter — increments on every period/type change so widgets
  // can detect and discard stale in-flight responses.
  const [requestGeneration, setRequestGeneration] = useState(0);
  const prevConfigRef = useRef("");

  useEffect(() => {
    const key = `${selectedPeriodType}::${selectedPeriod}`;
    if (prevConfigRef.current !== key) {
      prevConfigRef.current = key;
      setRequestGeneration((g) => g + 1);
    }
  }, [selectedPeriodType, selectedPeriod]);

  const DEFAULT_COLORS = useMemo(() => [
    "#4E79A7", // Blue
    "#F28E2B", // Orange
    "#E15759", // Red
    "#76B7B2", // Cyan/Teal
    "#59A14F", // Green
    "#EDC948", // Yellow
    "#B07AA1", // Purple
    "#FF9DA7", // Pink
    "#9C755F", // Brown
    "#56B4E9", // Light Blue
    "#009E73", // Emerald
    "#0072B2", // Medium Blue
    "#D55E00", // Dark Orange
    "#CC79A7", // Magenta
  ], []);

  const OTHERS_COLOR = "#9ca3af"; // Gray

  const getColorForValue = useCallback((value: string, idx: number, total: number, defaultColor: string) => {
    if (!consistentColors) return defaultColor;
    
    const key = (value || "").trim();
    if (!key) return defaultColor;
    
    const keyLower = key.toLowerCase();
    if (keyLower === "others") return colorMappings[key] || OTHERS_COLOR;
    
    if (colorMappings[key]) return colorMappings[key];
    
    // Deterministic fallback if not explicitly mapped yet
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const usedColors = new Set(Object.values(colorMappings));
    const available = DEFAULT_COLORS.filter(c => !usedColors.has(c));
    
    if (available.length > 0) {
      const index = Math.abs(hash) % available.length;
      return available[index];
    } else {
      // Generate deterministic unique color based on hash to avoid collisions
      const hue = Math.abs(hash) % 360;
      const lightness = 50 + (Math.abs(hash) % 3) * 7;
      return hslToHex(hue, 70, lightness);
    }
  }, [consistentColors, colorMappings, DEFAULT_COLORS]);

  // Registry for unique original labels detected on this page
  const [registeredLabels, setRegisteredLabels] = useState<Record<string, string[]>>({});

  // Modals state
  const [activeLabelToEdit, setActiveLabelToEdit] = useState<{ originalLabel: string; widgetId?: string } | null>(null);
  const [globalModalOpen, setGlobalModalOpen] = useState(false);

  // Fetch customizations and check role on mount/update
  useEffect(() => {
    if (!token || !dashboardId) return;
    setLoading(true);

    // Get current user role to see if Super Admin
    api<{ role: string }>("/auth/me", { token })
      .then((me) => {
        setIsOrgAdmin(me.role === "SUPER_ADMIN");
      })
      .catch(() => setIsOrgAdmin(false));

    // Fetch customizations
    const query = organizationId ? `?organization_id=${organizationId}` : "";
    api<Customization[]>(`/dashboards/${dashboardId}/label-customizations${query}`, { token })
      .then((data) => {
        const globals: Record<string, string> = {};
        const widgets: Record<string, Record<string, string>> = {};

        data.forEach((c) => {
          if (c.widget_id) {
            if (!widgets[c.widget_id]) widgets[c.widget_id] = {};
            widgets[c.widget_id][c.original_label] = c.customized_label;
          } else {
            globals[c.original_label] = c.customized_label;
          }
        });

        setGlobalCustomizations(globals);
        setWidgetCustomizations(widgets);
      })
      .catch((e) => console.error("Failed to load label customizations", e))
      .finally(() => setLoading(false));
  }, [token, dashboardId, organizationId]);

  // Register widget labels
  const registerWidgetLabels = (widgetId: string, labels: string[]) => {
    setRegisteredLabels((prev) => {
      // Avoid infinite rendering loop by comparing array contents
      const current = prev[widgetId] || [];
      if (current.length === labels.length && current.every((val, index) => val === labels[index])) {
        return prev;
      }
      return { ...prev, [widgetId]: labels };
    });
  };

  // Get unique union of all labels currently rendered on the page
  const allPageLabels = useMemo(() => {
    const all = new Set<string>();
    Object.values(registeredLabels).forEach((labels) => {
      labels.forEach((l) => {
        if (l && typeof l === "string") {
          all.add(l.trim());
        }
      });
    });
    return Array.from(all).sort((a, b) => a.localeCompare(b));
  }, [registeredLabels]);

  // Priority order resolution: Widget-level > Global > Original
  const getDisplayLabel = (originalLabel: string, widgetId?: string) => {
    if (!originalLabel) return "";
    const key = originalLabel.trim();
    if (widgetId && widgetCustomizations[widgetId]?.[key]) {
      return widgetCustomizations[widgetId][key];
    }
    if (globalCustomizations[key]) {
      return globalCustomizations[key];
    }
    return originalLabel;
  };

  // Save/Update customization
  const saveCustomization = async (widgetId: string | null, originalLabel: string, customizedLabel: string) => {
    if (!token) return;
    const cleanLabel = originalLabel.trim();
    const cleanVal = customizedLabel.trim();
    if (!cleanVal) {
      // Revert if empty
      await deleteCustomization(widgetId, cleanLabel);
      return;
    }

    try {
      const query = organizationId ? `?organization_id=${organizationId}` : "";
      await api<Customization>(`/dashboards/${dashboardId}/label-customizations${query}`, {
        method: "POST",
        token,
        body: JSON.stringify({
          widget_id: widgetId,
          original_label: cleanLabel,
          customized_label: cleanVal,
        }),
      });

      if (widgetId) {
        setWidgetCustomizations((prev) => ({
          ...prev,
          [widgetId]: {
            ...(prev[widgetId] || {}),
            [cleanLabel]: cleanVal,
          },
        }));
      } else {
        setGlobalCustomizations((prev) => ({
          ...prev,
          [cleanLabel]: cleanVal,
        }));
      }
      toast.success("Display label updated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save customization.");
    }
  };

  // Delete customization
  const deleteCustomization = async (widgetId: string | null, originalLabel: string) => {
    if (!token) return;
    const cleanLabel = originalLabel.trim();

    try {
      const q = new URLSearchParams({
        original_label: cleanLabel,
      });
      if (widgetId) q.set("widget_id", widgetId);
      if (organizationId) q.set("organization_id", String(organizationId));

      await api(`/dashboards/${dashboardId}/label-customizations?${q.toString()}`, {
        method: "DELETE",
        token,
      });

      if (widgetId) {
        setWidgetCustomizations((prev) => {
          const next = { ...prev };
          if (next[widgetId]) {
            const updated = { ...next[widgetId] };
            delete updated[cleanLabel];
            next[widgetId] = updated;
          }
          return next;
        });
      } else {
        setGlobalCustomizations((prev) => {
          const next = { ...prev };
          delete next[cleanLabel];
          return next;
        });
      }
      toast.success("Display label reset to original.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to reset label.");
    }
  };

  const [loadingWidgets, setLoadingWidgets] = useState<Set<string | number>>(new Set());

  const setWidgetLoading = useCallback((widgetId: string | number, isLoading: boolean) => {
    setLoadingWidgets((prev) => {
      const next = new Set(prev);
      if (isLoading) {
        next.add(widgetId);
      } else {
        next.delete(widgetId);
      }
      return next;
    });
  }, []);

  const isAnyWidgetLoading = loadingWidgets.size > 0;

  const openEditModal = (originalLabel: string, widgetId?: string) => {
    setActiveLabelToEdit({ originalLabel, widgetId });
  };

  const openGlobalModal = () => {
    setGlobalModalOpen(true);
  };

  return (
    <DashboardCustomizationContext.Provider
      value={{
        globalCustomizations,
        widgetCustomizations,
        isOrgAdmin,
        loading,
        registerWidgetLabels,
        getDisplayLabel,
        saveCustomization,
        deleteCustomization,
        allPageLabels,
        openEditModal,
        openGlobalModal,
        consistentColors,
        colorMappings,
        getColorForValue,
        fetchDataWithDate,
        periodOptions,
        selectedPeriod,
        selectedPeriodType,
        requestGeneration,
        setWidgetLoading,
        isAnyWidgetLoading,
      }}
    >
      {children}

      {/* Individual Label Customizer Modal */}
      {activeLabelToEdit && (
        <IndividualEditModal
          originalLabel={activeLabelToEdit.originalLabel}
          widgetId={activeLabelToEdit.widgetId}
          getDisplayLabel={getDisplayLabel}
          saveCustomization={saveCustomization}
          deleteCustomization={deleteCustomization}
          onClose={() => setActiveLabelToEdit(null)}
        />
      )}

      {/* Global Customize Labels Modal */}
      {globalModalOpen && (
        <GlobalEditModal
          allLabels={allPageLabels}
          globalCustomizations={globalCustomizations}
          saveCustomization={saveCustomization}
          deleteCustomization={deleteCustomization}
          onClose={() => setGlobalModalOpen(false)}
        />
      )}
    </DashboardCustomizationContext.Provider>
  );
}

// Individual Modal Helper Component
function IndividualEditModal({
  originalLabel,
  widgetId,
  getDisplayLabel,
  saveCustomization,
  deleteCustomization,
  onClose,
}: {
  originalLabel: string;
  widgetId?: string;
  getDisplayLabel: (originalLabel: string, widgetId?: string) => string;
  saveCustomization: (widgetId: string | null, originalLabel: string, customizedLabel: string) => Promise<void>;
  deleteCustomization: (widgetId: string | null, originalLabel: string) => Promise<void>;
  onClose: () => void;
}) {
  const [val, setVal] = useState("");
  const isWidgetLevel = !!widgetId;
  const currentVal = getDisplayLabel(originalLabel, widgetId);

  useEffect(() => {
    setVal(currentVal !== originalLabel ? currentVal : "");
  }, [currentVal, originalLabel]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveCustomization(widgetId || null, originalLabel, val);
    onClose();
  };

  const handleReset = async () => {
    await deleteCustomization(widgetId || null, originalLabel);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(4px)",
        padding: "1.5rem",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="card"
        onSubmit={handleSave}
        style={{
          maxWidth: 420,
          width: "100%",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)",
          padding: "1.5rem",
          display: "grid",
          gap: "1rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600 }}>
            {isWidgetLevel ? "Customize Label for Widget" : "Customize Label"}
          </h3>
          <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
            Provide a custom UI display label to override the original backend value.
          </p>
        </div>

        <div className="form-group">
          <label style={{ fontSize: "0.82rem", color: "var(--muted)" }}>Original Value</label>
          <div style={{ padding: "0.5rem 0.75rem", background: "var(--bg)", borderRadius: 6, fontSize: "0.95rem" }}>
            {originalLabel}
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="custom-display-label">Display Override Label</label>
          <input
            id="custom-display-label"
            className="form-control"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="Enter custom label (e.g. Mal)"
            autoFocus
          />
        </div>

        <div
          style={{
            marginTop: "0.5rem",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          }}
        >
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          {currentVal !== originalLabel && (
            <button type="button" className="btn form-error" style={{ color: "#ef4444" }} onClick={handleReset}>
              Reset
            </button>
          )}
          <button type="submit" className="btn btn-primary">
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

// Global Modal Helper Component
function GlobalEditModal({
  allLabels,
  globalCustomizations,
  saveCustomization,
  deleteCustomization,
  onClose,
}: {
  allLabels: string[];
  globalCustomizations: Record<string, string>;
  saveCustomization: (widgetId: string | null, originalLabel: string, customizedLabel: string) => Promise<void>;
  deleteCustomization: (widgetId: string | null, originalLabel: string) => Promise<void>;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const initial: Record<string, string> = {};
    allLabels.forEach((label) => {
      initial[label] = globalCustomizations[label] || "";
    });
    setFormData(initial);
  }, [allLabels, globalCustomizations]);

  const handleChange = (label: string, value: string) => {
    setFormData((prev) => ({ ...prev, [label]: value }));
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Sync each label
      for (const label of allLabels) {
        const nextVal = (formData[label] || "").trim();
        const prevVal = globalCustomizations[label] || "";
        if (nextVal !== prevVal) {
          if (nextVal) {
            await saveCustomization(null, label, nextVal);
          } else {
            await deleteCustomization(null, label);
          }
        }
      }
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(15, 23, 42, 0.45)",
        backdropFilter: "blur(4px)",
        padding: "1.5rem",
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        className="card"
        onSubmit={handleSaveAll}
        style={{
          maxWidth: 600,
          width: "100%",
          maxHeight: "90vh",
          boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 600 }}>
            Global Dashboard Label Customizer
          </h3>
          <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.85rem", color: "var(--muted)" }}>
            Customize display labels globally across all widgets on this dashboard page.
          </p>
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingRight: "0.5rem", maxHeight: "50vh" }}>
          {allLabels.length === 0 ? (
            <p style={{ color: "var(--muted)", fontStyle: "italic", margin: "1rem 0" }}>
              No customizable labels detected on the current dashboard. Make sure widgets are loaded.
            </p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--border)", textAlign: "left" }}>
                  <th style={{ padding: "0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>Original Label</th>
                  <th style={{ padding: "0.5rem", fontSize: "0.85rem", color: "var(--muted)" }}>Custom UI Display</th>
                </tr>
              </thead>
              <tbody>
                {allLabels.map((label) => (
                  <tr key={label} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.6rem 0.5rem", fontWeight: 500, fontSize: "0.9rem" }}>{label}</td>
                    <td style={{ padding: "0.4rem 0.5rem" }}>
                      <input
                        className="form-control"
                        value={formData[label] || ""}
                        onChange={(e) => handleChange(label, e.target.value)}
                        placeholder={`e.g. Override for "${label}"`}
                        style={{ height: 32, fontSize: "0.875rem" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
            borderTop: "1px solid var(--border)",
            paddingTop: "1rem",
          }}
        >
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving Changes..." : "Save Customizations"}
          </button>
        </div>
      </form>
    </div>
  );
}
