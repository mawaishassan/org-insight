"""Pure-Python MLI text extraction engine.

Applies a list of MLITextExtractionRule-like dicts (loaded from the DB) to each row
dict produced by load_multi_line_row_dicts.  Raw values are never mutated — this
function returns a *new* list of row dicts with extracted / cleaned values applied.

Supported extraction_method values:
  - "between_symbols" : extract text found between start_symbol and end_symbol into
                        target_sub_field_key, honouring occurrence / target_action.
                        Optionally also remove the matched portion from source
                        (remove_from_source + remove_delimiters_too).
  - "remove_only"     : delete the matched segment from source_sub_field_key only.
                        target_sub_field_key is ignored.  remove_delimiters_too controls
                        whether the delimiter chars themselves are also removed.
"""

from __future__ import annotations

import re
from typing import Any


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def apply_extraction_rules(
    rows: list[dict],
    rules: list[dict],
) -> list[dict]:
    """Apply ordered extraction rules to every row dict (in-memory, non-mutating).

    Args:
        rows:  List of row dicts as produced by load_multi_line_row_dicts.
        rules: List of rule dicts (DB model fields as plain dict keys).
               Expected keys per rule:
                 source_sub_field_key, target_sub_field_key, extraction_method,
                 start_symbol, end_symbol, remove_delimiters_too, occurrence,
                 all_separator, target_action, remove_from_source, is_active.

    Returns:
        New list of row dicts with rules applied.  Original list is not mutated.

    Raises:
        ValueError: if a circular dependency is detected in the rule chain.
    """
    active_rules = [r for r in rules if r.get("is_active", True)]
    if not active_rules:
        return [dict(row) for row in rows]

    ordered = _topological_sort(active_rules)
    return [_apply_rules_to_row(dict(row), ordered) for row in rows]


# ---------------------------------------------------------------------------
# Dependency ordering
# ---------------------------------------------------------------------------

def _topological_sort(rules: list[dict]) -> list[dict]:
    """Return rules in dependency order using Kahn's algorithm (BFS topo sort).

    A rule R1 must run *before* R2 when R1.target_sub_field_key == R2.source_sub_field_key.

    Raises:
        ValueError: if a cycle is detected.
    """
    n = len(rules)
    # Build adjacency: index i must come before index j
    from collections import defaultdict, deque
    adj: dict[int, list[int]] = defaultdict(list)
    in_degree = [0] * n

    target_to_indices: dict[str, list[int]] = defaultdict(list)
    for i, r in enumerate(rules):
        t = r.get("target_sub_field_key")
        if t:
            target_to_indices[t].append(i)

    for j, r in enumerate(rules):
        src = r.get("source_sub_field_key", "")
        if src in target_to_indices:
            for i in target_to_indices[src]:
                if i != j:
                    adj[i].append(j)
                    in_degree[j] += 1

    queue = deque(i for i in range(n) if in_degree[i] == 0)
    ordered: list[dict] = []
    while queue:
        idx = queue.popleft()
        ordered.append(rules[idx])
        for nxt in adj[idx]:
            in_degree[nxt] -= 1
            if in_degree[nxt] == 0:
                queue.append(nxt)

    if len(ordered) != n:
        # Find one cycle for a helpful error message
        remaining = [rules[i]["name"] for i in range(n) if in_degree[i] > 0]
        raise ValueError(
            f"Circular dependency detected in MLI extraction rules. "
            f"Rules involved: {', '.join(remaining)}"
        )

    return ordered


# ---------------------------------------------------------------------------
# Per-row application
# ---------------------------------------------------------------------------

def _apply_rules_to_row(row: dict, rules: list[dict]) -> dict:
    for rule in rules:
        method = rule.get("extraction_method", "between_symbols")
        try:
            if method == "between_symbols":
                row = _apply_between_symbols(row, rule)
            elif method == "remove_only":
                row = _apply_remove_only(row, rule)
            elif method == "full_cell_format":
                row = _apply_full_cell_format(row, rule)
        except Exception:
            # Never crash downstream consumers — skip bad rule silently
            pass
    return row


# ---------------------------------------------------------------------------
# Extraction methods & Formatting Helpers
# ---------------------------------------------------------------------------

