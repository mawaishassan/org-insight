"""Odoo integration tables.

Revision ID: 040_odoo_integration
Revises: 039_chat_nl
Create Date: 2026-05-24
"""

from alembic import op
import sqlalchemy as sa


revision = "040_odoo_integration"
down_revision = "039_chat_nl"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "organization_odoo_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("login_url", sa.String(length=2048), nullable=False),
        sa.Column("data_fetch_url", sa.String(length=2048), nullable=False),
        sa.Column("odoo_db", sa.String(length=255), nullable=True),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("password", sa.String(length=512), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_org_odoo_config_org_id"),
    )
    op.create_index(
        op.f("ix_organization_odoo_configs_organization_id"),
        "organization_odoo_configs",
        ["organization_id"],
        unique=False,
    )

    op.create_table(
        "kpi_odoo_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("request_body", sa.JSON(), nullable=False),
        sa.Column("response_items_path", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kpi_id", name="uq_kpi_odoo_config_kpi_id"),
    )
    op.create_index(op.f("ix_kpi_odoo_configs_kpi_id"), "kpi_odoo_configs", ["kpi_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_kpi_odoo_configs_kpi_id"), table_name="kpi_odoo_configs")
    op.drop_table("kpi_odoo_configs")
    op.drop_index(op.f("ix_organization_odoo_configs_organization_id"), table_name="organization_odoo_configs")
    op.drop_table("organization_odoo_configs")
