/**
 * Shared report print/PDF: build HTML document and open print window.
 * Used by report view page and design page (direct print from design).
 */

export interface ReportData {
  template_name: string;
  template_id: number;
  year: number;
  rendered_html?: string | null;
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
  const year = data.year;
  const style = `
    body { font-family: inherit; margin: 1rem; color: #111; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; border: 1px solid #333; }
    td, th { border: 1px solid #333; padding: 6px; }
    .report-card { border: 1px solid #ddd; padding: 1rem; border-radius: 8px; }
    .print-hint { font-size: 0.85rem; color: #666; margin-bottom: 1rem; }
    @media print { .print-hint { display: none; } }
  `;
  const bodyContent = data.rendered_html
    ? data.rendered_html
    : `
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
    ${data.kpis.map((k) => `
    <section style="margin-bottom: 1.5rem;">
      <h2 style="font-size: 1.15rem; margin-bottom: 0.5rem;">${escapeHtml(k.kpi_name)}</h2>
      ${k.entries.map((ent) => `
        <div style="margin-left: 1rem; margin-bottom: 0.75rem;">
          ${ent.fields.map((f) => `
            <div style="display: flex; gap: 0.5rem; margin-bottom: 0.25rem;">
              <strong style="min-width: 140px;">${escapeHtml(f.field_name)}:</strong>
              <span>${escapeHtml(String(f.value ?? "—"))}</span>
            </div>
          `).join("")}
        </div>
      `).join("")}
    </section>
    `).join("")}
  `;
  const parts = [
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>",
    escapeHtml(title),
    "</title><style>",
    style,
    "</style></head><body><p class=\"print-hint\">Year: ",
    String(year),
    ". To save as PDF: in the print dialog choose &quot;Save as PDF&quot; or &quot;Print to PDF&quot;.</p><h1 style=\"font-size: 1.25rem; margin-bottom: 0.5rem;\">",
    escapeHtml(title),
    "</h1>",
    bodyContent,
    "</body></html>",
  ];
  return parts.join("");
}

/**
 * Opens the report in a new tab for print/PDF. Returns true if the window opened, false if blocked (e.g. pop-up blocker).
 * Callers should show an inline message if false instead of using alert().
 */
export function openReportPrintWindow(doc: string, autoPrint = true): boolean {
  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    URL.revokeObjectURL(url);
    return false;
  }
  const doPrint = () => {
    URL.revokeObjectURL(url);
    if (autoPrint) {
      setTimeout(() => {
        win.print();
        if (typeof (win as Window & { onafterprint?: () => void }).onafterprint !== "undefined") {
          (win as Window & { onafterprint?: () => void }).onafterprint = () => win.close();
        } else {
          setTimeout(() => win.close(), 1000);
        }
      }, 150);
    }
  };
  try {
    if (win.document.readyState === "complete") {
      doPrint();
    } else {
      win.addEventListener("load", doPrint);
    }
  } catch {
    win.addEventListener("load", doPrint);
  }
  return true;
}
