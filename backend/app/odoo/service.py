"""Odoo XML-RPC/API authentication and KPI data fetch."""

from __future__ import annotations

import asyncio
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
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(cfg.login_url, json=payload)
    except httpx.HTTPError as e:
        raise ValueError(f"Odoo server connection failed: {e}") from e
    except Exception as e:
        raise ValueError(f"Odoo request error: {e}") from e

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

    target_url = cfg.data_fetch_url
    if getattr(kpi_cfg, "endpoint", None) is not None:
        if not kpi_cfg.endpoint.is_active:
            raise ValueError(
                f"The selected Odoo API endpoint '{kpi_cfg.endpoint.name}' is currently inactive. Please select an active endpoint in KPI configuration."
            )
        target_url = kpi_cfg.endpoint.url

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            target_url,
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


import logging
import mimetypes
import urllib.parse
import uuid

logger = logging.getLogger(__name__)


def extract_odoo_attachment_ids(raw_val: Any) -> list[str | int]:
    """Extract list of attachment IDs from any representation Odoo returns."""
    if raw_val is None or raw_val == "":
        return []

    ids: list[str | int] = []

    def _collect(v: Any) -> None:
        if v is None or v == "" or isinstance(v, bool):
            return
        if isinstance(v, (int, float)):
            if isinstance(v, float) and v.is_integer():
                v = int(v)
            ids.append(v)
            return
        if isinstance(v, str):
            s = v.strip()
            if not s or s.lower() in ("none", "false", "null", "undefined"):
                return
            if s.startswith("[") or s.startswith("{"):
                try:
                    parsed = json.loads(s)
                    _collect(parsed)
                    return
                except Exception:
                    pass
            if "," in s:
                for part in s.split(","):
                    _collect(part.strip())
                return
            if s.isdigit():
                ids.append(int(s))
            else:
                ids.append(s)
            return
        if isinstance(v, dict):
            if "id" in v and v["id"] is not None:
                _collect(v["id"])
            return
        if isinstance(v, (list, tuple)):
            if len(v) == 3 and v[0] in (6, "6") and isinstance(v[2], (list, tuple)):
                _collect(v[2])
                return
            if len(v) == 2 and v[0] in (4, "4"):
                _collect(v[1])
                return
            for item in v:
                _collect(item)

    _collect(raw_val)
    seen: set[str | int] = set()
    result: list[str | int] = []
    for x in ids:
        if x not in seen:
            seen.add(x)
            result.append(x)
    return result


def _extract_filename_from_headers(headers: httpx.Headers, default_id: Any) -> str:
    """Extract filename from HTTP Content-Disposition response header or fallback based on Content-Type."""
    cd = headers.get("content-disposition", "")
    filename = None
    if cd:
        match_star = re.search(r"filename\*\s*=\s*(?:[^\']*\')*([^;]+)", cd, re.IGNORECASE)
        if match_star:
            filename = urllib.parse.unquote(match_star.group(1).strip("\"'"))
        else:
            match = re.search(r'filename\s*=\s*"?([^";]+)"?', cd, re.IGNORECASE)
            if match:
                filename = match.group(1).strip()

    if not filename:
        ct = headers.get("content-type", "").split(";")[0].strip()
        ext = mimetypes.guess_extension(ct) if ct else None
        if not ext:
            if ct == "application/pdf":
                ext = ".pdf"
            elif ct in ("image/png", "image/jpeg"):
                ext = f".{ct.split('/')[1]}"
            else:
                ext = ".bin"
        filename = f"attachment_{default_id}{ext}"

    name = re.sub(r"[^\w.\- ]", "_", filename).strip() or "file"
    return name[:200]


