import sys

path = r"d:\New folder\org-insight\frontend\src\app\dashboard\reports\page.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Replace inner modal JSX
old_modal_jsx = """              <div>
                <h3 style={{ margin: "0 0 0.4rem 0", fontSize: "1.35rem", fontWeight: 700, color: "#0f172a" }}>
                  Generate PDF Report
                </h3>
                <p style={{ color: "#475569", fontSize: "0.95rem", margin: "0 0 1.5rem 0", lineHeight: "1.5" }}>
                  Select reporting period parameters for{" "}
                  <strong style={{ color: "#1e3a8a", fontWeight: 700 }}>{activeReport.name}</strong>.
                </p>
              </div>

              {/* Reporting Period */}
              <div style={{ marginBottom: "1.25rem" }}>
                <label style={{ display: "block", marginBottom: "0.45rem", fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                  Reporting Period *
                </label>
                <select
                  value={selectedPeriodType}
                  onChange={(e) => setSelectedPeriodType(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "#ffffff",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "0.95rem",
                    color: "#0f172a",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                >
                  <option value="by_default">Fiscal Year</option>
                  {customPeriods.map((cp: any) => (
                    <option key={cp.custom_period_name} value={cp.custom_period_name}>
                      {cp.custom_period_name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reporting Time */}
              <div style={{ marginBottom: "1.5rem" }}>
                <label style={{ display: "block", marginBottom: "0.45rem", fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                  Reporting Time *
                </label>
                <select
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.65rem 0.85rem",
                    background: "#ffffff",
                    border: "1.5px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "0.95rem",
                    color: "#0f172a",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                >
                  {activePeriodOptions.length > 0 ? (
                    activePeriodOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))
                  ) : (
                    <option value={String(new Date().getFullYear())}>
                      {new Date().getFullYear()}/{String(new Date().getFullYear() + 1).slice(-2)}
                    </option>
                  )}
                </select>
              </div>

              {/* Format Selection for Custom Reports: PDF, Excel, Word - Org Admin and Super Admin ONLY */}
              {isCustom && canManageAssignments && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.9rem", color: "#1e293b" }}>
                    Choose Format (PDF, Excel, Word) *
                  </label>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.65rem" }}>
                    {/* PDF Card */}
                    <div
                      onClick={() => setSelectedFormat("pdf")}
                      style={{
                        padding: "0.85rem 0.5rem",
                        borderRadius: "10px",
                        border: selectedFormat === "pdf" ? "2px solid #ef4444" : "1px solid #e2e8f0",
                        background: selectedFormat === "pdf" ? "rgba(239, 68, 68, 0.05)" : "#ffffff",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s ease",
                        boxShadow: selectedFormat === "pdf" ? "0 2px 8px rgba(239, 68, 68, 0.15)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>📄</div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: selectedFormat === "pdf" ? "#b91c1c" : "#1e293b" }}>PDF</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Document</div>
                    </div>

                    {/* Excel Card */}
                    <div
                      onClick={() => setSelectedFormat("xlsx")}
                      style={{
                        padding: "0.85rem 0.5rem",
                        borderRadius: "10px",
                        border: selectedFormat === "xlsx" ? "2px solid #10b981" : "1px solid #e2e8f0",
                        background: selectedFormat === "xlsx" ? "rgba(16, 185, 129, 0.05)" : "#ffffff",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s ease",
                        boxShadow: selectedFormat === "xlsx" ? "0 2px 8px rgba(16, 185, 129, 0.15)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>📊</div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: selectedFormat === "xlsx" ? "#047857" : "#1e293b" }}>Excel</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Spreadsheet</div>
                    </div>

                    {/* Word Card */}
                    <div
                      onClick={() => setSelectedFormat("docx")}
                      style={{
                        padding: "0.85rem 0.5rem",
                        borderRadius: "10px",
                        border: selectedFormat === "docx" ? "2px solid #2563eb" : "1px solid #e2e8f0",
                        background: selectedFormat === "docx" ? "rgba(37, 99, 235, 0.05)" : "#ffffff",
                        cursor: "pointer",
                        textAlign: "center",
                        transition: "all 0.15s ease",
                        boxShadow: selectedFormat === "docx" ? "0 2px 8px rgba(37, 99, 235, 0.15)" : "none",
                      }}
                    >
                      <div style={{ fontSize: "1.5rem", marginBottom: "0.25rem" }}>📝</div>
                      <div style={{ fontWeight: 700, fontSize: "0.9rem", color: selectedFormat === "docx" ? "#1d4ed8" : "#1e293b" }}>Word</div>
                      <div style={{ fontSize: "0.75rem", color: "#64748b" }}>Document</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.75rem" }}>
                <button
                  type="button"
                  className="modal-btn-cancel"
                  onClick={() => {
                    setGenModalOpen(false);
                    setGenerateLoading(false);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="modal-btn-confirm"
                  disabled={
                    isCustom &&
                    dateFetchingEnabled &&
                    selectedPeriodType !== "by_default" &&
                    !selectedPeriod
                  }
                  onClick={handleGenerateClick}
                >
                  {isCustom
                    ? isAdmin
                      ? `Download ${selectedFormat === "xlsx" ? "Excel" : selectedFormat === "docx" ? "Word" : "PDF"}`
                      : "Generate PDF"
                    : "Generate PDF"}
                </button>
              </div>"""

