"""Odoo XML-RPC/API authentication and KPI data fetch."""

from __future__ import annotations

import copy
import json
import re
from typing import Any

import httpx

from app.core.models import OrganizationOdooConfig, KpiOdooConfig

PLACEHOLDER_PATTERN = re.compile(
    r"__([A-Z_]+)__"
)

SENSITIVE_FIELD_CONFIG_KEYS = frozenset(
    {
        "odoo_field_mappings",
        "odoo_field_list_indices",
        "multi_items_api_endpoint_url",
    }
)


def mask_odoo_password(password: str | None) -> str:
    if not password:
        return ""
    return "***"


def sanitize_multi_items_field_config(config: dict | None, is_org_admin: bool) -> dict | None:
    """Strip sensitive import config for non-admin users."""
    if not config or is_org_admin:
        return config
    out = dict(config)
    for key in SENSITIVE_FIELD_CONFIG_KEYS:
        out.pop(key, None)
    channel = out.get("multi_items_import_channel")
    if channel == "odoo":
        out["multi_items_import_channel"] = "odoo"
    elif channel == "api":
        out["multi_items_import_channel"] = "api"
    return out


def _replace_placeholders_in_str(value: str, context: dict[str, Any]) -> str:
    def repl(m: re.Match) -> str:
        key = m.group(1).lower()
        if key in context:
            return str(context[key])
        return m.group(0)

    return PLACEHOLDER_PATTERN.sub(repl, value)


def _inject_context(obj: Any, context: dict[str, Any]) -> Any:
    if isinstance(obj, str):
        return _replace_placeholders_in_str(obj, context)
    if isinstance(obj, list):
        return [_inject_context(x, context) for x in obj]
    if isinstance(obj, dict):
        return {k: _inject_context(v, context) for k, v in obj.items()}
    return obj


def build_odoo_request_body(template: dict | list | Any, context: dict[str, Any]) -> Any:
    """Deep-copy template and replace __SESSION_ID__, __YEAR__, etc."""
    body = copy.deepcopy(template)
    return _inject_context(body, context)


def _extract_session_id(data: dict, cookies: httpx.Cookies) -> str | None:
    result = data.get("result")
    if isinstance(result, dict):
        for key in ("session_id", "sid"):
            val = result.get(key)
            if val:
                return str(val)
        session = result.get("session")
        if isinstance(session, dict) and session.get("sid"):
            return str(session["sid"])
        if result.get("uid"):
            cookie_sid = cookies.get("session_id")
            if cookie_sid:
                return str(cookie_sid)
    cookie_sid = cookies.get("session_id")
    if cookie_sid:
        return str(cookie_sid)
    return None


async def odoo_authenticate(cfg: OrganizationOdooConfig) -> str:
    """Authenticate with Odoo login URL; return session id for the fetch step."""
    db_name = (cfg.odoo_db or "").strip() or "OBE"
    payload = {
        "jsonrpc": "2.0",
        "params": {
            "db": db_name,
            "login": cfg.username,
            "password": cfg.password,
        },
        "id": None,
    }
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(cfg.login_url, json=payload)
    if resp.status_code < 200 or resp.status_code >= 300:
        raise ValueError(f"Odoo login failed (HTTP {resp.status_code})")
    try:
        data = resp.json()
    except Exception as e:
        raise ValueError(f"Odoo login returned non-JSON response: {e}") from e
    if data.get("error"):
        raise ValueError(f"Odoo login error: {data.get('error')}")
    session_id = _extract_session_id(data, resp.cookies)
    if not session_id:
        result = data.get("result")
        uid = None
        if isinstance(result, dict):
            uc = result.get("user_context") or {}
            uid = uc.get("uid") or result.get("uid")
        if uid:
            session_id = str(uid)
        else:
            raise ValueError("Odoo login succeeded but no session id was returned")
    return session_id


def _get_by_path(data: Any, path: str | None) -> Any:
    if path is None or path.strip() == "":
        for candidate in ("items", "data", "records", "rows"):
            if isinstance(data, dict) and candidate in data:
                return data[candidate]
        if isinstance(data, dict) and "result" in data:
            res = data["result"]
            if isinstance(res, list):
                return res
            if isinstance(res, dict):
                for candidate in ("items", "data", "records", "rows"):
                    if candidate in res:
                        return res[candidate]
        return None
    cur = data
    for part in path.strip().split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


async def odoo_fetch_items(
    cfg: OrganizationOdooConfig,
    kpi_cfg: KpiOdooConfig,
    session_id: str,
    context: dict[str, Any],
) -> list[dict]:
    """Call data fetch URL with session and KPI request body; return list of row dicts."""
    ctx = {
        "session_id": session_id,
        "year": context.get("year"),
        "kpi_id": context.get("kpi_id"),
        "organization_id": context.get("organization_id"),
        "entry_id": context.get("entry_id"),
        "field_id": context.get("field_id"),
        "field_key": context.get("field_key"),
    }
    body = build_odoo_request_body(kpi_cfg.request_body, ctx)
    if isinstance(body, dict) and "session_id" not in body and "__SESSION_ID__" not in json.dumps(kpi_cfg.request_body):
        body["session_id"] = session_id

    headers: dict[str, str] = {"Content-Type": "application/json"}
    cookies = {"session_id": session_id}

    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(
            cfg.data_fetch_url,
            json=body if isinstance(body, (dict, list)) else {"payload": body},
            headers=headers,
            cookies=cookies,
        )
    if resp.status_code < 200 or resp.status_code >= 300:
        raise ValueError(f"Odoo data fetch failed (HTTP {resp.status_code})")
    try:
        data = resp.json()
    except Exception as e:
        raise ValueError(f"Odoo data fetch returned non-JSON: {e}") from e
    if isinstance(data, dict) and data.get("error"):
        raise ValueError(f"Odoo data fetch error: {data.get('error')}")

    raw_items = _get_by_path(data, kpi_cfg.response_items_path)
    if raw_items is None and isinstance(data, list):
        raw_items = data
    if not isinstance(raw_items, list):
        raise ValueError("Odoo response did not contain a list of items")
    items = [dict(x) for x in raw_items if isinstance(x, dict)]
    return items


