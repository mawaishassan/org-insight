"""Relational storage for multi_line_items rows/cells (backfill from legacy JSON arrays).

Revision ID: 033_ml_items_rel_storage
Revises: 032_fieldtype_mixed_list
Create Date: 2026-04-23

"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "033_ml_items_rel_storage"
down_revision: Union[str, None] = "032_fieldtype_mixed_list"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _as_bool(v: Any) -> bool | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        if v == 1:
            return True
        if v == 0:
            return False
    if isinstance(v, str):
        s = v.strip().lower()
        if s in ("true", "yes", "y", "1"):
            return True
        if s in ("false", "no", "n", "0"):
            return False
    return None


def _as_float(v: Any) -> float | None:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        try:
            return float(s)
        except Exception:
            return None
    return None


def _as_datetime(v: Any) -> datetime | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v
    if isinstance(v, str):
        s = v.strip()
        if not s:
            return None
        # Try ISO first; if it fails keep it as text in value_text.
        try:
            return datetime.fromisoformat(s)
        except Exception:
            return None
    return None


def upgrade() -> None:
    op.create_table(
        "kpi_multi_line_rows",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("row_index", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["entry_id"], ["kpi_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("entry_id", "field_id", "row_index", name="uq_kpi_multi_line_rows_entry_field_row_index"),
    )
    op.create_index(
        "ix_kpi_multi_line_rows_entry_field_row_index",
        "kpi_multi_line_rows",
        ["entry_id", "field_id", "row_index"],
        unique=False,
    )
    op.create_index(op.f("ix_kpi_multi_line_rows_entry_id"), "kpi_multi_line_rows", ["entry_id"], unique=False)
    op.create_index(op.f("ix_kpi_multi_line_rows_field_id"), "kpi_multi_line_rows", ["field_id"], unique=False)

    op.create_table(
        "kpi_multi_line_cells",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
        sa.Column("row_id", sa.Integer(), nullable=False),
        sa.Column("sub_field_id", sa.Integer(), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_number", sa.Float(), nullable=True),
        sa.Column("value_json", sa.JSON(), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column("value_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["row_id"], ["kpi_multi_line_rows.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sub_field_id"], ["kpi_field_sub_fields.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("row_id", "sub_field_id", name="uq_kpi_multi_line_cells_row_sub_field"),
    )
    op.create_index(op.f("ix_kpi_multi_line_cells_row_id"), "kpi_multi_line_cells", ["row_id"], unique=False)
    op.create_index(
        "ix_kpi_multi_line_cells_row_sub_field",
        "kpi_multi_line_cells",
        ["row_id", "sub_field_id"],
        unique=False,
    )
    op.create_index(op.f("ix_kpi_multi_line_cells_sub_field_id"), "kpi_multi_line_cells", ["sub_field_id"], unique=False)

    bind = op.get_bind()
    meta = sa.MetaData()

    # Lightweight table declarations for migration-time queries/inserts.
    kpi_fields = sa.Table(
        "kpi_fields",
        meta,
        sa.Column("id", sa.Integer()),
        sa.Column("field_type", sa.String()),
    )
    field_values = sa.Table(
        "kpi_field_values",
        meta,
        sa.Column("id", sa.Integer()),
        sa.Column("entry_id", sa.Integer()),
        sa.Column("field_id", sa.Integer()),
        sa.Column("value_json", sa.JSON()),
    )
    sub_fields = sa.Table(
        "kpi_field_sub_fields",
        meta,
        sa.Column("id", sa.Integer()),
        sa.Column("field_id", sa.Integer()),
        sa.Column("key", sa.String()),
        sa.Column("field_type", sa.String()),
    )
    ml_rows = sa.Table(
        "kpi_multi_line_rows",
        meta,
        sa.Column("id", sa.Integer()),
        sa.Column("entry_id", sa.Integer()),
        sa.Column("field_id", sa.Integer()),
        sa.Column("row_index", sa.Integer()),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )
    ml_cells = sa.Table(
        "kpi_multi_line_cells",
        meta,
        sa.Column("id", sa.Integer()),
        sa.Column("row_id", sa.Integer()),
        sa.Column("sub_field_id", sa.Integer()),
        sa.Column("value_text", sa.Text()),
        sa.Column("value_number", sa.Float()),
        sa.Column("value_json", sa.JSON()),
        sa.Column("value_boolean", sa.Boolean()),
        sa.Column("value_date", sa.DateTime()),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )

    # Build (field_id -> key -> (sub_field_id, field_type_string))
    sub_res = bind.execute(sa.select(sub_fields.c.id, sub_fields.c.field_id, sub_fields.c.key, sub_fields.c.field_type))
    sub_map: dict[int, dict[str, tuple[int, str]]] = {}
    for sid, fid, key, ft in sub_res.fetchall():
        if fid is None or not key:
            continue
        sub_map.setdefault(int(fid), {})[str(key)] = (int(sid), str(ft) if ft is not None else "single_line_text")

    # Select legacy multi_line_items values.
    # kpi_fields.field_type is a Postgres enum (`fieldtype`), so cast the literal explicitly.
    legacy = bind.execute(
        sa.text(
            "SELECT fv.entry_id, fv.field_id, fv.value_json "
            "FROM kpi_field_values fv "
            "JOIN kpi_fields f ON f.id = fv.field_id "
            "WHERE f.field_type = 'multi_line_items'::fieldtype"
        )
    )

    now = datetime.utcnow()

    for entry_id, field_id, value_json in legacy.fetchall():
        if entry_id is None or field_id is None:
            continue
        # Skip if already migrated (idempotency for reruns).
        existing_cnt = bind.execute(
            sa.select(sa.func.count()).select_from(ml_rows).where(
                ml_rows.c.entry_id == int(entry_id),
                ml_rows.c.field_id == int(field_id),
            )
        ).scalar()
        if existing_cnt and int(existing_cnt) > 0:
            continue

        rows = value_json
        # value_json may come as a string; attempt to parse.
        if isinstance(rows, str):
            try:
                rows = json.loads(rows)
            except Exception:
                rows = None
        if not isinstance(rows, list) or not rows:
            continue

        # Insert ml rows and capture ids
        row_id_by_index: dict[int, int] = {}
        for idx, row in enumerate(rows):
            ins = ml_rows.insert().values(
                entry_id=int(entry_id),
                field_id=int(field_id),
                row_index=int(idx),
                created_at=now,
                updated_at=now,
            ).returning(ml_rows.c.id)
            rid = bind.execute(ins).scalar()
            if rid is None:
                continue
            row_id_by_index[int(idx)] = int(rid)

        # Insert cells
        key_map = sub_map.get(int(field_id), {})
        cell_inserts: list[dict[str, Any]] = []
        for idx, row in enumerate(rows):
            rid = row_id_by_index.get(int(idx))
            if rid is None:
                continue
            if not isinstance(row, dict):
                continue
            for k, raw in row.items():
                if k not in key_map:
                    continue
                sub_id, ft = key_map[k]
                payload: dict[str, Any] = {
                    "row_id": rid,
                    "sub_field_id": sub_id,
                    "value_text": None,
                    "value_number": None,
                    "value_json": None,
                    "value_boolean": None,
                    "value_date": None,
                    "created_at": now,
                    "updated_at": now,
                }
                ft_s = (ft or "").strip()
                if ft_s in ("number",):
                    payload["value_number"] = _as_float(raw)
                    if payload["value_number"] is None and raw is not None:
                        payload["value_text"] = str(raw)
                elif ft_s in ("boolean",):
                    payload["value_boolean"] = _as_bool(raw)
                    if payload["value_boolean"] is None and raw is not None:
                        payload["value_text"] = str(raw)
                elif ft_s in ("date",):
                    dt = _as_datetime(raw)
                    if dt is not None:
                        payload["value_date"] = dt
                    elif raw is not None:
                        payload["value_text"] = str(raw)
                elif ft_s in ("mixed_list", "multi_reference"):
                    # Preserve raw complex payload.
                    payload["value_json"] = raw
                    if isinstance(raw, str):
                        payload["value_text"] = raw
                elif ft_s in ("reference", "attachment"):
                    # Keep reference/attachment payloads as json when structured; otherwise text.
                    if isinstance(raw, (dict, list)):
                        payload["value_json"] = raw
                    elif raw is not None:
                        payload["value_text"] = str(raw)
                else:
                    if isinstance(raw, (dict, list)):
                        payload["value_json"] = raw
                    elif raw is not None:
                        payload["value_text"] = str(raw)
                cell_inserts.append(payload)

        if cell_inserts:
            bind.execute(ml_cells.insert(), cell_inserts)


def downgrade() -> None:
    op.drop_index(op.f("ix_kpi_multi_line_cells_sub_field_id"), table_name="kpi_multi_line_cells")
    op.drop_index("ix_kpi_multi_line_cells_row_sub_field", table_name="kpi_multi_line_cells")
    op.drop_index(op.f("ix_kpi_multi_line_cells_row_id"), table_name="kpi_multi_line_cells")
    op.drop_table("kpi_multi_line_cells")

    op.drop_index(op.f("ix_kpi_multi_line_rows_field_id"), table_name="kpi_multi_line_rows")
    op.drop_index(op.f("ix_kpi_multi_line_rows_entry_id"), table_name="kpi_multi_line_rows")
    op.drop_index("ix_kpi_multi_line_rows_entry_field_row_index", table_name="kpi_multi_line_rows")
    op.drop_table("kpi_multi_line_rows")

