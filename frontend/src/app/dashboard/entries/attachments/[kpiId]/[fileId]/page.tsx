"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { getApiUrl } from "@/lib/api";

export default function AttachmentDownloadPage() {
  const params = useParams();
  const router = useRouter();
  const kpiId = params.kpiId as string;
  const fileId = params.fileId as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("Attachment");
  const [fileType, setFileType] = useState<string>("");

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      // Redirect to login, maintaining this page's path for redirection after login
      const currentPath = window.location.pathname + window.location.search;
      router.push(`/login?redirect=${encodeURIComponent(currentPath)}`);
      return;
    }

    const checkAccess = async () => {
      try {
        const checkUrl = getApiUrl(`/kpis/${kpiId}/files/${fileId}/download`);
        // Perform a check request to verify user authorization and retrieve metadata headers
        const res = await fetch(checkUrl, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          try {
            const errData = await res.json();
            setError(errData.detail || `Error ${res.status}: Failed to load file.`);
          } catch {
            if (res.status === 403) {
              setError("Access Denied: You do not have permission to view this attachment.");
            } else if (res.status === 404) {
              setError("File not found. The attachment may have been deleted or moved.");
            } else {
              setError(`Error ${res.status}: Failed to fetch attachment.`);
            }
          }
          setLoading(false);
          return;
        }

        // Access is valid. Extract filename from Content-Disposition header
        const disposition = res.headers.get("Content-Disposition");
        let name = "Attachment";
        if (disposition) {
          const match = /filename="([^"]+)"/.exec(disposition);
          if (match) name = match[1];
        }
        setFileName(name);
        setFileType(res.headers.get("Content-Type") || "");
        setLoading(false);
      } catch (err) {
        setError("A network error occurred while verifying file access.");
        setLoading(false);
      }
    };

    checkAccess();
  }, [kpiId, fileId, router]);

  const handleOpen = async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const downloadApiPath = `/kpis/${kpiId}/files/${fileId}/download`;
      const url = getApiUrl(downloadApiPath);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load file");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      alert("Could not open attachment.");
    }
  };

  const handleDownload = async () => {
    const token = getAccessToken();
    if (!token) return;
    try {
      const downloadApiPath = `/kpis/${kpiId}/files/${fileId}/download?download=true`;
      const url = getApiUrl(downloadApiPath);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to download file");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName || "attachment";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert("Could not download attachment.");
    }
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <div className="card" style={cardStyle}>
          <div className="spinner-border text-primary" role="status" style={{ margin: "0 auto" }}>
            <span className="visually-hidden">Loading...</span>
          </div>
          <p style={{ marginTop: "1rem", color: "var(--muted, #6b7280)" }}>
            Verifying your security credentials...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={containerStyle}>
        <div className="card" style={{ ...cardStyle, borderLeft: "4px solid var(--destructive, #ef4444)" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", color: "var(--destructive, #ef4444)", marginBottom: "0.5rem" }}>
            Access Denied
          </h2>
          <p style={{ fontSize: "0.95rem", color: "var(--foreground, #1f2937)", marginBottom: "1.5rem" }}>
            {error}
          </p>
          <button onClick={() => router.push("/dashboard/entries")} className="btn btn-primary">
            Back to Entries
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div className="card" style={cardStyle}>
        <div style={iconContainerStyle}>
          <svg style={iconStyle} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h2 style={{ fontSize: "1.25rem", fontWeight: "bold", marginBottom: "0.25rem" }}>
          Secure Attachment
        </h2>
        <p style={{ fontSize: "0.95rem", color: "var(--muted, #6b7280)", marginBottom: "1rem", wordBreak: "break-all" }}>
          {fileName}
        </p>

        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", marginTop: "1rem" }}>
          <button onClick={handleOpen} className="btn btn-primary">
            View / Open
          </button>
          <button onClick={handleDownload} className="btn" style={secondaryButtonStyle}>
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  minHeight: "60vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "1.5rem",
};

const cardStyle: React.CSSProperties = {
  maxWidth: "420px",
  width: "100%",
  textAlign: "center",
  padding: "2rem",
  boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
  borderRadius: "0.5rem",
  backgroundColor: "var(--card-bg, #ffffff)",
  border: "1px solid var(--border-color, #e5e7eb)",
};

const iconContainerStyle: React.CSSProperties = {
  width: "4rem",
  height: "4rem",
  backgroundColor: "rgba(37, 99, 235, 0.1)",
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  margin: "0 auto 1rem auto",
};

const iconStyle: React.CSSProperties = {
  width: "2rem",
  height: "2rem",
  color: "var(--primary, #2563eb)",
};

const secondaryButtonStyle: React.CSSProperties = {
  backgroundColor: "var(--muted-bg, #f3f4f6)",
  color: "var(--muted-foreground, #374151)",
  border: "1px solid var(--border-color, #e5e7eb)",
};
