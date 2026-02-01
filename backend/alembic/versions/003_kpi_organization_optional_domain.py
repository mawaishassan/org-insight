"""KPI organization_id and optional domain_id.

Revision ID: 003_kpi_org_domain
Revises: 002_categories
Create Date: 2025-01-31

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "003_kpi_org_domain"
down_revision: Union[str, None] = "002_categories"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("kpis", sa.Column("organization_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_kpis_organization_id"), "kpis", ["organization_id"], unique=False)
    # Backfill organization_id from domain
    op.execute(
        """
        UPDATE kpis
        SET organization_id = (SELECT organization_id FROM domains WHERE domains.id = kpis.domain_id)
        WHERE domain_id IS NOT NULL
        """
    )
    op.alter_column(
        "kpis",
        "organization_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_foreign_key(
        "fk_kpis_organization_id",
        "kpis",
        "organizations",
        ["organization_id"],
        ["id"],
        ondelete="CASCADE",
    )
    # Make domain_id nullable and change FK to SET NULL
    op.drop_constraint("kpis_domain_id_fkey", "kpis", type_="foreignkey")
    op.alter_column(
        "kpis",
        "domain_id",
        existing_type=sa.Integer(),
        nullable=True,
    )
    op.create_foreign_key(
        "kpis_domain_id_fkey",
        "kpis",
        "domains",
        ["domain_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("kpis_domain_id_fkey", "kpis", type_="foreignkey")
    op.alter_column(
        "kpis",
        "domain_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.create_foreign_key(
        "kpis_domain_id_fkey",
        "kpis",
        "domains",
        ["domain_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.drop_constraint("fk_kpis_organization_id", "kpis", type_="foreignkey")
    op.drop_index(op.f("ix_kpis_organization_id"), table_name="kpis")
    op.drop_column("kpis", "organization_id")
