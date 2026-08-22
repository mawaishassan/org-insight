"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";
import { generatePeriodOptions } from "@/lib/periodHelpers";
import {
  SubField,
  FieldSummary,
  MultiFilterConditionRow,
  emptyMultiFilterRow,
  payloadToFilterDraft,
  filterDraftToPayload,
  removeConditionFromPayload,
} from "@/lib/multiItemsFiltersHelper";
import MultiItemsAdvancedFiltersPanel from "@/components/MultiItemsAdvancedFiltersPanel";
import { ColumnWidthConfigModal } from "@/components/ColumnWidthConfigModal";

interface KPISubField {
  id: number;
  key: string;
  name: string;
  field_type: string;
}

interface KPIField {
  id: number;
  kpi_id: number;
  key: string;
  name: string;
  field_type: string;
  sub_fields?: KPISubField[];
}

interface KPI {
  id: number;
  name: string;
  fields: KPIField[];
}

interface CustomReportField {
  id?: number;
  kpi_field_id: number;
  field_key: string;
  field_name: string;
  field_type: string;
  sort_order: number;
  kpi_id: number;
  config?: {
    selected_columns?: string[] | null;
    filters?: { conditions: any[]; _version: number } | null;
    column_widths?: Record<string, number> | null;
    custom_name?: string | null;
    merged_headers?: any[] | null;
    [key: string]: any;
  } | null;
}

interface CustomReportSection {
  id?: number;
  kpi_id: number | null;
  kpi_name: string;
  custom_header: string | null;
  sort_order: number;
  fields: CustomReportField[];
}

interface CustomReportDetail {
  id: number;
  organization_id: number;
  name: string;
  description: string | null;
  sections: CustomReportSection[];
  fetch_data_with_date?: boolean;
  date_fetching_config?: any;
}

