"""add_odoo_endpoints_table_and_kpi_odoo_config_endpoint_id

Revision ID: 043_odoo_endpoints
Revises: 64807081ec44
Create Date: 2026-08-13 11:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "043_odoo_endpoints"
down_revision = "64807081ec44"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create odoo_endpoints table
    op.create_table(
        "odoo_endpoints",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("url", sa.String(length=2048), nullable=False),
        sa.Column("description", sa.String(length=1024), nullable=True),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_odoo_endpoints_id"), "odoo_endpoints", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_odoo_endpoints_organization_id"),
        "odoo_endpoints",
        ["organization_id"],
        unique=False,
    )

    # 2. Add odoo_endpoint_id column to kpi_odoo_configs
    op.add_column(
        "kpi_odoo_configs",
        sa.Column("odoo_endpoint_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        op.f("ix_kpi_odoo_configs_odoo_endpoint_id"),
        "kpi_odoo_configs",
        ["odoo_endpoint_id"],
        unique=False,
    )
    op.create_foreign_key(
        "fk_kpi_odoo_configs_odoo_endpoint_id",
        "kpi_odoo_configs",
        "odoo_endpoints",
        ["odoo_endpoint_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_kpi_odoo_configs_odoo_endpoint_id",
        "kpi_odoo_configs",
        type_="foreignkey",
    )
    op.drop_index(
        op.f("ix_kpi_odoo_configs_odoo_endpoint_id"),
        table_name="kpi_odoo_configs",
    )
    op.drop_column("kpi_odoo_configs", "odoo_endpoint_id")
    op.drop_index(op.f("ix_odoo_endpoints_organization_id"), table_name="odoo_endpoints")
    op.drop_index(op.f("ix_odoo_endpoints_id"), table_name="odoo_endpoints")
    op.drop_table("odoo_endpoints")
