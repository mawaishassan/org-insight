# Widget data bundle API (v1)

- **Health (no auth):** `GET /api/widget-data/health` → `{"status":"ok"}` — use this to confirm the FastAPI app is reachable. In dev, call it through the Next.js app: `http://localhost:3001/api/widget-data/health` (or your dev port); that request is rewritten to the backend URL in `next.config.js` (`NEXT_PUBLIC_BACKEND_URL` or `NEXT_PUBLIC_API_URL`, default `http://localhost:8080`).

- **Method / path:** `POST /api/widget-data`
- **Auth:** same JWT as other `/api` routes; body must include `organization_id` the caller may access (super-admin may pass another org).
- **Request body (JSON):**
  - `version` — `1`
  - `organization_id` — int
  - `widget` — same object as stored in dashboard layout (`id`, `type`, and type-specific options)
  - `overrides` (optional) — e.g. `year`, `period_key`, or `selected_years` (for `kpi_trend`) without changing saved layout
- **Response (JSON):**
  - `version` — `1`
  - `widget_type` — e.g. `kpi_bar_chart`, `kpi_trend`, …
  - `meta` — context such as `kpi_id`, `year`, `period_key`, `entry_id`, `row_count`, `truncated` (multi-line table)
  - `data` — per-type payload (`raw_rows`, `bars`, `field_bars_by_year`, `raw_rows_by_year`, `field_map` with `id_by_key` / `name_by_key`, etc.)
  - `entry_revision` — string derived from entry id + `updated_at` (use for client cache keys / invalidation)
  - `etag` — weak ETag string derived from `entry_revision` when present

**Opt out (frontend):** set `NEXT_PUBLIC_WIDGET_DATA_BUNDLE=0` to use the legacy multiple-request flow.

**Note:** Batching several widgets in one request is not part of v1.