async def download_and_store_odoo_attachments(
    db: Any,
    *,
    org_id: int,
    kpi_id: int,
    entry_id: int,
    year: int,
    user_id: int | None,
    attachment_url_template: str,
    session_id: str,
    raw_attachment_val: Any,
) -> tuple[Any, list[str]]:
    """
    Download attachment files from Odoo using attachment_url_template, create KpiFile records,
    and return (converted_cell_value, error_messages).
    """
    from app.core.models import KpiFile
    from app.storage.service import upload_file as storage_upload_file

    att_ids = extract_odoo_attachment_ids(raw_attachment_val)
    if not att_ids:
        return None, []

    downloaded_objects: list[dict[str, Any]] = []
    errors: list[str] = []

    async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
        for att_id in att_ids:
            target_url = (
                attachment_url_template.replace("{ATTACHMENT_ID}", str(att_id))
                .replace("{attachment_id}", str(att_id))
                .replace("__ATTACHMENT_ID__", str(att_id))
                .replace("{SESSION_ID}", session_id)
                .replace("{session_id}", session_id)
                .replace("__SESSION_ID__", session_id)
            )

            try:
                resp = await client.get(target_url, cookies={"session_id": session_id})
                if resp.status_code < 200 or resp.status_code >= 300:
                    msg = f"Failed to download attachment ID {att_id}: HTTP {resp.status_code}"
                    logger.error("Odoo attachment download error: %s (URL: %s)", msg, target_url)
                    errors.append(msg)
                    continue

                content = resp.content
                if not content:
                    msg = f"Failed to download attachment ID {att_id}: File content is empty"
                    logger.error("Odoo attachment download error: %s (URL: %s)", msg, target_url)
                    errors.append(msg)
                    continue

                original_filename = _extract_filename_from_headers(resp.headers, att_id)
                content_type = resp.headers.get("content-type", "application/octet-stream").split(";")[0].strip()

                base_name = re.sub(r"[^\w.\- ]", "_", original_filename).strip() or "file"
                unique = f"{base_name[:100]}_{uuid.uuid4().hex[:8]}"
                relative_path = f"org_{org_id}/kpi_{kpi_id}/year_{year}/{unique}"

                stored_path = await storage_upload_file(db, org_id, relative_path, content, content_type)

                kf = KpiFile(
                    kpi_id=kpi_id,
                    organization_id=org_id,
                    year=year,
                    entry_id=entry_id,
                    original_filename=original_filename[:512],
                    stored_path=stored_path,
                    content_type=content_type[:255] if content_type else None,
                    size=len(content),
                    uploaded_by_user_id=user_id,
                )
                db.add(kf)
                await db.flush()

                download_url = f"/api/kpis/{kpi_id}/files/{kf.id}/download"
                downloaded_objects.append({"url": download_url, "filename": kf.original_filename})

            except Exception as e:
                msg = f"Failed to download attachment ID {att_id}: {e!s}"
                logger.error("Odoo attachment download exception: %s (URL: %s)", msg, target_url, exc_info=True)
                errors.append(msg)
                continue

    if not downloaded_objects:
        return None, errors

    if len(downloaded_objects) == 1:
        return downloaded_objects[0], errors

    return downloaded_objects, errors


async def store_pre_downloaded_odoo_attachments(
    db: Any,
    *,
    org_id: int,
    kpi_id: int,
    entry_id: int,
    year: int,
    user_id: int | None,
    raw_attachment_val: Any,
    downloaded_data: dict[str | int, tuple[bytes, dict[str, str]]],
) -> tuple[Any, list[str]]:
    """
    Store pre-downloaded attachment files into KpiFile records and storage sequentially.
    """
    from app.core.models import KpiFile
    from app.storage.service import upload_file as storage_upload_file
    import uuid

    att_ids = extract_odoo_attachment_ids(raw_attachment_val)
    if not att_ids:
        return None, []

    stored_objects: list[dict[str, Any]] = []
    errors: list[str] = []

    for att_id in att_ids:
        if att_id not in downloaded_data:
            # If download failed during concurrent phase, report it
            errors.append(f"Attachment ID {att_id} content was not downloaded")
            continue

        content, headers_dict = downloaded_data[att_id]
        headers = httpx.Headers(headers_dict)
        try:
            if not content:
                errors.append(f"Attachment ID {att_id} has empty content")
                continue

            original_filename = _extract_filename_from_headers(headers, att_id)
            content_type = headers.get("content-type", "application/octet-stream").split(";")[0].strip()

            base_name = re.sub(r"[^\w.\- ]", "_", original_filename).strip() or "file"
            unique = f"{base_name[:100]}_{uuid.uuid4().hex[:8]}"
            relative_path = f"org_{org_id}/kpi_{kpi_id}/year_{year}/{unique}"

            stored_path = await storage_upload_file(db, org_id, relative_path, content, content_type)

            kf = KpiFile(
                kpi_id=kpi_id,
                organization_id=org_id,
                year=year,
                entry_id=entry_id,
                original_filename=original_filename[:512],
                stored_path=stored_path,
                content_type=content_type[:255] if content_type else None,
                size=len(content),
                uploaded_by_user_id=user_id,
            )
            db.add(kf)
            await db.flush()

            download_url = f"/api/kpis/{kpi_id}/files/{kf.id}/download"
            stored_objects.append({"url": download_url, "filename": kf.original_filename})

        except Exception as e:
            msg = f"Failed to store attachment ID {att_id}: {e!s}"
            logger.error("Odoo attachment store exception: %s", msg, exc_info=True)
            errors.append(msg)

    if not stored_objects:
        return None, errors

    if len(stored_objects) == 1:
        return stored_objects[0], errors

    return stored_objects, errors