new_modal_jsx = """              <div>
                <h3 style={{ margin: "0 0 0.4rem 0", fontSize: "1.35rem", fontWeight: 700, color: "#0f172a" }}>
                  Download Report
                </h3>
                <p style={{ color: "#475569", fontSize: "0.95rem", margin: "0 0 1.5rem 0", lineHeight: "1.5" }}>
                  Select reporting options for{" "}
                  <strong style={{ color: "#1e3a8a", fontWeight: 700 }}>{activeReport.name}</strong>.
                </p>
              </div>

              {/* Period Controls (Only shown if Can Change Period or Admin) */}
              {canChangePeriod && (
                <>
                  <div style={{ marginBottom: "1.25rem" }}>
                    <label style={{ display: "block", marginBottom: "0.45rem", fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                      Period Type
                    </label>
                    <select
                      value={selectedPeriodType}
                      onChange={(e) => setSelectedPeriodType(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.65rem 0.85rem",
                        background: "#ffffff",
                        border: "1.5px solid #cbd5e1",
                        borderRadius: "8px",
                        fontSize: "0.95rem",
                        color: "#0f172a",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="by_default">Fiscal Year</option>
                      {customPeriods.map((cp: any) => (
                        <option key={cp.custom_period_name} value={cp.custom_period_name}>
                          {cp.custom_period_name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ marginBottom: "1.5rem" }}>
                    <label style={{ display: "block", marginBottom: "0.45rem", fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                      Reporting Period
                    </label>
                    <select
                      value={selectedPeriod}
                      onChange={(e) => setSelectedPeriod(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.65rem 0.85rem",
                        background: "#ffffff",
                        border: "1.5px solid #cbd5e1",
                        borderRadius: "8px",
                        fontSize: "0.95rem",
                        color: "#0f172a",
                        outline: "none",
                        boxSizing: "border-box",
                      }}
                    >
                      {activePeriodOptions.length > 0 ? (
                        activePeriodOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))
                      ) : (
                        <option value={String(new Date().getFullYear())}>
                          {new Date().getFullYear()}/{String(new Date().getFullYear() + 1).slice(-2)}
                        </option>
                      )}
                    </select>
                  </div>
                </>
              )}

              {/* Format Selection (Clean Radio Options, NO ICONS) */}
              {showFormatOptions && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 600, fontSize: "0.95rem", color: "#0f172a" }}>
                    Download Format
                  </label>
                  <div style={{ display: "flex", gap: "1.5rem", alignItems: "center" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", cursor: "pointer", fontSize: "0.95rem", color: "#0f172a", fontWeight: 500 }}>
                      <input
                        type="radio"
                        name="reportDownloadFormat"
                        value="pdf"
                        checked={selectedFormat === "pdf"}
                        onChange={() => setSelectedFormat("pdf")}
                      />
                      PDF
                    </label>
                    {canExcel && (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", cursor: "pointer", fontSize: "0.95rem", color: "#0f172a", fontWeight: 500 }}>
                        <input
                          type="radio"
                          name="reportDownloadFormat"
                          value="xlsx"
                          checked={selectedFormat === "xlsx"}
                          onChange={() => setSelectedFormat("xlsx")}
                        />
                        Excel
                      </label>
                    )}
                    {canWord && (
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", cursor: "pointer", fontSize: "0.95rem", color: "#0f172a", fontWeight: 500 }}>
                        <input
                          type="radio"
                          name="reportDownloadFormat"
                          value="docx"
                          checked={selectedFormat === "docx"}
                          onChange={() => setSelectedFormat("docx")}
                        />
                        Word
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1.75rem" }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setGenModalOpen(false);
                    setGenerateLoading(false);
                  }}
                >
                  Cancel
                </button>
                {canPrint && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setGenModalOpen(false);
                      void handleGenerateReport(activeReport, selectedPeriodType, selectedPeriod);
                    }}
                  >
                    Print
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    isCustom &&
                    dateFetchingEnabled &&
                    canChangePeriod &&
                    selectedPeriodType !== "by_default" &&
                    !selectedPeriod
                  }
                  onClick={handleGenerateClick}
                >
                  Download
                </button>
              </div>"""