BRACKET_PAIRS = {
    "(": ")",
    "[": "]",
    "{": "}",
    "<": ">",
}

BRACKET_PAIRS_REVERSE = {
    "(": ")",
    "[": "]",
    "{": "}",
    "<": ">",
    "()": ("(", ")"),
    "[]": ("[", "]"),
    "{}": ("{", "}"),
    "<>": ("<", ">"),
    '""': ('"', '"'),
    "''": ("'", "'"),
}


def _apply_wrapping_and_pattern(
    value: str,
    row: dict,
    wrap_mode: str | None,
    wrap_symbol: str | None,
    output_pattern: str | None,
    wrap_end_symbol: str | None = None,
) -> str:
    """Apply prefix, suffix, wrapping symbol, or custom pattern template to value."""
    if value is None:
        val_str = ""
    else:
        val_str = str(value).strip()

    if not wrap_mode or wrap_mode == "none":
        if output_pattern:
            wrap_mode = "pattern"
        else:
            return val_str

    if wrap_mode == "prefix":
        sym = wrap_symbol or ""
        return f"{sym}{val_str}"

    if wrap_mode == "suffix":
        sym = wrap_end_symbol or wrap_symbol or ""
        return f"{val_str}{sym}"

    if wrap_mode == "wrap":
        open_sym = wrap_symbol or ""
        close_sym = wrap_end_symbol or ""
        if not close_sym:
            if open_sym in BRACKET_PAIRS_REVERSE:
                pair = BRACKET_PAIRS_REVERSE[open_sym]
                if isinstance(pair, tuple):
                    open_sym, close_sym = pair
                else:
                    close_sym = pair
            elif len(open_sym) == 2 and open_sym[0] in BRACKET_PAIRS and open_sym[1] == BRACKET_PAIRS[open_sym[0]]:
                open_sym, close_sym = open_sym[0], open_sym[1]
            else:
                close_sym = open_sym
        return f"{open_sym}{val_str}{close_sym}"

    if wrap_mode == "pattern" or output_pattern:
        pattern = output_pattern or "{CELL_VALUE}"
        res = pattern.replace("{CELL_VALUE}", val_str)
        # Resolve any other {sub_field_key} placeholders present in row
        for k, v in row.items():
            if isinstance(k, str) and f"{{{k}}}" in res:
                v_str = "" if v is None else str(v).strip()
                res = res.replace(f"{{{k}}}", v_str)
        return res

    return val_str


def _find_matches(
    text: str,
    start: str,
    end: str,
    occurrence: str,
) -> list[tuple[int, int, int, int]]:
    """Return list of (outer_start, outer_end, inner_start, inner_end) spans.

    outer_* includes delimiters; inner_* is the captured text only.
    occurrence: "first" | "last" | "all"
    """
    if not text:
        return []

    results: list[tuple[int, int, int, int]] = []

    # Use balanced matching for standard bracket pairs if start & end match the pair
    if start in BRACKET_PAIRS and end == BRACKET_PAIRS[start]:
        search_from = 0
        n = len(text)
        while search_from < n:
            s_pos = text.find(start, search_from)
            if s_pos == -1:
                break
            depth = 1
            curr = s_pos + len(start)
            found_e = -1
            while curr < n:
                if text.startswith(start, curr):
                    depth += 1
                    curr += len(start)
                elif text.startswith(end, curr):
                    depth -= 1
                    if depth == 0:
                        found_e = curr
                        break
                    curr += len(end)
                else:
                    curr += 1
            if found_e != -1:
                inner_start = s_pos + len(start)
                inner_end = found_e
                outer_end = found_e + len(end)
                results.append((s_pos, outer_end, inner_start, inner_end))
                search_from = outer_end
            else:
                search_from = s_pos + len(start)
    else:
        search_from = 0
        while True:
            s_pos = text.find(start, search_from)
            if s_pos == -1:
                break
            inner_start = s_pos + len(start)
            e_pos = text.find(end, inner_start)
            if e_pos == -1:
                break
            inner_end = e_pos
            outer_end = e_pos + len(end)
            results.append((s_pos, outer_end, inner_start, inner_end))
            search_from = outer_end

    if not results:
        return []
    if occurrence == "first":
        return [results[0]]
    if occurrence == "last":
        return [results[-1]]
    # "all"
    return results


