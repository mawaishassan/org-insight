import ast
from typing import Any, Optional


# All built-in formula engine function names — these are never field references.
_BUILTIN_FUNCTIONS = frozenset({
    # Basic aggregations
    "SUM", "AVG", "AVERAGE", "COUNT", "MIN", "MAX", "ROUND",
    # MLI aggregations
    "SUM_ITEMS", "AVG_ITEMS", "AVERAGE_ITEMS", "COUNT_ITEMS", "MIN_ITEMS", "MAX_ITEMS",
    "COUNT_UNIQUE_ITEMS", "UNIQUE_COUNT_ITEMS", "COUNT_DISTINCT_ITEMS",
    # MLI conditional aggregations
    "SUM_ITEMS_WHERE", "AVG_ITEMS_WHERE", "AVERAGE_ITEMS_WHERE",
    "COUNT_ITEMS_WHERE", "MIN_ITEMS_WHERE", "MAX_ITEMS_WHERE",
    "COUNT_UNIQUE_ITEMS_WHERE", "UNIQUE_COUNT_ITEMS_WHERE", "COUNT_DISTINCT_ITEMS_WHERE",
    # Cross-KPI aggregations
    "KPI_FIELD",
    "SUM_KPI_ITEMS", "AVG_KPI_ITEMS", "AVERAGE_KPI_ITEMS",
    "COUNT_KPI_ITEMS", "MIN_KPI_ITEMS", "MAX_KPI_ITEMS",
    "COUNT_UNIQUE_KPI_ITEMS", "UNIQUE_COUNT_KPI_ITEMS", "COUNT_DISTINCT_KPI_ITEMS",
    # Cross-KPI conditional aggregations
    "SUM_KPI_ITEMS_WHERE", "AVG_KPI_ITEMS_WHERE", "AVERAGE_KPI_ITEMS_WHERE",
    "COUNT_KPI_ITEMS_WHERE", "MIN_KPI_ITEMS_WHERE", "MAX_KPI_ITEMS_WHERE",
    "COUNT_UNIQUE_KPI_ITEMS_WHERE", "UNIQUE_COUNT_KPI_ITEMS_WHERE", "COUNT_DISTINCT_KPI_ITEMS_WHERE",
    # Group-by and fetch helpers
    "GROUP_BY", "KPI_GROUP_BY", "GROUP_BY_KPI",
    "FETCH_ITEMS_WHERE", "FETCH_KPI_ITEMS_WHERE",
    "WHERE",
    # Operators
    "op_eq", "op_neq", "op_gt", "op_gte", "op_lt", "op_lte",
    "op_contains", "op_not_contains", "op_starts_with", "op_ends_with",
    "op_and", "op_or",
    "eq", "neq", "gt", "gte", "lt", "lte",
    "contains", "not_contains", "starts_with", "ends_with",
    "and", "or",
    # CurrentRow sentinel
    "CurrentRow",
})

# Cross-KPI function names — their non-first arguments are remote KPI column names,
# not local field references, and must NOT be validated against local fields.
_CROSS_KPI_FUNCTIONS = frozenset({
    "KPI_FIELD",
    "SUM_KPI_ITEMS", "AVG_KPI_ITEMS", "AVERAGE_KPI_ITEMS",
    "COUNT_KPI_ITEMS", "MIN_KPI_ITEMS", "MAX_KPI_ITEMS",
    "COUNT_UNIQUE_KPI_ITEMS", "UNIQUE_COUNT_KPI_ITEMS", "COUNT_DISTINCT_KPI_ITEMS",
    "SUM_KPI_ITEMS_WHERE", "AVG_KPI_ITEMS_WHERE", "AVERAGE_KPI_ITEMS_WHERE",
    "COUNT_KPI_ITEMS_WHERE", "MIN_KPI_ITEMS_WHERE", "MAX_KPI_ITEMS_WHERE",
    "COUNT_UNIQUE_KPI_ITEMS_WHERE", "UNIQUE_COUNT_KPI_ITEMS_WHERE", "COUNT_DISTINCT_KPI_ITEMS_WHERE",
    "KPI_GROUP_BY", "GROUP_BY_KPI",
    "FETCH_KPI_ITEMS_WHERE",
})


def extract_formula_dependencies(expression: Optional[str]) -> set:
    """
    Extract local field keys referenced in the formula expression.

    Returns only true local references — bare Name nodes that are not
    built-in function names, operator tokens, or known formula keywords.
    `CurrentRow.attr` references are included (they refer to local MLI columns).
    """
    if not expression or not expression.strip():
        return set()

    try:
        tree = ast.parse(expression)
    except SyntaxError:
        return set()

    dependencies = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            if node.id not in _BUILTIN_FUNCTIONS:
                dependencies.add(node.id)
        elif isinstance(node, ast.Attribute):
            if isinstance(node.value, ast.Name) and node.value.id == "CurrentRow":
                dependencies.add(node.attr)

    return dependencies


