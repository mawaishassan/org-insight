"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { Widget } from "@/app/dashboard/dashboards/[id]/widgets";
import { useDashboardCustomization } from "@/app/dashboard/dashboards/[id]/DashboardCustomizationContext";

export interface DrillDownDimensionFilter {
  sub_field_key?: string;
  field_key?: string;
  value: any;
  year?: number;
  label?: string;
}

export interface WidgetDrillDownModalProps {
  isOpen: boolean;
  onClose: () => void;
  widget: Widget;
  organizationId: number;
  dashboardId: number;
  dimensionFilter?: DrillDownDimensionFilter;
  label?: string;
  periodOverride?: string;
  periodType?: string;
  selectedColumnValue?: string;
  normalFilters?: Record<string, any>;
}

interface ColumnMeta {
  key: string;
  name: string;
  field_type?: string;
}

interface DrillDownResponse {
  version: number;
  widget_id?: string;
  widget_title?: string;
  kpi_id?: number;
  kpi_title?: string;
  source_field_key?: string;
  source_field_name?: string;
  source_field_id?: number;
  columns: ColumnMeta[];
  rows: Array<Record<string, any>>;
  total: number;
  page: number;
  page_size: number;
  dimension_filter?: any;
  entry_ids?: number[];
  meta?: Record<string, any>;
}

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text ?? "").replace(/[&<>"']/g, (m) => map[m]);
}

async function getBase64Image(url: string, token?: string | null): Promise<string | null> {
  try {
    const fullUrl = url.startsWith("http")
      ? url
      : `${window.location.origin}${url.startsWith("/api") ? url : `/api${url}`}`;
    const res = await fetch(token ? `${fullUrl}${fullUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : fullUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export function WidgetDrillDownModal({
  isOpen,
  onClose,
  widget,
  organizationId,
  dashboardId,
  dimensionFilter,
  label,
  periodOverride,
  periodType,
  selectedColumnValue,
  normalFilters,
}: WidgetDrillDownModalProps) {
  const { getDisplayLabel } = useDashboardCustomization();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<DrillDownResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportProgress, setExportProgress] = useState<string>("");

  const firstColKey = drillData?.columns?.[0]?.key;
  const sortedRows = useMemo(() => {
    if (!drillData?.rows?.length) return [];
    if (sortBy) return drillData.rows;
    if (!firstColKey) return drillData.rows;

    const freqMap = new Map<string, number>();
    drillData.rows.forEach((r) => {
      const v = String(r[firstColKey] ?? "").trim();
      freqMap.set(v, (freqMap.get(v) || 0) + 1);
    });

    return [...drillData.rows].sort((a, b) => {
      const valA = String(a[firstColKey] ?? "").trim();
      const valB = String(b[firstColKey] ?? "").trim();
      const countA = freqMap.get(valA) || 0;
      const countB = freqMap.get(valB) || 0;
      if (countB !== countA) {
        return countB - countA;
      }
      return valA.localeCompare(valB);
    });
  }, [drillData, sortBy, firstColKey]);

  const displayPeriodType = useMemo(() => {
    const raw =
      drillData?.meta?.period_type ||
      periodType ||
      (periodOverride && (periodOverride.includes("/") || periodOverride.includes("-")) ? "Fiscal Year" : "Data Entry");
    const s = String(raw || "").trim();
    const lower = s.toLowerCase();
    if (lower === "by_default" || lower === "data_entry" || lower === "data entry") {
      return "Data Entry";
    }
    if (lower === "fiscal_year" || lower === "fiscal year") {
      return "Fiscal Year";
    }
    if (lower === "academic_year" || lower === "academic year") {
      return "Academic Year";
    }
    if (lower === "calendar_year" || lower === "calendar year") {
      return "Calendar Year";
    }
    if (s) {
      return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    }
    return "Fiscal Year";
  }, [drillData?.meta?.period_type, periodType, periodOverride]);

  const reportingPeriod = useMemo(() => {
    return (
      periodOverride ||
      drillData?.meta?.reporting_period ||
      drillData?.meta?.period_key ||
      (drillData?.meta?.year ? String(drillData.meta.year) : "")
    );
  }, [periodOverride, drillData?.meta?.reporting_period, drillData?.meta?.period_key, drillData?.meta?.year]);

  const periodFormattedText = useMemo(() => {
    if (drillData?.meta?.period_info) {
      return drillData.meta.period_info;
    }
    return reportingPeriod ? `${displayPeriodType} : ${reportingPeriod}` : displayPeriodType;
  }, [drillData?.meta?.period_info, displayPeriodType, reportingPeriod]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page & search on modal open or filter change
  useEffect(() => {
    if (isOpen) {
      setPage(1);
      setSearch("");
      setDebouncedSearch("");
      setSortBy(null);
      setSortDir("asc");
    }
  }, [isOpen, widget.id, dimensionFilter]);

  // Fetch drill-down rows
  const fetchDrillDownRows = useCallback(async () => {
    if (!isOpen) return;
    const token = getAccessToken();
    if (!token) return;

    setLoading(true);
    setError(null);

    const overrides: Record<string, any> = {
      ...(periodOverride ? { year: periodOverride } : {}),
      period_type: periodType || undefined,
      selected_column_value: selectedColumnValue || undefined,
      normal_filters: normalFilters && Object.keys(normalFilters).length ? normalFilters : undefined,
    };

    const payload = {
      version: 1,
      organization_id: organizationId,
      dashboard_id: dashboardId,
      widget,
      overrides,
      dimension_filter: dimensionFilter || null,
      page,
      page_size: pageSize,
      search: debouncedSearch || null,
      sort_by: sortBy || null,
      sort_dir: sortDir,
    };

    try {
      const token = getAccessToken();
      const res = await api<DrillDownResponse>("/widget-data/drill-down", {
        method: "POST",
        token: token ?? undefined,
        body: JSON.stringify(payload),
      });
      setDrillData(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load drill-down records");
    } finally {
      setLoading(false);
    }
  }, [
    isOpen,
    organizationId,
    dashboardId,
    widget,
    periodOverride,
    periodType,
    normalFilters,
    dimensionFilter,
    page,
    pageSize,
    debouncedSearch,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    if (isOpen) {
      fetchDrillDownRows();
    }
  }, [fetchDrillDownRows, isOpen]);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleHeaderSort = (colKey: string) => {
    if (sortBy === colKey) {
      if (sortDir === "asc") {
        setSortDir("desc");
      } else {
        setSortBy(null);
        setSortDir("asc");
      }
    } else {
      setSortBy(colKey);
      setSortDir("asc");
    }
    setPage(1);
  };

  const sliceName = useMemo(() => {
    const customLabel =
      label ||
      dimensionFilter?.label ||
      drillData?.meta?.display_slice_label ||
      drillData?.dimension_filter?.label;
    if (customLabel) return getDisplayLabel(String(customLabel), widget.id) || String(customLabel);
    if (dimensionFilter?.value !== undefined && dimensionFilter?.value !== null) {
      const v = String(dimensionFilter.value);
      return getDisplayLabel(v, widget.id) || v;
    }
    return "";
  }, [dimensionFilter, label, drillData, getDisplayLabel, widget.id]);

  const dimensionColumnName = useMemo(() => {
    // 1. From backend metadata or resolved dimension_filter
    if (drillData?.meta?.dimension_column_name) {
      return String(drillData.meta.dimension_column_name);
    }
    if (drillData?.dimension_filter?.column_name) {
      return String(drillData.dimension_filter.column_name);
    }
    if (drillData?.dimension_filter?.sub_field_name) {
      return String(drillData.dimension_filter.sub_field_name);
    }

    // 2. From widget or dimensionFilter key matching columns
    const filterKey =
      dimensionFilter?.sub_field_key ||
      (widget as any)?.group_by_sub_field_key ||
      dimensionFilter?.field_key ||
      (dimensionFilter as any)?.field ||
      (dimensionFilter as any)?.dimension ||
      drillData?.dimension_filter?.sub_field_key ||
      drillData?.dimension_filter?.field_key;

    if (filterKey && drillData?.columns?.length) {
      const kLower = String(filterKey).toLowerCase().trim();
      const matchedCol = drillData.columns.find(
        (c) => c.key.toLowerCase().trim() === kLower
      );
      if (matchedCol?.name) {
        return matchedCol.name;
      }
    }

    // 3. Year / period check
    if (dimensionFilter?.year !== undefined && !filterKey) {
      return "Year";
    }

    // 4. Scan rows to identify which column contains this value (e.g. "verified" is found in "State" column)
    if (drillData?.columns?.length && drillData?.rows?.length) {
      const rawValStr = dimensionFilter?.value !== undefined && dimensionFilter?.value !== null ? String(dimensionFilter.value).toLowerCase().trim() : "";
      const sliceStr = sliceName ? String(sliceName).toLowerCase().trim() : "";
      for (const col of drillData.columns) {
        const found = drillData.rows.some((r) => {
          const v = String(r[col.key] ?? "").toLowerCase().trim();
          return (rawValStr && v === rawValStr) || (sliceStr && v === sliceStr);
        });
        if (found) {
          return col.name;
        }
      }
    }

    // 5. Fallback to formatting the key (e.g. "state" -> "State", "sub_category" -> "Sub Category")
    if (filterKey) {
      return String(filterKey)
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    return "Dimension";
  }, [drillData, dimensionFilter, widget, sliceName]);

  const widgetTitle = widget.title || drillData?.widget_title || "Widget Details";
  const fullPdfHeader = sliceName ? `${widgetTitle} (${sliceName})` : widgetTitle;

  const handleDownloadPdf = async () => {
    if (!drillData || !sortedRows.length || exportingPdf) return;
    setExportingPdf(true);
    setExportProgress("Preparing export...");
    try {
      const token = getAccessToken();
      let rowsToExport = sortedRows;

      // If total exceeds current page rows or we are on page > 1, fetch all records so PDF is complete
      if (drillData.total > rowsToExport.length || page > 1) {
        setExportProgress(`Fetching all ${drillData.total.toLocaleString()} records...`);
        try {
          const overrides: Record<string, any> = {
            ...(periodOverride ? { year: periodOverride } : {}),
            period_type: periodType || undefined,
            selected_column_value: selectedColumnValue || undefined,
            normal_filters: normalFilters && Object.keys(normalFilters).length ? normalFilters : undefined,
          };
          const resAll = await api<DrillDownResponse>("/widget-data/drill-down", {
            method: "POST",
            token: token ?? undefined,
            body: JSON.stringify({
              version: 1,
              organization_id: organizationId,
              dashboard_id: dashboardId,
              widget,
              overrides,
              dimension_filter: dimensionFilter || null,
              page: 1,
              page_size: Math.max(drillData.total, 50),
              search: debouncedSearch || null,
              sort_by: sortBy || null,
              sort_dir: sortDir,
            }),
          });
          if (resAll?.rows?.length) {
            if (!sortBy && firstColKey) {
              const freqMap = new Map<string, number>();
              resAll.rows.forEach((r) => {
                const v = String(r[firstColKey] ?? "").trim();
                freqMap.set(v, (freqMap.get(v) || 0) + 1);
              });
              rowsToExport = [...resAll.rows].sort((a, b) => {
                const valA = String(a[firstColKey] ?? "").trim();
                const valB = String(b[firstColKey] ?? "").trim();
                const countA = freqMap.get(valA) || 0;
                const countB = freqMap.get(valB) || 0;
                if (countB !== countA) return countB - countA;
                return valA.localeCompare(valB);
              });
            } else {
              rowsToExport = resAll.rows;
            }
          }
        } catch (fetchErr) {
          console.error("Failed to fetch all rows for PDF export, falling back to loaded rows:", fetchErr);
        }
      }

      setExportProgress("Loading brand assets...");

      // Fetch logos if available
      let logoBase64: string | null = null;
      if (drillData.meta?.logo_url) {
        logoBase64 = await getBase64Image(drillData.meta.logo_url, token);
      }
      let logo2Base64: string | null = null;
      if (drillData.meta?.logo2_url) {
        logo2Base64 = await getBase64Image(drillData.meta.logo2_url, token);
      }

      // Dynamically import html2canvas and jsPDF
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");

      const isLandscape = drillData.columns.length > 3;
      const pageWidth = isLandscape ? 297 : 210;
      const pageHeight = isLandscape ? 210 : 297;
      const margin = 12;
      const contentWidth = pageWidth - margin * 2;
      const containerWidth = isLandscape ? 1060 : 780;

      const topMarginMm = 10;
      // Footer divider line is drawn at (pageHeight - 13) mm.
      // We set maxImageBottomMm to (pageHeight - 15.5) mm, giving a tight, clean ~3.2mm gap between table bottom and footer line.
      const maxImageBottomMm = pageHeight - 15.5;
      const maxImageHeightMm = maxImageBottomMm - topMarginMm;
      const maxContainerHeightPx = Math.floor((maxImageHeightMm * containerWidth) / contentWidth);

      const mainHeading = drillData.meta?.header_main_heading || widgetTitle;
      const subHeading = drillData.meta?.header_sub_heading || "";
      const fontFamily = drillData.meta?.header_font_family
        ? `'${drillData.meta.header_font_family}', Helvetica, Arial, sans-serif`
        : "Helvetica, Arial, sans-serif";
      const mainColor = drillData.meta?.header_text_color || "#1e3a8a";
      const mainAlign = (drillData.meta?.header_text_align || "center").toLowerCase();
      const subColor = drillData.meta?.header_sub_text_color || "#4b5563";
      const themeColor = drillData.meta?.header_kpi_name_color || "#1e3a8a";

      const periodText = periodFormattedText;

      const logo1Html = logoBase64
        ? `<img src="${logoBase64}" style="max-height: 65px; max-width: 140px; object-fit: contain;" alt="Logo 1" />`
        : `<div style="width: 120px;"></div>`;

      const logo2Html = logo2Base64
        ? `<img src="${logo2Base64}" style="max-height: 65px; max-width: 140px; object-fit: contain; margin-bottom: 4px;" alt="Logo 2" />`
        : "";

      const headerContainerHtml = `
        <div class="report-header-container" style="width: 100%; margin-bottom: 0.65rem;">
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; position: relative;">
            <div style="flex: 0 0 130px; display: flex; justify-content: flex-start; align-items: center;">
              ${logo1Html}
            </div>
            <div style="flex: 1 1 auto; text-align: ${mainAlign}; padding: 0 0.75rem;">
              <h1 style="margin: 0; font-size: 21px; color: ${mainColor}; font-weight: bold; font-family: ${fontFamily}; text-align: ${mainAlign}; line-height: 1.25;">
                ${escapeHtml(mainHeading)}
              </h1>
              ${subHeading ? `
                <div style="margin-top: 0.25rem; font-size: 11px; color: ${subColor}; text-align: ${mainAlign}; font-family: ${fontFamily}; font-style: italic;">
                  ${escapeHtml(subHeading)}
                </div>
              ` : ""}
            </div>
            <div style="flex: 0 0 130px; display: flex; justify-content: flex-end; align-items: center;">
              ${logo2Html}
            </div>
          </div>
          ${periodText ? `
            <div style="display: flex; justify-content: flex-end; width: 100%; margin-top: 0.35rem;">
              <div style="font-size: 0.85rem; font-weight: bold; color: #475569; white-space: nowrap;">
                ${escapeHtml(periodText)}
              </div>
            </div>
          ` : ""}
        </div>
      `;

      const sectionTitleHtml = `
        <section style="margin-bottom: 0.65rem;">
          <h2 style="font-size: 1.2rem; margin-top: 0; margin-bottom: 0.25rem; color: ${themeColor}; font-weight: bold;">
            ${escapeHtml(fullPdfHeader)}
          </h2>
        </section>
      `;

      const isCenterCol = (colKey: string, colName: string) => {
        const k = colKey.toLowerCase();
        const n = colName.toLowerCase();
        if (k === "status" || n.includes("status")) return true;
        if (k === "year" || n.includes("year")) return true;
        if (k === "date" || n.includes("date")) return true;
        if (k === "sr" || k === "sno" || k === "s_no" || k === "serial") return true;
        if (k.includes("code") || n.includes("code")) return true;
        if (k.includes("type") || n.includes("type")) return true;
        if (k.includes("quartile") || n.includes("quartile")) return true;
        return false;
      };

      // Fixed Column Width Allocation: ensures 100% identical column widths on EVERY page
      const tableWidthPx = containerWidth - 40; // 20px padding left + 20px padding right
      const srColWidth = rowsToExport.length >= 1000 ? 54 : 46;
      const remainingTableWidth = Math.max(100, tableWidthPx - srColWidth);

      const compactKeywords = ["year", "status", "code", "type", "quartile", "date", "dept_code", "sno", "s_no"];
      let compactCount = 0;
      let flexCount = 0;

      const isColCompact = drillData.columns.map((c) => {
        const k = c.key.toLowerCase();
        const n = c.name.toLowerCase();
        const comp = compactKeywords.some((kw) => k.includes(kw) || n.includes(kw));
        if (comp) compactCount++;
        else flexCount++;
        return comp;
      });

      const compactWidth = Math.min(95, Math.max(75, Math.floor(remainingTableWidth * 0.16)));
      const totalCompactWidth = compactCount * compactWidth;
      const totalFlexWidth = Math.max(100, remainingTableWidth - totalCompactWidth);
      const flexWidth = flexCount > 0 ? totalFlexWidth / flexCount : remainingTableWidth / Math.max(1, drillData.columns.length);

      const colWidths = [srColWidth, ...isColCompact.map((comp) => (comp ? compactWidth : flexWidth))];

      const colgroupHtml = `
        <colgroup>
          ${colWidths.map((w) => `<col style="width: ${w.toFixed(1)}px;" />`).join("")}
        </colgroup>
      `;

      const theadHtml = `
        <thead>
          <tr style="background-color: ${themeColor}; color: #ffffff; border-bottom: 2px solid ${themeColor}; font-size: 10pt;">
            <th style="border: 1px solid #d1d5db; padding: 6px 4px; text-align: center; font-weight: 600; color: #ffffff; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">Sr</th>
            ${drillData.columns.map((c) => {
              const center = isCenterCol(c.key, c.name);
              return `<th style="border: 1px solid #d1d5db; padding: 6px 8px; text-align: ${center ? "center" : "left"}; font-weight: 600; color: #ffffff; font-size: 10pt; vertical-align: middle; overflow: hidden; text-overflow: ellipsis; ${center ? "white-space: nowrap;" : "word-break: normal;"}">${escapeHtml(c.name)}</th>`;
            }).join("")}
          </tr>
        </thead>
      `;

      // Table Footer HTML (if evaluated_footer_rows present in meta)
      const evaluatedFooter = drillData.meta?.evaluated_footer_rows;
      let tfootHtml = "";
      if (Array.isArray(evaluatedFooter) && evaluatedFooter.length > 0) {
        tfootHtml = `
          <tfoot>
            ${evaluatedFooter.map((f_row: any) => {
              const cells = f_row.cells || [];
              return `
                <tr style="font-size: 9.5pt; background-color: #f8fafc;">
                  ${cells.map((c: any) => {
                    const span = c.colspan ? `colspan="${c.colspan}"` : "";
                    const align = c.align || "left";
                    const weight = c.bold ? "bold" : "normal";
                    return `<td ${span} style="border: 1px solid #d1d5db; padding: 6px 8px; color: #111827; text-align: ${align}; font-weight: ${weight}; vertical-align: middle;">${escapeHtml(c.value || "")}</td>`;
                  }).join("")}
                </tr>
              `;
            }).join("")}
          </tfoot>
        `;
      }

      const renderRowHtml = (row: Record<string, any>, idx: number) => {
        const bg = idx % 2 === 1 ? "#f9fafb" : "#ffffff";
        const cells = drillData.columns.map((c) => {
          const val = row[c.key];
          const rawStr = val !== null && val !== undefined && val !== "" ? String(val) : "";
          const displayVal = rawStr ? (getDisplayLabel(rawStr, widget.id) || rawStr) : "—";
          const center = isCenterCol(c.key, c.name);
          return `<td style="border: 1px solid #d1d5db; padding: 6px 8px; font-size: 9.5pt; color: #111827; text-align: ${center ? "center" : "left"}; vertical-align: middle; overflow-wrap: break-word; word-break: normal;">${escapeHtml(displayVal)}</td>`;
        }).join("");
        return `
          <tr style="background-color: ${bg}; font-size: 9.5pt;">
            <td style="border: 1px solid #d1d5db; padding: 6px 4px; font-size: 9.5pt; color: #4b5563; text-align: center; white-space: nowrap; vertical-align: middle;">${idx + 1}</td>
            ${cells}
          </tr>
        `;
      };

      const renderRowsHtml = (rowIndices: number[]) => {
        return rowIndices.map((idx) => renderRowHtml(rowsToExport[idx], idx)).join("");
      };

      // Step 1: Measure row heights in a hidden staging container with identical fixed column widths
      setExportProgress(`Analyzing layout (${rowsToExport.length.toLocaleString()} records)...`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      const stagingContainer = document.createElement("div");
      stagingContainer.style.position = "fixed";
      stagingContainer.style.left = "0";
      stagingContainer.style.top = "0";
      stagingContainer.style.width = `${containerWidth}px`;
      stagingContainer.style.padding = "8px 20px 3px 20px";
      stagingContainer.style.background = "#ffffff";
      stagingContainer.style.color = "#111827";
      stagingContainer.style.boxSizing = "border-box";
      stagingContainer.style.zIndex = "-9999";
      stagingContainer.style.pointerEvents = "none";
      stagingContainer.style.fontFamily = fontFamily;

      stagingContainer.innerHTML = `
        <div style="color: #111; font-family: ${fontFamily};">
          ${headerContainerHtml}
          ${sectionTitleHtml}
          <table style="width: 100%; table-layout: fixed; border-collapse: collapse; border: 1px solid #d1d5db; margin-top: 2px;">
            ${colgroupHtml}
            ${theadHtml}
            <tbody id="staging-tbody">
              ${renderRowsHtml(rowsToExport.map((_, i) => i))}
            </tbody>
            ${tfootHtml}
          </table>
        </div>
      `;

      document.body.appendChild(stagingContainer);

      // Wait for images to decode
      const imgEls = Array.from(stagingContainer.querySelectorAll("img"));
      await Promise.all(imgEls.map((img) => img.decode().catch(() => {})));
      await new Promise((resolve) => setTimeout(resolve, 80));

      const headerEl = stagingContainer.querySelector(".report-header-container") as HTMLElement | null;
      const sectionEl = stagingContainer.querySelector("section") as HTMLElement | null;
      const theadEl = stagingContainer.querySelector("thead") as HTMLElement | null;
      const tbodyEl = stagingContainer.querySelector("#staging-tbody") as HTMLElement | null;
      const tfootEl = stagingContainer.querySelector("tfoot") as HTMLElement | null;

      // Accurate measurement of all non-row vertical heights with tight padding
      const page1NonRowHeight = 8 + (headerEl?.offsetHeight || 75) + 6 + (sectionEl?.offsetHeight || 32) + 6 + 2 + (theadEl?.offsetHeight || 30) + 2 + 3;
      const otherPagesNonRowHeight = 4 + 2 + (theadEl?.offsetHeight || 30) + 2 + 3;
      const tfootHeight = tfootEl?.offsetHeight || 0;

      // Tight, consistent row budget per page stopping cleanly ~3.2mm above the footer line
      const maxPage1RowsHeight = Math.max(150, maxContainerHeightPx - page1NonRowHeight - 3);
      const maxOtherRowsHeight = Math.max(150, maxContainerHeightPx - otherPagesNonRowHeight - 3);

      const rowEls = tbodyEl ? (Array.from(tbodyEl.children) as HTMLElement[]) : [];
      const rowHeights = rowEls.map((r) => r.getBoundingClientRect().height || r.offsetHeight || 32);

      if (document.body.contains(stagingContainer)) {
        document.body.removeChild(stagingContainer);
      }

      // Group row indices into cleanly formatted pages
      const pagesRowIndices: number[][] = [];
      let curPageRows: number[] = [];
      let curHeight = 0;
      let isFirstPage = true;

      for (let i = 0; i < rowHeights.length; i++) {
        const rH = rowHeights[i];
        const maxH = isFirstPage ? maxPage1RowsHeight : maxOtherRowsHeight;
        const extraEnd = (i === rowHeights.length - 1) ? tfootHeight : 0;

        if (curPageRows.length > 0 && (curHeight + rH + extraEnd) > maxH) {
          pagesRowIndices.push(curPageRows);
          curPageRows = [i];
          curHeight = rH;
          isFirstPage = false;
        } else {
          curPageRows.push(i);
          curHeight += rH;
        }
      }
      if (curPageRows.length > 0) {
        pagesRowIndices.push(curPageRows);
      }

      // Step 2: Render each page cleanly to jsPDF with self-correcting overflow protection
      const pdf = new jsPDF({
        orientation: isLandscape ? "landscape" : "portrait",
        unit: "mm",
        format: "a4",
      });

      for (let pIdx = 0; pIdx < pagesRowIndices.length; pIdx++) {
        setExportProgress(`Rendering page ${pIdx + 1} of ${pagesRowIndices.length}...`);
        await new Promise((resolve) => setTimeout(resolve, 10));
        let pageRows = pagesRowIndices[pIdx];
        let isLast = pIdx === pagesRowIndices.length - 1;

        const pageContainer = document.createElement("div");
        pageContainer.style.position = "fixed";
        pageContainer.style.left = "0";
        pageContainer.style.top = "0";
        pageContainer.style.width = `${containerWidth}px`;
        pageContainer.style.padding = pIdx === 0 ? "8px 20px 3px 20px" : "4px 20px 3px 20px";
        pageContainer.style.background = "#ffffff";
        pageContainer.style.color = "#111827";
        pageContainer.style.boxSizing = "border-box";
        pageContainer.style.zIndex = "-9999";
        pageContainer.style.pointerEvents = "none";
        pageContainer.style.fontFamily = fontFamily;

        const buildPageHtml = (rows: number[], last: boolean) => `
          <div style="color: #111; font-family: ${fontFamily};">
            ${pIdx === 0 ? headerContainerHtml + sectionTitleHtml : ""}
            <table style="width: 100%; table-layout: fixed; border-collapse: collapse; border: 1px solid #d1d5db; margin-top: 2px;">
              ${colgroupHtml}
              ${theadHtml}
              <tbody>
                ${renderRowsHtml(rows)}
              </tbody>
              ${last ? tfootHtml : ""}
            </table>
          </div>
        `;

        pageContainer.innerHTML = buildPageHtml(pageRows, isLast);
        document.body.appendChild(pageContainer);

        if (pIdx === 0) {
          const pImgs = Array.from(pageContainer.querySelectorAll("img"));
          await Promise.all(pImgs.map((img) => img.decode().catch(() => {})));
          await new Promise((resolve) => setTimeout(resolve, 60));
        }

        // Self-correcting overflow guard:
        // If the rendered pageContainer exceeds maxContainerHeightPx, move rows to next page
        while (pageContainer.offsetHeight > maxContainerHeightPx && pageRows.length > 1) {
          const popped = pageRows.pop()!;
          if (pIdx + 1 < pagesRowIndices.length) {
            pagesRowIndices[pIdx + 1].unshift(popped);
          } else {
            pagesRowIndices.push([popped]);
          }
          isLast = pIdx === pagesRowIndices.length - 1;
          pageContainer.innerHTML = buildPageHtml(pageRows, isLast);
        }

        const canvas = await html2canvas(pageContainer, {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: "#ffffff",
          scrollX: 0,
          scrollY: 0,
          windowWidth: containerWidth,
        });

        if (document.body.contains(pageContainer)) {
          document.body.removeChild(pageContainer);
        }

        if (pIdx > 0) {
          pdf.addPage();
        }

        const pageImgHeightMm = (canvas.height * contentWidth) / canvas.width;
        const pageImgData = canvas.toDataURL("image/jpeg", 0.98);
        pdf.addImage(pageImgData, "JPEG", margin, topMarginMm, contentWidth, pageImgHeightMm, undefined, "FAST");
      }

      // Step 3: Draw running footers matching Custom Report NumberedCanvas on EVERY page
      const totalPdfPages = pdf.getNumberOfPages();
      const footerLabel = drillData.meta?.footer_label || 
        (drillData.meta?.organization_name 
          ? `Confidential Document | ${drillData.meta.organization_name}` 
          : "Confidential Document");

      const dateFormatted = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "2-digit",
        year: "numeric",
      });

      for (let p = 1; p <= totalPdfPages; p++) {
        pdf.setPage(p);

        // Divider line: #e5e7eb, width 0.3mm (matching custom reports NumberedCanvas: self.line(54, 55, pagesize - 54, 55))
        pdf.setDrawColor(229, 231, 235);
        pdf.setLineWidth(0.3);
        pdf.line(margin, pageHeight - 13, pageWidth - margin, pageHeight - 13);

        // Footer typography: Helvetica 8pt #6b7280
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(107, 114, 128); // #6b7280

        // Left text: Confidential Document | Organization Name
        pdf.text(footerLabel, margin, pageHeight - 8);

        // Right text: Generated on Month Day, Year | Page X of Y
        const footerRight = `Generated on ${dateFormatted} | Page ${p} of ${totalPdfPages}`;
        pdf.text(footerRight, pageWidth - margin, pageHeight - 8, { align: "right" });
      }

      const cleanFileName = (fullPdfHeader || "Export")
        .replace(/[^a-zA-Z0-9_-]/g, "_")
        .replace(/_+/g, "_");

      setExportProgress("Saving PDF...");
      await new Promise((resolve) => setTimeout(resolve, 10));
      pdf.save(`${cleanFileName}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (err) {
      console.error("Failed to generate PDF", err);
      alert("Failed to generate PDF. Please try again.");
    } finally {
      setExportingPdf(false);
      setExportProgress("");
    }
  };

  if (!isOpen) return null;

  const total = drillData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startRow = total > 0 ? (page - 1) * pageSize + 1 : 0;
  const endRow = Math.min(page * pageSize, total);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; transform: scale(0.97) translateY(6px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .drilldown-spinner {
          border-radius: 50% !important;
          animation: spin 0.8s linear infinite !important;
          box-sizing: border-box !important;
          display: inline-block !important;
        }
        .drilldown-modal-container {
          background: #ffffff;
          border-radius: 14px;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.08);
          width: 100%;
          max-width: 1200px;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .drilldown-modal-header {
          padding: 1rem 1.4rem;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          background: #f8fafc;
          gap: 0.75rem;
        }
        .drilldown-header-actions {
          display: flex;
          gap: 0.5rem;
          align-items: center;
          flex-shrink: 0;
          margin-left: auto;
        }
        .drilldown-btn-pdf {
          display: inline-flex;
          align-items: center;
          gap: 0.42rem;
          padding: 0.45rem 0.85rem;
          font-size: 0.82rem;
          font-weight: 600;
          color: #334155;
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 7px;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
          min-height: 35px;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        }
        .drilldown-btn-pdf:hover:not(:disabled) {
          background: #f8fafc;
          border-color: #94a3b8;
          color: #0f172a;
          box-shadow: 0 2px 4px rgba(0,0,0,0.06);
        }
        .drilldown-btn-pdf:active:not(:disabled) {
          background: #f1f5f9;
          transform: translateY(1px);
        }
        .drilldown-btn-pdf:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }
        .drilldown-btn-close {
          background: #ffffff;
          border: 1px solid #cbd5e1;
          border-radius: 7px;
          width: 35px;
          height: 35px;
          min-width: 35px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          color: #64748b;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          padding: 0;
        }
        .drilldown-btn-close:hover {
          background: #f1f5f9;
          border-color: #94a3b8;
          color: #0f172a;
          box-shadow: 0 2px 4px rgba(0,0,0,0.06);
        }
        .drilldown-btn-close:active {
          background: #e2e8f0;
          transform: translateY(1px);
        }
        .drilldown-btn-pdf-short {
          display: none;
        }
        .drilldown-btn-pdf-full {
          display: inline;
        }
        @media (max-width: 640px) {
          .drilldown-modal-header {
            padding: 0.85rem 1rem;
            gap: 0.5rem;
          }
          .drilldown-modal-container {
            max-height: 94vh;
            border-radius: 10px;
          }
          .drilldown-btn-pdf {
            padding: 0.4rem 0.65rem;
            font-size: 0.78rem;
            min-height: 32px;
          }
          .drilldown-btn-close {
            width: 32px;
            height: 32px;
            min-width: 32px;
          }
        }
        @media (max-width: 480px) {
          .drilldown-btn-pdf-full {
            display: none;
          }
          .drilldown-btn-pdf-short {
            display: inline;
          }
          .drilldown-btn-pdf {
            padding: 0.38rem 0.55rem;
            gap: 0.3rem;
          }
        }
      `}</style>
      <div className="drilldown-modal-container">
        {/* Modal Header */}
        <div className="drilldown-modal-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <h2 style={{ fontSize: "1.15rem", fontWeight: 700, color: "#0f172a", margin: 0, wordBreak: "break-word" }}>
                {widget.title || drillData?.widget_title || "Widget Details"}
              </h2>
            </div>

            {/* Active Filters Badges */}
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.45rem", alignItems: "center" }}>
              {drillData?.kpi_title && (
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "#475569",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    padding: "0.15rem 0.5rem",
                    borderRadius: "20px",
                    fontWeight: 500,
                  }}
                >
                  KPI: <strong>{drillData.kpi_title}</strong>
                </span>
              )}

              {drillData?.source_field_name && (
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "#475569",
                    background: "#ffffff",
                    border: "1px solid #cbd5e1",
                    padding: "0.15rem 0.5rem",
                    borderRadius: "20px",
                    fontWeight: 500,
                  }}
                >
                  Table: <strong>{drillData.source_field_name}</strong>
                </span>
              )}

              {selectedColumnValue && (
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "#4338ca",
                    background: "#e0e7ff",
                    border: "1px solid #c7d2fe",
                    padding: "0.15rem 0.55rem",
                    borderRadius: "20px",
                    fontWeight: 600,
                  }}
                >
                  Department: <strong>{selectedColumnValue}</strong>
                </span>
              )}

              {(dimensionFilter?.value !== undefined || sliceName) && (
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "#0369a1",
                    background: "#e0f2fe",
                    border: "1px solid #bae6fd",
                    padding: "0.15rem 0.55rem",
                    borderRadius: "20px",
                    fontWeight: 600,
                  }}
                >
                  {dimensionColumnName}: <strong>{String(sliceName || dimensionFilter?.value || "(empty)")}</strong>
                </span>
              )}

              {reportingPeriod && (
                <span
                  style={{
                    fontSize: "0.78rem",
                    color: "#7c2d12",
                    background: "#ffedd5",
                    border: "1px solid #fed7aa",
                    padding: "0.15rem 0.5rem",
                    borderRadius: "20px",
                    fontWeight: 500,
                  }}
                >
                  {displayPeriodType} : <strong>{reportingPeriod}</strong>
                </span>
              )}

              <span
                style={{
                  fontSize: "0.78rem",
                  color: "#166534",
                  background: "#dcfce7",
                  border: "1px solid #bbf7d0",
                  padding: "0.15rem 0.55rem",
                  borderRadius: "20px",
                  fontWeight: 650,
                  marginLeft: "auto",
                }}
              >
                {total.toLocaleString()} total {total === 1 ? "record" : "records"}
              </span>
            </div>
          </div>

          <div className="drilldown-header-actions">
            <button
              type="button"
              className="drilldown-btn-pdf"
              onClick={handleDownloadPdf}
              disabled={exportingPdf || !drillData || sortedRows.length === 0}
              title="Download PDF of records"
            >
              {exportingPdf ? (
                <>
                  <div
                    className="drilldown-spinner"
                    style={{
                      width: "13px",
                      height: "13px",
                      border: "2px solid #cbd5e1",
                      borderTopColor: "#3b82f6",
                    }}
                  />
                  <span className="drilldown-btn-pdf-full">{exportProgress || "Generating PDF..."}</span>
                  <span className="drilldown-btn-pdf-short">PDF...</span>
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  <span className="drilldown-btn-pdf-full">Download PDF</span>
                  <span className="drilldown-btn-pdf-short">PDF</span>
                </>
              )}
            </button>

            <button
              type="button"
              className="drilldown-btn-close"
              onClick={onClose}
              title="Close modal (Esc)"
              aria-label="Close modal"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>

        {/* Action / Search Bar */}
        <div
          style={{
            padding: "0.6rem 1.4rem",
            borderBottom: "1px solid #f1f5f9",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#ffffff",
            gap: "1rem",
          }}
        >
          <div style={{ position: "relative", maxWidth: "360px", width: "100%" }}>
            <input
              type="text"
              placeholder="Search table rows..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                width: "100%",
                padding: "0.4rem 0.65rem 0.4rem 2rem",
                fontSize: "0.85rem",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
            <svg
              style={{ position: "absolute", left: "0.65rem", top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                style={{
                  position: "absolute",
                  right: "0.5rem",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                ✕
              </button>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <label style={{ fontSize: "0.82rem", color: "#64748b" }}>Rows per page:</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              style={{
                padding: "0.3rem 0.5rem",
                fontSize: "0.82rem",
                borderRadius: "6px",
                border: "1px solid #cbd5e1",
                background: "#ffffff",
                color: "#1e293b",
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>

        {/* Content / Table Area */}
        <div style={{ flex: 1, overflow: "auto", position: "relative", minHeight: "260px" }}>
          {loading && !drillData ? (
            <div
              style={{
                padding: "4.5rem 1.5rem",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minHeight: "260px",
              }}
            >
              <div
                className="drilldown-spinner"
                style={{
                  width: "38px",
                  height: "38px",
                  border: "3.5px solid #e2e8f0",
                  borderTopColor: "#2563eb",
                }}
              />
              <span style={{ marginTop: "0.8rem", fontSize: "0.95rem", color: "#334155", fontWeight: 600 }}>
                Fetching Data...
              </span>
            </div>
          ) : error ? (
            <div style={{ padding: "3rem 1.5rem", textAlign: "center" }}>
              <div style={{ color: "#ef4444", fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                Error loading records
              </div>
              <div style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => fetchDrillDownRows()}
              >
                Retry
              </button>
            </div>
          ) : !drillData || sortedRows.length === 0 ? (
            <div style={{ padding: "4rem 1.5rem", textAlign: "center", color: "#64748b" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="1.5" style={{ margin: "0 auto 0.75rem auto" }}>
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "#1e293b", marginBottom: "0.25rem" }}>
                No records found
              </div>
              <div style={{ fontSize: "0.85rem" }}>
                {debouncedSearch
                  ? `No entries match "${debouncedSearch}". Try clearing your search query.`
                  : "No Multi-Line Item records match this drill-down selection."}
              </div>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              {loading && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(255, 255, 255, 0.65)",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 10,
                  }}
                >
                  <div
                    className="drilldown-spinner"
                    style={{
                      width: "34px",
                      height: "34px",
                      border: "3.5px solid #e2e8f0",
                      borderTopColor: "#2563eb",
                    }}
                  />
                  <span style={{ marginTop: "0.6rem", fontSize: "0.85rem", color: "#475569", fontWeight: 500 }}>
                    Fetching Data...
                  </span>
                </div>
              )}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 5, borderBottom: "2px solid #e2e8f0" }}>
                  <tr>
                    <th style={{ padding: "0.6rem 0.8rem", width: "54px", color: "#64748b", fontWeight: 600, textAlign: "center" }}>Sr</th>
                    {drillData.columns.map((col) => {
                      const isSorted = sortBy === col.key;
                      return (
                        <th
                          key={col.key}
                          onClick={() => handleHeaderSort(col.key)}
                          style={{
                            padding: "0.6rem 0.8rem",
                            fontWeight: 650,
                            color: isSorted ? "#2563eb" : "#334155",
                            cursor: "pointer",
                            userSelect: "none",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
                            <span>{col.name}</span>
                            <span style={{ fontSize: "0.72rem", color: isSorted ? "#2563eb" : "#94a3b8" }}>
                              {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, idx) => {
                    const srNumber = startRow + idx;
                    return (
                      <tr
                        key={row.id || idx}
                        style={{
                          borderBottom: "1px solid #f1f5f9",
                          background: idx % 2 === 0 ? "#ffffff" : "#fcfcfd",
                          transition: "background 0.1s ease",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = idx % 2 === 0 ? "#ffffff" : "#fcfcfd")}
                      >
                        <td style={{ padding: "0.55rem 0.8rem", color: "#64748b", fontSize: "0.8rem", textAlign: "center", fontWeight: 500 }}>{srNumber}</td>
                        {drillData.columns.map((col) => {
                          const cellVal = row[col.key];
                          let renderedVal: React.ReactNode = "";
                          if (cellVal === null || cellVal === undefined || cellVal === "") {
                            renderedVal = <span style={{ color: "#cbd5e1" }}>—</span>;
                          } else if (typeof cellVal === "boolean") {
                            renderedVal = cellVal ? (
                              <span style={{ color: "#166534", fontWeight: 600 }}>Yes</span>
                            ) : (
                              <span style={{ color: "#991b1b", fontWeight: 600 }}>No</span>
                            );
                          } else {
                            const rawStr = String(cellVal);
                            renderedVal = getDisplayLabel(rawStr, widget.id) || rawStr;
                          }
                          return (
                            <td
                              key={col.key}
                              style={{
                                padding: "0.55rem 0.8rem",
                                color: "#334155",
                                maxWidth: "320px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={typeof cellVal === "string" ? cellVal : undefined}
                            >
                              {renderedVal}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal Footer / Pagination */}
        <div
          style={{
            padding: "0.75rem 1.4rem",
            borderTop: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
            fontSize: "0.82rem",
            color: "#64748b",
          }}
        >
          <div>
            Showing <strong>{startRow}</strong> to <strong>{endRow}</strong> of <strong>{total.toLocaleString()}</strong> rows
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: page <= 1 ? "#f1f5f9" : "#ffffff",
                color: page <= 1 ? "#94a3b8" : "#334155",
                cursor: page <= 1 ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
            >
              Previous
            </button>

            <span style={{ padding: "0 0.4rem" }}>
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </span>

            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              style={{
                padding: "0.3rem 0.6rem",
                borderRadius: "4px",
                border: "1px solid #cbd5e1",
                background: page >= totalPages ? "#f1f5f9" : "#ffffff",
                color: page >= totalPages ? "#94a3b8" : "#334155",
                cursor: page >= totalPages ? "not-allowed" : "pointer",
                fontWeight: 500,
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default WidgetDrillDownModal;
