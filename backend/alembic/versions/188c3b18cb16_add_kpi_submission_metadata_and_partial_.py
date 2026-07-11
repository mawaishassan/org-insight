"""add_kpi_submission_metadata_and_partial_indexes

Revision ID: 188c3b18cb16
Revises: 3b2409fe2adf
Create Date: 2026-07-10 09:08:39.578421

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '188c3b18cb16'
down_revision: Union[str, None] = '3b2409fe2adf'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns
    op.add_column("kpi_entries", sa.Column("submitted_by_user_id", sa.Integer(), nullable=True))
    op.add_column("kpi_entries", sa.Column("last_modified_by_user_id", sa.Integer(), nullable=True))
    op.add_column("kpi_entries", sa.Column("last_modified_at", sa.DateTime(), nullable=True))
    op.add_column(
        "kpi_entries",
        sa.Column("is_modified_after_submission", sa.Boolean(), nullable=False, server_default="false"),
    )
    
    # Add foreign keys
    op.create_foreign_key(
        "fk_kpi_entries_submitted_by_user_id",
        "kpi_entries",
        "users",
        ["submitted_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_kpi_entries_last_modified_by_user_id",
        "kpi_entries",
        "users",
        ["last_modified_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    
    # Drop constraint
    op.drop_constraint("uq_kpi_entry_org_kpi_year_period", "kpi_entries", type_="unique")
    
    # Create indexes
    bind = op.get_bind()
    dialect = bind.dialect.name
    if dialect == "postgresql":
        op.create_index(
            "uq_kpi_entry_published",
            "kpi_entries",
            ["organization_id", "kpi_id", "year", "period_key"],
            unique=True,
            postgresql_where=sa.text("is_draft = false"),
        )
        op.create_index(
            "uq_kpi_entry_draft",
            "kpi_entries",
            ["organization_id", "kpi_id", "year", "period_key", "user_id"],
            unique=True,
            postgresql_where=sa.text("is_draft = true"),
        )
    else:
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_entry_published ON kpi_entries (organization_id, kpi_id, year, period_key) WHERE is_draft = 0;"
        )
        op.execute(
            "CREATE UNIQUE INDEX uq_kpi_entry_draft ON kpi_entries (organization_id, kpi_id, year, period_key, user_id) WHERE is_draft = 1;"
        )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    
    # Drop new indexes
    op.drop_index("uq_kpi_entry_published", table_name="kpi_entries")
    op.drop_index("uq_kpi_entry_draft", table_name="kpi_entries")
    
    # Re-create unique constraint
    op.create_unique_constraint(
        "uq_kpi_entry_org_kpi_year_period",
        "kpi_entries",
        ["organization_id", "kpi_id", "year", "period_key"],
    )
    
    # Drop foreign keys and columns
    op.drop_constraint("fk_kpi_entries_submitted_by_user_id", "kpi_entries", type_="foreignkey")
    op.drop_constraint("fk_kpi_entries_last_modified_by_user_id", "kpi_entries", type_="foreignkey")
    op.drop_column("kpi_entries", "is_modified_after_submission")
    op.drop_column("kpi_entries", "last_modified_at")
    op.drop_column("kpi_entries", "last_modified_by_user_id")
    op.drop_column("kpi_entries", "submitted_by_user_id")

