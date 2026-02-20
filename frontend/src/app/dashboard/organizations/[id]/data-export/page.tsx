"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAccessToken } from "@/lib/auth";
import { api, getApiUrl } from "@/lib/api";

interface ExportItem {
  kpi_id: number;
  kpi_name: string;
  kpi_description: string | null;
  kpi_year: number;
  kpi_fields_ids: number[];
  kpi_fields: {
    kpi_field_id: number;
    kpi_field_key: string;
    kpi_field_data_type: string;
    kpi_field_values: unknown;
    kpi_field_year: number | null;
  }[];
}

const API_SCHEMA_AND_EXAMPLE = {
  schema: {
    description: "GET /api/kpis/data-export returns an array of KPI objects. Query params: organization_id (required for Super Admin), year (optional, 2000-2100).",
    response: "Array of KPI export items",
    item_shape: {
      kpi_id: "number – KPI id",
      kpi_name: "string – KPI name",
      kpi_description: "string | null – KPI description",
      kpi_year: "number – KPI year",
      kpi_fields_ids: "number[] – list of field ids for this KPI",
      kpi_fields: "array of field objects (see below)",
    },
    field_shape: {
      kpi_field_id: "number – field id",
      kpi_field_key: "string – stable key (e.g. grant_type, amount)",
      kpi_field_data_type: "string – one of: single_line_text, multi_line_text, number, date, boolean, multi_line_items, formula",
      kpi_field_values: "value – type depends on data_type: string, number, ISO date string, boolean, array of row objects (multi_line_items), or computed number (formula)",
      kpi_field_year: "number | null – year of the entry this value belongs to",
    },
    field_types_note: "Scalar: single_line_text, multi_line_text, number, date, boolean. multi_line_items = array of objects (one per row). formula = server-computed value.",
  },
  example: [
    {
      kpi_id: 1,
      kpi_name: "Sample KPI with all field types",
      kpi_description: "Example showing scalar, multi_line_items, and formula fields",
      kpi_year: 2025,
      kpi_fields_ids: [101, 102, 103, 104, 105, 106],
      kpi_fields: [
        {
          kpi_field_id: 101,
          kpi_field_key: "title",
          kpi_field_data_type: "single_line_text",
          kpi_field_values: "Annual Research Grant Summary",
          kpi_field_year: 2025,
        },
        {
          kpi_field_id: 102,
          kpi_field_key: "total_budget",
          kpi_field_data_type: "number",
          kpi_field_values: 500000,
          kpi_field_year: 2025,
        },
        {
          kpi_field_id: 103,
          kpi_field_key: "report_date",
          kpi_field_data_type: "date",
          kpi_field_values: "2025-01-15",
          kpi_field_year: 2025,
        },
        {
          kpi_field_id: 104,
          kpi_field_key: "is_verified",
          kpi_field_data_type: "boolean",
          kpi_field_values: true,
          kpi_field_year: 2025,
        },
        {
          kpi_field_id: 105,
          kpi_field_key: "grant_items",
          kpi_field_data_type: "multi_line_items",
          kpi_field_values: [
            { item_name: "Equipment", amount: 120000, recipient: "Lab A" },
            { item_name: "Travel", amount: 35000, recipient: "Lab B" },
          ],
          kpi_field_year: 2025,
        },
        {
          kpi_field_id: 106,
          kpi_field_key: "total_spent",
          kpi_field_data_type: "formula",
          kpi_field_values: 155000,
          kpi_field_year: 2025,
        },
      ],
    },
  ],
};

