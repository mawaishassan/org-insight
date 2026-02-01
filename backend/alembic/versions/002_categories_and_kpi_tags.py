"""Categories and KPI domain/category tags.

Revision ID: 002_categories
Revises: 001_initial
Create Date: 2025-01-31

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "002_categories"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("domain_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["domain_id"], ["domains.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_categories_id"), "categories", ["id"], unique=False)
    op.create_index(op.f("ix_categories_domain_id"), "categories", ["domain_id"], unique=False)

    op.create_table(
        "kpi_domains",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("domain_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["domain_id"], ["domains.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kpi_id", "domain_id", name="uq_kpi_domain"),
    )
    op.create_index(op.f("ix_kpi_domains_id"), "kpi_domains", ["id"], unique=False)
    op.create_index(op.f("ix_kpi_domains_kpi_id"), "kpi_domains", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_domains_domain_id"), "kpi_domains", ["domain_id"], unique=False)

    op.create_table(
        "kpi_categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("category_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["category_id"], ["categories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kpi_id", "category_id", name="uq_kpi_category"),
    )
    op.create_index(op.f("ix_kpi_categories_id"), "kpi_categories", ["id"], unique=False)
    op.create_index(op.f("ix_kpi_categories_kpi_id"), "kpi_categories", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_categories_category_id"), "kpi_categories", ["category_id"], unique=False)


def downgrade() -> None:
    op.drop_table("kpi_categories")
    op.drop_table("kpi_domains")
    op.drop_table("categories")
