"use client";

import { useEffect, useState, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api } from "@/lib/api";
import toast from "react-hot-toast";

interface CustomHeaderRow {
  id: number;
  organization_id: number;
  name: string;
  logo_path: string;
  logo_path_2?: string | null;
  main_heading: string;
  sub_heading: string | null;
  font_family: string | null;
  font_size: number | null;
  text_color: string | null;
  text_align?: string | null;
  sub_font_family?: string | null;
  sub_font_size?: number | null;
  sub_text_color?: string | null;
  sub_text_align?: string | null;
  kpi_name_color?: string | null;
  created_at: string;
  updated_at: string;
  logo_url: string;
  logo_url_2?: string | null;
}

interface OrganizationBranding {
  id: number;
  organization_id: number;
  footer_label: string;
}

export default function CustomHeadersPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const selectedOrgId = searchParams?.get("organization_id");

  const [headers, setHeaders] = useState<CustomHeaderRow[]>([]);
  const [branding, setBranding] = useState<OrganizationBranding | null>(null);
  const [brandingInput, setBrandingInput] = useState("");
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal / Form States
  const [showModal, setShowModal] = useState(false);
  const [editingHeader, setEditingHeader] = useState<CustomHeaderRow | null>(null);

  const [formName, setFormName] = useState("");
  const [formMainHeading, setFormMainHeading] = useState("");
  const [formSubHeading, setFormSubHeading] = useState("");
  const [formFontFamily, setFormFontFamily] = useState("Helvetica");
  const [formFontSize, setFormFontSize] = useState("16");
  const [formTextColor, setFormTextColor] = useState("#1e3a8a");
  const [formTextAlign, setFormTextAlign] = useState("center");

  // Sub-Heading Form States
  const [formSubFontFamily, setFormSubFontFamily] = useState("Helvetica");
  const [formSubFontSize, setFormSubFontSize] = useState("11");
  const [formSubTextColor, setFormSubTextColor] = useState("#4b5563");
  const [formSubTextAlign, setFormSubTextAlign] = useState("center");

  const [formKpiNameColor, setFormKpiNameColor] = useState("#1e3a8a");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFile2, setSelectedFile2] = useState<File | null>(null);
  const [removeLogo2, setRemoveLogo2] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef2 = useRef<HTMLInputElement>(null);

  const token = getAccessToken();

  // Parse user role from token
  useEffect(() => {
    if (!token) return;
    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      if (payload?.role === "SUPER_ADMIN") {
        setIsSuperAdmin(true);
      }
    } catch (e) {
      // ignore
    }
  }, [token]);

  const loadHeaders = () => {
    if (!token || !selectedOrgId) return;
    setLoading(true);
    setError(null);

    Promise.all([
      api<CustomHeaderRow[]>(`/reports/headers?organization_id=${selectedOrgId}`, { token }),
      api<OrganizationBranding | null>(`/reports/organizations/${selectedOrgId}/branding`, { token }).catch(() => null),
    ])
      .then(([hdrData, brandData]) => {
        setHeaders(hdrData);
        setBranding(brandData);
        setBrandingInput(brandData?.footer_label || "");
      })
      .catch((err) => setError(err.message || "Failed to load custom headers"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!token) {
      router.push("/auth/login");
      return;
    }
    if (!selectedOrgId) {
      setError("No organization selected.");
      setLoading(false);
      return;
    }
    loadHeaders();
  }, [token, selectedOrgId]);

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedOrgId) return;
    if (!brandingInput.trim()) {
      toast.error("Branding label cannot be empty");
      return;
    }

    const toastId = toast.loading("Saving organization branding label...");
    try {
      const updated = await api<OrganizationBranding>(`/reports/organizations/${selectedOrgId}/branding`, {
        token,
        method: "PUT",
        body: JSON.stringify({ footer_label: brandingInput.trim() }),
      });
      setBranding(updated);
      toast.success("Organization branding label saved!", { id: toastId });
    } catch (err: any) {
      toast.error(err.message || "Failed to save branding label", { id: toastId });
    }
  };

  const handleResetBranding = async () => {
    if (!token || !selectedOrgId || !confirm("Reset branding label to default?")) return;
    const toastId = toast.loading("Resetting branding label...");
    try {
      await api(`/reports/organizations/${selectedOrgId}/branding`, {
        token,
        method: "DELETE",
      });
      setBranding(null);
      setBrandingInput("");
      toast.success("Branding label reset to default!", { id: toastId });
    } catch (err: any) {
      toast.error(err.message || "Failed to reset branding label", { id: toastId });
    }
  };

  const openCreateModal = () => {
    setEditingHeader(null);
    setFormName("");
    setFormMainHeading("");
    setFormSubHeading("");
    setFormFontFamily("Helvetica");
    setFormFontSize("16");
    setFormTextColor("#1e3a8a");
    setFormTextAlign("center");
    setFormSubFontFamily("Helvetica");
    setFormSubFontSize("11");
    setFormSubTextColor("#4b5563");
    setFormSubTextAlign("center");
    setFormKpiNameColor("#1e3a8a");
    setSelectedFile(null);
    setSelectedFile2(null);
    setRemoveLogo2(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (fileInputRef2.current) fileInputRef2.current.value = "";
    setShowModal(true);
  };

  const openEditModal = (h: CustomHeaderRow) => {
    setEditingHeader(h);
    setFormName(h.name);
    setFormMainHeading(h.main_heading);
    setFormSubHeading(h.sub_heading || "");
    setFormFontFamily(h.font_family || "Helvetica");
    setFormFontSize(String(h.font_size || 16));
    setFormTextColor(h.text_color || "#1e3a8a");
    setFormTextAlign(h.text_align || "center");
    setFormSubFontFamily(h.sub_font_family || "Helvetica");
    setFormSubFontSize(String(h.sub_font_size || 11));
    setFormSubTextColor(h.sub_text_color || "#4b5563");
    setFormSubTextAlign(h.sub_text_align || "center");
    setFormKpiNameColor(h.kpi_name_color || "#1e3a8a");
    setSelectedFile(null);
    setSelectedFile2(null);
    setRemoveLogo2(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (fileInputRef2.current) fileInputRef2.current.value = "";
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !selectedOrgId) return;

    if (!formName.trim() || !formMainHeading.trim()) {
      toast.error("Please fill in Name and Main Heading");
      return;
    }

    if (!editingHeader && !selectedFile) {
      toast.error("Please upload a primary logo file");
      return;
    }

    const formData = new FormData();
    formData.append("name", formName.trim());
    formData.append("main_heading", formMainHeading.trim());
    formData.append("sub_heading", formSubHeading.trim());
    formData.append("font_family", formFontFamily);
    formData.append("font_size", formFontSize);
    formData.append("text_color", formTextColor);
    formData.append("text_align", formTextAlign);
    formData.append("sub_font_family", formSubFontFamily);
    formData.append("sub_font_size", formSubFontSize);
    formData.append("sub_text_color", formSubTextColor);
    formData.append("sub_text_align", formSubTextAlign);
    formData.append("kpi_name_color", formKpiNameColor);
    formData.append("organization_id", selectedOrgId);
    if (selectedFile) {
      formData.append("file", selectedFile);
    }
    if (selectedFile2) {
      formData.append("file2", selectedFile2);
    }
    if (removeLogo2) {
      formData.append("remove_logo_2", "true");
    }

    const toastId = toast.loading(editingHeader ? "Updating header..." : "Creating header...");

    try {
      const url = editingHeader
        ? `${process.env.NEXT_PUBLIC_API_URL || ""}/api/reports/headers/${editingHeader.id}`
        : `${process.env.NEXT_PUBLIC_API_URL || ""}/api/reports/headers`;

      const method = editingHeader ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Failed to save header");
      }

      toast.success(editingHeader ? "Header updated!" : "Header created!", { id: toastId });
      setShowModal(false);
      loadHeaders();
    } catch (err: any) {
      toast.error(err.message || "Failed to save header", { id: toastId });
    }
  };

  const handleDelete = async (headerId: number) => {
    if (!token || !confirm("Are you sure you want to delete this custom header?")) return;

    const toastId = toast.loading("Deleting header...");
    try {
      await api(`/reports/headers/${headerId}`, {
        token,
        method: "DELETE",
      });
      toast.success("Header deleted!", { id: toastId });
      loadHeaders();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete header", { id: toastId });
    }
  };

  const getFontFamilyCSS = (font: string | null) => {
    const f = (font || "Helvetica").toLowerCase();
    if (f === "times-roman" || f === "times new roman" || f === "times")
      return "Times New Roman, Times, serif";
    if (f === "courier" || f === "courier new")
      return "Courier New, Courier, monospace";
    if (f === "arial")
      return "Arial, sans-serif";
    if (f === "georgia")
      return "Georgia, 'Times New Roman', serif";
    if (f === "verdana")
      return "Verdana, Geneva, Tahoma, sans-serif";
    if (f === "calibri")
      return "Calibri, Candara, Segoe, 'Segoe UI', Optima, Arial, sans-serif";
    if (f === "garamond")
      return "Garamond, 'EB Garamond', 'Times New Roman', serif";
    return "Helvetica, Arial, sans-serif";
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "200px" }}>
        <p style={{ color: "var(--muted)" }}>Loading custom headers...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "1rem" }}>
        <p className="form-error">{error}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: "1rem", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--text)", margin: 0 }}>
            Custom Report Headers & Branding
          </h1>
          <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginTop: "0.25rem" }}>
            Create and manage report headers with logos, headings, custom font styles, KPI header colors, and organization footer branding.
          </p>
        </div>
        <button className="btn btn-primary" onClick={openCreateModal}>
          + Create Header
        </button>
      </div>

      {/* Organization Branding Section (Super Admin option) */}
      <div className="card" style={{ marginBottom: "2rem", padding: "1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div>
            <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", margin: 0 }}>
              Organization Footer Branding Label
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--muted)", margin: "0.25rem 0 0 0" }}>
              Displays on the bottom-left footer of every generated PDF and Word report for this organization.
            </p>
          </div>
          {isSuperAdmin && (
            <span style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", borderRadius: "4px", background: "rgba(30, 58, 138, 0.1)", color: "#1e3a8a", fontWeight: 600 }}>
              Super Admin Config
            </span>
          )}
        </div>

        {isSuperAdmin ? (
          <form onSubmit={handleSaveBranding} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
            <input
              type="text"
              placeholder="e.g. Confidential Document | Ustadex University"
              value={brandingInput}
              onChange={(e) => setBrandingInput(e.target.value)}
              style={{ flex: 1, minWidth: "280px", padding: "0.45rem 0.75rem" }}
            />
            <button type="submit" className="btn btn-primary" style={{ padding: "0.45rem 1rem" }}>
              Save Branding
            </button>
            {branding && (
              <button type="button" className="btn" onClick={handleResetBranding} style={{ padding: "0.45rem 1rem" }}>
                Reset to Default
              </button>
            )}
          </form>
        ) : (
          <div style={{ fontSize: "0.9rem", color: "var(--text)", background: "var(--bg-subtle)", padding: "0.75rem", borderRadius: "6px", border: "1px dashed var(--border)" }}>
            <strong>Active Footer Label:</strong> {branding?.footer_label || "Confidential Document | <Organization Name> (Default)"}
            {!branding && <span style={{ color: "var(--muted)", fontSize: "0.8rem", marginLeft: "0.5rem" }}>(Can be customized by Super Admin)</span>}
          </div>
        )}
      </div>

      <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "var(--text)", marginBottom: "1rem" }}>
        Header Templates
      </h2>

      {headers.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem 1rem", color: "var(--muted)" }}>
          <p style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>No custom headers created yet.</p>
          <button className="btn btn-primary" onClick={openCreateModal}>
            Create your first header
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "1.5rem" }}>
          {headers.map((h) => (
            <div key={h.id} className="card" style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", padding: "1.25rem" }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
                  <h3 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text)", margin: 0 }}>
                    {h.name}
                  </h3>
                  <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    ID: {h.id}
                  </span>
                </div>

                {/* Rendered Preview Block with applied Styles */}
                <div style={{
                  border: "1px dashed var(--border)",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  background: "var(--bg-subtle)",
                  marginBottom: "1rem",
                  minHeight: "90px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem"
                }}>
                  {/* Primary Logo Image */}
                  <img
                    src={`${process.env.NEXT_PUBLIC_API_URL || ""}${h.logo_url}?token=${token}`}
                    alt="Logo 1"
                    style={{
                      maxHeight: "45px",
                      maxWidth: "80px",
                      objectFit: "contain",
                      background: "#fff",
                      padding: "2px",
                      borderRadius: "4px"
                    }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />

                  <div style={{ flex: 1, minWidth: 0, textAlign: (h.text_align as any) || "center" }}>
                    <div style={{ 
                      fontWeight: 700, 
                      fontSize: `${Math.max(13, (h.font_size || 16) * 0.85)}px`, 
                      fontFamily: getFontFamilyCSS(h.font_family),
                      color: h.text_color || "#1e3a8a", 
                      overflow: "hidden", 
                      textOverflow: "ellipsis", 
                      whiteSpace: "nowrap" 
                    }}>
                      {h.main_heading}
                    </div>
                    {h.sub_heading && (
                      <div style={{ 
                        fontStyle: "italic", 
                        fontSize: `${Math.max(10, Number(h.sub_font_size || 11))}px`, 
                        fontFamily: getFontFamilyCSS(h.sub_font_family || "Helvetica"),
                        color: h.sub_text_color || "#4b5563", 
                        textAlign: (h.sub_text_align as any) || (h.text_align as any) || "center",
                        overflow: "hidden", 
                        textOverflow: "ellipsis", 
                        whiteSpace: "nowrap", 
                        marginTop: "2px" 
                      }}>
                        {h.sub_heading}
                      </div>
                    )}
                  </div>

                  {/* Secondary Logo Image (Right Side) */}
                  {h.logo_url_2 && (
                    <img
                      src={`${process.env.NEXT_PUBLIC_API_URL || ""}${h.logo_url_2}?token=${token}`}
                      alt="Logo 2"
                      style={{
                        maxHeight: "45px",
                        maxWidth: "80px",
                        objectFit: "contain",
                        background: "#fff",
                        padding: "2px",
                        borderRadius: "4px"
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                </div>

                <div style={{ fontSize: "0.8rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
                  <strong>Styles:</strong> Font: {h.font_family || "Helvetica"} ({h.font_size || 16}pt), Align: {h.text_align || "center"}, Header Color: <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: h.text_color || "#1e3a8a", marginRight: "2px", verticalAlign: "middle" }}></span> {h.text_color || "#1e3a8a"}
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.5rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
                <button
                  className="btn"
                  onClick={() => openEditModal(h)}
                  style={{ flex: 1, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                >
                  Edit Details
                </button>
                <button
                  className="btn btn-error"
                  onClick={() => handleDelete(h.id)}
                  style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem", background: "rgba(220, 38, 38, 0.08)", border: "1px solid rgba(220, 38, 38, 0.2)", color: "var(--error)" }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Dialog */}
      {showModal && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.5)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 1000,
          backdropFilter: "blur(4px)"
        }}>
          <div className="card" style={{ width: "100%", maxWidth: "560px", padding: "1.5rem", maxHeight: "90vh", overflowY: "auto" }}>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, marginBottom: "1.25rem" }}>
              {editingHeader ? "Edit Custom Header" : "Create Custom Header"}
            </h2>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div className="form-group">
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                  Header Reference Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Standard Departmental Header"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  style={{ width: "100%", padding: "0.4rem 0.6rem" }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                  Main Heading
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. UNIVERSITY OF EDUCATION"
                  value={formMainHeading}
                  onChange={(e) => setFormMainHeading(e.target.value)}
                  style={{ width: "100%", padding: "0.4rem 0.6rem" }}
                />
              </div>

              <div className="form-group">
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                  Sub Heading (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Quality Enhancement Cell"
                  value={formSubHeading}
                  onChange={(e) => setFormSubHeading(e.target.value)}
                  style={{ width: "100%", padding: "0.4rem 0.6rem" }}
                />
              </div>

              {/* Main Heading Styling */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.5rem" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.5rem" }}>
                  Main Heading Formatting & Alignment
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.5rem" }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Font Style
                    </label>
                    <select
                      value={formFontFamily}
                      onChange={(e) => setFormFontFamily(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem" }}
                    >
                      <option value="Helvetica">Helvetica (Sans)</option>
                      <option value="Times-Roman">Times New Roman</option>
                      <option value="Courier">Courier New</option>
                      <option value="Arial">Arial (Sans)</option>
                      <option value="Georgia">Georgia (Serif)</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Calibri">Calibri</option>
                      <option value="Garamond">Garamond</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Font Size
                    </label>
                    <select
                      value={formFontSize}
                      onChange={(e) => setFormFontSize(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem" }}
                    >
                      {Array.from({ length: 29 }, (_, i) => i + 8).map((sz) => (
                        <option key={sz} value={String(sz)}>
                          {sz}pt{sz === 16 ? " (Default)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Text Alignment
                    </label>
                    <select
                      value={formTextAlign}
                      onChange={(e) => setFormTextAlign(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem" }}
                    >
                      <option value="center">Center (Default)</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="justify">Justify</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Text Color
                    </label>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        type="color"
                        value={formTextColor}
                        onChange={(e) => setFormTextColor(e.target.value)}
                        style={{ width: "35px", height: "32px", border: "1px solid var(--border)", cursor: "pointer", padding: "1px", borderRadius: "4px" }}
                      />
                      <input
                        type="text"
                        value={formTextColor}
                        onChange={(e) => setFormTextColor(e.target.value)}
                        placeholder="#1e3a8a"
                        style={{ flex: 1, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Sub-Heading Styling */}
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.75rem", marginTop: "0.75rem" }}>
                <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--primary)", marginBottom: "0.5rem" }}>
                  Sub-Heading Formatting & Alignment
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem", marginBottom: "0.5rem" }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Sub Font Style
                    </label>
                    <select
                      value={formSubFontFamily}
                      onChange={(e) => setFormSubFontFamily(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem" }}
                    >
                      <option value="Helvetica">Helvetica (Sans)</option>
                      <option value="Times-Roman">Times New Roman</option>
                      <option value="Courier">Courier New</option>
                      <option value="Arial">Arial (Sans)</option>
                      <option value="Georgia">Georgia (Serif)</option>
                      <option value="Verdana">Verdana</option>
                      <option value="Calibri">Calibri</option>
                      <option value="Garamond">Garamond</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Sub Font Size
                    </label>
                    <select
                      value={formSubFontSize}
                      onChange={(e) => setFormSubFontSize(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem" }}
                    >
                      {Array.from({ length: 29 }, (_, i) => i + 8).map((sz) => (
                        <option key={sz} value={String(sz)}>
                          {sz}pt{sz === 11 ? " (Default)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Sub Alignment
                    </label>
                    <select
                      value={formSubTextAlign}
                      onChange={(e) => setFormSubTextAlign(e.target.value)}
                      style={{ width: "100%", padding: "0.4rem 0.6rem", fontSize: "0.85rem" }}
                    >
                      <option value="center">Center (Default)</option>
                      <option value="left">Left</option>
                      <option value="right">Right</option>
                      <option value="justify">Justify</option>
                    </select>
                  </div>

                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem", fontSize: "0.85rem" }}>
                      Sub Text Color
                    </label>
                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                      <input
                        type="color"
                        value={formSubTextColor}
                        onChange={(e) => setFormSubTextColor(e.target.value)}
                        style={{ width: "35px", height: "32px", border: "1px solid var(--border)", cursor: "pointer", padding: "1px", borderRadius: "4px" }}
                      />
                      <input
                        type="text"
                        value={formSubTextColor}
                        onChange={(e) => setFormSubTextColor(e.target.value)}
                        placeholder="#4b5563"
                        style={{ flex: 1, padding: "0.35rem 0.5rem", fontSize: "0.85rem" }}
                      />
                    </div>
                  </div>
                </div>
              </div>


              {/* Primary Logo Upload */}
              <div className="form-group" style={{ marginTop: "0.75rem" }}>
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                  Primary Logo (Left Side)
                </label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/png, image/jpeg, image/jpg"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile(e.target.files[0]);
                    }
                  }}
                  style={{ width: "100%", padding: "0.4rem 0.6rem" }}
                />
              </div>

              {/* Secondary Logo Upload (Optional) */}
              <div className="form-group">
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>
                  Secondary Logo (Right Side — Optional)
                </label>
                <input
                  type="file"
                  ref={fileInputRef2}
                  accept="image/png, image/jpeg, image/jpg"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setSelectedFile2(e.target.files[0]);
                      setRemoveLogo2(false);
                    }
                  }}
                  style={{ width: "100%", padding: "0.4rem 0.6rem" }}
                />
                {editingHeader?.logo_url_2 && !selectedFile2 && !removeLogo2 && (
                  <div style={{ marginTop: "0.4rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>Current Logo 2 attached</span>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setRemoveLogo2(true)}
                      style={{ fontSize: "0.75rem", color: "var(--error)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}
                    >
                      Remove Logo 2
                    </button>
                  </div>
                )}
                {removeLogo2 && (
                  <span style={{ fontSize: "0.8rem", color: "var(--error)", marginTop: "0.25rem", display: "block" }}>
                    Secondary logo will be removed upon saving.
                  </span>
                )}
              </div>

              {/* Dynamic Live Preview inside the Modal */}
              <div className="form-group" style={{ marginTop: "1rem" }}>
                <label style={{ fontWeight: 600, display: "block", marginBottom: "0.4rem" }}>Header Live Preview</label>
                <div style={{
                  border: "1px solid var(--border)",
                  borderRadius: "6px",
                  padding: "0.75rem",
                  background: "var(--surface)",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.75rem",
                  minHeight: "70px"
                }}>
                  {/* Left Logo */}
                  {selectedFile ? (
                    <div style={{ width: "50px", height: "40px", background: "rgba(226, 232, 240, 0.5)", border: "1px solid var(--border)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "var(--muted)", fontWeight: 500 }}>
                      New Logo 1
                    </div>
                  ) : editingHeader ? (
                    <img 
                      src={`${process.env.NEXT_PUBLIC_API_URL || ""}${editingHeader.logo_url}?token=${token}`} 
                      style={{ maxHeight: "40px", maxWidth: "70px", objectFit: "contain" }} 
                      onError={(e) => { e.currentTarget.style.display = "none"; }} 
                    />
                  ) : (
                    <div style={{ width: "50px", height: "40px", background: "rgba(226, 232, 240, 0.5)", border: "1px solid var(--border)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "var(--muted)", fontWeight: 500 }}>
                      Logo 1
                    </div>
                  )}

                  {/* Middle Headings & KPI Name Preview */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: 700,
                      fontFamily: getFontFamilyCSS(formFontFamily),
                      fontSize: `${Math.max(12, Number(formFontSize) * 0.85)}px`,
                      color: formTextColor,
                      textAlign: (formTextAlign as any) || "center"
                    }}>
                      {formMainHeading || "MAIN HEADING PREVIEW"}
                    </div>
                    {formSubHeading && (
                      <div style={{
                        fontStyle: "italic",
                        fontFamily: getFontFamilyCSS(formSubFontFamily),
                        fontSize: `${Math.max(9, Number(formSubFontSize))}px`,
                        color: formSubTextColor,
                        textAlign: (formSubTextAlign as any) || (formTextAlign as any) || "center",
                        marginTop: "2px"
                      }}>
                        {formSubHeading}
                      </div>
                    )}
                  </div>

                  {/* Right Logo */}
                  {selectedFile2 ? (
                    <div style={{ width: "50px", height: "40px", background: "rgba(226, 232, 240, 0.5)", border: "1px solid var(--border)", borderRadius: "4px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "var(--muted)", fontWeight: 500 }}>
                      New Logo 2
                    </div>
                  ) : editingHeader?.logo_url_2 && !removeLogo2 ? (
                    <img 
                      src={`${process.env.NEXT_PUBLIC_API_URL || ""}${editingHeader.logo_url_2}?token=${token}`} 
                      style={{ maxHeight: "40px", maxWidth: "70px", objectFit: "contain" }} 
                      onError={(e) => { e.currentTarget.style.display = "none"; }} 
                    />
                  ) : null}
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1rem" }}>
                <button type="button" className="btn" onClick={() => setShowModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Header
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
