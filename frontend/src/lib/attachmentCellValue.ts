/**
 * Multi-line / scalar attachment fields: support legacy string URL or { url, filename }.
 */

export type AttachmentCellObject = { url: string; filename?: string | null };

export function isAttachmentCellObject(v: unknown): v is AttachmentCellObject {
  return (
    typeof v === "object" &&
    v !== null &&
    "url" in v &&
    typeof (v as AttachmentCellObject).url === "string" &&
    String((v as AttachmentCellObject).url).trim() !== ""
  );
}

/** Parse JSON attachment string from DB/API into a cell object when possible. */
function parseJsonAttachmentString(s: string): AttachmentCellObject | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t) as unknown;
    return isAttachmentCellObject(o) ? o : null;
  } catch {
    return null;
  }
}

/** URL string for API calls (open / delete). */
export function getAttachmentUrl(cell: unknown): string {
  if (cell == null || cell === "") return "";
  if (typeof cell === "string") {
    const parsed = parseJsonAttachmentString(cell);
    if (parsed) return parsed.url.trim();
    return cell.trim();
  }
  if (isAttachmentCellObject(cell)) return cell.url.trim();
  return String(cell).trim();
}

/** Label for UI (filename when known). */
export function getAttachmentDisplayName(cell: unknown): string {
  const url = getAttachmentUrl(cell);
  if (!url) return "";
  if (isAttachmentCellObject(cell)) {
    const fn = cell.filename;
    if (typeof fn === "string" && fn.trim()) return fn.trim();
  }
  if (typeof cell === "string") {
    const parsed = parseJsonAttachmentString(cell);
    if (parsed?.filename && String(parsed.filename).trim()) return String(parsed.filename).trim();
  }
  return "Attached file";
}

export function makeAttachmentCellValue(url: string, filename: string): AttachmentCellObject {
  return { url: url.trim(), filename: filename.trim() || null };
}

/** Scalar field: JSON in value_text or plain URL. Accepts object from API if ever deserialized. */
export function parseScalarAttachmentValueText(text: unknown): AttachmentCellObject & { raw: string } {
  if (text != null && typeof text === "object" && !Array.isArray(text) && isAttachmentCellObject(text)) {
    const o = text as AttachmentCellObject;
    return { url: o.url.trim(), filename: o.filename ?? null, raw: JSON.stringify({ url: o.url, filename: o.filename }) };
  }
  const raw = typeof text === "string" ? text.trim() : String(text ?? "").trim();
  if (!raw) return { url: "", filename: null, raw: "" };
  if (raw.startsWith("{")) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (isAttachmentCellObject(o)) {
        return { url: o.url.trim(), filename: o.filename ?? null, raw };
      }
    } catch {
      /* fall through */
    }
  }
  return { url: raw, filename: null, raw };
}

export function stringifyScalarAttachment(url: string, filename: string): string {
  return JSON.stringify({ url: url.trim(), filename: (filename || "").trim() || undefined });
}

/** Normalize API `value_text` for attachment scalar fields (string, or rare object shape). */
export function coerceScalarValueTextFromApi(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null && isAttachmentCellObject(raw)) {
    return stringifyScalarAttachment(raw.url, raw.filename ?? "");
  }
  return undefined;
}
