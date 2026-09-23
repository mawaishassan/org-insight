"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";

interface AccessDeniedProps {
  title?: string;
  message?: string;
  returnUrl?: string;
  returnLabel?: string;
}

export function AccessDenied({
  title = "Access Denied",
  message = "You do not have permission to access this resource, or it belongs to another organization.",
  returnUrl,
  returnLabel = "Return to Dashboard",
}: AccessDeniedProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orgId = searchParams?.get("organization_id");

  const fallbackUrl = returnUrl || (orgId ? `/dashboard?organization_id=${orgId}` : "/dashboard");

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "55vh",
        padding: "2rem 1rem",
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: "500px",
          width: "100%",
          padding: "2.5rem 2rem",
          textAlign: "center",
          borderRadius: "16px",
          boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.04)",
          border: "1px solid var(--border, #e2e8f0)",
          background: "var(--surface, #ffffff)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            width: "64px",
            height: "64px",
            borderRadius: "50%",
            background: "rgba(239, 68, 68, 0.1)",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "1.25rem",
          }}
        >
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        </div>

        <h2
          style={{
            margin: "0 0 0.5rem 0",
            fontSize: "1.35rem",
            fontWeight: 700,
            color: "var(--text, #0f172a)",
          }}
        >
          {title}
        </h2>

        <p
          style={{
            margin: "0 0 1.75rem 0",
            fontSize: "0.925rem",
            color: "var(--muted, #64748b)",
            lineHeight: 1.5,
          }}
        >
          {message}
        </p>

        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
          <button
            type="button"
            className="btn"
            onClick={() => router.back()}
            style={{
              padding: "0.55rem 1.25rem",
              fontSize: "0.9rem",
              borderRadius: "8px",
            }}
          >
            Go Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => router.push(fallbackUrl)}
            style={{
              padding: "0.55rem 1.35rem",
              fontSize: "0.9rem",
              borderRadius: "8px",
            }}
          >
            {returnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
