"""Initial schema: organizations, users, domains, kpis, fields, entries, reports.

Revision ID: 001_initial
Revises:
Create Date: 2025-01-31

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_organizations_id"), "organizations", ["id"], unique=False)
    op.create_index(op.f("ix_organizations_name"), "organizations", ["name"], unique=False)

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=True),
        sa.Column("username", sa.String(100), nullable=False),
        sa.Column("email", sa.String(255), nullable=True),
        sa.Column("hashed_password", sa.String(255), nullable=False),
        sa.Column("full_name", sa.String(255), nullable=True),
        sa.Column("role", sa.Enum("SUPER_ADMIN", "ORG_ADMIN", "USER", "REPORT_VIEWER", name="userrole"), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_users_id"), "users", ["id"], unique=False)
    op.create_index(op.f("ix_users_organization_id"), "users", ["organization_id"], unique=False)
    op.create_index(op.f("ix_users_username"), "users", ["username"], unique=False)

    op.create_table(
        "domains",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_domains_id"), "domains", ["id"], unique=False)
    op.create_index(op.f("ix_domains_organization_id"), "domains", ["organization_id"], unique=False)

    op.create_table(
        "kpis",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("domain_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["domain_id"], ["domains.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpis_id"), "kpis", ["id"], unique=False)
    op.create_index(op.f("ix_kpis_domain_id"), "kpis", ["domain_id"], unique=False)
    op.create_index(op.f("ix_kpis_year"), "kpis", ["year"], unique=False)

    op.create_table(
        "kpi_fields",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("key", sa.String(100), nullable=False),
        sa.Column("field_type", sa.Enum("single_line_text", "multi_line_text", "number", "date", "boolean", "multi_line_items", "formula", name="fieldtype"), nullable=False),
        sa.Column("formula_expression", sa.Text(), nullable=True),
        sa.Column("is_required", sa.Boolean(), server_default="false", nullable=True),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=True),
        sa.Column("config", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_fields_id"), "kpi_fields", ["id"], unique=False)
    op.create_index(op.f("ix_kpi_fields_key"), "kpi_fields", ["key"], unique=False)
    op.create_index(op.f("ix_kpi_fields_kpi_id"), "kpi_fields", ["kpi_id"], unique=False)

    op.create_table(
        "kpi_field_options",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("value", sa.String(255), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=True),
        sa.ForeignKeyConstraint(["field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_field_options_field_id"), "kpi_field_options", ["field_id"], unique=False)

    op.create_table(
        "kpi_assignments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "kpi_id", name="uq_user_kpi"),
    )
    op.create_index(op.f("ix_kpi_assignments_kpi_id"), "kpi_assignments", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_assignments_user_id"), "kpi_assignments", ["user_id"], unique=False)

    op.create_table(
        "kpi_entries",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("is_draft", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_locked", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_entries_kpi_id"), "kpi_entries", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_kpi_entries_user_id"), "kpi_entries", ["user_id"], unique=False)
    op.create_index(op.f("ix_kpi_entries_year"), "kpi_entries", ["year"], unique=False)

    op.create_table(
        "kpi_field_values",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("entry_id", sa.Integer(), nullable=False),
        sa.Column("field_id", sa.Integer(), nullable=False),
        sa.Column("value_text", sa.Text(), nullable=True),
        sa.Column("value_number", sa.Float(), nullable=True),
        sa.Column("value_json", sa.JSON(), nullable=True),
        sa.Column("value_boolean", sa.Boolean(), nullable=True),
        sa.Column("value_date", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["entry_id"], ["kpi_entries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_kpi_field_values_entry_id"), "kpi_field_values", ["entry_id"], unique=False)
    op.create_index(op.f("ix_kpi_field_values_field_id"), "kpi_field_values", ["field_id"], unique=False)

    op.create_table(
        "report_templates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_report_templates_id"), "report_templates", ["id"], unique=False)
    op.create_index(op.f("ix_report_templates_organization_id"), "report_templates", ["organization_id"], unique=False)

    op.create_table(
        "report_template_kpis",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("report_template_id", sa.Integer(), nullable=False),
        sa.Column("kpi_id", sa.Integer(), nullable=False),
        sa.Column("include_all_fields", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=True),
        sa.ForeignKeyConstraint(["kpi_id"], ["kpis.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["report_template_id"], ["report_templates.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_report_template_kpis_kpi_id"), "report_template_kpis", ["kpi_id"], unique=False)
    op.create_index(op.f("ix_report_template_kpis_report_template_id"), "report_template_kpis", ["report_template_id"], unique=False)

    op.create_table(
        "report_template_fields",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("report_template_kpi_id", sa.Integer(), nullable=False),
        sa.Column("kpi_field_id", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), server_default="0", nullable=True),
        sa.ForeignKeyConstraint(["kpi_field_id"], ["kpi_fields.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["report_template_kpi_id"], ["report_template_kpis.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_report_template_fields_kpi_field_id"), "report_template_fields", ["kpi_field_id"], unique=False)
    op.create_index(op.f("ix_report_template_fields_report_template_kpi_id"), "report_template_fields", ["report_template_kpi_id"], unique=False)

    op.create_table(
        "report_access_permissions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("report_template_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("can_view", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("can_print", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("can_export", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["report_template_id"], ["report_templates.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("report_template_id", "user_id", name="uq_report_user"),
    )
    op.create_index(op.f("ix_report_access_permissions_report_template_id"), "report_access_permissions", ["report_template_id"], unique=False)
    op.create_index(op.f("ix_report_access_permissions_user_id"), "report_access_permissions", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_table("report_access_permissions")
    op.drop_table("report_template_fields")
    op.drop_table("report_template_kpis")
    op.drop_table("report_templates")
    op.drop_table("kpi_field_values")
    op.drop_table("kpi_entries")
    op.drop_table("kpi_assignments")
    op.drop_table("kpi_field_options")
    op.drop_table("kpi_fields")
    op.drop_table("kpis")
    op.drop_table("domains")
    op.drop_table("users")
    op.drop_table("organizations")
    op.execute("DROP TYPE IF EXISTS userrole")
    op.execute("DROP TYPE IF EXISTS fieldtype")
