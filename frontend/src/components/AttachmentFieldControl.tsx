"use client";

import type { ReactNode } from "react";
import { deleteKpiStoredFileByUrl, getApiUrl, openKpiStoredFileInNewTab } from "@/lib/api";
import { getAttachmentDisplayName, getAttachmentUrl } from "@/lib/attachmentCellValue";

function BinIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export type AttachmentFieldControlProps = {
  value: unknown;
  onUploaded: (downloadUrl: string, filename: string) => void;
  onClear: () => void;
  token: string | null | undefined;
  kpiId: number;
  entryId: number | null;
  year: number;
  compact?: boolean;
  /** When token missing (e.g. session expired). */
  onNotAuthenticated?: () => void;
  onError?: (message: string) => void;
  /** Shown above the Attach button when there is no file (e.g. paste URL + KPI file picker). */
  emptySlot?: ReactNode;
  attachDisabled?: boolean;
  /** When false, parent handles success feedback (e.g. auto-save toast). Default true. */
  uploadSuccessAlert?: boolean;
};

export function AttachmentFieldControl({
  value,
  onUploaded,
  onClear,
  token,
  kpiId,
  entryId,
  year,
  compact,
  onNotAuthenticated,
  onError,
  emptySlot,
  attachDisabled,
  uploadSuccessAlert = true,
}: AttachmentFieldControlProps) {
  const urlNow = getAttachmentUrl(value);
  const displayName = getAttachmentDisplayName(value);
  const canAttach = Boolean(token && entryId && !attachDisabled);

  const runUpload = async (file: File) => {
    if (!token) {
      onNotAuthenticated?.();
      return;
    }
    if (!entryId) {
      onError?.("Entry is still loading. Please wait and try again.");
      return;
    }
    try {
      const form = new FormData();
      form.append("files", file);
      form.append("entry_id", String(entryId));
      form.append("year", String(year));
      const res = await fetch(getApiUrl(`/kpis/${kpiId}/files`), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        onError?.("File upload failed");
        return;
      }
      const uploaded = (await res.json()) as Array<{ download_url?: string; original_filename?: string }>;
      const latest = uploaded[0];
      if (!latest?.download_url) {
        onError?.("File upload failed");
        return;
      }
      const name = latest.original_filename || file.name || "Uploaded file";
      onUploaded(latest.download_url, name);
      if (uploadSuccessAlert) {
        window.alert(`Upload successful.\n\nFile: ${name}\n\nSave to keep this change.`);
      }
    } catch {
      onError?.("File upload failed");
    }
  };

  if (!urlNow) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: compact ? "column" : "column",
          gap: compact ? "0.35rem" : "0.45rem",
          alignItems: "stretch",
          minWidth: compact ? 120 : undefined,
        }}
      >
        {emptySlot}
        <label
          className={canAttach ? "btn btn-primary" : "btn"}
          style={{
            padding: compact ? "0.4rem 0.85rem" : "0.55rem 1.15rem",
            fontSize: compact ? "0.875rem" : "0.9375rem",
            fontWeight: 600,
            lineHeight: 1.25,
            minHeight: compact ? "2.375rem" : "2.625rem",
            width: "fit-content",
            cursor: canAttach ? "pointer" : "not-allowed",
            alignSelf: "flex-start",
            boxSizing: "border-box",
            ...(canAttach
              ? { color: "#fff" }
              : {
                  background: "var(--surface)",
                  borderColor: "var(--border)",
                  color: "var(--text)",
                }),
          }}
        >
          Attach
          <input
            type="file"
            style={{ display: "none" }}
            disabled={!canAttach}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              await runUpload(file);
            }}
          />
        </label>
      </div>
    );
  }

  const fontSize = compact ? "0.82rem" : "0.95rem";
  const iconSize = compact ? 15 : 18;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.35rem",
        minWidth: 0,
      }}
    >
      <button
        type="button"
        aria-label="Remove attachment"
        title="Remove attachment"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!window.confirm("Remove this file? If it was uploaded here, it will be deleted from storage.")) {
            return;
          }
          if (!token) {
            onNotAuthenticated?.();
            return;
          }
          try {
            await deleteKpiStoredFileByUrl(urlNow, token);
          } catch {
            onError?.("Could not delete file from storage. The link was removed.");
          }
          onClear();
        }}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0.15rem",
          border: "none",
          background: "transparent",
          color: "var(--muted, #666)",
          cursor: "pointer",
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        <BinIcon size={iconSize} />
      </button>
      <button
        type="button"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!token) {
            onNotAuthenticated?.();
            return;
          }
          try {
            await openKpiStoredFileInNewTab(value, token);
          } catch (err) {
            onError?.(err instanceof Error ? err.message : "Could not open file");
          }
        }}
        title={urlNow}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          margin: 0,
          font: "inherit",
          fontSize,
          fontWeight: 600,
          color: "var(--accent)",
          cursor: "pointer",
          textAlign: "left",
          textDecoration: "underline",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {displayName}
      </button>
    </div>
  );
}
