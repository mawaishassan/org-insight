"""Add template_mode to report_templates for designer vs code rendering.

Revision ID: 019_report_template_mode
Revises: 018_remove_report_template_year
Create Date: 2026-04-20

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "019_report_template_mode"
# NOTE: this migration was added later than other changes; to avoid multiple heads,
# it must be based on the current head revision.
down_revision: Union[str, None] = "032_fieldtype_mixed_list"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_templates",
        sa.Column("template_mode", sa.String(length=20), nullable=False, server_default="designer"),
    )


def downgrade() -> None:
    op.drop_column("report_templates", "template_mode")

