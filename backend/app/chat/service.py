"""Chat service: schema context, OpenAI intent, data fetch, response formatting."""

from __future__ import annotations

import json
import re
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, case
from sqlalchemy.orm import selectinload

from datetime import datetime

from app.core.config import get_settings
from app.core.models import KPI, KPIField, KPIEntry
from app.entries.service import (
    get_entries_for_kpis,
    get_latest_year_with_entries,
    get_available_years,
)

# Max schema size to keep prompts small
MAX_KPIS_IN_SCHEMA = 50
MAX_FIELDS_PER_KPI = 20

# When user doesn't specify year we use latest year with data (see run_chat_turn)
DEFAULT_YEAR_FALLBACK = 2024  # only if no entries exist at all

# Limits for LLM and frontend to avoid token blow-up and bad UX
MAX_ROWS_SENT_TO_LLM = 5
MAX_TABLE_ROWS_DISPLAY = 15
MAX_CELL_CHARS = 60
MAX_YEARS_COMPARE = 6  # max years to include in year-over-year comparison


def _get_openai_client() -> tuple["OpenAI | None", str]:
    """Return (client, error_message). If client is None, error_message describes why."""
    try:
        from openai import OpenAI
    except ImportError as e:
        return None, f"OpenAI package not installed: {e}. Run: pip install openai"
    settings = get_settings()
    api_key = (settings.OPENAI_API_KEY or "").strip()
    if not api_key:
        return None, "OPENAI_API_KEY is empty in settings. Check your .env file and restart the server."
    try:
        client = OpenAI(api_key=api_key)
        return client, ""
    except Exception as e:
        return None, f"OpenAI client init failed: {str(e)}"


async def build_org_schema(db: AsyncSession, org_id: int) -> list[dict]:
    """Build a compact schema of KPIs, fields, and sub-fields for the org (for LLM context).
    KPIs that have at least one entry (submitted data) for this org are included first, so
    chat can match questions to them and not report 'not currently collected'."""
    # KPI ids that have any entry for this org (so they are always in schema when we have room)
    entry_kpi_q = (
        select(KPIEntry.kpi_id)
        .where(KPIEntry.organization_id == org_id)
        .distinct()
    )
    entry_res = await db.execute(entry_kpi_q)
    ids_with_entries = [row[0] for row in entry_res.all()]

    order = [KPI.year.desc(), KPI.sort_order, KPI.name]
    if ids_with_entries:
        # Put KPIs that have data first so they are never dropped by the limit
        order.insert(0, case((KPI.id.in_(ids_with_entries), 0), else_=1))

    q = (
        select(KPI)
        .where(KPI.organization_id == org_id)
        .order_by(*order)
        .limit(MAX_KPIS_IN_SCHEMA)
        .options(
            selectinload(KPI.fields).selectinload(KPIField.sub_fields),
        )
    )
    result = await db.execute(q)
    kpis = result.unique().scalars().all()
    schema = []
    for k in kpis:
        fields = (k.fields or [])[:MAX_FIELDS_PER_KPI]
        field_list = []
        for f in fields:
            sub_fields = getattr(f, "sub_fields", None) or []
            sub_list = [{"key": sf.key, "name": sf.name} for sf in sub_fields[:15]]  # limit sub_fields per field
            field_list.append({
                "key": f.key,
                "name": f.name,
                "type": f.field_type.value,
                "sub_fields": sub_list,
            })
        schema.append({
            "id": k.id,
            "name": k.name,
            "year": k.year,
            "fields": field_list,
        })
    return schema


def _schema_to_text(schema: list[dict]) -> str:
    """Turn schema list into a short text block for the prompt. Include sub-fields so NLP can match them."""
    lines = []
    for k in schema:
        parts = []
        for f in k["fields"]:
            s = f"{f['key']} ({f['name']}, {f['type']})"
            sub = f.get("sub_fields") or []
            if sub:
                sub_str = ", ".join(f"{sf['key']} ({sf['name']})" for sf in sub)
                s += f" [sub_fields: {sub_str}]"
            parts.append(s)
        field_str = "; ".join(parts)
        lines.append(f"KPI id={k['id']} name=\"{k['name']}\" year={k['year']} fields: {field_str}")
    return "\n".join(lines)