def extract_formula_dependencies_split(expression: Optional[str]) -> tuple[set, set]:
    """
    Split formula dependencies into (local_refs, cross_kpi_refs).

    local_refs   — bare Name nodes NOT inside a cross-KPI function call,
                   plus all CurrentRow.attr references (always local).
    cross_kpi_refs — bare Name nodes that appear as non-kpi_id arguments
                     inside cross-KPI function calls.

    Use this when validating MLI subfield formulas so cross-KPI column names
    are not incorrectly flagged as missing local fields.
    """
    if not expression or not expression.strip():
        return set(), set()

    try:
        tree = ast.parse(expression)
    except SyntaxError:
        return set(), set()

    # Collect all Name node ids that appear as arguments (or within argument subtrees) to cross-KPI calls.
    # These are remote-KPI column names — never validate against local fields.
    cross_kpi_arg_ids: set = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func_name = (
            node.func.id if isinstance(node.func, ast.Name) else
            (node.func.attr if isinstance(node.func, ast.Attribute) else None)
        )
        if func_name not in _CROSS_KPI_FUNCTIONS:
            continue
        # Skip argument 0 (kpi_id — always a number) and argument 1 (mli field key — string literal).
        # From argument 2 onwards: bare Name nodes in arguments or sub-calls are remote column names.
        for arg in node.args[2:]:
            for subnode in ast.walk(arg):
                if isinstance(subnode, ast.Name) and subnode.id not in _BUILTIN_FUNCTIONS:
                    cross_kpi_arg_ids.add(subnode.id)

    local_refs: set = set()
    cross_kpi_refs: set = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            if node.id in _BUILTIN_FUNCTIONS:
                continue
            if node.id in cross_kpi_arg_ids:
                cross_kpi_refs.add(node.id)
            else:
                local_refs.add(node.id)
        elif isinstance(node, ast.Attribute):
            # CurrentRow.attr is always a local MLI column reference
            if isinstance(node.value, ast.Name) and node.value.id == "CurrentRow":
                local_refs.add(node.attr)

    return local_refs, cross_kpi_refs


def validate_mli_circular_dependencies(sub_fields: list[Any]) -> None:
    """
    Validate that sub-field formulas do not contain circular dependencies.
    Raises ValueError with a descriptive message if a loop is detected.
    """
    # 1. Build a dependency map: subfield_key -> set of referenced subfield_keys
    # sub_fields is a list of sub-fields (either Pydantic schemas or SQLAlchemy ORM objects)
    key_to_sub = {}
    dep_map = {}

    for sf in sub_fields:
        sf_key = getattr(sf, "key", None)
        if not sf_key:
            continue
        key_to_sub[sf_key] = sf

        # Resolve config (Pydantic dict vs ORM object)
        cfg = getattr(sf, "config", None)
        if hasattr(cfg, "get"):
            formula_expr = cfg.get("formula_expression")
        elif isinstance(cfg, dict):
            formula_expr = cfg.get("formula_expression")
        else:
            formula_expr = None

        sf_type = getattr(sf, "field_type", None)
        sf_type_s = sf_type.value if hasattr(sf_type, "value") else str(sf_type)

        if sf_type_s == "formula" and formula_expr:
            deps = extract_formula_dependencies(formula_expr)
            dep_map[sf_key] = deps
        else:
            dep_map[sf_key] = set()

    # 2. Check for cycles using DFS
    visited = {}  # key -> status: 0=unvisited, 1=visiting, 2=visited

    def dfs(u: str, path: list[str]) -> None:
        visited[u] = 1
        path.append(u)

        for v in dep_map.get(u, []):
            # Only trace dependencies that are actually columns in this multi-line item
            if v not in key_to_sub:
                continue

            if visited.get(v, 0) == 1:
                # Cycle found! Reconstruct the loop path for a readable error message
                cycle_start_idx = path.index(v)
                cycle_path = path[cycle_start_idx:] + [v]
                loop_str = " -> ".join(cycle_path)
                raise ValueError(f"Circular dependency detected in multi-line subfields: {loop_str}")

            if visited.get(v, 0) == 0:
                dfs(v, path)

        path.pop()
        visited[u] = 2

    for key in dep_map:
        if visited.get(key, 0) == 0:
            dfs(key, [])