export default function CustomReportDesignPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = Number(params.id);
  const orgId = Number(searchParams.get("organization_id"));

  const [report, setReport] = useState<CustomReportDetail | null>(null);
  const [sections, setSections] = useState<CustomReportSection[]>([]);
  const [attachments, setAttachments] = useState<any[]>([]);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [openSectionMenuIdx, setOpenSectionMenuIdx] = useState<number | null>(null);
  const [openFieldMenuLoc, setOpenFieldMenuLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  
  // KPI Search lists
  const [allKpis, setAllKpis] = useState<KPI[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveSaving, setSaveSaving] = useState(false);
  const [fetchDataWithDate, setFetchDataWithDate] = useState<boolean>(false);
  const [dateFetchingConfig, setDateFetchingConfig] = useState<any>({});
  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);

  const [reportHeaderId, setReportHeaderId] = useState<number | null>(null);
  const [showReportName, setShowReportName] = useState<boolean>(true);
  const [brandingTitle, setBrandingTitle] = useState<string>("");
  const [scalarBold, setScalarBold] = useState<boolean>(true);
  const [scalarFontSize, setScalarFontSize] = useState<number>(11);
  const [mliFontSize, setMliFontSize] = useState<number>(10);
  const [showOdooButton, setShowOdooButton] = useState<boolean>(false);
  const [customReportHeaders, setCustomReportHeaders] = useState<any[]>([]);

  const [localReportHeaderId, setLocalReportHeaderId] = useState<number | null>(null);
  const [localShowReportName, setLocalShowReportName] = useState<boolean>(true);
  const [localBrandingTitle, setLocalBrandingTitle] = useState<string>("");
  const [localScalarBold, setLocalScalarBold] = useState<boolean>(true);
  const [localScalarFontSize, setLocalScalarFontSize] = useState<number>(11);
  const [localMliFontSize, setLocalMliFontSize] = useState<number>(10);
  const [localShowOdooButton, setLocalShowOdooButton] = useState<boolean>(false);
  const [odooSyncKpiIds, setOdooSyncKpiIds] = useState<number[]>([]);
  const [localOdooSyncKpiIds, setLocalOdooSyncKpiIds] = useState<number[]>([]);
  const [odooConfiguredKpis, setOdooConfiguredKpis] = useState<{id: number; name: string}[]>([]);



  // Live Preview properties
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewYear, setPreviewYear] = useState(() => new Date().getFullYear());
  const [previewLoading, setPreviewLoading] = useState(false);

  // Identify all referenced KPI IDs in sections and attachments
  const referencedKpiIds = useMemo(() => {
    const ids = new Set<number>();
    sections.forEach((s) => {
      if (s.kpi_id) ids.add(s.kpi_id);
    });
    attachments.forEach((a) => {
      if (a.kpi_id) ids.add(a.kpi_id);
    });
    return Array.from(ids);
  }, [sections, attachments]);

  // Identify all MLI fields used in custom report sections
  const customReportMliFields = useMemo(() => {
    const list: Array<{ kpiId: number; kpiName: string; field: KPIField }> = [];
    sections.forEach((s) => {
      const kpiObj = allKpis.find((k) => k.id === s.kpi_id);
      s.fields.forEach((f) => {
        const kpiField = kpiObj?.fields?.find((kf) => kf.id === f.kpi_field_id);
        if (kpiField && kpiField.field_type === "multi_line_items") {
          list.push({
            kpiId: s.kpi_id!,
            kpiName: s.kpi_name || kpiObj?.name || `KPI #${s.kpi_id}`,
            field: kpiField,
          });
        }
      });
    });
    return list;
  }, [sections, allKpis]);

  const [organization, setOrganization] = useState<any>(null);
  const [localPeriodType, setLocalPeriodType] = useState<string>("");
  const [localDateBasedFetching, setLocalDateBasedFetching] = useState<boolean>(false);
  const [localDateColumn, setLocalDateColumn] = useState<string>("");
  const [localMliDateCols, setLocalMliDateCols] = useState<Record<string, string>>({});
  const [localConfiguredKpiIds, setLocalConfiguredKpiIds] = useState<number[]>([]);
  const [localKpiMlis, setLocalKpiMlis] = useState<Record<string, string>>({});

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !orgId) return;
    api<any>(`/organizations/${orgId}`, { token })
      .then((orgData) => {
        setOrganization(orgData);
      })
      .catch((err) => {
        console.error("Failed to load org details", err);
      });
  }, [orgId]);

  useEffect(() => {
    if (reportSettingsOpen) {
      setLocalPeriodType(dateFetchingConfig?.period_type || "");
      setLocalDateBasedFetching(fetchDataWithDate);
      setLocalDateColumn(dateFetchingConfig?.date_column || "");
      setLocalMliDateCols(dateFetchingConfig?.mli_date_cols || {});
      setLocalConfiguredKpiIds(dateFetchingConfig?.configured_kpi_ids || []);
      setLocalKpiMlis(dateFetchingConfig?.kpi_mlis || {});
      setLocalReportHeaderId(reportHeaderId);
      setLocalShowReportName(showReportName);
      setLocalBrandingTitle(brandingTitle);
      setLocalScalarBold(scalarBold);
      setLocalScalarFontSize(scalarFontSize);
      setLocalMliFontSize(mliFontSize);
      setLocalShowOdooButton(showOdooButton);
      setLocalOdooSyncKpiIds(odooSyncKpiIds);

    }
  }, [reportSettingsOpen, fetchDataWithDate, dateFetchingConfig, reportHeaderId, showReportName, brandingTitle, scalarBold, scalarFontSize, mliFontSize, showOdooButton, odooSyncKpiIds]);



  const customPeriods = useMemo(() => {
    if (!organization) return [];
    if (organization.custom_periods && organization.custom_periods.length > 0) {
      return organization.custom_periods;
    }
    if (organization.custom_period_name) {
      return [{
        custom_period_name: organization.custom_period_name,
        custom_period_start_month: organization.custom_period_start_month,
        custom_period_start_day: organization.custom_period_start_day,
        custom_period_duration_months: organization.custom_period_duration_months,
        custom_period_display_format: organization.custom_period_display_format,
        custom_period_prefix: organization.custom_period_prefix,
        custom_period_suffix: organization.custom_period_suffix,
      }];
    }
    return [];
  }, [organization]);

  const periodOptionsList = useMemo(() => {
    return customPeriods.map((p: any) => p.custom_period_name);
  }, [customPeriods]);

  const dateColumns = useMemo(() => {
    const cols = new Set<string>();
    customReportMliFields.forEach(({ field }) => {
      field.sub_fields?.forEach((sf) => {
        if (sf.field_type === "date" || sf.field_type === "datetime") {
          cols.add(sf.key);
        }
      });
    });
    return Array.from(cols);
  }, [customReportMliFields]);

  // Drag and drop states
  const [draggedSectionIdx, setDraggedSectionIdx] = useState<number | null>(null);
  const [draggedFieldLoc, setDraggedFieldLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  const [dragOverSectionIdx, setDragOverSectionIdx] = useState<number | null>(null);
  const [dragOverFieldLoc, setDragOverFieldLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);

  const hasUnsavedChanges = useMemo(() => {
    if (!report) return false;
    const currentLayout = {
      sections: sections.map(s => ({
        kpi_id: s.kpi_id,
        custom_header: s.custom_header,
        sort_order: s.sort_order,
        fields: s.fields.map(f => ({
          kpi_field_id: f.kpi_field_id,
          sort_order: f.sort_order,
          config: f.config || null,
        })),
      })),
      attachments: attachments.map(a => ({
        kpi_id: a.kpi_id,
        kpi_field_id: a.kpi_field_id,
        title: a.title,
        selected_columns: a.selected_columns || [],
        filters: a.filters || null,
        sort_order: a.sort_order,
      })),
      fetch_data_with_date: fetchDataWithDate,
      date_fetching_config: dateFetchingConfig,
      report_header_id: reportHeaderId,
      show_report_name: showReportName,
      branding_title: brandingTitle,
      scalar_bold: scalarBold,
      scalar_font_size: scalarFontSize,
      mli_font_size: mliFontSize,
      show_odoo_button: showOdooButton,
      odoo_sync_kpi_ids: odooSyncKpiIds,
    };

    const reportLayout = {
      sections: report.sections.map(s => ({
        kpi_id: s.kpi_id,
        custom_header: s.custom_header,
        sort_order: s.sort_order,
        fields: s.fields.map(f => ({
          kpi_field_id: f.kpi_field_id,
          sort_order: f.sort_order,
          config: f.config || null,
        })),
      })),
      attachments: (report as any).attachments?.map((a: any) => ({
        kpi_id: a.kpi_id,
        kpi_field_id: a.kpi_field_id,
        title: a.title,
        selected_columns: a.selected_columns || [],
        filters: a.filters || null,
        sort_order: a.sort_order,
      })) || [],
      fetch_data_with_date: report.fetch_data_with_date ?? false,
      date_fetching_config: report.date_fetching_config ?? {},
      report_header_id: (report as any).report_header_id ?? null,
      show_report_name: (report as any).show_report_name ?? true,
      branding_title: (report as any).branding_title ?? "",
      scalar_bold: (report as any).scalar_bold ?? true,
      scalar_font_size: (report as any).scalar_font_size ?? 11,
      mli_font_size: (report as any).mli_font_size ?? 10,
      show_odoo_button: (report as any).show_odoo_button ?? false,
      odoo_sync_kpi_ids: (report as any).odoo_sync_kpi_ids ?? [],
    };

    return JSON.stringify(currentLayout) !== JSON.stringify(reportLayout);
  }, [report, sections, attachments, fetchDataWithDate, dateFetchingConfig, reportHeaderId, showReportName, brandingTitle, scalarBold, scalarFontSize, mliFontSize, showOdooButton, odooSyncKpiIds]);


  // Column Selection & Reordering + Row Filtering States for MLIs
  const [editingFieldLoc, setEditingFieldLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  const [editingWidthsLoc, setEditingWidthsLoc] = useState<{ secIdx: number; fieldIdx: number } | null>(null);
  const [editingFieldConfig, setEditingFieldConfig] = useState<{
    selected_columns: string[];
    filters: { conditions: any[]; _version: number };
    custom_sub_field_labels?: Record<string, string>;
    sort_column?: string;
    sort_direction?: string;
    merged_headers?: { title: string; start_key: string; end_key: string }[];
  } | null>(null);

  const [editingAttachmentIdx, setEditingAttachmentIdx] = useState<number | null>(null);
  const [editingAttachmentConfig, setEditingAttachmentConfig] = useState<{
    kpi_id: number;
    kpi_field_id: number;
    title: string;
    selected_columns: string[];
    filters: { conditions: any[]; _version: number; sort_column?: string; sort_direction?: string };
  } | null>(null);

  const [openFilterFieldKey, setOpenFilterFieldKey] = useState<boolean>(false);
  const [filterDraft, setFilterDraft] = useState<MultiFilterConditionRow[]>([emptyMultiFilterRow()]);
  const [sourceKpiFieldsById, setSourceKpiFieldsById] = useState<Record<number, FieldSummary[]>>({});
  const [refFilterOptions, setRefFilterOptions] = useState<Record<string, string[]>>({});

  const handleMoveSectionUp = (idx: number) => {
    if (idx === 0) return;
    setSections((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[idx - 1];
      next[idx - 1] = temp;
      return next.map((s, sIdx) => ({ ...s, sort_order: sIdx }));
    });
  };

  const handleMoveSectionDown = (idx: number) => {
    if (idx === sections.length - 1) return;
    setSections((prev) => {
      const next = [...prev];
      const temp = next[idx];
      next[idx] = next[idx + 1];
      next[idx + 1] = temp;
      return next.map((s, sIdx) => ({ ...s, sort_order: sIdx }));
    });
  };

  const handleMoveFieldUp = (secIdx: number, fIdx: number) => {
    if (fIdx === 0) return;
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const fields = [...s.fields];
        const temp = fields[fIdx];
        fields[fIdx] = fields[fIdx - 1];
        fields[fIdx - 1] = temp;
        return {
          ...s,
          fields: fields.map((f, idx) => ({ ...f, sort_order: idx })),
        };
      });
    });
  };

  const handleMoveFieldDown = (secIdx: number, fIdx: number) => {
    const sec = sections[secIdx];
    if (fIdx === sec.fields.length - 1) return;
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const fields = [...s.fields];
        const temp = fields[fIdx];
        fields[fIdx] = fields[fIdx + 1];
        fields[fIdx + 1] = temp;
        return {
          ...s,
          fields: fields.map((f, idx) => ({ ...f, sort_order: idx })),
        };
      });
    });
  };

  useEffect(() => {
    const token = getAccessToken();
    if (!token || !id || !orgId) return;

    setLoading(true);
    Promise.all([
      api<CustomReportDetail>(`/custom-reports/${id}/detail?organization_id=${orgId}`, { token }),
      api<any[]>(`/kpis?organization_id=${orgId}`, { token }),
      api<KPIField[]>(`/fields?organization_id=${orgId}`, { token }),
      api<any[]>(`/reports/headers?organization_id=${orgId}`, { token }).catch(() => []),
      api<{id: number; name: string}[]>(`/custom-reports/odoo-configured-kpis?organization_id=${orgId}`, { token }).catch(() => []),
    ])
      .then(([detail, kpisData, allFields, headersData, odooKpis]) => {

        setReport(detail);
        setSections(detail.sections.sort((a, b) => a.sort_order - b.sort_order));
        setAttachments((detail as any).attachments || []);
        setFetchDataWithDate(detail.fetch_data_with_date ?? false);
        setDateFetchingConfig(detail.date_fetching_config ?? {});
        setReportHeaderId((detail as any).report_header_id ?? null);
        setShowReportName((detail as any).show_report_name ?? true);
        setBrandingTitle((detail as any).branding_title ?? "");
        setScalarBold((detail as any).scalar_bold ?? true);
        setScalarFontSize((detail as any).scalar_font_size ?? 11);
        setMliFontSize((detail as any).mli_font_size ?? 10);
        setShowOdooButton((detail as any).show_odoo_button ?? false);
        setOdooSyncKpiIds((detail as any).odoo_sync_kpi_ids || []);
        setOdooConfiguredKpis(odooKpis || []);

        setCustomReportHeaders(headersData || []);

        // Group fields by kpi_id in memory
        const fieldsByKpi = (allFields || []).reduce((acc, f) => {
          if (!acc[f.kpi_id]) acc[f.kpi_id] = [];
          acc[f.kpi_id].push(f);
          return acc;
        }, {} as Record<number, KPIField[]>);

        const fullKpis: KPI[] = kpisData.map((k) => ({
          id: k.id,
          name: k.name,
          fields: fieldsByKpi[k.id] || [],
        }));
        
        setAllKpis(fullKpis);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load designer data"))
      .finally(() => setLoading(false));
  }, [id, orgId]);

  const fetchPreview = async (yearVal: number) => {
    const token = getAccessToken();
    if (!token || !id) return;

    setPreviewLoading(true);
    try {
      const data = await api<{ rendered_html?: string }>(
        `/custom-reports/${id}/generate?year=${yearVal}&organization_id=${orgId}&preview=true`,
        { token }
      );
      setPreviewHtml(data.rendered_html || "<p>No content generated</p>");
    } catch (e) {
      setPreviewHtml(`<p style="color: var(--error);">Failed to generate preview: ${e instanceof Error ? e.message : "error"}</p>`);
    } finally {
      setPreviewLoading(false);
    }
  };

  useEffect(() => {
    if (id && orgId && !loading) {
      fetchPreview(previewYear);
    }
  }, [id, orgId, loading, previewYear]);

  // Search filter
  const filteredKpis = useMemo(() => {
    return allKpis.filter((k) =>
      k.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allKpis, searchQuery]);

  // Add KPI as section
  const handleAddKpi = (kpi: KPI) => {
    // Check if section for this KPI already exists
    if (sections.some((s) => s.kpi_id === kpi.id)) {
      toast.error("KPI is already added as a section in this report");
      return;
    }

    // Map fields
    const kpiFields: CustomReportField[] = kpi.fields.map((f, idx) => ({
      kpi_field_id: f.id,
      field_key: f.key,
      field_name: f.name,
      field_type: f.field_type,
      sort_order: idx,
      kpi_id: kpi.id,
    }));

    const newSection: CustomReportSection = {
      kpi_id: kpi.id,
      kpi_name: kpi.name,
      custom_header: null,
      sort_order: sections.length,
      fields: kpiFields,
    };

    setSections((prev) => [...prev, newSection]);
    toast.success(`Added "${kpi.name}" section`);
  };

  // Remove section
  const handleRemoveSection = (secIdx: number) => {
    const sec = sections[secIdx];
    if (sec && sec.fields.length > 0) {
      setDeleteConfirmIdx(secIdx);
    } else {
      setSections((prev) => {
        const next = prev.filter((_, idx) => idx !== secIdx);
        return next.map((s, idx) => ({ ...s, sort_order: idx }));
      });
      toast.success("Section removed");
    }
  };

  const confirmDeleteEverything = (secIdx: number) => {
    setSections((prev) => {
      const next = prev.filter((_, idx) => idx !== secIdx);
      return next.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    setDeleteConfirmIdx(null);
    toast.success("Heading and fields removed");
  };

  const confirmMergeFields = (secIdx: number) => {
    setSections((prev) => {
      if (prev.length <= 1) {
        toast.error("No other section to merge fields into.");
        return prev;
      }

      const currentSec = prev[secIdx];
      const fieldsToMerge = currentSec.fields;
      
      const targetIdx = secIdx > 0 ? secIdx - 1 : secIdx + 1;
      
      const next = prev.map((s, idx) => {
        if (idx === targetIdx) {
          const mergedFields = [...s.fields, ...fieldsToMerge].map((f, fIdx) => ({
            ...f,
            sort_order: fIdx
          }));
          return { ...s, fields: mergedFields };
        }
        return s;
      });

      const filtered = next.filter((_, idx) => idx !== secIdx);
      return filtered.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    setDeleteConfirmIdx(null);
    toast.success("Heading removed and fields merged");
  };

  // Remove field
  const handleRemoveField = (secIdx: number, fieldIdx: number) => {
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const nextFields = s.fields.filter((_, fIdx) => fIdx !== fieldIdx);
        return {
          ...s,
          fields: nextFields.map((f, idx) => ({ ...f, sort_order: idx })),
        };
      });
    });
  };

  // Handle section header edit
  const handleSectionHeaderChange = (secIdx: number, val: string) => {
    setSections((prev) => {
      return prev.map((s, idx) => {
        if (idx !== secIdx) return s;
        return { ...s, custom_header: val || null };
      });
    });
  };

  // Handle sub-heading (field) name edit
  const handleFieldNameChange = (secIdx: number, fieldIdx: number, val: string) => {
    setSections((prev) => {
      return prev.map((s, sIdx) => {
        if (sIdx !== secIdx) return s;
        const fields = s.fields.map((f, fIdx) => {
          if (fIdx !== fieldIdx) return f;
          return {
            ...f,
            config: {
              ...(f.config || {}),
              custom_name: val || null
            }
          };
        });
        return { ...s, fields };
      });
    });
  };

  // Split section at field index to insert a new heading with dynamic renumbering
  const handleSplitSection = (secIdx: number, fieldIdx: number) => {
    setSections((prev) => {
      const next = [];
      for (let i = 0; i < prev.length; i++) {
        if (i === secIdx) {
          const currentSec = prev[i];
          const splitFields = currentSec.fields.slice(fieldIdx);
          
          // Truncate original section fields
          const firstSec = {
            ...currentSec,
            fields: currentSec.fields.slice(0, fieldIdx)
          };
          next.push(firstSec);

          // Create new section split off from the original
          const secondSec = {
            kpi_id: currentSec.kpi_id,
            kpi_name: currentSec.kpi_name,
            custom_header: "New Heading",
            sort_order: currentSec.sort_order + 1,
            fields: splitFields.map((f, fIdx) => ({
              ...f,
              sort_order: fIdx
            }))
          };
          next.push(secondSec);
        } else {
          next.push(prev[i]);
        }
      }
      return next.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    toast.success("Heading split created");
  };

  // Insert a new blank heading section (with no fields initially)
  const handleInsertBlankSection = (insertAfterIdx: number | null) => {
    setSections((prev) => {
      // Inherit kpi_id from surrounding sections to satisfy non-null foreign key in DB
      const defaultKpiId = prev.length > 0 
        ? (insertAfterIdx !== null ? prev[insertAfterIdx].kpi_id : prev[prev.length - 1].kpi_id)
        : (allKpis.length > 0 ? allKpis[0].id : 0);

      const defaultKpiName = prev.length > 0 
        ? (insertAfterIdx !== null ? prev[insertAfterIdx].kpi_name : prev[prev.length - 1].kpi_name)
        : (allKpis.length > 0 ? allKpis[0].name : "Custom Heading");

      const newSec = {
        kpi_id: defaultKpiId,
        kpi_name: defaultKpiName,
        custom_header: "New Custom Heading",
        sort_order: 0,
        fields: []
      };

      let next = [...prev];
      if (insertAfterIdx === null) {
        next.push(newSec);
      } else {
        next.splice(insertAfterIdx + 1, 0, newSec);
      }

      return next.map((s, idx) => ({ ...s, sort_order: idx }));
    });
    toast.success("New custom heading inserted");
  };

  // Reordering calculations for display numbering
  const displaySections = useMemo(() => {
    return sections.map((s, sIdx) => {
      const secNum = sIdx + 1;
      const fields = s.fields.map((f, fIdx) => ({
        ...f,
        number: `${secNum}.${fIdx + 1}`,
      }));
      return {
        ...s,
        number: String(secNum),
        fields,
      };
    });
  }, [sections]);

  // Section Drag and Drop handlers
  const handleSectionDragStart = (idx: number) => {
    setDraggedSectionIdx(idx);
    setDraggedFieldLoc(null);
  };

  const handleSectionDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedSectionIdx === null || draggedSectionIdx === idx) return;
    setDragOverSectionIdx(idx);
  };

  const handleSectionDrop = (idx: number) => {
    if (draggedSectionIdx === null) return;
    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(draggedSectionIdx, 1);
      next.splice(idx, 0, moved);
      return next.map((s, sIdx) => ({ ...s, sort_order: sIdx }));
    });
    setDraggedSectionIdx(null);
    setDragOverSectionIdx(null);
  };

  // Field Drag and Drop handlers
  const handleFieldDragStart = (secIdx: number, fieldIdx: number) => {
    setDraggedFieldLoc({ secIdx, fieldIdx });
    setDraggedSectionIdx(null);
  };

  const handleFieldDragOver = (e: React.DragEvent, secIdx: number, fieldIdx: number) => {
    e.preventDefault();
    if (!draggedFieldLoc) return;
    if (draggedFieldLoc.secIdx === secIdx && draggedFieldLoc.fieldIdx === fieldIdx) return;
    setDragOverFieldLoc({ secIdx, fieldIdx });
  };

  const handleFieldDrop = (secIdx: number, targetFieldIdx: number) => {
    if (!draggedFieldLoc) return;
    
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, fields: [...s.fields] }));
      const { secIdx: sourceSecIdx, fieldIdx: sourceFieldIdx } = draggedFieldLoc;

      // Extract field from source section
      const [moved] = next[sourceSecIdx].fields.splice(sourceFieldIdx, 1);

      // Re-index source section fields
      next[sourceSecIdx].fields = next[sourceSecIdx].fields.map((f, idx) => ({ ...f, sort_order: idx }));

      // Insert field into target section
      next[secIdx].fields.splice(targetFieldIdx, 0, moved);

      // Re-index target section fields
      next[secIdx].fields = next[secIdx].fields.map((f, idx) => ({ ...f, sort_order: idx }));

      return next;
    });

    setDraggedFieldLoc(null);
    setDragOverFieldLoc(null);
  };

  // Layout save trigger
  const handleSave = async (andExit = false) => {
    const token = getAccessToken();
    if (!token || !id) return;

    setSaveSaving(true);
    try {
      const payload = {
        sections: sections.map((s) => ({
          kpi_id: s.kpi_id,
          custom_header: s.custom_header,
          sort_order: s.sort_order,
          fields: s.fields.map((f) => ({
            kpi_field_id: f.kpi_field_id,
            sort_order: f.sort_order,
            config: f.config || null,
          })),
        })),
        attachments: attachments.map((a) => ({
          kpi_id: a.kpi_id,
          kpi_field_id: a.kpi_field_id,
          title: a.title,
          selected_columns: a.selected_columns || [],
          filters: a.filters || null,
          sort_order: a.sort_order,
        })),
        fetch_data_with_date: fetchDataWithDate,
        date_fetching_config: dateFetchingConfig,
        report_header_id: reportHeaderId,
        show_report_name: showReportName,
        branding_title: brandingTitle,
        scalar_bold: scalarBold,
        scalar_font_size: scalarFontSize,
        mli_font_size: mliFontSize,
        show_odoo_button: showOdooButton,
        odoo_sync_kpi_ids: odooSyncKpiIds,
      };


      await api(`/custom-reports/${id}/layout?organization_id=${orgId}`, {
        method: "PUT",
        token,
        body: JSON.stringify(payload),
      });

      setReport((prev) => prev ? {
        ...prev,
        sections: sections,
        attachments: attachments,
        fetch_data_with_date: fetchDataWithDate,
        date_fetching_config: dateFetchingConfig,
        report_header_id: reportHeaderId,
        show_report_name: showReportName,
        branding_title: brandingTitle,
        scalar_bold: scalarBold,
        scalar_font_size: scalarFontSize,
        mli_font_size: mliFontSize,
        show_odoo_button: showOdooButton,
        odoo_sync_kpi_ids: odooSyncKpiIds,
      } : null);


      toast.success("Report layout saved successfully");
      fetchPreview(previewYear);

      if (andExit) {
        router.push(`/dashboard/custom-reports?organization_id=${orgId}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save layout");
    } finally {
      setSaveSaving(false);
    }
  };

  if (loading) return <p style={{ padding: "1.5rem" }}>Loading designer configuration...</p>;
  if (error) return <p className="form-error" style={{ margin: "1.5rem" }}>{error}</p>;

  return (
    <div style={{ padding: "0 1rem 1rem", height: "calc(100vh - 80px)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>
            Designer: {report?.name}
          </h1>
          <p style={{ color: "var(--muted)", margin: 0, fontSize: "0.85rem" }}>
            Drag sections and fields to arrange layouts. Rename headings directly.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button type="button" className="btn" onClick={() => router.push(`/dashboard/custom-reports?organization_id=${orgId}`)}>
            Cancel
          </button>
          <button type="button" className="btn" onClick={() => handleSave(false)} disabled={saveSaving}>
            Save Layout
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => setReportSettingsOpen(!reportSettingsOpen)}
            style={{
              background: reportSettingsOpen ? "var(--border)" : "transparent",
              border: "1px solid var(--border)",
            }}
          >
            ⚙️ Settings
          </button>
          <button type="button" className="btn btn-primary" onClick={() => handleSave(true)} disabled={saveSaving}>
            {saveSaving ? "Saving..." : "Save & Close"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: "1.5rem" }}>
        {/* Left Column: Layout designer */}
        <div style={{ flex: "0 0 520px", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "1rem", borderBottom: "1px solid var(--border)" }}>
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "0.95rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)" }}>Add KPIs to Report</h3>
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search available KPIs..."
              style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            {searchQuery && (
              <div style={{ maxHeight: 150, overflowY: "auto", marginTop: "0.5rem", border: "1px solid var(--border)", borderRadius: 6, background: "white" }}>
                {filteredKpis.length === 0 ? (
                  <p style={{ padding: "0.5rem", fontSize: "0.85rem", color: "var(--muted)", margin: 0 }}>No KPIs found</p>
                ) : (
                  filteredKpis.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => handleAddKpi(k)}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: "0.5rem",
                        textAlign: "left",
                        fontSize: "0.85rem",
                        border: "none",
                        background: "none",
                        cursor: "pointer",
                        borderBottom: "1px solid #f1f5f9",
                        transition: "background 0.2s"
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      + {k.name} <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>({k.fields.length} fields)</span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "1rem" }}>
            {reportSettingsOpen && (
              <div className="card" style={{ padding: "0.75rem", display: "grid", gap: "0.75rem", marginBottom: "1rem", background: "var(--bg-muted, #fcfcfc)", border: "1px dashed var(--border)", borderRadius: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 650, fontSize: "0.9rem" }}>Report Settings & Branding</span>
                  <button type="button" className="btn btn-secondary btn-sm" style={{ padding: "0.1rem 0.35rem", fontSize: "0.7rem" }} onClick={() => setReportSettingsOpen(false)}>Close</button>
                </div>

                <div style={{ display: "grid", gap: "0.75rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" }}>
                  <span style={{ fontWeight: 650, fontSize: "0.9rem" }}>Report Header & Branding</span>
                  
                  {/* Select Report Header template */}
                  <div style={{ display: "grid", gap: "0.25rem" }}>
                    <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Report Header Template</label>
                    <select
                      value={localReportHeaderId ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        setLocalReportHeaderId(val ? Number(val) : null);
                      }}
                      style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
                    >
                      <option value="">No Header Template</option>
                      {customReportHeaders.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name} ({h.main_heading})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Show Report Name Option (only if more than 1 KPI is added) */}
                  {referencedKpiIds.length > 1 && (
                    <div style={{ display: "grid", gap: "0.35rem" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Show Report Name as Header</span>
                      <div style={{ display: "flex", gap: "1rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", cursor: "pointer", margin: 0 }}>
                          <input
                            type="radio"
                            name="showReportNameRadio"
                            checked={localShowReportName === true}
                            onChange={() => setLocalShowReportName(true)}
                          />
                          Yes
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", cursor: "pointer", margin: 0 }}>
                          <input
                            type="radio"
                            name="showReportNameRadio"
                            checked={localShowReportName === false}
                            onChange={() => setLocalShowReportName(false)}
                          />
                          No
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Branding/Footer label Override */}
                  <div style={{ display: "grid", gap: "0.25rem" }}>
                    <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Custom Footer Branding Label</label>
                    <input
                      type="text"
                      placeholder="e.g. Confidential | Org Name"
                      value={localBrandingTitle}
                      onChange={(e) => setLocalBrandingTitle(e.target.value)}
                      style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
                    />
                    <p style={{ margin: 0, fontSize: "0.7rem", color: "var(--muted)" }}>
                      Overrides the default organization footer branding label in the PDF footer.
                    </p>
                  </div>

                  {/* Typography & Font Sizes */}
                  <div style={{ display: "grid", gap: "0.6rem", borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}>
                    <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>Typography & Font Sizes</span>
                    
                    {/* Scalar values bold or not */}
                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <span style={{ fontSize: "0.8rem", fontWeight: 600 }}>Bold Scalar Field Values</span>
                      <div style={{ display: "flex", gap: "1rem" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", cursor: "pointer", margin: 0 }}>
                          <input
                            type="radio"
                            name="scalarBoldRadio"
                            checked={localScalarBold === true}
                            onChange={() => setLocalScalarBold(true)}
                          />
                          Yes (Bold)
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.8rem", cursor: "pointer", margin: 0 }}>
                          <input
                            type="radio"
                            name="scalarBoldRadio"
                            checked={localScalarBold === false}
                            onChange={() => setLocalScalarBold(false)}
                          />
                          No (Regular)
                        </label>
                      </div>
                    </div>

                    {/* Scalar field values font size */}
                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Scalar Field Font Size (pt)</label>
                      <input
                        type="number"
                        min={6}
                        max={24}
                        value={localScalarFontSize}
                        onChange={(e) => setLocalScalarFontSize(Number(e.target.value))}
                        style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
                      />
                    </div>

                    {/* MLI table cells font size */}
                    <div style={{ display: "grid", gap: "0.25rem" }}>
                      <label style={{ fontSize: "0.8rem", fontWeight: 600 }}>Table Cell Font Size (pt)</label>
                      <input
                        type="number"
                        min={6}
                        max={24}
                        value={localMliFontSize}
                        onChange={(e) => setLocalMliFontSize(Number(e.target.value))}
                        style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}
                      />
                    </div>
                  </div>
                </div>

                {/* LMS Integration */}
                <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                  <span style={{ fontWeight: 650, fontSize: "0.9rem" }}>LMS Integration</span>
                  <div style={{ display: "grid", gap: "0.3rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={localShowOdooButton}
                        onChange={(e) => setLocalShowOdooButton(e.target.checked)}
                      />
                      Show &quot;Load Data from LMS&quot; Button

                    </label>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                      When enabled, a button will appear at the top of the report. Only KPIs selected below will be synced when clicked.
                    </p>
                  </div>

                  {localShowOdooButton && (
                    <div style={{ display: "grid", gap: "0.5rem", background: "var(--surface-2, #f8fafc)", border: "1px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
                      <span style={{ fontWeight: 600, fontSize: "0.82rem", color: "var(--text)" }}>
                        Select KPIs to sync from LMS:

                      </span>
                      {odooConfiguredKpis.length === 0 ? (
                        <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>
                          No Odoo-configured KPIs found in this organization. Configure Odoo for KPIs first.
                        </p>
                      ) : (
                        <>
                          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.25rem" }}>
                            <button
                              type="button"
                              onClick={() => setLocalOdooSyncKpiIds(odooConfiguredKpis.map(k => k.id))}
                              style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", color: "var(--text)" }}
                            >Select All</button>
                            <button
                              type="button"
                              onClick={() => setLocalOdooSyncKpiIds([])}
                              style={{ fontSize: "0.72rem", padding: "0.15rem 0.5rem", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", color: "var(--text)" }}
                            >Deselect All</button>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", maxHeight: 200, overflowY: "auto" }}>
                            {odooConfiguredKpis.map(kpi => {
                              const isChecked = localOdooSyncKpiIds.includes(kpi.id);
                              return (
                                <label key={kpi.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.82rem", cursor: "pointer", margin: 0, fontWeight: 500 }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setLocalOdooSyncKpiIds(prev => [...prev, kpi.id]);
                                      } else {
                                        setLocalOdooSyncKpiIds(prev => prev.filter(k => k !== kpi.id));
                                      }
                                    }}
                                  />
                                  {kpi.name}
                                </label>
                              );
                            })}
                          </div>
                        </>
                      )}
                      <p style={{ margin: "0.25rem 0 0 0", fontSize: "0.73rem", color: "var(--muted)" }}>
                        Only selected KPIs will be synced when the &quot;Load Data from LMS&quot; button is pressed.
                      </p>
                    </div>
                  )}
                </div>



                
                <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.5rem" }}>
                  <span style={{ fontWeight: 650, fontSize: "0.9rem" }}>Report Date-Fetching Configuration</span>
                  
                  <div style={{ display: "grid", gap: "0.3rem" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 600, fontSize: "0.85rem", cursor: "pointer", margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={localDateBasedFetching}
                        onChange={(e) => setLocalDateBasedFetching(e.target.checked)}
                      />
                      Fetch Data with Date
                    </label>
                    <p style={{ margin: 0, fontSize: "0.75rem", color: "var(--muted)" }}>
                      Enable date-based data-fetching using organization custom reporting periods. If disabled, default integer year logic will be used.
                    </p>
                  </div>

                  {localDateBasedFetching && (
                    <div style={{ display: "grid", gap: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <label style={{ fontSize: "0.85rem", fontWeight: 650 }}>Configure Date-Based Filtering KPIs</label>
                        <select
                          value=""
                          onChange={(e) => {
                            const kid = Number(e.target.value);
                            if (kid && !localConfiguredKpiIds.includes(kid)) {
                              setLocalConfiguredKpiIds(prev => [...prev, kid]);
                            }
                            e.target.value = "";
                          }}
                          style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem", borderRadius: "4px", border: "1px solid var(--border)", background: "var(--surface)" }}
                        >
                          <option value="">+ Add KPI for Date Filtering...</option>
                          {allKpis
                            .filter(k => !localConfiguredKpiIds.includes(k.id))
                            .map(k => (
                              <option key={k.id} value={k.id}>
                                {k.name || `KPI #${k.id}`}
                              </option>
                            ))}
                        </select>
                      </div>

                      {localConfiguredKpiIds.length === 0 ? (
                        <p style={{ fontSize: "0.8rem", color: "var(--muted)", margin: 0, fontStyle: "italic" }}>
                          No KPIs selected for date-based filtering. Select a KPI above to map its MLI and Date sub-field.
                        </p>
                      ) : (
                        <div style={{ display: "grid", gap: "0.75rem" }}>
                          {localConfiguredKpiIds.map((kpiId) => {
                            const kpiObj = allKpis.find(k => k.id === kpiId);
                            const kpiName = kpiObj?.name || `KPI #${kpiId}`;
                            const mliFields = (kpiObj?.fields || []).filter((f: any) => f.field_type === "multi_line_items");
                            const selectedMliKey = localKpiMlis[String(kpiId)] || (mliFields[0]?.key || "");
                            const selectedMliField = mliFields.find((f: any) => f.key === selectedMliKey);
                            const dateSubFields = (selectedMliField?.sub_fields || []).filter(
                              (sf: any) => sf.field_type === "date" || sf.field_type === "datetime"
                            );
                            const mliDateKey = `${kpiId}_${selectedMliKey}`;

                            return (
                              <div key={kpiId} style={{ padding: "0.75rem", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", display: "grid", gap: "0.5rem" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                  <div style={{ fontSize: "0.85rem", fontWeight: 650 }}>
                                    <span style={{ color: "var(--muted)" }}>KPI:</span> {kpiName}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setLocalConfiguredKpiIds(prev => prev.filter(id => id !== kpiId));
                                    }}
                                    style={{ border: "none", background: "transparent", color: "#ef4444", fontSize: "0.8rem", cursor: "pointer", fontWeight: 600 }}
                                  >
                                    Remove
                                  </button>
                                </div>

                                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
                                  <div>
                                    <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.2rem" }}>Select MLI Field:</label>
                                    <select
                                      value={selectedMliKey}
                                      onChange={(e) => {
                                        const mliKey = e.target.value;
                                        setLocalKpiMlis(prev => ({ ...prev, [String(kpiId)]: mliKey }));
                                      }}
                                      style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", width: "100%" }}
                                    >
                                      {mliFields.length === 0 ? (
                                        <option value="">No MLI fields available</option>
                                      ) : (
                                        mliFields.map((f: any) => (
                                          <option key={f.key} value={f.key}>
                                            {f.name || f.key}
                                          </option>
                                        ))
                                      )}
                                    </select>
                                  </div>

                                  <div>
                                    <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.2rem" }}>Select Date Sub-field:</label>
                                    <select
                                      value={localMliDateCols[mliDateKey] || ""}
                                      onChange={(e) => {
                                        const dateSubKey = e.target.value;
                                        setLocalMliDateCols(prev => ({ ...prev, [mliDateKey]: dateSubKey }));
                                      }}
                                      style={{ padding: "0.35rem 0.5rem", fontSize: "0.82rem", borderRadius: "6px", border: "1px solid var(--border)", background: "var(--surface)", width: "100%" }}
                                    >
                                      <option value="">Select Date column...</option>
                                      {dateSubFields.map((sf: any) => (
                                        <option key={sf.key} value={sf.key}>
                                          {sf.name || sf.key} ({sf.field_type})
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      const nextConfig = {
                        ...dateFetchingConfig,
                        configured_kpi_ids: localConfiguredKpiIds,
                        kpi_mlis: localKpiMlis,
                        mli_date_cols: localMliDateCols,
                      };
                      setFetchDataWithDate(localDateBasedFetching);
                      setDateFetchingConfig(nextConfig);
                      setReportHeaderId(localReportHeaderId);
                      setShowReportName(localShowReportName);
                      setBrandingTitle(localBrandingTitle);
                      setScalarBold(localScalarBold);
                      setScalarFontSize(localScalarFontSize);
                      setMliFontSize(localMliFontSize);
                      setShowOdooButton(localShowOdooButton);
                      setOdooSyncKpiIds(localOdooSyncKpiIds);

                      const tok = getAccessToken();
                      if (!tok || !id) return;
                      try {
                        const payload = {
                          sections: sections.map((s) => ({
                            kpi_id: s.kpi_id,
                            custom_header: s.custom_header,
                            sort_order: s.sort_order,
                            fields: s.fields.map((f) => ({
                              kpi_field_id: f.kpi_field_id,
                              sort_order: f.sort_order,
                              config: f.config || null,
                            })),
                          })),
                          attachments: attachments.map((a) => ({
                            kpi_id: a.kpi_id,
                            kpi_field_id: a.kpi_field_id,
                            title: a.title,
                            selected_columns: a.selected_columns || [],
                            filters: a.filters || null,
                            sort_order: a.sort_order,
                          })),
                          fetch_data_with_date: localDateBasedFetching,
                          date_fetching_config: nextConfig,
                          report_header_id: localReportHeaderId,
                          show_report_name: localShowReportName,
                          branding_title: localBrandingTitle,
                          scalar_bold: localScalarBold,
                          scalar_font_size: localScalarFontSize,
                          mli_font_size: localMliFontSize,
                          show_odoo_button: localShowOdooButton,
                          odoo_sync_kpi_ids: localOdooSyncKpiIds,
                        };


                        await api(`/custom-reports/${id}/layout?organization_id=${orgId}`, {
                          method: "PUT",
                          token: tok,
                          body: JSON.stringify(payload),
                        });

                        setReport((prev) => prev ? {
                          ...prev,
                          sections: sections,
                          attachments: attachments,
                          fetch_data_with_date: localDateBasedFetching,
                          date_fetching_config: nextConfig,
                          report_header_id: localReportHeaderId,
                          show_report_name: localShowReportName,
                          branding_title: localBrandingTitle,
                          scalar_bold: localScalarBold,
                          scalar_font_size: localScalarFontSize,
                          mli_font_size: localMliFontSize,
                          show_odoo_button: localShowOdooButton,
                          odoo_sync_kpi_ids: localOdooSyncKpiIds,
                        } : null);


                        toast.success("Configuration saved successfully.");
                        fetchPreview(previewYear);
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed to save configuration");
                      }
                    }}
                    style={{ marginTop: "0.5rem", width: "100%" }}
                  >
                    Save Configuration
                  </button>
                </div>
              </div>
            )}

            <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)" }}>Report Structure</h3>
            {displaySections.length === 0 ? (
              <div style={{ padding: "2rem", textAlign: "center", border: "2px dashed var(--border)", borderRadius: 8, color: "var(--muted)" }}>
                No sections added yet. Search and click a KPI above to add it.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {displaySections.map((sec, sIdx) => {
                  const isSectionDragged = draggedSectionIdx === sIdx;
                  const isSectionDragOver = dragOverSectionIdx === sIdx;
                  return (
                    <div
                      key={sec.kpi_id}
                      draggable
                      onDragStart={() => handleSectionDragStart(sIdx)}
                      onDragOver={(e) => handleSectionDragOver(e, sIdx)}
                      onDrop={() => handleSectionDrop(sIdx)}
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        background: isSectionDragOver ? "#eff6ff" : "white",
                        opacity: isSectionDragged ? 0.4 : 1,
                        cursor: "grab",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
                      }}
                    >
                      {/* Section Header */}
                      <div
                        style={{
                          padding: "0.6rem 0.75rem",
                          background: "#f8fafc",
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          borderTopLeftRadius: 7,
                          borderTopRightRadius: 7
                        }}
                      >
                        <span style={{ fontSize: "1.1rem", color: "#94a3b8", cursor: "grab" }}>☰</span>
                        <div style={{ display: "flex", flexDirection: "column", gap: "2px", marginRight: "0.2rem" }}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleMoveSectionUp(sIdx); }}
                            disabled={sIdx === 0}
                            style={{ border: "none", background: "none", color: sIdx === 0 ? "#cbd5e1" : "#64748b", cursor: sIdx === 0 ? "not-allowed" : "pointer", fontSize: "0.65rem", padding: 0, height: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
                            title="Move section up"
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); handleMoveSectionDown(sIdx); }}
                            disabled={sIdx === sections.length - 1}
                            style={{ border: "none", background: "none", color: sIdx === sections.length - 1 ? "#cbd5e1" : "#64748b", cursor: sIdx === sections.length - 1 ? "not-allowed" : "pointer", fontSize: "0.65rem", padding: 0, height: 10, display: "flex", alignItems: "center", justifyContent: "center" }}
                            title="Move section down"
                          >
                            ▼
                          </button>
                        </div>
                        <span style={{ fontWeight: 600, color: "var(--muted)", fontSize: "0.9rem" }}>{sec.number}</span>
                        <div style={{ display: "flex", alignItems: "center", flex: 1, position: "relative" }}>
                          <input
                            value={sec.custom_header || ""}
                            onChange={(e) => handleSectionHeaderChange(sIdx, e.target.value)}
                            placeholder={sec.kpi_name}
                            style={{
                              width: "100%",
                              padding: "0.2rem 1.5rem 0.2rem 0.4rem",
                              fontSize: "0.9rem",
                              fontWeight: 600,
                              borderRadius: 4,
                              border: "1px solid transparent",
                              background: "transparent",
                              color: "var(--text)"
                            }}
                            onFocus={(e) => {
                              e.currentTarget.style.border = "1px solid var(--border)";
                              e.currentTarget.style.background = "white";
                            }}
                            onBlur={(e) => {
                              e.currentTarget.style.border = "1px solid transparent";
                              e.currentTarget.style.background = "transparent";
                            }}
                          />

                        </div>
                        <div style={{ position: "relative" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenSectionMenuIdx(openSectionMenuIdx === sIdx ? null : sIdx);
                            }}
                            style={{
                              border: "none",
                              background: "none",
                              color: "#64748b",
                              cursor: "pointer",
                              fontSize: "1.1rem",
                              padding: "0.25rem 0.5rem",
                              borderRadius: 4,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center"
                            }}
                            title="Section Actions"
                          >
                            ⋮
                          </button>
                          {openSectionMenuIdx === sIdx && (
                            <>
                              <div
                                style={{
                                  position: "fixed",
                                  inset: 0,
                                  zIndex: 40,
                                  cursor: "default"
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenSectionMenuIdx(null);
                                }}
                              />
                              <div
                                style={{
                                  position: "absolute",
                                  right: 0,
                                  top: "100%",
                                  zIndex: 50,
                                  background: "white",
                                  border: "1px solid var(--border)",
                                  borderRadius: 8,
                                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                                  padding: "0.4rem 0",
                                  minWidth: "160px",
                                  display: "flex",
                                  flexDirection: "column"
                                }}
                              >
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleInsertBlankSection(sIdx);
                                    setOpenSectionMenuIdx(null);
                                  }}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    padding: "0.5rem 1rem",
                                    textAlign: "left",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                    color: "var(--text)"
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  + Insert Heading Below
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveSection(sIdx);
                                    setOpenSectionMenuIdx(null);
                                  }}
                                  style={{
                                    border: "none",
                                    background: "none",
                                    padding: "0.5rem 1rem",
                                    textAlign: "left",
                                    fontSize: "0.85rem",
                                    cursor: "pointer",
                                    color: "var(--error)"
                                  }}
                                  onMouseEnter={(e) => (e.currentTarget.style.background = "#fff5f5")}
                                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                >
                                  Remove Heading
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Section Fields (Drop Target for Fields) */}
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleFieldDrop(sIdx, sec.fields.length)}
                        style={{ padding: "0.5rem", minHeight: 40, display: "flex", flexDirection: "column", gap: "0.4rem" }}
                      >
                        {sec.fields.length === 0 ? (
                          <div style={{ padding: "0.5rem", textAlign: "center", color: "var(--muted)", fontSize: "0.8rem", fontStyle: "italic" }}>
                            Drop fields here
                          </div>
                        ) : (
                          sec.fields.map((f, fIdx) => {
                            const isFieldDragged = draggedFieldLoc?.secIdx === sIdx && draggedFieldLoc?.fieldIdx === fIdx;
                            const isFieldDragOver = dragOverFieldLoc?.secIdx === sIdx && dragOverFieldLoc?.fieldIdx === fIdx;
                            return (
                              <div
                                key={f.kpi_field_id}
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  handleFieldDragStart(sIdx, fIdx);
                                }}
                                onDragOver={(e) => handleFieldDragOver(e, sIdx, fIdx)}
                                onDrop={(e) => {
                                  e.stopPropagation();
                                  handleFieldDrop(sIdx, fIdx);
                                }}
                                style={{
                                  padding: "0.4rem 0.6rem",
                                  background: isFieldDragOver ? "#eff6ff" : "#f1f5f9",
                                  border: "1px solid #e2e8f0",
                                  borderRadius: 6,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.4rem",
                                  opacity: isFieldDragged ? 0.4 : 1,
                                  cursor: "grab"
                                }}
                              >
                                 <span style={{ color: "#cbd5e1" }}>⁝⁝</span>
                                <div style={{ display: "flex", flexDirection: "column", gap: "1px", marginRight: "0.2rem" }}>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleMoveFieldUp(sIdx, fIdx); }}
                                    disabled={fIdx === 0}
                                    style={{ border: "none", background: "none", color: fIdx === 0 ? "#cbd5e1" : "#64748b", cursor: fIdx === 0 ? "not-allowed" : "pointer", fontSize: "0.55rem", padding: 0, height: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
                                    title="Move field up"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleMoveFieldDown(sIdx, fIdx); }}
                                    disabled={fIdx === sec.fields.length - 1}
                                    style={{ border: "none", background: "none", color: fIdx === sec.fields.length - 1 ? "#cbd5e1" : "#64748b", cursor: fIdx === sec.fields.length - 1 ? "not-allowed" : "pointer", fontSize: "0.55rem", padding: 0, height: 8, display: "flex", alignItems: "center", justifyContent: "center" }}
                                    title="Move field down"
                                  >
                                    ▼
                                  </button>
                                </div>
                                <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 500 }}>{f.number}</span>
                                <div style={{ display: "flex", alignItems: "center", flex: 1, position: "relative" }}>
                                  <input
                                    value={(f.config as any)?.custom_name ?? f.field_name}
                                    onChange={(e) => handleFieldNameChange(sIdx, fIdx, e.target.value)}
                                    placeholder={f.field_name}
                                    style={{
                                      width: "100%",
                                      padding: "0.15rem 1.3rem 0.15rem 0.3rem",
                                      fontSize: "0.85rem",
                                      fontWeight: 500,
                                      borderRadius: 4,
                                      border: "1px solid transparent",
                                      background: "transparent",
                                      color: "var(--text)",
                                      minWidth: 0
                                    }}
                                    onFocus={(e) => {
                                      e.currentTarget.style.border = "1px solid var(--border)";
                                      e.currentTarget.style.background = "white";
                                    }}
                                    onBlur={(e) => {
                                      e.currentTarget.style.border = "1px solid transparent";
                                      e.currentTarget.style.background = "transparent";
                                    }}
                                  />

                                </div>
                                {f.kpi_id !== sec.kpi_id && (
                                  <span style={{ fontSize: "0.7rem", padding: "0.1rem 0.3rem", borderRadius: 4, background: "#e2e8f0", color: "#64748b" }}>
                                    Moved
                                  </span>
                                )}
                                <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic", marginRight: "0.5rem" }}>
                                  {f.field_type === "multi_line_items" ? "MLI" : "Scalar"}
                                </span>
                                <div style={{ position: "relative" }}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOpenFieldMenuLoc(
                                        openFieldMenuLoc?.secIdx === sIdx && openFieldMenuLoc?.fieldIdx === fIdx
                                          ? null
                                          : { secIdx: sIdx, fieldIdx: fIdx }
                                      );
                                    }}
                                    style={{
                                      border: "none",
                                      background: "none",
                                      color: "#64748b",
                                      cursor: "pointer",
                                      fontSize: "1rem",
                                      padding: "0.1rem 0.3rem",
                                      borderRadius: 4,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center"
                                    }}
                                    title="Field Actions"
                                  >
                                    ⋮
                                  </button>
                                  {openFieldMenuLoc?.secIdx === sIdx && openFieldMenuLoc?.fieldIdx === fIdx && (
                                    <>
                                      <div
                                        style={{
                                          position: "fixed",
                                          inset: 0,
                                          zIndex: 40,
                                          cursor: "default"
                                        }}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setOpenFieldMenuLoc(null);
                                        }}
                                      />
                                      <div
                                        style={{
                                          position: "absolute",
                                          right: 0,
                                          top: "100%",
                                          zIndex: 50,
                                          background: "white",
                                          border: "1px solid var(--border)",
                                          borderRadius: 8,
                                          boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)",
                                          padding: "0.4rem 0",
                                          minWidth: "180px",
                                          display: "flex",
                                          flexDirection: "column"
                                        }}
                                      >
                                        {f.field_type === "multi_line_items" && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              const kpi = allKpis.find(k => k.id === f.kpi_id);
                                              const kpiField = kpi?.fields.find(fld => fld.id === f.kpi_field_id);
                                              const subFields = kpiField?.sub_fields || [];
                                              setEditingFieldLoc({ secIdx: sIdx, fieldIdx: fIdx });
                                              setEditingFieldConfig({
                                                selected_columns: (f.config as any)?.selected_columns || subFields.map(sf => sf.key).slice(0, 5),
                                                filters: ((f.config as any)?.filters || { conditions: [], _version: 2 }) as any,
                                                sort_column: (f.config as any)?.sort_column || "",
                                                sort_direction: (f.config as any)?.sort_direction || "asc",
                                                merged_headers: (f.config as any)?.merged_headers || []
                                              });

                                              setFilterDraft(payloadToFilterDraft(((f.config as any)?.filters || { conditions: [], _version: 2 }) as any));
                                              setOpenFilterFieldKey(false);
                                              setOpenFieldMenuLoc(null);
                                            }}
                                            style={{
                                              border: "none",
                                              background: "none",
                                              padding: "0.5rem 1rem",
                                              textAlign: "left",
                                              fontSize: "0.85rem",
                                              cursor: "pointer",
                                              color: f.config ? "var(--primary)" : "var(--text)",
                                              fontWeight: f.config ? 600 : 400
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                          >
                                            ⚙️ {f.config ? "Configured" : "Configure Columns"}
                                          </button>
                                        )}
                                        {f.field_type === "multi_line_items" && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setEditingWidthsLoc({ secIdx: sIdx, fieldIdx: fIdx });
                                              setOpenFieldMenuLoc(null);
                                            }}
                                            style={{
                                              border: "none",
                                              background: "none",
                                              padding: "0.5rem 1rem",
                                              textAlign: "left",
                                              fontSize: "0.85rem",
                                              cursor: "pointer",
                                              color: (f.config as any)?.column_widths ? "var(--primary)" : "var(--text)",
                                              fontWeight: (f.config as any)?.column_widths ? 600 : 400
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                          >
                                            📐 {(f.config as any)?.column_widths ? "Configured Widths" : "Configure Column Widths"}
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleSplitSection(sIdx, fIdx);
                                            setOpenFieldMenuLoc(null);
                                          }}
                                          style={{
                                            border: "none",
                                            background: "none",
                                            padding: "0.5rem 1rem",
                                            textAlign: "left",
                                            fontSize: "0.85rem",
                                            cursor: "pointer",
                                            color: "var(--text)"
                                          }}
                                          onMouseEnter={(e) => (e.currentTarget.style.background = "#f1f5f9")}
                                          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                        >
                                          + Split Section Here
                                        </button>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveField(sIdx, fIdx);
                                            setOpenFieldMenuLoc(null);
                                          }}
                                          style={{
                                            border: "none",
                                            background: "none",
                                            padding: "0.5rem 1rem",
                                            textAlign: "left",
                                            fontSize: "0.85rem",
                                            cursor: "pointer",
                                            color: "var(--error)"
                                          }}
                                          onMouseEnter={(e) => (e.currentTarget.style.background = "#fff5f5")}
                                          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                                        >
                                          Remove Field
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
                <button
                  type="button"
                  className="btn"
                  onClick={() => handleInsertBlankSection(null)}
                  style={{
                    width: "100%",
                    padding: "0.6rem",
                    border: "2px dashed var(--border)",
                    background: "none",
                    color: "var(--muted)",
                    fontWeight: 600,
                    cursor: "pointer",
                    borderRadius: 8,
                    textAlign: "center",
                    marginTop: "1rem"
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--primary)";
                    e.currentTarget.style.color = "var(--primary)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border)";
                    e.currentTarget.style.color = "var(--muted)";
                  }}
                >
                  + Add New Heading at Bottom
                </button>
              </div>
            )}

            <div style={{ borderTop: "2px solid var(--border)", marginTop: "2rem", paddingTop: "1rem" }}>
              <h3 style={{ margin: "0 0 0.75rem 0", fontSize: "0.95rem", fontWeight: 600, textTransform: "uppercase", color: "var(--muted)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>Report Attachments</span>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                  onClick={() => {
                    const newAtt = {
                      kpi_id: 0,
                      kpi_field_id: 0,
                      title: "New Attachment",
                      selected_columns: [],
                      filters: { conditions: [], _version: 2, sort_column: "", sort_direction: "asc" },
                      sort_order: attachments.length
                    };

                    setAttachments(prev => [...prev, newAtt]);
                    setEditingAttachmentIdx(attachments.length);
                    setEditingAttachmentConfig(newAtt);
                    setFilterDraft([emptyMultiFilterRow()]);
                    setOpenFilterFieldKey(false);
                  }}
                >
                  + Add Attachment
                </button>
              </h3>
              {attachments.length === 0 ? (
                <div style={{ padding: "1.5rem", textAlign: "center", border: "2px dashed var(--border)", borderRadius: 8, color: "var(--muted)", fontSize: "0.85rem" }}>
                  No attachments configured.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {attachments.map((att, attIdx) => {
                    const kpi = allKpis.find(k => k.id === att.kpi_id);
                    const kfield = kpi?.fields.find(f => f.id === att.kpi_field_id);
                    return (
                      <div
                        key={attIdx}
                        style={{
                          padding: "0.5rem 0.75rem",
                          background: "white",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "0.5rem"
                        }}
                      >
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {att.title}
                          </span>
                          <span style={{ fontSize: "0.7rem", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {kpi?.name || `KPI #${att.kpi_id}`} - {kfield?.name || `Field #${att.kpi_field_id}`}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: "0.25rem", alignItems: "center", flexShrink: 0 }}>
                          <button
                            type="button"
                            disabled={attIdx === 0}
                            onClick={() => {
                              setAttachments(prev => {
                                const next = [...prev];
                                const temp = next[attIdx];
                                next[attIdx] = next[attIdx - 1];
                                next[attIdx - 1] = temp;
                                return next.map((a, idx) => ({ ...a, sort_order: idx }));
                              });
                            }}
                            style={{ border: "none", background: "none", fontSize: "0.75rem", cursor: attIdx === 0 ? "not-allowed" : "pointer", opacity: attIdx === 0 ? 0.3 : 1 }}
                          >
                            ▲
                          </button>
                          <button
                            type="button"
                            disabled={attIdx === attachments.length - 1}
                            onClick={() => {
                              setAttachments(prev => {
                                const next = [...prev];
                                const temp = next[attIdx];
                                next[attIdx] = next[attIdx + 1];
                                next[attIdx + 1] = temp;
                                return next.map((a, idx) => ({ ...a, sort_order: idx }));
                              });
                            }}
                            style={{ border: "none", background: "none", fontSize: "0.75rem", cursor: attIdx === attachments.length - 1 ? "not-allowed" : "pointer", opacity: attIdx === attachments.length - 1 ? 0.3 : 1 }}
                          >
                            ▼
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "0.15rem 0.35rem", fontSize: "0.7rem" }}
                            onClick={() => {
                              setEditingAttachmentIdx(attIdx);
                              setEditingAttachmentConfig({
                                kpi_id: att.kpi_id,
                                kpi_field_id: att.kpi_field_id,
                                title: att.title,
                                selected_columns: att.selected_columns || [],
                                filters: att.filters || { conditions: [], _version: 2, sort_column: "", sort_direction: "asc" }
                              });

                              setFilterDraft(payloadToFilterDraft(att.filters || { conditions: [], _version: 2 }));
                              setOpenFilterFieldKey(false);
                            }}
                          >
                            ⚙️
                          </button>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "0.15rem 0.35rem", fontSize: "0.7rem", color: "var(--error)" }}
                            onClick={() => {
                              setAttachments(prev => {
                                const next = prev.filter((_, idx) => idx !== attIdx);
                                return next.map((a, idx) => ({ ...a, sort_order: idx }));
                              });
                              toast.success("Attachment removed");
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Live Preview iframe */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "0.75rem 1rem", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text)" }}>Live Preview</span>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {hasUnsavedChanges && (
                <span style={{ fontSize: "0.75rem", color: "var(--error)", fontWeight: 600, marginRight: "0.5rem" }}>
                  ⚠️ Unsaved changes (Save layout to update preview)
                </span>
              )}
              <label style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Year</label>
              <select
                value={previewYear}
                onChange={(e) => setPreviewYear(Number(e.target.value))}
                style={{ padding: "0.25rem 0.5rem", borderRadius: 4, border: "1px solid var(--border)", fontSize: "0.85rem" }}
              >
                {Array.from({ length: 11 }, (_, i) => new Date().getFullYear() - 5 + i).map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button
                type="button"
                className="btn"
                style={{ padding: "0.25rem 0.5rem", fontSize: "0.85rem" }}
                onClick={() => fetchPreview(previewYear)}
                disabled={previewLoading}
              >
                {previewLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div style={{ flex: 1, padding: "1rem", background: "#f8fafc", position: "relative" }}>
            {previewLoading && (
              <div style={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 }}>
                <p>Generating preview...</p>
              </div>
            )}
            <iframe
              title="Layout live preview"
              srcDoc={`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:inherit;margin:1rem;color:#111;line-height:1.5;}</style></head><body>${previewHtml || (previewLoading ? "<p style='color: #64748b;'>Loading live preview...</p>" : "<p style='color: #64748b;'>Save layout to refresh preview content.</p>")}</body></html>`}
              style={{ width: "100%", height: "100%", background: "white", border: "1px solid var(--border)", borderRadius: 6 }}
            />
          </div>
        </div>
      </div>

      {/* Column Selection & Row Filter Modal */}
      {editingFieldLoc && editingFieldConfig && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: "1.5rem",
          }}
          onClick={() => setEditingFieldLoc(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.15)", background: "var(--surface)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem", marginBottom: "1rem", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                  Configure Columns & Filters: {
                    sections[editingFieldLoc.secIdx].fields[editingFieldLoc.fieldIdx].field_name
                  }
                </h3>
                <p style={{ color: "var(--muted)", margin: "0.25rem 0 0 0", fontSize: "0.85rem" }}>
                  Select and order visible columns, and define filtering criteria for rows.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  const loc = editingFieldLoc;
                  setEditingFieldLoc(null);
                  setEditingWidthsLoc(loc);
                }}
                style={{ padding: "0.4rem 0.75rem", fontSize: "0.82rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.3rem", flexShrink: 0 }}
              >
                📐 Configure Column Widths
              </button>
            </div>

            {/* Columns Selector & Ordering Section */}
            {(() => {
              const field = sections[editingFieldLoc.secIdx].fields[editingFieldLoc.fieldIdx];
              const kpi = allKpis.find(k => k.id === field.kpi_id);
              const kpiField = kpi?.fields.find(fld => fld.id === field.kpi_field_id);
              const subFields = kpiField?.sub_fields || [];
              const token = getAccessToken();

              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                        Select Columns
                      </label>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", maxHeight: 180, overflowY: "auto", background: "white" }}>
                        {subFields.map(sf => {
                          const isChecked = editingFieldConfig.selected_columns.includes(sf.key);
                          return (
                            <label key={sf.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", padding: "0.2rem 0", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  let nextCols = [...editingFieldConfig.selected_columns];
                                  if (isChecked) {
                                    nextCols = nextCols.filter(c => c !== sf.key);
                                  } else {
                                    nextCols = [...nextCols, sf.key];
                                  }
                                  setEditingFieldConfig(prev => prev ? { ...prev, selected_columns: nextCols } : null);
                                }}
                              />
                              {sf.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                        Order Selected Columns & Edit Labels
                      </label>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", maxHeight: 180, overflowY: "auto", background: "#f8fafc" }}>
                        {editingFieldConfig.selected_columns.length === 0 ? (
                          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)", fontStyle: "italic" }}>No columns selected</p>
                        ) : (
                          editingFieldConfig.selected_columns.map((col, idx) => {
                            const sf = subFields.find(s => s.key === col);
                            const currentLabel = (editingFieldConfig as any).custom_sub_field_labels?.[col] ?? sf?.name ?? col;
                            return (
                              <div
                                key={col}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  background: "white",
                                  border: "1px solid var(--border)",
                                  borderRadius: 4,
                                  padding: "0.25rem 0.5rem",
                                  marginBottom: "0.25rem",
                                  fontSize: "0.8rem",
                                  gap: "0.5rem"
                                }}
                              >
                                <input
                                  type="text"
                                  value={currentLabel}
                                  onChange={(e) => {
                                    const nextLabels = {
                                      ...((editingFieldConfig as any).custom_sub_field_labels || {}),
                                      [col]: e.target.value
                                    };
                                    setEditingFieldConfig(prev => prev ? { ...prev, custom_sub_field_labels: nextLabels } : null);
                                  }}
                                  style={{
                                    flex: 1,
                                    fontSize: "0.8rem",
                                    padding: "0.1rem 0.3rem",
                                    borderRadius: 4,
                                    border: "1px solid var(--border)",
                                    minWidth: 0
                                  }}
                                  placeholder={sf?.name || col}
                                />
                                <div style={{ display: "flex", gap: "2px" }}>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={idx === 0}
                                    onClick={() => {
                                      const nextCols = [...editingFieldConfig.selected_columns];
                                      const temp = nextCols[idx];
                                      nextCols[idx] = nextCols[idx - 1];
                                      nextCols[idx - 1] = temp;
                                      setEditingFieldConfig(prev => prev ? { ...prev, selected_columns: nextCols } : null);
                                    }}
                                    style={{ padding: "0 0.25rem", fontSize: "0.65rem", height: 18 }}
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={idx === editingFieldConfig.selected_columns.length - 1}
                                    onClick={() => {
                                      const nextCols = [...editingFieldConfig.selected_columns];
                                      const temp = nextCols[idx];
                                      nextCols[idx] = nextCols[idx + 1];
                                      nextCols[idx + 1] = temp;
                                      setEditingFieldConfig(prev => prev ? { ...prev, selected_columns: nextCols } : null);
                                    }}
                                    style={{ padding: "0 0.25rem", fontSize: "0.65rem", height: 18 }}
                                  >
                                    ▼
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Merged Headers Section */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginBottom: "1.5rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                      Grouped / Merged Headers
                    </label>
                    <p style={{ color: "var(--muted)", margin: "0 0 0.75rem 0", fontSize: "0.75rem" }}>
                      Define secondary header titles merged across groups of columns (e.g. "Students" group for Name, Phone, City).
                    </p>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                      {(!editingFieldConfig.merged_headers || editingFieldConfig.merged_headers.length === 0) ? (
                        <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)", fontStyle: "italic" }}>No merged headers defined.</p>
                      ) : (
                        editingFieldConfig.merged_headers.map((group, idx) => (
                          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 6 }}>
                            <div style={{ flex: 2 }}>
                              <input
                                type="text"
                                className="form-control"
                                placeholder="Group Title (e.g. Students)"
                                style={{ fontSize: "0.8rem", height: "30px", padding: "2px 8px" }}
                                value={group.title}
                                onChange={(e) => {
                                  const nextGroups = [...(editingFieldConfig.merged_headers || [])];
                                  nextGroups[idx] = { ...nextGroups[idx], title: e.target.value };
                                  setEditingFieldConfig(prev => prev ? { ...prev, merged_headers: nextGroups } : null);
                                }}
                              />
                            </div>
                            <div style={{ flex: 1.5 }}>
                              <select
                                className="form-control"
                                style={{ fontSize: "0.8rem", height: "30px", padding: "2px 8px" }}
                                value={group.start_key}
                                onChange={(e) => {
                                  const nextGroups = [...(editingFieldConfig.merged_headers || [])];
                                  nextGroups[idx] = { ...nextGroups[idx], start_key: e.target.value };
                                  setEditingFieldConfig(prev => prev ? { ...prev, merged_headers: nextGroups } : null);
                                }}
                              >
                                <option value="">Start Col...</option>
                                {editingFieldConfig.selected_columns.map(c => {
                                  const sf = subFields.find(s => s.key === c);
                                  return <option key={c} value={c}>{sf?.name || c}</option>;
                                })}
                              </select>
                            </div>
                            <div style={{ flex: 1.5 }}>
                              <select
                                className="form-control"
                                style={{ fontSize: "0.8rem", height: "30px", padding: "2px 8px" }}
                                value={group.end_key}
                                onChange={(e) => {
                                  const nextGroups = [...(editingFieldConfig.merged_headers || [])];
                                  nextGroups[idx] = { ...nextGroups[idx], end_key: e.target.value };
                                  setEditingFieldConfig(prev => prev ? { ...prev, merged_headers: nextGroups } : null);
                                }}
                              >
                                <option value="">End Col...</option>
                                {editingFieldConfig.selected_columns.map(c => {
                                  const sf = subFields.find(s => s.key === c);
                                  return <option key={c} value={c}>{sf?.name || c}</option>;
                                })}
                              </select>
                            </div>
                            <button
                              type="button"
                              className="btn btn-danger"
                              style={{ padding: "0 0.5rem", height: "30px", fontSize: "0.85rem", display: "flex", alignItems: "center" }}
                              onClick={() => {
                                const nextGroups = (editingFieldConfig.merged_headers || []).filter((_, gIdx) => gIdx !== idx);
                                setEditingFieldConfig(prev => prev ? { ...prev, merged_headers: nextGroups } : null);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        ))
                      )}
                      
                      <div>
                        <button
                          type="button"
                          className="btn"
                          style={{ fontSize: "0.8rem", padding: "0.25rem 0.75rem", border: "1px dashed var(--border)", background: "white" }}
                          onClick={() => {
                            const nextGroups = [...(editingFieldConfig.merged_headers || []), { title: "", start_key: "", end_key: "" }];
                            setEditingFieldConfig(prev => prev ? { ...prev, merged_headers: nextGroups } : null);
                          }}
                        >
                          + Add Grouped Header
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Sort Rows Section */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginBottom: "1.5rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                      Sort Rows
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>Sort Column</label>
                        <select
                          value={(editingFieldConfig as any).sort_column || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingFieldConfig((prev) => prev ? { ...prev, sort_column: val } : null);
                          }}
                          style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", width: "100%", borderRadius: "4px", border: "1px solid var(--border)", background: "white", color: "var(--text)" }}
                        >
                          <option value="">Default (No Sorting)</option>
                          {subFields.map((sf) => (
                            <option key={sf.key} value={sf.key}>
                              {sf.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>Direction</label>
                        <select
                          value={(editingFieldConfig as any).sort_direction || "asc"}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingFieldConfig((prev) => prev ? { ...prev, sort_direction: val } : null);
                          }}
                          disabled={!(editingFieldConfig as any).sort_column}
                          style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", width: "100%", borderRadius: "4px", border: "1px solid var(--border)", background: "white", color: "var(--text)" }}
                        >
                          <option value="asc">Ascending (A-Z / 0-9)</option>
                          <option value="desc">Descending (Z-A / 9-0)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Advanced Filters Builder Section */}

                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginBottom: "1.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Row Filters</label>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setOpenFilterFieldKey(prev => !prev)}
                        style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                      >
                        {openFilterFieldKey ? "Hide Filter Builder ▲" : "Show Filter Builder ▼"}
                      </button>
                    </div>

                    {openFilterFieldKey && token && (
                      <div style={{ marginBottom: "1rem", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", background: "white" }}>
                        <MultiItemsAdvancedFiltersPanel
                          token={token}
                          effectiveOrgId={orgId}
                          subFields={subFields.map(sf => ({ ...sf, field_type: sf.field_type || null }))}
                          filterDraft={filterDraft}
                          setFilterDraft={setFilterDraft}
                          sourceKpiFieldsById={sourceKpiFieldsById}
                          setSourceKpiFieldsById={setSourceKpiFieldsById}
                          refFilterOptions={refFilterOptions}
                          setRefFilterOptions={setRefFilterOptions}
                          fieldId={field.kpi_field_id}
                          year={previewYear}
                          onApply={(draft) => {
                            const payload = filterDraftToPayload(draft, subFields.map(sf => ({ ...sf, field_type: sf.field_type || null })));
                             setEditingFieldConfig(prev => {
                               if (!prev) return null;
                               return {
                                 ...prev,
                                 filters: (payload || { conditions: [], _version: 2 }) as any
                               };
                             });
                            setOpenFilterFieldKey(false);
                            toast.success("Applied filter constraints");
                          }}
                          onClose={() => setOpenFilterFieldKey(false)}
                          showCloseButton={true}
                        />
                      </div>
                    )}

                    {/* Active Filters Display */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                      {editingFieldConfig.filters.conditions.length === 0 ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>No active filters (all rows will be shown)</span>
                      ) : (
                        editingFieldConfig.filters.conditions.map((cond, condIdx) => {
                          const sub = subFields.find(s => s.key === cond.field);
                          return (
                            <div
                              key={condIdx}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                background: "#f1f5f9",
                                border: "1px solid #cbd5e1",
                                borderRadius: "16px",
                                padding: "0.1rem 0.5rem",
                                fontSize: "0.75rem",
                                gap: "0.25rem",
                                color: "#334155"
                              }}
                            >
                              <span>
                                {sub?.name || cond.field} {cond.op} {String(cond.value ?? cond.values?.join(", "))}
                              </span>
                              <button
                                type="button"
                                style={{ border: "none", background: "none", color: "var(--error)", cursor: "pointer", fontWeight: 700, padding: 0 }}
                                onClick={() => {
                                  const nextPayload = removeConditionFromPayload(editingFieldConfig.filters as any, condIdx);
                                  setEditingFieldConfig(prev => {
                                    if (!prev) return null;
                                    return {
                                      ...prev,
                                      filters: (nextPayload || { conditions: [], _version: 2 }) as any
                                    };
                                  });
                                  setFilterDraft(payloadToFilterDraft(nextPayload));
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Modal Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setEditingFieldLoc(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setSections(prev => {
                    const next = prev.map((s, sIdx) => {
                      if (sIdx !== editingFieldLoc.secIdx) return s;
                      const fields = s.fields.map((f, fIdx) => {
                        if (fIdx !== editingFieldLoc.fieldIdx) return f;
                        return {
                          ...f,
                          config: editingFieldConfig
                        };
                      });
                      return { ...s, fields };
                    });
                    return next;
                  });
                  setEditingFieldLoc(null);
                  toast.success("Applied settings (click Save Layout to persist changes)");
                }}
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}
      {editingAttachmentIdx !== null && editingAttachmentConfig && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: "1.5rem",
          }}
          onClick={() => setEditingAttachmentIdx(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 720, width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 10px 40px rgba(0,0,0,0.15)", background: "var(--surface)", padding: "1.5rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1rem", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                Configure Attachment
              </h3>
              <p style={{ color: "var(--muted)", margin: "0.25rem 0 0 0", fontSize: "0.85rem" }}>
                Select KPI, Multi-Line field, visible columns, and define filtering criteria.
              </p>
            </div>

            {/* Title field */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                Attachment Title
              </label>
              <input
                type="text"
                value={editingAttachmentConfig.title}
                onChange={(e) => setEditingAttachmentConfig({ ...editingAttachmentConfig, title: e.target.value })}
                placeholder="Attachment Title"
                style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem", borderRadius: 6, border: "1px solid var(--border)" }}
              />
            </div>

            {/* KPI & Field selectors */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Select KPI
                </label>
                <select
                  value={editingAttachmentConfig.kpi_id || ""}
                  onChange={(e) => {
                    const kid = Number(e.target.value);
                    const kpi = allKpis.find(k => k.id === kid);
                    const mliFields = kpi?.fields.filter(f => f.field_type === "multi_line_items") || [];
                    const firstMli = mliFields[0];
                    setEditingAttachmentConfig({
                      ...editingAttachmentConfig,
                      kpi_id: kid,
                      kpi_field_id: firstMli ? firstMli.id : 0,
                      selected_columns: firstMli?.sub_fields?.map(sf => sf.key).slice(0, 5) || []
                    });
                  }}
                  style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem", borderRadius: 6, border: "1px solid var(--border)" }}
                >
                  <option value="">-- Choose KPI --</option>
                  {allKpis.map(k => (
                    <option key={k.id} value={k.id}>{k.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.25rem" }}>
                  Select Multi-Line Item Field
                </label>
                <select
                  value={editingAttachmentConfig.kpi_field_id || ""}
                  onChange={(e) => {
                    const fid = Number(e.target.value);
                    const kpi = allKpis.find(k => k.id === editingAttachmentConfig.kpi_id);
                    const kfield = kpi?.fields.find(f => f.id === fid);
                    setEditingAttachmentConfig({
                      ...editingAttachmentConfig,
                      kpi_field_id: fid,
                      selected_columns: kfield?.sub_fields?.map(sf => sf.key).slice(0, 5) || []
                    });
                  }}
                  disabled={!editingAttachmentConfig.kpi_id}
                  style={{ width: "100%", padding: "0.4rem", fontSize: "0.85rem", borderRadius: 6, border: "1px solid var(--border)" }}
                >
                  <option value="">-- Choose Field --</option>
                  {allKpis.find(k => k.id === editingAttachmentConfig.kpi_id)?.fields
                    .filter(f => f.field_type === "multi_line_items")
                    .map(f => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                </select>
              </div>
            </div>

            {/* Columns & Filters configuration (shows only if KPI and Field are selected) */}
            {(() => {
              if (!editingAttachmentConfig.kpi_id || !editingAttachmentConfig.kpi_field_id) return null;
              const kpi = allKpis.find(k => k.id === editingAttachmentConfig.kpi_id);
              const kpiField = kpi?.fields.find(fld => fld.id === editingAttachmentConfig.kpi_field_id);
              const subFields = kpiField?.sub_fields || [];
              const token = getAccessToken();

              return (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1.5rem" }}>
                    <div>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                        Select Columns
                      </label>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", maxHeight: 180, overflowY: "auto", background: "white" }}>
                        {subFields.map(sf => {
                          const isChecked = editingAttachmentConfig.selected_columns.includes(sf.key);
                          return (
                            <label key={sf.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", padding: "0.2rem 0", cursor: "pointer" }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  let nextCols = [...editingAttachmentConfig.selected_columns];
                                  if (isChecked) {
                                    nextCols = nextCols.filter(c => c !== sf.key);
                                  } else {
                                    nextCols = [...nextCols, sf.key];
                                  }
                                  setEditingAttachmentConfig({ ...editingAttachmentConfig, selected_columns: nextCols });
                                }}
                              />
                              {sf.name}
                            </label>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                        Order Selected Columns
                      </label>
                      <div style={{ border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", maxHeight: 180, overflowY: "auto", background: "#f8fafc" }}>
                        {editingAttachmentConfig.selected_columns.length === 0 ? (
                          <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)", fontStyle: "italic" }}>No columns selected</p>
                        ) : (
                          editingAttachmentConfig.selected_columns.map((col, idx) => {
                            const sf = subFields.find(s => s.key === col);
                            return (
                              <div
                                key={col}
                                style={{
                                  display: "flex",
                                  justifyContent: "space-between",
                                  alignItems: "center",
                                  background: "white",
                                  border: "1px solid var(--border)",
                                  borderRadius: 4,
                                  padding: "0.25rem 0.5rem",
                                  marginBottom: "0.25rem",
                                  fontSize: "0.8rem"
                                }}
                              >
                                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {sf?.name || col}
                                </span>
                                <div style={{ display: "flex", gap: "2px" }}>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={idx === 0}
                                    onClick={() => {
                                      const nextCols = [...editingAttachmentConfig.selected_columns];
                                      const temp = nextCols[idx];
                                      nextCols[idx] = nextCols[idx - 1];
                                      nextCols[idx - 1] = temp;
                                      setEditingAttachmentConfig({ ...editingAttachmentConfig, selected_columns: nextCols });
                                    }}
                                    style={{ padding: "0 0.25rem", fontSize: "0.65rem", height: 18 }}
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    className="btn"
                                    disabled={idx === editingAttachmentConfig.selected_columns.length - 1}
                                    onClick={() => {
                                      const nextCols = [...editingAttachmentConfig.selected_columns];
                                      const temp = nextCols[idx];
                                      nextCols[idx] = nextCols[idx + 1];
                                      nextCols[idx + 1] = temp;
                                      setEditingAttachmentConfig({ ...editingAttachmentConfig, selected_columns: nextCols });
                                    }}
                                    style={{ padding: "0 0.25rem", fontSize: "0.65rem", height: 18 }}
                                  >
                                    ▼
                                  </button>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Sort Rows Section */}
                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginBottom: "1.5rem" }}>
                    <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                      Sort Rows
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>Sort Column</label>
                        <select
                          value={editingAttachmentConfig.filters?.sort_column || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingAttachmentConfig({
                              ...editingAttachmentConfig,
                              filters: {
                                ...editingAttachmentConfig.filters,
                                sort_column: val
                              }
                            });
                          }}
                          style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", width: "100%", borderRadius: "4px", border: "1px solid var(--border)", background: "white", color: "var(--text)" }}
                        >
                          <option value="">Default (No Sorting)</option>
                          {subFields.map((sf) => (
                            <option key={sf.key} value={sf.key}>
                              {sf.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ marginBottom: 0 }}>
                        <label style={{ fontSize: "0.75rem", color: "var(--muted)", display: "block", marginBottom: "0.25rem" }}>Direction</label>
                        <select
                          value={editingAttachmentConfig.filters?.sort_direction || "asc"}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingAttachmentConfig({
                              ...editingAttachmentConfig,
                              filters: {
                                ...editingAttachmentConfig.filters,
                                sort_direction: val
                              }
                            });
                          }}
                          disabled={!editingAttachmentConfig.filters?.sort_column}
                          style={{ padding: "0.4rem 0.6rem", fontSize: "0.8rem", width: "100%", borderRadius: "4px", border: "1px solid var(--border)", background: "white", color: "var(--text)" }}
                        >
                          <option value="asc">Ascending (A-Z / 0-9)</option>
                          <option value="desc">Descending (Z-A / 9-0)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Filters section */}

                  <div style={{ borderTop: "1px solid var(--border)", paddingTop: "1rem", marginBottom: "1.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                      <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>Row Filters</label>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setOpenFilterFieldKey(prev => !prev)}
                        style={{ padding: "0.2rem 0.5rem", fontSize: "0.75rem" }}
                      >
                        {openFilterFieldKey ? "Hide Filter Builder ▲" : "Show Filter Builder ▼"}
                      </button>
                    </div>

                    {openFilterFieldKey && token && (
                      <div style={{ marginBottom: "1rem", border: "1px solid var(--border)", borderRadius: 6, padding: "0.5rem", background: "white" }}>
                        <MultiItemsAdvancedFiltersPanel
                          token={token}
                          effectiveOrgId={orgId}
                          subFields={subFields.map(sf => ({ ...sf, field_type: sf.field_type || null }))}
                          filterDraft={filterDraft}
                          setFilterDraft={setFilterDraft}
                          sourceKpiFieldsById={sourceKpiFieldsById}
                          setSourceKpiFieldsById={setSourceKpiFieldsById}
                          refFilterOptions={refFilterOptions}
                          setRefFilterOptions={setRefFilterOptions}
                          fieldId={editingAttachmentConfig.kpi_field_id}
                          year={previewYear}
                          onApply={(draft) => {
                            const payload = filterDraftToPayload(draft, subFields.map(sf => ({ ...sf, field_type: sf.field_type || null })));
                            setEditingAttachmentConfig({
                              ...editingAttachmentConfig,
                              filters: (payload || { conditions: [], _version: 2 }) as any
                            });
                            setOpenFilterFieldKey(false);
                            toast.success("Applied filter constraints");
                          }}
                          onClose={() => setOpenFilterFieldKey(false)}
                          showCloseButton={true}
                        />
                      </div>
                    )}

                    {/* Active Filters Display */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem" }}>
                      {editingAttachmentConfig.filters.conditions.length === 0 ? (
                        <span style={{ fontSize: "0.75rem", color: "var(--muted)", fontStyle: "italic" }}>No active filters (all rows will be shown)</span>
                      ) : (
                        editingAttachmentConfig.filters.conditions.map((cond, condIdx) => {
                          const sub = subFields.find(s => s.key === cond.field);
                          return (
                            <div
                              key={condIdx}
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                background: "#f1f5f9",
                                border: "1px solid #cbd5e1",
                                borderRadius: "16px",
                                padding: "0.1rem 0.5rem",
                                fontSize: "0.75rem",
                                gap: "0.25rem",
                                color: "#334155"
                              }}
                            >
                              <span>
                                {sub?.name || cond.field} {cond.op} {String(cond.value ?? cond.values?.join(", "))}
                              </span>
                              <button
                                type="button"
                                style={{ border: "none", background: "none", color: "var(--error)", cursor: "pointer", fontWeight: 700, padding: 0 }}
                                onClick={() => {
                                  const nextPayload = removeConditionFromPayload(editingAttachmentConfig.filters as any, condIdx);
                                  setEditingAttachmentConfig({
                                    ...editingAttachmentConfig,
                                    filters: (nextPayload || { conditions: [], _version: 2 }) as any
                                  });
                                  setFilterDraft(payloadToFilterDraft(nextPayload));
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                </>
              );
            })()}

            {/* Modal Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setEditingAttachmentIdx(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  if (!editingAttachmentConfig.kpi_id || !editingAttachmentConfig.kpi_field_id) {
                    toast.error("Please select a KPI and a Multi-Line field");
                    return;
                  }
                  if (!editingAttachmentConfig.title.trim()) {
                    toast.error("Please enter a title for the attachment");
                    return;
                  }
                  setAttachments(prev => {
                    const next = [...prev];
                    const kpi = allKpis.find(k => k.id === editingAttachmentConfig.kpi_id);
                    const kfield = kpi?.fields.find(f => f.id === editingAttachmentConfig.kpi_field_id);
                    next[editingAttachmentIdx] = {
                      ...next[editingAttachmentIdx],
                      ...editingAttachmentConfig,
                      kpi_name: kpi?.name || "",
                      field_name: kfield?.name || ""
                    };
                    return next;
                  });
                  setEditingAttachmentIdx(null);
                  toast.success("Applied attachment settings (click Save Layout to persist changes)");
                }}
              >
                Apply Settings
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteConfirmIdx !== null && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            padding: "1.5rem",
          }}
          onClick={() => setDeleteConfirmIdx(null)}
        >
          <div
            className="card"
            style={{ maxWidth: 480, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.15)", background: "var(--surface)", padding: "1.5rem" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "1.25rem", fontWeight: 600 }}>
              Delete Heading Section
            </h3>
            <p style={{ color: "var(--muted)", fontSize: "0.9rem", margin: "0 0 1.5rem 0" }}>
              This section contains <strong>{sections[deleteConfirmIdx]?.fields.length}</strong> fields. Please choose what to do with them:
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => confirmMergeFields(deleteConfirmIdx)}
                disabled={sections.length <= 1}
                style={{
                  textAlign: "left",
                  padding: "0.75rem 1rem",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  gap: "0.2rem",
                  background: sections.length <= 1 ? "#f1f5f9" : "white",
                  cursor: sections.length <= 1 ? "not-allowed" : "pointer"
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--primary)" }}>Option A: Merge Fields (Recommended)</span>
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Deletes this heading and moves all its fields into the adjacent section.
                </span>
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => confirmDeleteEverything(deleteConfirmIdx)}
                style={{
                  textAlign: "left",
                  padding: "0.75rem 1rem",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-start",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  gap: "0.2rem",
                  background: "white"
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--error)" }}>Option B: Delete Everything</span>
                <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                  Permanently deletes this heading and all of its fields from the report.
                </span>
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteConfirmIdx(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {editingWidthsLoc && (() => {
        const sec = sections[editingWidthsLoc.secIdx];
        const f = sec?.fields[editingWidthsLoc.fieldIdx];
        if (!f) return null;

        const kpi = allKpis.find(k => k.id === f.kpi_id);
        const kpiField = kpi?.fields.find(fld => fld.id === f.kpi_field_id);
        const subFields = kpiField?.sub_fields || [];
        const selectedColKeys: string[] = (f.config as any)?.selected_columns || subFields.map(sf => sf.key).slice(0, 6);

        const cols = selectedColKeys.map(k => {
          const sf = subFields.find(s => s.key === k);
          return { key: k, name: sf?.name || k };
        });

        return (
          <ColumnWidthConfigModal
            isOpen={true}
            onClose={() => setEditingWidthsLoc(null)}
            fieldName={f.field_name}
            columns={cols}
            initialWidths={(f.config as any)?.column_widths || null}
            h1Color="#1e3a8a"
            onSave={(newWidths) => {
              setSections(prev => {
                const next = [...prev];
                const curField = next[editingWidthsLoc.secIdx].fields[editingWidthsLoc.fieldIdx];
                const updatedConfig: Record<string, any> = { ...((curField.config as any) || {}) };
                if (newWidths && Object.keys(newWidths).length > 0) {
                  updatedConfig.column_widths = newWidths;
                } else {
                  delete updatedConfig.column_widths;
                }
                next[editingWidthsLoc.secIdx].fields[editingWidthsLoc.fieldIdx] = {
                  ...curField,
                  config: Object.keys(updatedConfig).length > 0 ? updatedConfig : null
                };
                return next;
              });
              setEditingWidthsLoc(null);
              toast.success("Column width configuration updated.");
            }}
          />
        );
      })()}
    </div>
  );
}
