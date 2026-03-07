"""Drop report_template_domains table (templates no longer attached to domains).

Revision ID: 017_drop_report_template_domains
Revises: 016_time_dimension
Create Date: 2026-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "017_drop_report_template_domains"
down_revision: Union[str, None] = "016_time_dimension"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint("uq_report_template_domain", "report_template_domains", type_="unique")
    op.drop_index("ix_report_template_domains_domain_id", table_name="report_template_domains")
    op.drop_index("ix_report_template_domains_report_template_id", table_name="report_template_domains")
    op.drop_table("report_template_domains")


def downgrade() -> None:
    op.create_table(
        "report_template_domains",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("report_template_id", sa.Integer(), sa.ForeignKey("report_templates.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain_id", sa.Integer(), sa.ForeignKey("domains.id", ondelete="CASCADE"), nullable=False),
    )
    op.create_index("ix_report_template_domains_report_template_id", "report_template_domains", ["report_template_id"], unique=False)
    op.create_index("ix_report_template_domains_domain_id", "report_template_domains", ["domain_id"], unique=False)
    op.create_unique_constraint("uq_report_template_domain", "report_template_domains", ["report_template_id", "domain_id"])
