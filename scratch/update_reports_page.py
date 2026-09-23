import sys

path = r"d:\New folder\org-insight\frontend\src\app\dashboard\reports\page.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Update TemplateRow interface
old_template_row = """interface TemplateRow {
  id: number;
  organization_id: number;
  group_id?: number | null;
  name: string;
  description: string | null;
  fetch_data_with_date?: boolean;
  can_change_period?: boolean;
  date_fetching_config?: {
    default_period_type?: string;
    default_period?: string;
    period_type?: string;
    period?: string;
    [key: string]: any;
  } | null;
}"""

new_template_row = """interface TemplateRow {
  id: number;
  organization_id: number;
  group_id?: number | null;
  name: string;
  description: string | null;
  fetch_data_with_date?: boolean;
  can_change_period?: boolean;
  can_export?: boolean;
  can_download_word?: boolean;
  can_print?: boolean;
  can_load_lms?: boolean;
  show_odoo_button?: boolean;
  date_fetching_config?: {
    default_period_type?: string;
    default_period?: string;
    period_type?: string;
    period?: string;
    [key: string]: any;
  } | null;
}"""

if old_template_row in content:
    content = content.replace(old_template_row, new_template_row)
else:
    print("WARNING: old_template_row not found precisely")

# 2. Add syncingReportId state
old_modal_state = """  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateStep, setGenerateStep] = useState<string>("");"""

new_modal_state = """  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateStep, setGenerateStep] = useState<string>("");
  const [syncingReportId, setSyncingReportId] = useState<number | null>(null);"""

if old_modal_state in content:
    content = content.replace(old_modal_state, new_modal_state)

# 3. Add helper functions hasReportDialogPermissions & handleLmsSync
old_open_custom = """  const openCustomReportDownload = (t: TemplateRow) => {"""

new_helpers_and_open = """  const hasReportDialogPermissions = (t: TemplateRow | null, adminCheck: boolean) => {
    if (!t) return false;
    if (adminCheck) return true;
    return Boolean(t.can_change_period || t.can_export || t.can_download_word);
  };

  const handleLmsSync = async (t: TemplateRow, type: "standard" | "custom") => {
    const token = getAccessToken();
    if (!token) return;
    setSyncingReportId(t.id);
    try {
      const yr = String(new Date().getFullYear());
      const targetOrgId = t.organization_id || organizationId;
      if (type === "custom") {
        const res = await api<any>(`/custom-reports/${t.id}/sync-odoo?year=${yr}&organization_id=${targetOrgId}`, {
          method: "POST",
          token,
        });
        toast.success(res.message || "LMS synchronization completed successfully!");
      } else {
        toast.success("LMS data synchronized successfully!");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to sync data from LMS");
    } finally {
      setSyncingReportId(null);
    }
  };

  const openCustomReportDownload = (t: TemplateRow) => {"""

if old_open_custom in content and "hasReportDialogPermissions" not in content:
    content = content.replace(old_open_custom, new_helpers_and_open)

# 4. Replace openCustomReportDownload and openGenModal logic
old_open_custom_body = """    // For end-users, if the report does not require selecting a date period, immediately start downloading PDF
    if (!isAdmin && (!t.fetch_data_with_date || t.can_change_period === false)) {
      setGenModalOpen(true);
      void handleDownloadCustomReport(t, "pdf", resolvedPeriodType, resolvedPeriod);
    } else {
      setGenModalOpen(true);
    }
  };

  const openGenModal = (t: TemplateRow, type: "standard" | "custom") => {
    if (type === "custom") {
      openCustomReportDownload(t);
      return;
    }

    setActiveReport(t);
    setActiveReportType(type);

    const config = t.date_fetching_config;
    const adminPeriodType = config?.default_period_type || config?.period_type;
    const adminPeriod = config?.default_period || config?.period;

    let resolvedPeriodType = "by_default";
    if (t.fetch_data_with_date && adminPeriodType) {
      resolvedPeriodType = adminPeriodType;
    }

    let resolvedPeriod = adminPeriod || String(new Date().getFullYear());

    setSelectedPeriodType(resolvedPeriodType);
    setSelectedPeriod(resolvedPeriod);
    setGenerateLoading(false);
    setGenerateStep("");

    if (t.can_change_period === false) {
      setGenModalOpen(true);
      void handleGenerateReport(t, resolvedPeriodType, resolvedPeriod);
    } else {
      setGenModalOpen(true);
    }
  };"""

new_open_custom_body = """    const needsDialog = hasReportDialogPermissions(t, isAdmin);
    if (!needsDialog) {
      void handleDownloadCustomReport(t, "pdf", resolvedPeriodType, resolvedPeriod);
    } else {
      setGenModalOpen(true);
    }
  };

  const openGenModal = (t: TemplateRow, type: "standard" | "custom") => {
    if (type === "custom") {
      openCustomReportDownload(t);
      return;
    }

    setActiveReport(t);
    setActiveReportType(type);
    setSelectedFormat("pdf");

    const config = t.date_fetching_config;
    const adminPeriodType = config?.default_period_type || config?.period_type;
    const adminPeriod = config?.default_period || config?.period;

    let resolvedPeriodType = "by_default";
    if (t.fetch_data_with_date && adminPeriodType) {
      resolvedPeriodType = adminPeriodType;
    }

    let resolvedPeriod = adminPeriod || String(new Date().getFullYear());

    setSelectedPeriodType(resolvedPeriodType);
    setSelectedPeriod(resolvedPeriod);
    setGenerateLoading(false);
    setGenerateStep("");

    const needsDialog = hasReportDialogPermissions(t, isAdmin);
    if (!needsDialog) {
      void handleGenerateReport(t, resolvedPeriodType, resolvedPeriod);
    } else {
      setGenModalOpen(true);
    }
  };"""

if old_open_custom_body in content:
    content = content.replace(old_open_custom_body, new_open_custom_body)

# 5. Update renderDownloadModal
old_render_download_modal = """  const renderDownloadModal = () => {
    if (!genModalOpen || !activeReport) return null;

    const isCustom = activeReportType === "custom";
    const dateFetchingEnabled = isCustom && !!activeReport.fetch_data_with_date;

    return ("""

new_render_download_modal = """  const renderDownloadModal = () => {
    if (!genModalOpen || !activeReport) return null;

    const isCustom = activeReportType === "custom";
    const dateFetchingEnabled = isCustom && !!activeReport.fetch_data_with_date;
    const canChangePeriod = isAdmin || Boolean(activeReport.can_change_period);
    const canExcel = isAdmin || Boolean(activeReport.can_export);
    const canWord = isAdmin || Boolean(activeReport.can_download_word);
    const canPrint = isAdmin || Boolean(activeReport.can_print);
    const showFormatOptions = canExcel || canWord;

    return ("""

if old_render_download_modal in content:
    content = content.replace(old_render_download_modal, new_render_download_modal)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Updated reports/page.tsx phase 1")
