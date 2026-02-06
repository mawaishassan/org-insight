"""One KPI entry per organization per KPI per year.

- Add organization_id to kpi_entries, backfill from kpis, dedupe, then NOT NULL.
- Make user_id nullable (FK ondelete=SET NULL).
- Add unique constraint (organization_id, kpi_id, year).
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "009_kpi_entry_org"
down_revision: Union[str, None] = "008_report_body_template"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add organization_id nullable
    op.add_column(
        "kpi_entries",
        sa.Column("organization_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f("ix_kpi_entries_organization_id"),
        "kpi_entries",
        ["organization_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_kpi_entries_organization_id",
        "kpi_entries",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )

    # 2. Backfill organization_id from kpis
    op.execute(
        """
        UPDATE kpi_entries e
        SET organization_id = (SELECT organization_id FROM kpis WHERE kpis.id = e.kpi_id)
        WHERE e.organization_id IS NULL
        """
    )

    # 3. Dedupe: for each (organization_id, kpi_id, year) keep one entry, move field_values to it
    conn = op.get_bind()
    dupes = conn.execute(
        sa.text("""
            SELECT organization_id, kpi_id, year, array_agg(id ORDER BY submitted_at NULLS LAST, id) AS ids
            FROM kpi_entries
            WHERE organization_id IS NOT NULL
            GROUP BY organization_id, kpi_id, year
            HAVING count(*) > 1
        """)
    ).fetchall()

    for row in dupes:
        org_id, kpi_id, year, ids = row[0], row[1], row[2], row[3]
        if not ids or len(ids) < 2:
            continue
        keeper_id = ids[0]
        duplicate_ids = list(ids[1:])
        # Move field_values from duplicates to keeper only when keeper has no value for that field_id
        conn.execute(
            sa.text("""
                UPDATE kpi_field_values fv
                SET entry_id = :keeper
                WHERE fv.entry_id = ANY(:dupes)
                AND NOT EXISTS (
                    SELECT 1 FROM kpi_field_values k
                    WHERE k.entry_id = :keeper AND k.field_id = fv.field_id
                )
            """),
            {"keeper": keeper_id, "dupes": duplicate_ids},
        )
        conn.execute(
            sa.text("DELETE FROM kpi_entries WHERE id = ANY(:dupes)"),
            {"dupes": duplicate_ids},
        )

    # 4. Set organization_id NOT NULL
    op.alter_column(
        "kpi_entries",
        "organization_id",
        existing_type=sa.Integer(),
        nullable=False,
    )

    # 5. user_id: drop FK, make nullable, re-add FK with SET NULL
    op.drop_constraint("kpi_entries_user_id_fkey", "kpi_entries", type_="foreignkey")
    op.alter_column(
        "kpi_entries",
        "user_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.create_foreign_key(
        "kpi_entries_user_id_fkey",
        "kpi_entries",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # 6. Unique constraint
    op.create_unique_constraint(
        "uq_kpi_entry_org_kpi_year",
        "kpi_entries",
        ["organization_id", "kpi_id", "year"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_kpi_entry_org_kpi_year", "kpi_entries", type_="unique")
    op.drop_constraint("kpi_entries_user_id_fkey", "kpi_entries", type_="foreignkey")
    op.alter_column(
        "kpi_entries",
        "user_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_foreign_key(
        "kpi_entries_user_id_fkey",
        "kpi_entries",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("fk_kpi_entries_organization_id", "kpi_entries", type_="foreignkey")
    op.drop_index(op.f("ix_kpi_entries_organization_id"), table_name="kpi_entries")
    op.drop_column("kpi_entries", "organization_id")