export default function OrganizationDataExportPage() {
  const params = useParams();
  const router = useRouter();
  const orgIdParam = params?.id;
  const orgId = useMemo(() => {
    if (!orgIdParam) return null;
    if (Array.isArray(orgIdParam)) return parseInt(orgIdParam[0] as string, 10) || null;
    const n = parseInt(orgIdParam as string, 10);
    return Number.isNaN(n) ? null : n;
  }, [orgIdParam]);

  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [responseText, setResponseText] = useState<string>("\n// Click \"Test API call\" to see JSON here\n");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validHours, setValidHours] = useState<number>(24);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [generatedExpiresAt, setGeneratedExpiresAt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const token = getAccessToken();
  const displayToken = generatedToken ?? token ?? null;

  useEffect(() => {
    if (!token) {
      router.replace("/login");
    }
  }, [token, router]);

  const baseExportUrl = useMemo(() => {
    const url = getApiUrl("/kpis/data-export");
    if (!orgId) return url;
    const search = new URLSearchParams({ organization_id: String(orgId) });
    if (year.trim()) {
      search.set("year", year.trim());
    }
    return `${url}?${search.toString()}`;
  }, [orgId, year]);

  const handleGenerateToken = async () => {
    if (!orgId || !token) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await api<{ token: string; expires_at: string }>(
        `/organizations/${orgId}/export-token`,
        { method: "POST", body: JSON.stringify({ valid_hours: validHours }), token }
      );
      setGeneratedToken(res.token);
      setGeneratedExpiresAt(res.expires_at);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : "Failed to generate token");
    } finally {
      setGenerating(false);
    }
  };

  const handleTestCall = async () => {
    const authToken = displayToken ?? token;
    if (!authToken || !orgId) {
      setError("Missing token or organization id");
      return;
    }
    setLoading(true);
    setError(null);
    setResponseText("// Loading…");
    try {
      const search = new URLSearchParams({ organization_id: String(orgId) });
      if (year.trim()) {
        search.set("year", year.trim());
      }
      const data = await api<ExportItem[]>(`/kpis/data-export?${search.toString()}`, { token: authToken });
      setResponseText(JSON.stringify(data, null, 2));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to call API";
      setError(msg);
      setResponseText(`// Error: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const handleShowSchemaAndExample = () => {
    setError(null);
    const schemaJson = JSON.stringify(API_SCHEMA_AND_EXAMPLE.schema, null, 2);
    const exampleJson = JSON.stringify(API_SCHEMA_AND_EXAMPLE.example, null, 2);
    setResponseText(
      "// --- API SCHEMA ---\n" + schemaJson + "\n\n// --- EXAMPLE (one KPI with scalar, multi_line_items, formula) ---\n" + exampleJson
    );
  };

  if (!orgId) {
    return <p>Invalid organization id.</p>;
  }

  return (
    <div>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.75rem" }}>Data export API for organization #{orgId}</h1>
      <p style={{ color: "var(--muted)", marginBottom: "1rem" }}>
        Use this page to share the KPI JSON export endpoint and a bearer token with an external system,
        and to quickly test the API response.
      </p>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>1. Export URL</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          External systems should send a <code>GET</code> request to this URL with the bearer token below.
        </p>
        <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Year (optional)</label>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(e.target.value)}
          style={{
            marginBottom: "0.75rem",
            padding: "0.4rem 0.6rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            maxWidth: "160px",
          }}
        />
        <label style={{ display: "block", fontSize: "0.9rem", marginBottom: "0.25rem" }}>Data export URL</label>
        <textarea
          readOnly
          value={baseExportUrl}
          rows={2}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "0.85rem",
            padding: "0.5rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            resize: "vertical",
          }}
        />
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>2. Long-lived export token (recommended)</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.75rem" }}>
          Generate a token that stays valid for the number of hours you choose. No resync until it expires.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
          <label style={{ fontWeight: 500 }}>Valid for (hours)</label>
          <input
            type="number"
            min={1}
            max={8760}
            value={validHours}
            onChange={(e) => setValidHours(Number(e.target.value) || 24)}
            style={{
              width: 80,
              padding: "0.4rem 0.5rem",
              borderRadius: 6,
              border: "1px solid var(--border)",
            }}
          />
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>e.g. 24 = 1 day, 168 = 1 week, 8760 = 1 year</span>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGenerateToken}
            disabled={generating || !token}
          >
            {generating ? "Generating…" : "Generate token"}
          </button>
        </div>
        {generateError && <p className="form-error" style={{ marginBottom: "0.5rem" }}>{generateError}</p>}
        {generatedToken && (
          <div style={{ marginTop: "0.5rem" }}>
            <p style={{ fontSize: "0.9rem", fontWeight: 500, marginBottom: "0.25rem" }}>
              Token (copy now; it won’t be shown again):
            </p>
            <textarea
              readOnly
              value={generatedToken}
              rows={2}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: "0.85rem",
                padding: "0.5rem",
                borderRadius: 6,
                border: "1px solid var(--border)",
                resize: "vertical",
              }}
            />
            {generatedExpiresAt && (
              <p style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                Expires: {new Date(generatedExpiresAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>3. Security token (Bearer)</h2>
        <p style={{ fontSize: "0.9rem", color: "var(--muted)", marginBottom: "0.5rem" }}>
          Use the generated token above, or your session token below. Send in{" "}
          <code>Authorization: Bearer &lt;token&gt;</code> header.
        </p>
        <textarea
          readOnly
          value={displayToken ?? "// Generate a token above or sign in to use session token"}
          rows={3}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "0.85rem",
            padding: "0.5rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            resize: "vertical",
          }}
        />
      </div>

      <div className="card">
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>4. Test API call</h2>
        {error && (
          <p className="form-error" style={{ marginBottom: "0.5rem" }}>
            {error}
          </p>
        )}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <button type="button" className="btn btn-primary" onClick={handleTestCall} disabled={loading || !displayToken}>
            {loading ? "Calling…" : "Test API call"}
          </button>
          <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Uses token from section 3</span>
          <button type="button" className="btn" onClick={handleShowSchemaAndExample}>
            Schema & example
          </button>
        </div>
        <label style={{ display: "block", fontSize: "0.9rem", marginTop: "0.75rem", marginBottom: "0.25rem" }}>
          API response (readonly JSON)
        </label>
        <textarea
          readOnly
          value={responseText}
          rows={10}
          style={{
            width: "100%",
            fontFamily: "monospace",
            fontSize: "0.82rem",
            padding: "0.5rem",
            borderRadius: 6,
            border: "1px solid var(--border)",
            resize: "vertical",
            marginTop: "0.25rem",
          }}
        />
      </div>
    </div>
  );
}