if old_modal_jsx in content:
    content = content.replace(old_modal_jsx, new_modal_jsx)
else:
    print("WARNING: old_modal_jsx not found precisely")

# Replace End-User Standard Reports button area
old_std_btn = """                  <div style={{ marginTop: "1.25rem" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openGenModal(t, "standard")}
                      style={{ width: "100%", padding: "0.5rem", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.35rem" }}
                    >
                      Generate Report
                    </button>
                  </div>"""

new_std_btn = """                  <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openGenModal(t, "standard")}
                      style={{ flex: 1, padding: "0.5rem", fontSize: "0.9rem", textAlign: "center" }}
                    >
                      Download
                    </button>
                    {!hasReportDialogPermissions(t, false) && t.can_print && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void handleGenerateReport(t, "by_default", String(new Date().getFullYear()))}
                        style={{ padding: "0.5rem 0.85rem", fontSize: "0.9rem" }}
                      >
                        Print
                      </button>
                    )}
                    {t.can_load_lms && (
                      <button
                        type="button"
                        className="btn"
                        disabled={syncingReportId === t.id}
                        onClick={() => void handleLmsSync(t, "standard")}
                        style={{ padding: "0.5rem 0.85rem", fontSize: "0.9rem" }}
                      >
                        {syncingReportId === t.id ? "Syncing..." : "LMS Sync"}
                      </button>
                    )}
                  </div>"""

if old_std_btn in content:
    content = content.replace(old_std_btn, new_std_btn)

# Replace End-User Custom Reports button area (grouped & uncategorized)
old_cust_btn = """                    <div style={{ marginTop: "1.25rem" }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => openCustomReportDownload(t)}
                        style={{ width: "100%", padding: "0.5rem", fontSize: "0.9rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Download Report
                      </button>
                    </div>"""

new_cust_btn = """                    <div style={{ marginTop: "1.25rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => openCustomReportDownload(t)}
                        style={{ flex: 1, padding: "0.5rem", fontSize: "0.9rem", textAlign: "center" }}
                      >
                        Download
                      </button>
                      {!hasReportDialogPermissions(t, false) && t.can_print && (
                        <button
                          type="button"
                          className="btn"
                          onClick={() => void handleGenerateReport(t, "by_default", String(new Date().getFullYear()))}
                          style={{ padding: "0.5rem 0.85rem", fontSize: "0.9rem" }}
                        >
                          Print
                        </button>
                      )}
                      {t.can_load_lms && (
                        <button
                          type="button"
                          className="btn"
                          disabled={syncingReportId === t.id}
                          onClick={() => void handleLmsSync(t, "custom")}
                          style={{ padding: "0.5rem 0.85rem", fontSize: "0.9rem" }}
                        >
                          {syncingReportId === t.id ? "Syncing..." : "LMS Sync"}
                        </button>
                      )}
                    </div>"""

content = content.replace(old_cust_btn, new_cust_btn)

# Replace SVG download buttons in Admin view
old_admin_btn = """                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => openCustomReportDownload(t)}
                            style={{ fontSize: "0.85rem", display: "inline-flex", alignItems: "center", gap: "0.35rem" }}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Download
                          </button>"""

new_admin_btn = """                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => openCustomReportDownload(t)}
                            style={{ fontSize: "0.85rem" }}
                          >
                            Download
                          </button>"""

content = content.replace(old_admin_btn, new_admin_btn)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)

print("Updated reports/page.tsx phase 2 successfully")
