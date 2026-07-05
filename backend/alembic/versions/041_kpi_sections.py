"""KPI field sections: kpi_sections table + kpi_fields.section_id, backfilled to "General".

Revision ID: 041_kpi_sections
Revises: 040_odoo_integration
Create Date: 2026-07-05
"""

from alembic import op
import sqlalchemy as sa


revision = "041_kpi_sections"
down_revision = "040_odoo_integration"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kpi_sections",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_sections_kpi_id"), "kpi_sections", ["kpi_id"], unique=False)

    op.add_column("kpi_fields", sa.Column("section_id", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_kpi_fields_section_id"), "kpi_fields", ["section_id"], unique=False)
    op.create_foreign_key(
        "fk_kpi_fields_section_id_kpi_sections",
        "kpi_fields",
        "kpi_sections",
        ["section_id"],
        ["id"],
    )

    # Backfill: every KPI that has at least one field gets one "General" section, and every
    # field on that KPI is assigned to it. Existing KPIs keep working with zero manual steps.
    op.execute(
        """
        INSERT INTO kpi_sections (kpi_id, name, sort_order, created_at, updated_at)
        SELECT DISTINCT kpi_id, 'General', 0, now(), now()
        FROM kpi_fields
        WHERE section_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE kpi_fields kf
        SET section_id = ks.id
        FROM kpi_sections ks
        WHERE kf.section_id IS NULL
          AND ks.kpi_id = kf.kpi_id
          AND ks.name = 'General'
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_kpi_fields_section_id_kpi_sections", "kpi_fields", type_="foreignkey")
    op.drop_index(op.f("ix_kpi_fields_section_id"), table_name="kpi_fields")
    op.drop_column("kpi_fields", "section_id")
    op.drop_index(op.f("ix_kpi_sections_kpi_id"), table_name="kpi_sections")
    op.drop_table("kpi_sections")
