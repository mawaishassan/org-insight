"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { deleteKpiStoredFileByUrl, getApiUrl, openKpiStoredFileInNewTab, postFormDataWithUploadProgress } from "@/lib/api";
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
  onUploaded: (downloadUrl: string, filename: string) => Promise<void> | void;
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

  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "saving">("idle");
  const [uploadProgress, setUploadProgress] = useState(0);

  const canAttach = Boolean(token && entryId && !attachDisabled && uploadState === "idle");

  const runUpload = async (file: File) => {
    if (!token) {
      onNotAuthenticated?.();
      return;
    }
    if (!entryId) {
      onError?.("Entry is still loading. Please wait and try again.");
      return;
    }
    
    setUploadState("uploading");
    setUploadProgress(0);

    try {
      const form = new FormData();
      form.append("files", file);
      form.append("entry_id", String(entryId));
      form.append("year", String(year));

      const res = await postFormDataWithUploadProgress(
        `/kpis/${kpiId}/files`,
        form,
        {
          token,
          onUploadProgress: (ev) => {
            if (ev.lengthComputable) {
              const percent = Math.round((ev.loaded / ev.total) * 100);
              setUploadProgress(percent);
            }
          },
          onRequestSent: () => {
            setUploadState("saving");
          },
        }
      );

      if (!res.ok) {
        throw new Error("File upload failed");
      }

      const rawJson = await res.json();
      const uploaded = rawJson as Array<{ download_url?: string; original_filename?: string }>;
      const latest = uploaded[0];
      if (!latest?.download_url) {
        throw new Error("File upload failed");
      }

      const name = latest.original_filename || file.name || "Uploaded file";
      
      setUploadState("saving");
      await onUploaded(latest.download_url, name);

      if (uploadSuccessAlert) {
        window.alert(`Upload successful.\n\nFile: ${name}\n\nSave to keep this change.`);
      }
    } catch (err) {
      console.error("Upload error details:", err);
      onError?.(err instanceof Error ? err.message : "File upload failed");
    } finally {
      setUploadState("idle");
      setUploadProgress(0);
    }
  };

  if (uploadState !== "idle") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.25rem",
          width: "fit-content",
          minWidth: compact ? 120 : 160,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: compact ? "0.4rem 0.85rem" : "0.55rem 1.15rem",
            fontSize: compact ? "0.875rem" : "0.9375rem",
            fontWeight: 600,
            background: "var(--bg-subtle, #f1f5f9)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "var(--text-secondary)",
            lineHeight: 1.25,
            minHeight: compact ? "2.375rem" : "2.625rem",
            boxSizing: "border-box",
          }}
        >
          <svg
            className="animate-spin-custom"
            width={compact ? 14 : 16}
            height={compact ? 14 : 16}
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={{ color: "var(--accent)" }}
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              strokeDasharray="32"
              strokeDashoffset="10"
              strokeLinecap="round"
            />
          </svg>
          <span>
            {uploadState === "uploading" ? `Uploading ${uploadProgress}%` : "Saving..."}
          </span>
        </div>
        {uploadState === "uploading" && (
          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }} />
          </div>
        )}
      </div>
    );
  }

  if (!urlNow) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.45rem",
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
        disabled={uploadState !== "idle"}
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
          cursor: uploadState === "idle" ? "pointer" : "not-allowed",
          opacity: uploadState === "idle" ? 1 : 0.5,
          borderRadius: 4,
          flexShrink: 0,
        }}
      >
        <BinIcon size={iconSize} />
      </button>
      <button
        type="button"
        disabled={uploadState !== "idle"}
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
          cursor: uploadState === "idle" ? "pointer" : "not-allowed",
          opacity: uploadState === "idle" ? 1 : 0.7,
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