def _parse_intent_response(raw: str) -> dict | None:
    """Parse LLM JSON response; extract intent, kpi_ids, field_keys, year, not_collected."""
    raw = raw.strip()
    # Try to find a JSON object in the response
    match = re.search(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", raw, re.DOTALL)
    if match:
        raw = match.group(0)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return None
    intent = data.get("intent") or "list_data"
    if intent not in ("list_data", "summary", "comparison", "compare_years"):
        intent = "list_data"
    kpi_ids = data.get("kpi_ids")
    if not isinstance(kpi_ids, list):
        kpi_ids = [x for x in (data.get("kpi_id"),) if x is not None]
    field_keys = data.get("field_keys")
    if not isinstance(field_keys, list):
        field_keys = []
    year = data.get("year")
    if year is not None and isinstance(year, (int, float)):
        year = int(year)
    else:
        year = None
    years = data.get("years")
    if isinstance(years, list):
        years = [int(y) for y in years if y is not None and isinstance(y, (int, float))][:MAX_YEARS_COMPARE]
    else:
        years = []
    not_collected = bool(data.get("not_collected"))
    return {
        "intent": intent,
        "kpi_ids": [int(x) for x in kpi_ids if x is not None],
        "field_keys": [str(x) for x in field_keys if x],
        "year": year,
        "years": years,
        "not_collected": not_collected,
    }


async def get_chat_intent(db: AsyncSession, org_id: int, user_message: str) -> tuple[dict | None, list[dict], str]:
    """
    Call OpenAI to get structured intent from user message. Returns (intent_dict, schema, error_message).
    If error_message is non-empty, intent_dict may be None.
    """
    settings = get_settings()
    if not (settings.OPENAI_API_KEY or "").strip():
        return None, [], "Chat is not configured. Set OPENAI_API_KEY in the environment."

    schema = await build_org_schema(db, org_id)
    if not schema:
        return None, [], "Your organization has no KPIs defined yet. Add KPIs first."

    schema_text = _schema_to_text(schema)
    valid_ids = [k["id"] for k in schema]
    valid_keys = set()
    for k in schema:
        for f in k.get("fields", []):
            valid_keys.add(f["key"])

    system = f"""You are a KPI data assistant. The user's organization has the following KPI schema. Use only these IDs and field keys in your response.

Schema:
{schema_text}

Respond with ONLY a JSON object (no markdown, no explanation) with:
- "intent": one of "list_data", "summary", "comparison", or "compare_years". Use "compare_years" when the user asks to compare data across different years (e.g. "compare with previous years", "year over year", "2022 vs 2023 vs 2024", "how did it change over the years").
- "kpi_ids": array of KPI ids from the schema that match the user question (use schema ids only)
- "field_keys": optional array of field keys to include (from schema); if empty, include all fields
- "year": integer year ONLY if the user explicitly mentions a single year; otherwise omit or null.
- "years": optional array of years ONLY when intent is "compare_years" and the user specified which years (e.g. [2022, 2023, 2024]); otherwise omit so the system uses recent available years.

When the user asks about data that appears in a sub_field (e.g. "titles", "author", "year" inside a list), match to the parent field that contains those sub_fields and include that field's key in "field_keys".
If the user question does not match any KPI or field in the schema, set "kpi_ids" to [] and "not_collected" to true.
Spelling and term normalization: interpret the user intent and map to the schema (e.g. "reaserch papers" -> KPI about research papers if it exists)."""

    client, client_err = _get_openai_client()
    if not client:
        return None, schema, client_err or "OpenAI client could not be initialized."

    try:
        resp = client.chat.completions.create(
            model=settings.CHAT_MODEL or "gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_message[:3000]},
            ],
            max_tokens=400,
            temperature=0,
        )
        content = (resp.choices[0].message.content or "").strip()
    except Exception as e:
        return None, schema, f"Failed to call OpenAI: {str(e)}"

    intent = _parse_intent_response(content)
    if not intent:
        return None, schema, "Could not understand the question. Try rephrasing or ask about a specific KPI."

    # Validate intent against schema
    intent["kpi_ids"] = [i for i in intent["kpi_ids"] if i in valid_ids]
    intent["field_keys"] = [k for k in intent.get("field_keys", []) if k in valid_keys]
    return intent, schema, ""


def _truncate_cell(val: Any) -> str:
    """Truncate cell value for sending to LLM to save tokens."""
    s = str(val) if val is not None else ""
    if len(s) > MAX_CELL_CHARS:
        return s[: MAX_CELL_CHARS - 3] + "..."
    return s