def extract_odoo_columns(items: list[dict]) -> list[str]:
    """Stable union of keys across all rows (first-seen order)."""
    columns: list[str] = []
    seen: set[str] = set()
    for row in items:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                columns.append(str(key))
    return columns


def format_preview_cell(value: Any, max_len: int = 80) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        text = json.dumps(value, ensure_ascii=False, default=str)
    else:
        text = str(value)
    if len(text) > max_len:
        return text[: max_len - 1] + "…"
    return text


def build_odoo_preview_rows(
    items: list[dict],
    columns: list[str],
    *,
    max_rows: int = 5,
    max_columns: int = 7,
) -> tuple[list[dict[str, str]], int]:
    """Return display-safe sample rows using up to max_columns and max_rows."""
    preview_cols = columns[:max_columns]
    rows: list[dict[str, str]] = []
    for row in items[:max_rows]:
        rows.append({col: format_preview_cell(row.get(col)) for col in preview_cols})
    return rows, len(preview_cols)


def detect_odoo_list_columns(
    items: list[dict],
    columns: list[str],
    *,
    scan_rows: int = 25,
) -> dict[str, list[dict[str, Any]]]:
    """For columns whose values are list/tuple (e.g. Odoo many2one [id, name]), return index options with samples."""
    out: dict[str, list[dict[str, Any]]] = {}
    for col in columns:
        sample_val: list | tuple | None = None
        max_len = 0
        for row in items[:scan_rows]:
            val = row.get(col)
            if not isinstance(val, (list, tuple)) or len(val) == 0:
                continue
            max_len = max(max_len, len(val))
            if sample_val is None:
                sample_val = val
        if max_len == 0 or sample_val is None:
            continue
        parts: list[dict[str, Any]] = []
        for i in range(max_len):
            part = sample_val[i] if i < len(sample_val) else None
            parts.append({"index": i, "sample": format_preview_cell(part, max_len=60)})
        out[col] = parts
    return out


def serialize_odoo_cell_for_xlsx(value: Any) -> Any:
    """Make Odoo cell values safe for openpyxl (lists/dicts as JSON text)."""
    if value is None:
        return ""
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, ensure_ascii=False, default=str)
    return value


def build_odoo_sample_xlsx_bytes(items: list[dict], columns: list[str]) -> bytes:
    """Build an Excel workbook with all Odoo columns and rows (Super Admin sample export)."""
    from io import BytesIO

    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = "Odoo sample"
    ws.append(list(columns))
    for row in items:
        ws.append([serialize_odoo_cell_for_xlsx(row.get(col)) for col in columns])
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def extract_odoo_mapped_value(value: Any, list_index: int | None) -> Any:
    """Pick one element when Odoo returns a list/tuple (e.g. many2one [id, display_name])."""
    if list_index is None:
        return value
    if not isinstance(value, (list, tuple)):
        return value
    if 0 <= list_index < len(value):
        return value[list_index]
    return value


def apply_odoo_field_mappings(
    items: list[dict],
    mappings: dict[str, str],
    valid_sub_keys: set[str],
    list_indices: dict[str, int] | None = None,
) -> list[dict]:
    """Map Odoo field names to KPI multi-line sub-field keys."""
    if not mappings:
        return items
    indices = list_indices or {}
    out: list[dict] = []
    for row in items:
        mapped: dict[str, Any] = {}
        for odoo_key, kpi_key in mappings.items():
            if odoo_key in row and kpi_key in valid_sub_keys:
                idx = indices.get(odoo_key)
                mapped[kpi_key] = extract_odoo_mapped_value(row[odoo_key], idx)
        for k, v in row.items():
            if k in valid_sub_keys and k not in mapped:
                mapped[k] = v
        out.append(mapped)
    return out


def apply_odoo_sub_field_mappings(
    items: list[dict],
    sub_mappings: dict[str, dict[str, Any]],
    valid_sub_keys: set[str],
) -> list[dict]:
    """
    v2 mapping format: per KPI sub-field mapping to an Odoo column (and optional list index).

    Allows mapping the same Odoo column to multiple KPI sub-fields (e.g. department_id[0] -> dept_id, department_id[1] -> dept_name_text).
    sub_mappings example:
      {
        "dept_name_text": {"column": "department_id", "list_index": 1},
        "dept_ref": {"column": "department_id", "list_index": 0},
      }
    """
    if not sub_mappings:
        return items
    out: list[dict] = []
    for row in items:
        mapped: dict[str, Any] = {}
        for sub_key, spec in sub_mappings.items():
            if sub_key not in valid_sub_keys:
                continue
            if not isinstance(spec, dict):
                continue
            col = spec.get("column")
            if not col or not isinstance(col, str):
                continue
            if col not in row:
                continue
            idx_raw = spec.get("list_index")
            idx: int | None
            if isinstance(idx_raw, int):
                idx = idx_raw
            elif isinstance(idx_raw, str) and idx_raw.isdigit():
                idx = int(idx_raw)
            else:
                idx = None
            mapped[sub_key] = extract_odoo_mapped_value(row[col], idx)
        for k, v in row.items():
            if k in valid_sub_keys and k not in mapped:
                mapped[k] = v
        out.append(mapped)
    return out