def _apply_between_symbols(row: dict, rule: dict) -> dict:
    src_key = rule["source_sub_field_key"]
    tgt_key = rule.get("target_sub_field_key")
    start = rule.get("start_symbol", "(")
    end = rule.get("end_symbol", ")")
    occurrence = rule.get("occurrence", "first")
    separator = rule.get("all_separator") or " "
    target_action = rule.get("target_action", "replace")
    remove_from_source = rule.get("remove_from_source", False)
    remove_delimiters_too = rule.get("remove_delimiters_too", True)
    wrap_mode = rule.get("wrap_mode")
    wrap_symbol = rule.get("wrap_symbol")
    wrap_end_symbol = rule.get("wrap_end_symbol")
    output_pattern = rule.get("output_pattern")

    raw = row.get(src_key)
    if raw is None or not isinstance(raw, str):
        return row

    matches = _find_matches(raw, start, end, occurrence)
    if not matches:
        return row

    # Collect extracted text pieces (inner content only, trimmed)
    extracted_pieces = [raw[m[2]:m[3]].strip() for m in matches]
    formatted_pieces = [
        _apply_wrapping_and_pattern(p, row, wrap_mode, wrap_symbol, output_pattern, wrap_end_symbol)
        for p in extracted_pieces
        if p
    ]
    extracted_str = separator.join(p for p in formatted_pieces if p).strip()

    # Write to target if provided
    if tgt_key and extracted_str:
        existing = row.get(tgt_key)
        if target_action == "replace" or existing is None or existing == "":
            row[tgt_key] = extracted_str
        elif target_action == "append":
            row[tgt_key] = (str(existing) + separator + extracted_str) if existing else extracted_str
        elif target_action == "populate_if_empty":
            if not existing and existing != 0:
                row[tgt_key] = extracted_str

    # Remove from source if requested
    if remove_from_source:
        row[src_key] = _remove_spans(raw, matches, remove_delimiters_too)

    return row


def _apply_full_cell_format(row: dict, rule: dict) -> dict:
    src_key = rule["source_sub_field_key"]
    tgt_key = rule.get("target_sub_field_key") or src_key
    target_action = rule.get("target_action", "replace")
    wrap_mode = rule.get("wrap_mode")
    wrap_symbol = rule.get("wrap_symbol")
    wrap_end_symbol = rule.get("wrap_end_symbol")
    output_pattern = rule.get("output_pattern")
    separator = rule.get("all_separator") or " "

    raw = row.get(src_key)
    if raw is None:
        return row

    val_str = str(raw).strip()
    formatted_str = _apply_wrapping_and_pattern(val_str, row, wrap_mode, wrap_symbol, output_pattern, wrap_end_symbol)

    existing = row.get(tgt_key)
    if target_action == "replace" or existing is None or existing == "":
        row[tgt_key] = formatted_str
    elif target_action == "append":
        row[tgt_key] = (str(existing) + separator + formatted_str) if existing else formatted_str
    elif target_action == "populate_if_empty":
        if not existing and existing != 0:
            row[tgt_key] = formatted_str

    return row


def _apply_remove_only(row: dict, rule: dict) -> dict:
    src_key = rule["source_sub_field_key"]
    start = rule.get("start_symbol", "(")
    end = rule.get("end_symbol", ")")
    occurrence = rule.get("occurrence", "first")
    remove_delimiters_too = rule.get("remove_delimiters_too", True)

    raw = row.get(src_key)
    if raw is None or not isinstance(raw, str):
        return row

    matches = _find_matches(raw, start, end, occurrence)
    if not matches:
        return row

    row[src_key] = _remove_spans(raw, matches, remove_delimiters_too)
    return row


def _remove_spans(
    text: str,
    spans: list[tuple[int, int, int, int]],
    remove_delimiters_too: bool,
) -> str:
    """Remove matched spans from text, working right-to-left to preserve indices."""
    result = text
    for outer_s, outer_e, inner_s, inner_e in reversed(spans):
        if remove_delimiters_too:
            result = result[:outer_s] + result[outer_e:]
        else:
            result = result[:inner_s] + result[inner_e:]
    return re.sub(r" +", " ", result).strip()