def _get_nlp_summary(
    client: Any,
    user_message: str,
    column_names: list[str],
    row_count: int,
    sample_rows: list[dict],
    summary_numbers: dict[str, Any] | None,
    data_year: int,
    year_note: str,
    model: str,
) -> str:
    """
    Ask LLM for a short natural-language summary of the retrieved data. Use small payload only.
    """
    col_info = ", ".join(column_names) if column_names else "none"
    # Build a tiny summary for the prompt: do not send many rows
    data_desc = f"Total rows: {row_count}. Columns: {col_info}."
    if summary_numbers:
        data_desc += f" Summary numbers: {summary_numbers}."
    if sample_rows:
        # Truncate each cell
        sample = []
        for r in sample_rows:
            sample.append({k: _truncate_cell(v) for k, v in r.items()})
        data_desc += f" Sample rows (up to {len(sample)}): {json.dumps(sample, default=str)}."
    prompt = f"""The user asked: "{user_message[:500]}"

Retrieved KPI data for year {data_year}:
{data_desc}
{f"Note: {year_note}" if year_note else ""}

Write a short, friendly answer (2-4 sentences) summarizing the data in natural language. Do not list all columns or repeat raw numbers verbatim; highlight what matters for the user's question. No preamble."""

    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3,
        )
        content = (resp.choices[0].message.content or "").strip()
        return content or "Here is the retrieved data."
    except Exception:
        # Fallback: simple sentence
        return f"Found {row_count} record(s) for {data_year}. " + (year_note or "")


def _numeric_from_row(row: dict) -> float | None:
    """Extract first numeric value from a row dict (for charts)."""
    for v in (row or {}).values():
        try:
            if v is not None and str(v).strip() != "":
                return float(str(v).replace(",", ""))
        except (ValueError, TypeError):
            pass
    return None


async def _run_compare_years(
    db: AsyncSession,
    org_id: int,
    kpi_ids: list[int],
    intent_years: list[int],
    user_message: str,
    name_by_id_from_schema: dict[int, str],
) -> dict[str, Any]:
    """Fetch data for multiple years, build chart and comparison text."""
    # Resolve years to use (sorted ascending for chart)
    if intent_years:
        years = sorted(set(intent_years))[-MAX_YEARS_COMPARE:]
    else:
        years = await get_available_years(db, org_id, kpi_ids, limit=MAX_YEARS_COMPARE)
        years = sorted(years, reverse=True)[:MAX_YEARS_COMPARE]
        years = sorted(years)  # ascending for chart

    if not years:
        return {
            "text": "No data found for the selected KPIs in any year. Enter data for at least one year to see a comparison.",
            "sources": None,
            "chart": None,
            "not_entered": None,
            "not_collected": False,
        }

    # Fetch entries per year; build (kpi_id, year) -> value (first numeric in row)
    # and collect kpi_id -> kpi_name from rows
    value_by_kpi_year: dict[int, dict[int, float]] = {kid: {} for kid in kpi_ids}
    name_by_id: dict[int, str] = dict(name_by_id_from_schema)
    kpis_with_any_data: set[int] = set()

    for y in years:
        rows, missing = await get_entries_for_kpis(db, org_id, kpi_ids, y)
        for m in missing or []:
            name_by_id[m["kpi_id"]] = m["kpi_name"]
        for r in rows:
            kid = r["kpi_id"]
            kpis_with_any_data.add(kid)
            name_by_id[kid] = r.get("kpi_name", name_by_id.get(kid, ""))
            num = _numeric_from_row(r.get("row") or {})
            value_by_kpi_year[kid][y] = num if num is not None else 0.0

    # Sources: one per (kpi_id, year) for /dashboard/entries/kpi/{kpi_id}?year={y}&organization_id={org_id}
    sources = [
        {"kpi_id": kid, "kpi_name": name_by_id.get(kid, ""), "year": y, "organization_id": org_id}
        for kid in kpi_ids
        for y in years
    ]

    # Not entered: KPIs that have no data in any of the years
    not_entered = None
    missing_kpi_ids = [kid for kid in kpi_ids if kid not in kpis_with_any_data]
    if missing_kpi_ids:
        _, missing_list = await get_entries_for_kpis(db, org_id, missing_kpi_ids, years[-1])
        not_entered = [
            {"kpi_name": m["kpi_name"], "assigned_user_names": m.get("assigned_user_names", [])}
            for m in (missing_list or [])
        ]

    # Comparison text: LLM or simple
    text_parts = []
    if not_entered:
        for m in (not_entered or []):
            names = m.get("assigned_user_names") or []
            text_parts.append(
                f"Data for \"{m.get('kpi_name', '')}\" has not been entered for any of the years. "
                + (f"Responsible: {', '.join(names)}." if names else "")
            )
    # Build short summary for LLM: "Year 2022: KPI A = x, KPI B = y; Year 2023: ..."
    summary_lines = []
    for y in years:
        parts = []
        for kid in kpi_ids:
            val = value_by_kpi_year.get(kid, {}).get(y, 0)
            parts.append(f"{name_by_id.get(kid, '')}={val}")
        summary_lines.append(f"{y}: " + ", ".join(parts))
    data_summary = "; ".join(summary_lines)

    client, _ = _get_openai_client()
    if client:
        try:
            prompt = f"""The user asked: "{user_message[:400]}"

Year-over-year data (same KPIs across years):
{data_summary}

Write a short comparison in 2-4 sentences: how values change across the years, and any notable trend. No preamble."""
            resp = client.chat.completions.create(
                model=get_settings().CHAT_MODEL or "gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=250,
                temperature=0.3,
            )
            comp_text = (resp.choices[0].message.content or "").strip()
            if comp_text:
                text_parts.append(comp_text)
        except Exception:
            pass
    if not text_parts or (len(text_parts) == 1 and not_entered):
        text_parts.append(f"Comparison across {len(years)} year(s): {years[0]} to {years[-1]}. See the chart below for values by year.")
    text = " ".join(text_parts)

    return {
        "text": text,
        "sources": sources,
        "chart": None,
        "not_entered": not_entered,
        "not_collected": False,
    }


