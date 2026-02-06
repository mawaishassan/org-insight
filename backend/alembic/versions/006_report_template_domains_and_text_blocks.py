"""Attach report templates to domains; add text blocks.

Revision ID: 007_report_domain
Revises: 006_sub_fields
Create Date: 2026-02-05
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "007_report_domain"
down_revision = "006_sub_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "report_template_domains",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_template_id", sa.Integer(), sa.ForeignKey("report_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain_id", sa.Integer(), sa.ForeignKey("domains.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_report_template_domains_report_template_id", "report_template_domains", ["report_template_id"], unique=False)
    op.create_index("ix_report_template_domains_domain_id", "report_template_domains", ["domain_id"], unique=False)
    op.create_unique_constraint("uq_report_template_domain", "report_template_domains", ["report_template_id", "domain_id"])

    op.create_table(
        "report_template_text_blocks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_template_id", sa.Integer(), sa.ForeignKey("report_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=True),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_report_template_text_blocks_report_template_id", "report_template_text_blocks", ["report_template_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_report_template_text_blocks_report_template_id", table_name="report_template_text_blocks")
    op.drop_table("report_template_text_blocks")

    op.drop_constraint("uq_report_template_domain", "report_template_domains", type_="unique")
    op.drop_index("ix_report_template_domains_domain_id", table_name="report_template_domains")
    op.drop_index("ix_report_template_domains_report_template_id", table_name="report_template_domains")
    op.drop_table("report_template_domains")

