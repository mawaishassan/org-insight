/**
 * Multi-line / scalar attachment fields: support single or multiple { url, filename } objects.
 */

export type AttachmentCellObject = { url: string; filename?: string | null };

export function isAttachmentCellObject(v: unknown): v is AttachmentCellObject {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
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

/** Parse single attachment object, array of attachment objects, or JSON string into AttachmentCellObject array. */
export function parseAttachmentList(cell: unknown): AttachmentCellObject[] {
  if (cell == null || cell === "") return [];
  if (Array.isArray(cell)) {
    const list: AttachmentCellObject[] = [];
    for (const item of cell) {
      list.push(...parseAttachmentList(item));
    }
    return list;
  }
  if (typeof cell === "string") {
    const t = cell.trim();
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t);
        if (Array.isArray(parsed)) return parseAttachmentList(parsed);
      } catch {
        /* fall through */
      }
    } else if (t.startsWith("{")) {
      try {
        const parsed = JSON.parse(t);
        if (isAttachmentCellObject(parsed)) return [parsed];
      } catch {
        /* fall through */
      }
    }
    if (t) {
      return [{ url: t, filename: "Attached file" }];
    }
    return [];
  }
  if (isAttachmentCellObject(cell)) {
    return [cell];
  }
  return [];
}

/** URL string for API calls (open / delete). Returns first URL if multiple. */
export function getAttachmentUrl(cell: unknown): string {
  if (cell == null || cell === "") return "";
  if (Array.isArray(cell)) {
    const list = parseAttachmentList(cell);
    return list[0]?.url.trim() || "";
  }
  if (typeof cell === "string") {
    const t = cell.trim();
    if (t.startsWith("[")) {
      const list = parseAttachmentList(t);
      return list[0]?.url.trim() || "";
    }
    const parsed = parseJsonAttachmentString(t);
    if (parsed) return parsed.url.trim();
    return t;
  }
  if (isAttachmentCellObject(cell)) return cell.url.trim();
  return String(cell).trim();
}

/** Label for UI (filename when known, comma-separated if multiple). */
export function getAttachmentDisplayName(cell: unknown): string {
  const list = parseAttachmentList(cell);
  if (list.length > 0) {
    const names = list.map((item) => item.filename?.trim() || "Attached file");
    return names.join(", ");
  }
  const url = getAttachmentUrl(cell);
  if (!url) return "";
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