async def run_chat_turn(
    db: AsyncSession,
    org_id: int,
    user_message: str,
) -> dict[str, Any]:
    """
    Execute one chat turn: resolve intent, fetch data, format response.
    Returns a dict suitable for ChatMessageResponse (text, table, chart, summary_numbers, not_entered, not_collected).
    """
    intent, schema, err = await get_chat_intent(db, org_id, user_message)
    if err:
        return {
            "text": err,
            "sources": None,
            "chart": None,
            "not_entered": None,
            "not_collected": False,
        }

    kpi_ids = intent.get("kpi_ids") or []
    field_keys = intent.get("field_keys") or []
    intent_year = intent.get("year")  # None if user did not specify year
    intent_type = intent.get("intent") or "list_data"
    schema_by_id = {k["id"]: k for k in schema}

    # Resolve year: if user specified one use it; else use latest year that has data
    current_year = datetime.now().year
    if intent_year is not None:
        year = intent_year
        year_note = ""
    else:
        latest = await get_latest_year_with_entries(db, org_id, kpi_ids)
        year = latest if latest is not None else current_year
        if latest is not None and latest < current_year:
            year_note = f"Data for {current_year} has not been entered yet. The following is for {year}."
        else:
            year_note = ""

    # Only consider KPIs defined for the resolved year (same-name KPIs for other years
    # would have no entry for this year and would wrongly show as "not entered")
    kpi_ids_for_year = [i for i in kpi_ids if schema_by_id.get(i, {}).get("year") == year]
    if not kpi_ids_for_year:
        kpi_ids_for_year = kpi_ids  # fallback if no schema year match (e.g. legacy data)
    kpi_ids = kpi_ids_for_year

    # User asked about something not in schema
    if not kpi_ids and intent.get("not_collected"):
        return {
            "text": "This information is not currently being collected by the system. Please contact the system administrator if you want this data to be collected.",
            "sources": None,
            "chart": None,
            "not_entered": None,
            "not_collected": True,
        }

    if not kpi_ids:
        return {
            "text": "I couldn't match your question to any KPI in your organization. Try referring to a KPI by name or field.",
            "sources": None,
            "chart": None,
            "not_entered": None,
            "not_collected": False,
        }

    # --- Multi-year comparison branch ---
    if intent_type == "compare_years":
        return await _run_compare_years(
            db=db,
            org_id=org_id,
            kpi_ids=kpi_ids,
            intent_years=intent.get("years") or [],
            user_message=user_message,
            name_by_id_from_schema={k["id"]: k["name"] for k in schema},
        )

    rows, missing_kpis = await get_entries_for_kpis(db, org_id, kpi_ids, year)

    # Build not_entered for response
    not_entered = None
    if missing_kpis:
        not_entered = [
            {"kpi_name": m["kpi_name"], "assigned_user_names": m["assigned_user_names"]}
            for m in missing_kpis
        ]

    # Filter columns if field_keys specified
    if field_keys:
        for r in rows:
            r["row"] = {k: v for k, v in (r.get("row") or {}).items() if k in field_keys}

    # Build table (list of row dicts) - use first KPI's row keys for headers
    table = None
    if rows:
        all_keys = set()
        for r in rows:
            all_keys.update((r.get("row") or {}).keys())
        # Prefer order: field_keys then rest
        ordered_keys = [k for k in field_keys if k in all_keys]
        for k in sorted(all_keys):
            if k not in ordered_keys:
                ordered_keys.append(k)
        table = []
        for r in rows:
            row_dict = {"KPI": r.get("kpi_name", "")}
            row_dict.update((r.get("row") or {}))
            table.append(row_dict)

    # Summary numbers (count; optional avg for numeric columns)
    summary_numbers = None
    if rows:
        summary_numbers = {"Number of records": len(rows)}
        # If single KPI and numeric-looking fields, add simple aggregates
        if len(kpi_ids) == 1 and table:
            for col in list(table[0].keys()):
                if col == "KPI":
                    continue
                vals = [table[i].get(col) for i in range(len(table))]
                numeric = []
                for v in vals:
                    try:
                        if v is not None and str(v).strip() != "":
                            numeric.append(float(str(v).replace(",", "")))
                    except (ValueError, TypeError):
                        pass
                if numeric:
                    summary_numbers[f"Sum ({col})"] = round(sum(numeric), 2)
                    summary_numbers[f"Average ({col})"] = round(sum(numeric) / len(numeric), 2)

    # Chart: only for comparison with a few series
    chart = None
    if intent_type == "comparison" and rows and len(rows) <= 20:
        # Simple bar: KPI name or first text field as label, first numeric as value
        labels = []
        values = []
        for r in rows:
            labels.append(r.get("kpi_name", "")[:30])
            row = r.get("row") or {}
            num = None
            for v in row.values():
                try:
                    num = float(str(v).replace(",", ""))
                    break
                except (ValueError, TypeError):
                    pass
            values.append(num if num is not None else 0)
        if labels and values:
            chart = {"type": "bar", "labels": labels, "series": [{"name": "Value", "data": values}]}

    # Source links: /dashboard/entries/kpi/{kpi_id}?year={year}&organization_id={org_id}
    name_by_id: dict[int, str] = {r["kpi_id"]: r["kpi_name"] for r in rows}
    for m in missing_kpis or []:
        name_by_id[m["kpi_id"]] = m["kpi_name"]
    sources = [
        {"kpi_id": kid, "kpi_name": name_by_id.get(kid, ""), "year": year, "organization_id": org_id}
        for kid in kpi_ids
    ]

    # Main response text: get NLP summary from LLM when we have data (don't send many rows)
    text_parts = []
    if not_entered:
        for m in missing_kpis:
            names = m.get("assigned_user_names") or []
            if names:
                text_parts.append(
                    f"Data for \"{m.get('kpi_name', '')}\" has not been entered yet. "
                    f"The following user(s) are responsible for entering it: {', '.join(names)}."
                )
            else:
                text_parts.append(f"Data for \"{m.get('kpi_name', '')}\" has not been entered yet.")
    if year_note:
        text_parts.append(year_note)

    if rows:
        client, client_err = _get_openai_client()
        if client and table:
            column_names = list(table[0].keys()) if table else []
            sample_for_llm = table[:MAX_ROWS_SENT_TO_LLM]
            nlp_text = _get_nlp_summary(
                client=client,
                user_message=user_message,
                column_names=column_names,
                row_count=len(table),
                sample_rows=sample_for_llm,
                summary_numbers=summary_numbers,
                data_year=year,
                year_note=year_note,
                model=get_settings().CHAT_MODEL or "gpt-4o-mini",
            )
            text_parts.append(nlp_text)
        else:
            # Fallback without LLM
            if intent_type == "summary" and summary_numbers:
                text_parts.append("Summary: " + "; ".join(f"{k}: {v}" for k, v in summary_numbers.items()))
            elif intent_type == "comparison" and chart:
                text_parts.append(f"Comparison of {len(rows)} KPI entries for {year} (see chart below).")
            else:
                text_parts.append(f"Found {len(rows)} record(s) for the selected KPIs for year {year}.")
    if not text_parts:
        text_parts.append("No data found for the selected KPIs and year.")

    return {
        "text": " ".join(text_parts),
        "sources": sources,
        "chart": None,
        "not_entered": not_entered,
        "not_collected": False,
    }
