"""Organization tags and KPI-organization_tag link.

Revision ID: 004_org_tags
Revises: 003_kpi_org_domain
Create Date: 2025-01-31

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "004_org_tags"
down_revision: Union[str, None] = "003_kpi_org_domain"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organization_tags",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", name="uq_org_tag_name"),
    )
    op.create_index(op.f("ix_organization_tags_id"), "organization_tags", ["id"], unique=False)
    op.create_index(op.f("ix_organization_tags_organization_id"), "organization_tags", ["organization_id"], unique=False)

    op.create_table(
        "kpi_organization_tags",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("organization_tag_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_tag_id"], ["organization_tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kpi_id", "organization_tag_id", name="uq_kpi_org_tag"),
    )
    op.create_index(op.f("ix_kpi_organization_tags_id"), "kpi_organization_tags", ["id"], unique=False)
    op.create_index(op.f("ix_kpi_organization_tags_kpi_id"), "kpi_organization_tags", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_organization_tags_organization_tag_id"), "kpi_organization_tags", ["organization_tag_id"], unique=False)


def downgrade() -> None:
    op.drop_table("kpi_organization_tags")
    op.drop_table("organization_tags")
