"use client";

import { useState } from "react";
import type { KpiGroup, KpiPermission } from "./shared";

export function KpiRightsTable({
  groups,
  permissions,
  setPermissions,
  disabled,
}: {
  groups: KpiGroup[];
  permissions: Record<number, KpiPermission>;
  setPermissions: React.Dispatch<React.SetStateAction<Record<number, KpiPermission>>>;
  disabled?: boolean;
}) {
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const [bulkValue, setBulkValue] = useState<KpiPermission>("data_entry");

  const allSelected = groups.length > 0 && selectedNames.size === groups.length;
  const someSelected = selectedNames.size > 0;

  const toggleAll = () => {
    if (allSelected) setSelectedNames(new Set());
    else setSelectedNames(new Set(groups.map((g) => g.name)));
  };

  const toggleOne = (name: string) => {
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const setPermissionForGroup = (group: KpiGroup, perm: KpiPermission) => {
    setPermissions((prev) => {
      const next = { ...prev };
      group.kpiIds.forEach((id) => {
        if (perm === "") delete next[id];
        else next[id] = perm;
      });
      return next;
    });
  };

  const applyBulk = () => {
    if (!someSelected) return;
    setPermissions((prev) => {
      const next = { ...prev };
      groups.forEach((g) => {
        if (!selectedNames.has(g.name)) return;
        g.kpiIds.forEach((id) => {
          if (bulkValue === "") delete next[id];
          else next[id] = bulkValue;
        });
      });
      return next;
    });
    setSelectedNames(new Set());
  };

  const setAllTo = (perm: KpiPermission) => {
    setPermissions((prev) => {
      const next = { ...prev };
      groups.forEach((g) => {
        g.kpiIds.forEach((id) => {
          if (perm === "") delete next[id];
          else next[id] = perm;
        });
      });
      return next;
    });
  };

  const getGroupPermission = (group: KpiGroup): KpiPermission => {
    const first = group.kpiIds[0];
    return (permissions[first] ?? "") as KpiPermission;
  };

  return (
    <div className="form-group">
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", marginBottom: "0.5rem" }}>
        <span style={{ fontWeight: 600 }}>KPI rights</span>
        {groups.length > 0 && (
          <>
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.85rem" }}
              onClick={() => setAllTo("data_entry")}
              disabled={disabled}
            >
              Set all to Data entry
            </button>
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.85rem" }}
              onClick={() => setAllTo("view")}
              disabled={disabled}
            >
              Set all to View only
            </button>
            <button
              type="button"
              className="btn"
              style={{ fontSize: "0.85rem" }}
              onClick={() => setAllTo("")}
              disabled={disabled}
            >
              Clear all
            </button>
          </>
        )}
      </div>
      <p style={{ fontSize: "0.875rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
        Rights are per KPI and apply to all years. Data entry = can edit; View only = read-only.
      </p>
      {groups.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.9rem" }}>No KPIs match the selected filter. Change domain to see more.</p>
      ) : (
        <>
          {someSelected && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.9rem" }}>Set selected ({selectedNames.size}) to:</span>
              <select
                value={bulkValue}
                onChange={(e) => setBulkValue(e.target.value as KpiPermission)}
                style={{ padding: "0.35rem 0.5rem", minWidth: "8rem" }}
                disabled={disabled}
              >
                <option value="">No access</option>
                <option value="data_entry">Data entry</option>
                <option value="view">View only</option>
              </select>
              <button type="button" className="btn btn-primary" style={{ fontSize: "0.85rem" }} onClick={applyBulk} disabled={disabled}>
                Apply
              </button>
            </div>
          )}
          <div style={{ overflowX: "auto", maxHeight: "20rem", overflowY: "auto", border: "1px solid var(--border)", borderRadius: "8px" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
              <thead style={{ position: "sticky", top: 0, background: "var(--bg-subtle)", zIndex: 1, borderBottom: "1px solid var(--border)" }}>
                <tr>
                  <th style={{ width: "2.5rem", padding: "0.5rem 0.35rem", textAlign: "left" }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                      onChange={toggleAll}
                      disabled={disabled}
                      aria-label="Select all"
                    />
                  </th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left" }}>KPI</th>
                  <th style={{ padding: "0.5rem 0.75rem", textAlign: "left", minWidth: "10rem" }}>Rights</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.name} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "0.4rem 0.35rem" }}>
                      <input
                        type="checkbox"
                        checked={selectedNames.has(g.name)}
                        onChange={() => toggleOne(g.name)}
                        disabled={disabled}
                        aria-label={`Select ${g.name}`}
                      />
                    </td>
                    <td style={{ padding: "0.4rem 0.75rem" }}>{g.name}</td>
                    <td style={{ padding: "0.4rem 0.75rem" }}>
                      <select
                        value={getGroupPermission(g)}
                        onChange={(e) => setPermissionForGroup(g, e.target.value as KpiPermission)}
                        style={{ padding: "0.35rem 0.5rem", minWidth: "8rem" }}
                        disabled={disabled}
                      >
                        <option value="">No access</option>
                        <option value="data_entry">Data entry</option>
                        <option value="view">View only</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
