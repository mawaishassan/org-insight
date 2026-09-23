"use client";

import React, { useEffect, useState, useMemo, useCallback } from "react";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import { Widget } from "@/app/dashboard/dashboards/[id]/widgets";
import { useDashboardCustomization } from "@/app/dashboard/dashboards/[id]/DashboardCustomizationContext";
import { logDrillDownView, logDrillDownPdfExport } from "@/lib/activityLogger";

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
  canDownloadWidgetPdf?: boolean;
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

function highlightSearchMatch(text: string, query: string): React.ReactNode {
  if (!query || !query.trim() || !text) return text;
  const q = query.trim();
  try {
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(regex);
    if (parts.length <= 1) return text;

    return (
      <>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="drilldown-search-highlight">
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </>
    );
  } catch {
    return text;
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
  canDownloadWidgetPdf = true,
}: WidgetDrillDownModalProps) {
  const { getDisplayLabel } = useDashboardCustomization();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drillData, setDrillData] = useState<DrillDownResponse | null>(null);
  const baseDrillDataRef = React.useRef<DrillDownResponse | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchColumn, setSearchColumn] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportProgress, setExportProgress] = useState<string>("");
  const [hoveredTooltip, setHoveredTooltip] = useState<{
    text: string;
    columnName: string;
    x: number;
    y: number;
  } | null>(null);

  const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTooltipRef = React.useRef<{ text: string; columnName: string; x: number; y: number } | null>(null);

  const handleCellMouseEnter = useCallback((e: React.MouseEvent, text: string, columnName: string) => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (!text || text === "—") {
      setHoveredTooltip(null);
      return;
    }
    pendingTooltipRef.current = { text, columnName, x: e.clientX, y: e.clientY };
    hoverTimerRef.current = setTimeout(() => {
      if (pendingTooltipRef.current) {
        setHoveredTooltip({ ...pendingTooltipRef.current });
      }
    }, 1000); // 1 second stay criteria
  }, []);

  const handleCellMouseMove = useCallback((e: React.MouseEvent) => {
    if (pendingTooltipRef.current) {
      pendingTooltipRef.current.x = e.clientX;
      pendingTooltipRef.current.y = e.clientY;
    }
    setHoveredTooltip((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
  }, []);

  const handleCellMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    pendingTooltipRef.current = null;
    setHoveredTooltip(null);
  }, []);

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

  const filteredSortedRows = useMemo(() => {
    if (!sortedRows.length) return [];
    if (!debouncedSearch) return sortedRows;
    const q = debouncedSearch.toLowerCase().trim();
    if (!q) return sortedRows;
    if (searchColumn === "all") {
      return sortedRows.filter((row) =>
        Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(q))
      );
    }
    return sortedRows.filter((row) => {
      const val = String(row[searchColumn] ?? "").toLowerCase();
      return val.includes(q);
    });
  }, [sortedRows, debouncedSearch, searchColumn]);

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

  // Fast handler to clear search immediately without showing any loader
  const handleClearSearch = useCallback(() => {
    setSearch("");
    setDebouncedSearch("");
    setPage(1);
    if (baseDrillDataRef.current) {
      setDrillData(baseDrillDataRef.current);
      setLoading(false);
    }
  }, []);

  // Debounce search input (immediate restore of all data when cleared)
  useEffect(() => {
    if (!search.trim()) {
      setDebouncedSearch("");
      setPage(1);
      if (baseDrillDataRef.current) {
        setDrillData(baseDrillDataRef.current);
        setLoading(false);
      }
      return;
    }
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page & search on modal open or filter change
  useEffect(() => {
    if (isOpen) {
      setDrillData(null);
      baseDrillDataRef.current = null;
      setLoading(true);
      setError(null);
      setPage(1);
      setSearch("");
      setDebouncedSearch("");
      setSearchColumn("all");
      setSortBy(null);
      setSortDir("asc");
      setHoveredTooltip(null);
    } else {
      setDrillData(null);
      baseDrillDataRef.current = null;
      setLoading(false);
      setError(null);
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      pendingTooltipRef.current = null;
      setHoveredTooltip(null);
    }
  }, [isOpen, widget.id, dimensionFilter, periodOverride, periodType, selectedColumnValue]);

  // Fetch drill-down rows
  const fetchDrillDownRows = useCallback(async () => {
    if (!isOpen) return;
    const token = getAccessToken();
    if (!token) return;

    // If clearing search and baseDrillData is available, restore full records immediately without showing loader
    if (!debouncedSearch && baseDrillDataRef.current && page === 1 && !sortBy) {
      setDrillData(baseDrillDataRef.current);
      setLoading(false);
      return;
    }

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
      if (!debouncedSearch && page === 1 && !sortBy) {
        baseDrillDataRef.current = res;
      }
      const effectivePeriod = 
        (periodOverride && String(periodOverride).trim() && String(periodOverride).trim().toLowerCase() !== "none" && String(periodOverride).trim().toLowerCase() !== "by_default")
          ? String(periodOverride).trim()
          : (normalFilters as any)?.year || 
            (normalFilters as any)?.period || 
            (widget as any)?.date_fetching_config?.default_year || 
            (widget as any)?.date_fetching_config?.default_period || 
            (res as any)?.meta?.period ||
            (res as any)?.meta?.year ||
            null;

      logDrillDownView(
        typeof widget.id === "number" ? widget.id : 0,
        widget.title || res.widget_title || "Widget Drill-Down",
        `Drill-down on ${widget.title || res.widget_title || "Widget"}${effectivePeriod ? ` (${effectivePeriod})` : ""}`,
        effectivePeriod || undefined
      );
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
    const effectivePeriod = 
      (periodOverride && String(periodOverride).trim() && String(periodOverride).trim().toLowerCase() !== "none" && String(periodOverride).trim().toLowerCase() !== "by_default")
        ? String(periodOverride).trim()
        : (normalFilters as any)?.year || 
          (normalFilters as any)?.period || 
          (widget as any)?.date_fetching_config?.default_year || 
          (widget as any)?.date_fetching_config?.default_period || 
          (drillData as any)?.meta?.period ||
          (drillData as any)?.meta?.year ||
          null;

    logDrillDownPdfExport(
      typeof widget.id === "number" ? widget.id : 0,
      widget.title || drillData.widget_title || "Widget Drill-Down",
      effectivePeriod || undefined
    );
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
      const subFontFamily = drillData.meta?.header_sub_font_family
        ? `'${drillData.meta.header_sub_font_family}', Helvetica, Arial, sans-serif`
        : fontFamily;
      const subAlign = (drillData.meta?.header_sub_text_align || mainAlign).toLowerCase();

      const periodText = periodFormattedText;

      const estLogo1W = logoBase64 ? 80 : 0;
      const estLogo2W = logo2Base64 ? 80 : 0;
      const totalLogoGaps = (logoBase64 && logo2Base64 ? 32 : (logoBase64 || logo2Base64 ? 16 : 0));

      // Available width for heading ensuring it stays on one line within the centered group
      const totalWidthPx = containerWidth - 40; // 20px padding on each side
      const centerAvailableWidth = Math.max(280, totalWidthPx - estLogo1W - estLogo2W - totalLogoGaps - 16);

      // Auto-calculate font size identical to custom reports logic so the main header comes in full line
      const desiredFs = drillData.meta?.header_font_size ? Number(drillData.meta.header_font_size) : 18;
      const calcAutoHeaderFontSize = (text: string, availW: number, desired: number): number => {
        if (!text) return desired;
        const len = text.trim().length;
        if (len <= 0) return desired;
        const targetW = Math.max(availW - 8.0, 180.0);
        // Factor 0.46 for bold typography in px ensures the full title fits on one line
        const calcSize = targetW / (len * 0.46);
        const maxLimit = Math.max(desired, 18.5);
        return Math.round(Math.max(12.0, Math.min(calcSize, maxLimit)) * 10) / 10;
      };

      const mainFsPx = calcAutoHeaderFontSize(mainHeading, centerAvailableWidth, desiredFs);
      const subFontSize = drillData.meta?.header_sub_font_size
        ? Number(drillData.meta.header_sub_font_size)
        : Math.max(9, Math.round(mainFsPx * 0.6));

      const logo1Html = logoBase64
        ? `<img src="${logoBase64}" style="max-height: 60px; max-width: 100px; object-fit: contain; display: block;" alt="Logo 1" />`
        : "";

      const logo2Html = logo2Base64
        ? `<img src="${logo2Base64}" style="max-height: 60px; max-width: 100px; object-fit: contain; display: block;" alt="Logo 2" />`
        : "";

      const headerContainerHtml = `
        <div class="report-header-container" style="width: 100%; margin-bottom: 0.65rem;">
          <!-- Cohesive Centered Header Cluster: Logo 1 + Title/Subtitle + Logo 2 with tight natural spacing -->
          <div style="display: flex; justify-content: center; align-items: center; width: 100%; gap: 16px; position: relative;">
            ${logo1Html ? `
              <div style="flex: 0 0 auto; display: flex; align-items: center; justify-content: center;">
                ${logo1Html}
              </div>
            ` : ""}

            <div style="flex: 0 1 auto; text-align: center; max-width: ${centerAvailableWidth}px;">
              <h1 style="margin: 0; font-size: ${mainFsPx}px; color: ${mainColor}; font-weight: bold; font-family: ${fontFamily}; text-align: center; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(mainHeading)}
              </h1>
              ${subHeading ? `
                <div style="margin-top: 0.25rem; font-size: ${subFontSize}px; color: ${subColor}; text-align: center; font-family: ${subFontFamily}; font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${escapeHtml(subHeading)}
                </div>
              ` : ""}
            </div>

            ${logo2Html ? `
              <div style="flex: 0 0 auto; display: flex; align-items: center; justify-content: center;">
                ${logo2Html}
              </div>
            ` : ""}
          </div>

          <!-- Period Metadata: just below the header section, right aligned -->
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
          max-width: min(1320px, 96vw);
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

        /* Responsive Footer & Pagination Styles */
        .drilldown-modal-footer {
          padding: 0.75rem 1.4rem;
          border-top: 1px solid #e2e8f0;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: #f8fafc;
          font-size: 0.82rem;
          color: #64748b;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .drilldown-footer-info {
          display: flex;
          align-items: center;
          white-space: nowrap;
        }

        .drilldown-pagination-controls {
          display: flex;
          align-items: center;
          gap: 0.4rem;
        }

        .drilldown-pagination-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.35rem;
          padding: 0.4rem 0.75rem;
          border-radius: 6px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #334155;
          font-size: 0.82rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease-in-out;
          user-select: none;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        }

        .drilldown-pagination-btn:hover:not(:disabled) {
          background: #f1f5f9;
          border-color: #94a3b8;
          color: #0f172a;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
        }

        .drilldown-pagination-btn:active:not(:disabled) {
          background: #e2e8f0;
          transform: translateY(1px);
        }

        .drilldown-pagination-btn:disabled {
          background: #f8fafc;
          border-color: #e2e8f0;
          color: #94a3b8;
          cursor: not-allowed;
          opacity: 0.65;
          box-shadow: none;
        }

        .drilldown-pagination-btn svg {
          width: 14px;
          height: 14px;
          stroke-width: 2.2;
          flex-shrink: 0;
        }

        .drilldown-pagination-info {
          padding: 0.35rem 0.65rem;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          color: #475569;
          font-weight: 500;
          white-space: nowrap;
        }

        .drilldown-btn-label-full {
          display: inline;
        }

        .drilldown-btn-label-short {
          display: none;
        }

        @media (max-width: 640px) {
          .drilldown-modal-footer {
            padding: 0.65rem 0.9rem;
            flex-direction: column;
            align-items: stretch;
            gap: 0.6rem;
          }

          .drilldown-footer-info {
            justify-content: center;
            font-size: 0.78rem;
          }

          .drilldown-pagination-controls {
            justify-content: space-between;
            width: 100%;
          }

          .drilldown-pagination-btn {
            flex: 1;
            padding: 0.45rem 0.5rem;
            font-size: 0.8rem;
          }

          .drilldown-pagination-info {
            flex: 1;
            text-align: center;
            padding: 0.45rem 0.4rem;
            font-size: 0.78rem;
          }
        }

        @media (max-width: 420px) {
          .drilldown-btn-label-full {
            display: none;
          }

          .drilldown-btn-label-short {
            display: inline;
          }

          .drilldown-pagination-btn {
            padding: 0.42rem 0.35rem;
          }
        }

        /* Search Bar Modern Styles */
        .drilldown-search-wrapper {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          flex: 1;
          max-width: 540px;
        }
        .drilldown-search-container {
          display: flex;
          align-items: center;
          background: #ffffff;
          border: 1.5px solid #cbd5e1;
          border-radius: 8px;
          padding: 0.22rem 0.5rem 0.22rem 0.7rem;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          width: 100%;
          position: relative;
        }
        .drilldown-search-container:hover {
          border-color: #94a3b8;
        }
        .drilldown-search-container:focus-within {
          background: #ffffff;
          border-color: #3b82f6;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16), 0 1px 2px rgba(0, 0, 0, 0.05);
        }
        .drilldown-search-icon {
          color: #94a3b8;
          flex-shrink: 0;
          margin-right: 0.45rem;
          transition: color 0.15s ease;
        }
        .drilldown-search-container:focus-within .drilldown-search-icon {
          color: #2563eb;
        }
        .drilldown-search-input {
          width: 100%;
          border: none;
          background: transparent;
          outline: none;
          font-size: 0.86rem;
          color: #0f172a;
          padding: 0.25rem 0.2rem;
          font-family: inherit;
        }
        .drilldown-search-input::placeholder {
          color: #94a3b8;
        }
        .drilldown-column-select {
          border: 1.5px solid #cbd5e1;
          background: #ffffff;
          border-radius: 8px;
          font-size: 0.8rem;
          font-weight: 600;
          color: #334155;
          padding: 0.42rem 0.65rem;
          outline: none;
          cursor: pointer;
          transition: all 0.15s ease;
          flex-shrink: 0;
          max-width: 160px;
        }
        .drilldown-column-select:hover {
          background: #f8fafc;
          border-color: #94a3b8;
          color: #0f172a;
        }
        .drilldown-column-select:focus {
          border-color: #3b82f6;
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
        }
        .drilldown-search-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          padding: 0.15rem 0.5rem;
          border-radius: 9999px;
          font-size: 0.72rem;
          font-weight: 700;
          white-space: nowrap;
          flex-shrink: 0;
          margin-right: 0.35rem;
          user-select: none;
        }
        .drilldown-search-badge-success {
          background: #ecfdf5;
          color: #059669;
          border: 1px solid #a7f3d0;
        }
        .drilldown-search-badge-empty {
          background: #fef2f2;
          color: #dc2626;
          border: 1px solid #fecaca;
        }
        .drilldown-search-clear-btn {
          background: none;
          border: none;
          color: #94a3b8;
          cursor: pointer;
          width: 22px;
          height: 22px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          transition: all 0.15s ease;
          flex-shrink: 0;
          padding: 0;
        }
        .drilldown-search-clear-btn:hover {
          background: #f1f5f9;
          color: #0f172a;
        }
        .drilldown-search-highlight {
          background: #fef08a !important;
          color: #854d0e !important;
          font-weight: 700 !important;
          padding: 0.05rem 0.25rem !important;
          border-radius: 4px !important;
          box-shadow: 0 1px 2px rgba(202, 138, 4, 0.2) !important;
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
                  color: !drillData && loading ? "#2563eb" : "#166534",
                  background: !drillData && loading ? "#eff6ff" : "#dcfce7",
                  border: !drillData && loading ? "1px solid #bfdbfe" : "1px solid #bbf7d0",
                  padding: "0.15rem 0.55rem",
                  borderRadius: "20px",
                  fontWeight: 650,
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.35rem",
                }}
              >
                {!drillData && loading ? (
                  <>
                    <div
                      className="drilldown-spinner"
                      style={{ width: "10px", height: "10px", border: "2px solid #93c5fd", borderTopColor: "#2563eb" }}
                    />
                    <span>Loading records...</span>
                  </>
                ) : (
                  `${total.toLocaleString()} total ${total === 1 ? "record" : "records"}`
                )}
              </span>
            </div>
          </div>

          <div className="drilldown-header-actions">
            {canDownloadWidgetPdf !== false && (
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
            )}

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
            padding: "0.65rem 1.4rem",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "space-between",
            alignItems: "center",
            background: "#ffffff",
            gap: "0.75rem",
          }}
        >
          <div className="drilldown-search-wrapper">
            {/* Column Scope Selector */}
            {drillData?.columns && drillData.columns.length > 0 && (
              <select
                className="drilldown-column-select"
                style={{ background: "#ffffff" }}
                value={searchColumn}
                onChange={(e) => setSearchColumn(e.target.value)}
                title="Select specific column to search"
              >
                <option value="all">All Columns</option>
                {drillData.columns.map((col) => (
                  <option key={col.key} value={col.key}>
                    {col.name}
                  </option>
                ))}
              </select>
            )}

            {/* Elevated Modern Search Input */}
            <div className="drilldown-search-container" style={{ background: "#ffffff" }}>
              <input
                type="text"
                className="drilldown-search-input"
                placeholder={
                  searchColumn !== "all"
                    ? `Search in ${drillData?.columns?.find((c) => c.key === searchColumn)?.name || searchColumn}...`
                    : "Search records... (Press Enter)"
                }
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setDebouncedSearch(search.trim());
                    setPage(1);
                  } else if (e.key === "Escape") {
                    if (search) {
                      e.stopPropagation();
                      handleClearSearch();
                    }
                  }
                }}
              />

              {/* Match Counter Badge / Loader */}
              {loading && search.trim() ? (
                <div style={{ display: "flex", alignItems: "center", gap: "0.25rem", marginRight: "0.35rem" }}>
                  <div
                    className="drilldown-spinner"
                    style={{ width: "13px", height: "13px", border: "2px solid #cbd5e1", borderTopColor: "#3b82f6" }}
                  />
                  <span style={{ fontSize: "0.72rem", color: "#64748b", fontWeight: 600 }}>Searching...</span>
                </div>
              ) : debouncedSearch && drillData ? (
                <span
                  className={`drilldown-search-badge ${
                    filteredSortedRows.length > 0 ? "drilldown-search-badge-success" : "drilldown-search-badge-empty"
                  }`}
                  title={`${filteredSortedRows.length} matching rows`}
                >
                  {filteredSortedRows.length > 0 ? `${filteredSortedRows.length} found` : "0 matches"}
                </span>
              ) : null}

              {/* Clear search button */}
              {search && (
                <button
                  type="button"
                  className="drilldown-search-clear-btn"
                  onClick={handleClearSearch}
                  title="Clear search (Esc)"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <label style={{ fontSize: "0.82rem", color: "#64748b", fontWeight: 500 }}>Rows per page:</label>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              style={{
                padding: "0.35rem 0.6rem",
                fontSize: "0.82rem",
                borderRadius: "7px",
                border: "1.5px solid #cbd5e1",
                background: "#ffffff",
                color: "#1e293b",
                outline: "none",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
            </select>
          </div>
        </div>

        {/* Active Search Filter Banner Strip */}
        {debouncedSearch && (
          <div
            style={{
              padding: "0.45rem 1.4rem",
              background: filteredSortedRows.length > 0 ? "#eff6ff" : "#fef2f2",
              borderBottom: `1px solid ${filteredSortedRows.length > 0 ? "#dbeafe" : "#fee2e2"}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.8rem",
              color: filteredSortedRows.length > 0 ? "#1e40af" : "#991b1b",
              animation: "modalFadeIn 0.15s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700 }}>Filtered results:</span>
              <span>
                Matching <strong>"{debouncedSearch}"</strong>
                {searchColumn !== "all" ? (
                  <> in column <strong>"{drillData?.columns?.find((c) => c.key === searchColumn)?.name || searchColumn}"</strong></>
                ) : (
                  <> across all columns</>
                )}
              </span>
              <span
                style={{
                  padding: "0.1rem 0.5rem",
                  borderRadius: "9999px",
                  background: filteredSortedRows.length > 0 ? "#dbeafe" : "#fecaca",
                  fontWeight: 700,
                  fontSize: "0.74rem",
                  color: filteredSortedRows.length > 0 ? "#1e40af" : "#b91c1c",
                }}
              >
                {filteredSortedRows.length} of {drillData?.total || sortedRows.length} {filteredSortedRows.length === 1 ? "record" : "records"}
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearSearch}
              style={{
                background: "transparent",
                border: "none",
                color: filteredSortedRows.length > 0 ? "#2563eb" : "#dc2626",
                fontWeight: 700,
                cursor: "pointer",
                textDecoration: "underline",
                fontSize: "0.78rem",
                padding: "0.2rem 0.4rem",
              }}
            >
              Reset Search ✕
            </button>
          </div>
        )}

        {/* Content / Table Area */}
        <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", position: "relative", minHeight: "260px" }}>
          {!drillData ? (
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
                  width: "42px",
                  height: "42px",
                  border: "3.5px solid #e2e8f0",
                  borderTopColor: "#2563eb",
                }}
              />
              <span style={{ marginTop: "1rem", fontSize: "1.1rem", color: "#1e293b", fontWeight: 650, letterSpacing: "-0.01em" }}>
                Fetching data...
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
          ) : filteredSortedRows.length === 0 ? (
            <div style={{ padding: "4rem 1.5rem", textAlign: "center", color: "#64748b" }}>
              <div style={{ fontWeight: 700, fontSize: "1rem", color: "#0f172a", marginBottom: "0.35rem" }}>
                {debouncedSearch ? `No matches found for "${debouncedSearch}"` : "No records found"}
              </div>
              {!debouncedSearch && (
                <div style={{ fontSize: "0.85rem", color: "#64748b", maxWidth: "420px", margin: "0 auto" }}>
                  No Multi-Line Item records match this drill-down selection.
                </div>
              )}
              {debouncedSearch && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.4rem",
                    marginTop: "1rem",
                    padding: "0.5rem 1.5rem",
                    fontSize: "0.82rem",
                    fontWeight: 600,
                    color: "#2563eb",
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    borderRadius: "7px",
                    cursor: "pointer",
                    transition: "all 0.18s ease",
                    width: "clamp(140px, 50%, 220px)",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "#dbeafe";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#93c5fd";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#bfdbfe";
                  }}
                >
                  Clear Search Filter
                </button>
              )}
            </div>
          ) : (
            <div style={{ position: "relative", width: "100%", overflowX: "hidden" }}>
              {loading && Boolean(debouncedSearch.trim() || search.trim()) && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "rgba(255, 255, 255, 0.45)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 20,
                    transition: "all 0.15s ease",
                  }}
                >
                  <div
                    style={{
                      background: "#ffffff",
                      border: "1.5px solid #cbd5e1",
                      borderRadius: "9999px",
                      padding: "0.55rem 1.35rem",
                      boxShadow: "0 10px 25px -4px rgba(0, 0, 0, 0.12), 0 4px 10px -2px rgba(0, 0, 0, 0.06)",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.6rem",
                      animation: "modalFadeIn 0.15s ease",
                    }}
                  >
                    <div
                      className="drilldown-spinner"
                      style={{
                        width: "16px",
                        height: "16px",
                        border: "2.2px solid #cbd5e1",
                        borderTopColor: "#2563eb",
                      }}
                    />
                    <span
                      style={{
                        fontSize: "0.88rem",
                        color: "#0f172a",
                        fontWeight: 650,
                        letterSpacing: "-0.01em",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Filtering data...
                    </span>
                  </div>
                </div>
              )}
              <table
                style={{
                  width: "100%",
                  tableLayout: "fixed",
                  borderCollapse: "collapse",
                  fontSize: "0.88rem",
                  textAlign: "left",
                }}
              >
                <thead style={{ position: "sticky", top: 0, background: "#f8fafc", zIndex: 5, borderBottom: "2px solid #e2e8f0" }}>
                  <tr>
                    <th style={{ padding: "0.6rem 0.8rem", width: "50px", color: "#64748b", fontWeight: 700, textAlign: "center" }}>Sr</th>
                    {drillData.columns.map((col) => {
                      const isSorted = sortBy === col.key;
                      return (
                        <th
                          key={col.key}
                          onClick={() => handleHeaderSort(col.key)}
                          onMouseEnter={(e) => handleCellMouseEnter(e, col.name, "Column")}
                          onMouseMove={handleCellMouseMove}
                          onMouseLeave={handleCellMouseLeave}
                          style={{
                            padding: "0.6rem 0.8rem",
                            fontWeight: 700,
                            fontSize: "0.85rem",
                            color: isSorted ? "#2563eb" : "#1e293b",
                            cursor: "pointer",
                            userSelect: "none",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem", maxWidth: "100%", overflow: "hidden" }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{col.name}</span>
                            <span style={{ fontSize: "0.72rem", color: isSorted ? "#2563eb" : "#94a3b8", flexShrink: 0 }}>
                              {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                            </span>
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {filteredSortedRows.map((row, idx) => {
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
                        <td style={{ padding: "0.6rem 0.8rem", color: "#64748b", fontSize: "0.85rem", textAlign: "center", fontWeight: 600 }}>{srNumber}</td>
                        {drillData.columns.map((col) => {
                          const cellVal = row[col.key];
                          let renderedVal: React.ReactNode = "";
                          let tooltipText = "";
                          if (cellVal === null || cellVal === undefined || cellVal === "") {
                            renderedVal = <span style={{ color: "#cbd5e1" }}>—</span>;
                            tooltipText = "—";
                          } else if (typeof cellVal === "boolean") {
                            renderedVal = cellVal ? (
                              <span style={{ color: "#166534", fontWeight: 600 }}>Yes</span>
                            ) : (
                              <span style={{ color: "#991b1b", fontWeight: 600 }}>No</span>
                            );
                            tooltipText = cellVal ? "Yes" : "No";
                          } else {
                            const rawStr = String(cellVal);
                            const displayStr = getDisplayLabel(rawStr, widget.id) || rawStr;
                            tooltipText = displayStr;
                            const shouldHighlight = searchColumn === "all" || searchColumn === col.key;
                            renderedVal = shouldHighlight && debouncedSearch
                              ? highlightSearchMatch(displayStr, debouncedSearch)
                              : displayStr;
                          }
                          return (
                            <td
                              key={col.key}
                              style={{
                                padding: "0.6rem 0.8rem",
                                color: "#1e293b",
                                fontSize: "0.88rem",
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                cursor: "pointer",
                              }}
                              onMouseEnter={(e) => handleCellMouseEnter(e, tooltipText, col.name)}
                              onMouseMove={handleCellMouseMove}
                              onMouseLeave={handleCellMouseLeave}
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
        <div className="drilldown-modal-footer">
          <div className="drilldown-footer-info">
            Showing <strong>&nbsp;{startRow}&nbsp;</strong> to <strong>&nbsp;{endRow}&nbsp;</strong> of <strong>&nbsp;{total.toLocaleString()}&nbsp;</strong> rows
          </div>

          <div className="drilldown-pagination-controls">
            <button
              type="button"
              className="drilldown-pagination-btn"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              aria-label="Previous Page"
            >
              <span className="drilldown-btn-label-full">Previous</span>
              <span className="drilldown-btn-label-short">Prev</span>
            </button>

            <div className="drilldown-pagination-info">
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
            </div>

            <button
              type="button"
              className="drilldown-pagination-btn"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              aria-label="Next Page"
            >
              <span className="drilldown-btn-label-full">Next</span>
              <span className="drilldown-btn-label-short">Next</span>
            </button>
          </div>
        </div>
      </div>

      {/* Clean, Premium Large-Font Tooltip on Hover (Shown after staying on cell) */}
      {hoveredTooltip && (
        <div
          style={{
            position: "fixed",
            left: Math.max(
              16,
              hoveredTooltip.x > (typeof window !== "undefined" ? window.innerWidth * 0.62 : 800)
                ? hoveredTooltip.x - 16
                : hoveredTooltip.x + 16
            ),
            top: Math.max(
              16,
              hoveredTooltip.y > (typeof window !== "undefined" ? window.innerHeight * 0.72 : 600)
                ? hoveredTooltip.y - 12
                : hoveredTooltip.y + 16
            ),
            transform: `${
              hoveredTooltip.x > (typeof window !== "undefined" ? window.innerWidth * 0.62 : 800)
                ? "translateX(-100%)"
                : ""
            } ${
              hoveredTooltip.y > (typeof window !== "undefined" ? window.innerHeight * 0.72 : 600)
                ? "translateY(-100%)"
                : ""
            }`.trim() || "none",
            maxWidth: "min(560px, calc(100vw - 32px))",
            minWidth: "180px",
            background: "#ffffff",
            color: "#0f172a",
            border: "1.5px solid #cbd5e1",
            borderRadius: "10px",
            padding: "0.85rem 1.15rem",
            boxShadow: "0 14px 35px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08)",
            zIndex: 99999,
            pointerEvents: "none",
            userSelect: "none",
            lineHeight: 1.55,
            animation: "modalFadeIn 0.12s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <div
            style={{
              marginBottom: "0.4rem",
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "#1d4ed8",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                padding: "0.15rem 0.5rem",
                borderRadius: "5px",
              }}
            >
              {hoveredTooltip.columnName}
            </span>
          </div>
          <div
            style={{
              fontSize: "1.1rem", // Large, clear font for weak eyesight
              fontWeight: 600,
              color: "#0f172a",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
            }}
          >
            {hoveredTooltip.text}
          </div>
        </div>
      )}
    </div>
  );
}

export default WidgetDrillDownModal;
