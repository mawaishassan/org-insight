"""Add body_template column to report_templates for rich HTML layouts.

Revision ID: 008_report_body_template
Revises: 007_report_domain
Create Date: 2026-02-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "008_report_body_template"
down_revision: Union[str, None] = "007_report_domain"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("report_templates", sa.Column("body_template", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("report_templates", "body_template")

