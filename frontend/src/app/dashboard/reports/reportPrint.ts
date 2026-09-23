/**
 * Shared report print/PDF: build HTML document and trigger direct in-page print dialog.
 * Used by report view page, custom reports, and design page.
 */

export interface ReportData {
  template_name: string;
  template_id: number;
  year: number;
  rendered_html?: string | null;
  organization_name?: string | null;
  branding_title?: string | null;
  text_blocks?: Array<{ id: number; title: string | null; content: string; sort_order: number }>;
  kpis: Array<{
    kpi_id: number;
    kpi_name: string;
    entries: Array<{
      entry_id: number;
      fields: Array<{ field_key: string; field_name: string; value: unknown }>;
    }>;
  }>;
}

function escapeHtml(s: string): string {
  if (typeof document === "undefined") {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

export function buildReportPrintDocument(data: ReportData): string {
  const title = data.template_name;
  const today = new Date();
  const dateFormatted = today.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const style = `
    @page {
      size: auto;
      margin: 0 !important;
    }
    *, *::before, *::after {
      box-sizing: border-box;
    }
    html, body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      line-height: 1.45;
      margin: 0;
      padding: 0;
      background: #ffffff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    /* Master print table wrapper to guarantee consistent margins and prevent content overlap with footer */
    .print-layout-table {
      width: 100%;
      border-collapse: collapse !important;
      border: none !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
    }
    .print-layout-table > thead {
      display: table-header-group !important;
    }
    .print-layout-table > thead > tr > td {
      height: 12mm;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
      background: transparent !important;
    }
    .print-layout-table > tfoot {
      display: table-footer-group !important;
    }
    .print-layout-table > tfoot > tr > td {
      height: 16mm;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
      background: transparent !important;
    }
    .print-layout-table > tbody > tr > td {
      padding: 0 12mm !important;
      border: none !important;
      background: transparent !important;
      vertical-align: top;
    }

    /* Inner report tables styling */
    table:not(.print-layout-table) {
      border-collapse: collapse !important;
      width: 100% !important;
      border: 1px solid #cbd5e1 !important;
      margin-top: 0.5rem;
      margin-bottom: 0.5rem;
      page-break-inside: auto;
    }
    /* Don't repeat table headers or Grand Total footer on every single page */
    table:not(.print-layout-table) thead {
      display: table-row-group !important;
    }
    table:not(.print-layout-table) tfoot {
      display: table-row-group !important;
    }
    table:not(.print-layout-table) th {
      background-color: #1e3a8a !important;
      color: #ffffff !important;
      font-weight: 600 !important;
      border: 1px solid #cbd5e1 !important;
      padding: 6px 8px !important;
      font-size: 0.885rem !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    table:not(.print-layout-table) td {
      border: 1px solid #cbd5e1 !important;
      padding: 6px 8px;
      font-size: 0.885rem;
      text-align: left;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    table:not(.print-layout-table) tr {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }

    img {
      max-width: 100%;
      height: auto;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    section {
      break-inside: auto !important;
      page-break-inside: auto !important;
    }
    .report-field-scalar {
      break-inside: avoid !important;
      page-break-inside: avoid !important;
    }
    .report-field-mli {
      break-inside: auto !important;
      page-break-inside: auto !important;
    }
    .report-header-container {
      border-bottom: none !important;
      margin-bottom: 1.25rem !important;
    }

    /* Fixed bottom footer on every page */
    .report-fixed-footer {
      position: fixed;
      bottom: 4mm;
      left: 12mm;
      right: 12mm;
      font-size: 8pt;
      color: #6b7280;
      background: transparent;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    .report-fixed-footer .footer-divider {
      border-top: 0.5pt solid #cbd5e1;
      margin-bottom: 4px;
      width: 100%;
    }
    .report-fixed-footer .footer-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      width: 100%;
      padding: 0;
    }
    .report-fixed-footer .footer-left {
      visibility: hidden;
      display: none;
    }
    .report-fixed-footer .footer-right {
      text-align: right;
      margin-left: auto;
    }

    @media print {
      body {
        background: #ffffff !important;
        color: #000000 !important;
        margin: 0 !important;
        padding: 0 !important;
      }
    }
  `;

  let bodyContent = "";
  if (data.rendered_html) {
    // Custom report already has its own headers, logos, titles, and section formatting
    bodyContent = data.rendered_html;
  } else {
    // Standard template fallback
    bodyContent = `
      <h1 style="font-size: 1.45rem; font-weight: 700; margin-top: 0; margin-bottom: 1rem; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 0.5rem;">
        ${escapeHtml(title)}
      </h1>
      ${Array.isArray(data.text_blocks) && data.text_blocks.length > 0 ? `
      <section style="margin-bottom: 1.25rem;">
        ${data.text_blocks.map((b) => `
          <div style="margin-bottom: 0.75rem;">
            ${b.title ? `<h2 style="font-size: 1.05rem; margin-bottom: 0.25rem;">${escapeHtml(b.title)}</h2>` : ""}
            <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(b.content)}</p>
          </div>
        `).join("")}
      </section>
      ` : ""}
      ${Array.isArray(data.kpis) ? data.kpis.map((k) => `
      <section style="margin-bottom: 1.5rem;">
        <h2 style="font-size: 1.15rem; margin-bottom: 0.5rem; color: #1e3a8a;">${escapeHtml(k.kpi_name)}</h2>
        ${k.entries.map((ent) => `
          <div style="margin-left: 0.5rem; margin-bottom: 0.75rem;">
            ${ent.fields.map((f) => `
              <div style="display: flex; gap: 0.5rem; margin-bottom: 0.25rem;">
                <strong style="min-width: 140px;">${escapeHtml(f.field_name)}:</strong>
                <span>${escapeHtml(String(f.value ?? "—"))}</span>
              </div>
            `).join("")}
          </div>
        `).join("")}
      </section>
      `).join("") : ""}
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title></title>
  <style>${style}</style>
</head>
<body>
  <table class="print-layout-table">
    <thead>
      <tr>
        <td></td>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          ${bodyContent}
        </td>
      </tr>
    </tbody>
    <tfoot>
      <tr>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="report-fixed-footer">
    <div class="footer-divider"></div>
    <div class="footer-row">
      <div class="footer-left"></div>
      <div class="footer-right">Generated on ${escapeHtml(dateFormatted)}</div>
    </div>
  </div>
</body>
</html>`;

  return html;
}

/**
 * Triggers the browser's native print preview dialog directly in-page without
 * opening any new blank tabs or windows.
 */
export function printReportDocument(docHtml: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      resolve(false);
      return;
    }

    try {
      const frameId = "report-print-frame";
      let iframe = document.getElementById(frameId) as HTMLIFrameElement | null;
      if (iframe) {
        iframe.remove();
      }

      iframe = document.createElement("iframe");
      iframe.id = frameId;
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.style.visibility = "hidden";
      iframe.setAttribute("aria-hidden", "true");

      document.body.appendChild(iframe);

      const frameDoc = iframe.contentWindow?.document || iframe.contentDocument;
      if (!frameDoc) {
        iframe.remove();
        resolve(false);
        return;
      }

      frameDoc.open();
      frameDoc.write(docHtml);
      frameDoc.close();

      const doPrint = () => {
        try {
          if (iframe && iframe.contentWindow) {
            const originalTitle = document.title;
            try {
              document.title = "";
              if (iframe.contentDocument) {
                iframe.contentDocument.title = "";
              }
            } catch {}

            iframe.contentWindow.focus();
            iframe.contentWindow.print();

            setTimeout(() => {
              try {
                document.title = originalTitle;
              } catch {}
            }, 1000);

            resolve(true);
          } else {
            resolve(false);
          }
        } catch (err) {
          console.error("Iframe print invocation error", err);
          resolve(false);
        }
      };

      // Check if all images inside iframe are already loaded (e.g. base64 logos)
      const imgs = Array.from(frameDoc.querySelectorAll("img"));
      if (imgs.length > 0) {
        let pending = imgs.length;
        const onImgDone = () => {
          pending--;
          if (pending <= 0) {
            setTimeout(doPrint, 120);
          }
        };

        let allDone = true;
        for (const img of imgs) {
          if (!img.complete) {
            allDone = false;
            img.addEventListener("load", onImgDone, { once: true });
            img.addEventListener("error", onImgDone, { once: true });
          } else {
            pending--;
          }
        }

        if (allDone || pending <= 0) {
          setTimeout(doPrint, 120);
        } else {
          // Fallback safety timeout
          setTimeout(doPrint, 1000);
        }
      } else {
        setTimeout(doPrint, 150);
      }
    } catch (e) {
      console.error("Failed to setup print iframe", e);
      resolve(false);
    }
  });
}

/**
 * Backward compatibility wrapper: forwards directly to in-page printReportDocument.
 */
export function openReportPrintWindow(doc: string, autoPrint = true): boolean {
  if (autoPrint) {
    void printReportDocument(doc);
    return true;
  }
  return true;
}
