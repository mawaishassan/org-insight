"""Remove year column from report_templates (template is general; year passed at generate time).

Revision ID: 018_remove_report_template_year
Revises: 017_drop_report_template_domains
Create Date: 2026-03-02

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "018_remove_report_template_year"
down_revision: Union[str, None] = "017_drop_report_template_domains"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f("ix_report_templates_year"), table_name="report_templates", if_exists=True)
    op.drop_column("report_templates", "year")


def downgrade() -> None:
    op.add_column("report_templates", sa.Column("year", sa.Integer(), nullable=True))
    op.create_index(op.f("ix_report_templates_year"), "report_templates", ["year"], unique=False)
