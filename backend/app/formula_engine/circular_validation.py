import ast
from typing import Any, Optional


def extract_formula_dependencies(expression: Optional[str]) -> set[str]:
    """Extract subfield keys referenced in the formula expression (as Name nodes or CurrentRow attributes)."""
    if not expression or not expression.strip():
        return set()

    dependencies = set()
    try:
        tree = ast.parse(expression)
    except SyntaxError:
        return dependencies

    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            # Ignore built-in simpleeval functions and common constants
            if node.id not in (
                "SUM", "AVG", "COUNT", "MIN", "MAX", "ROUND",
                "SUM_ITEMS", "AVG_ITEMS", "COUNT_ITEMS", "MIN_ITEMS", "MAX_ITEMS",
                "SUM_ITEMS_WHERE", "AVG_ITEMS_WHERE", "COUNT_ITEMS_WHERE", "MIN_ITEMS_WHERE", "MAX_ITEMS_WHERE",
                "SUM_KPI_ITEMS", "AVG_KPI_ITEMS", "COUNT_KPI_ITEMS", "MIN_KPI_ITEMS", "MAX_KPI_ITEMS",
                "SUM_KPI_ITEMS_WHERE", "AVG_KPI_ITEMS_WHERE", "COUNT_KPI_ITEMS_WHERE", "MIN_KPI_ITEMS_WHERE", "MAX_KPI_ITEMS_WHERE",
                "KPI_FIELD", "CurrentRow",
                "op_eq", "op_neq", "op_gt", "op_gte", "op_lt", "op_lte",
                "op_contains", "op_not_contains", "op_starts_with", "op_ends_with",
                "op_and", "op_or", "eq", "neq", "gt", "gte", "lt", "lte",
                "contains", "not_contains", "starts_with", "ends_with",
                "and", "or"
            ):
                dependencies.add(node.id)
        elif isinstance(node, ast.Attribute):
            if isinstance(node.value, ast.Name) and node.value.id == "CurrentRow":
                dependencies.add(node.attr)

    return dependencies


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
