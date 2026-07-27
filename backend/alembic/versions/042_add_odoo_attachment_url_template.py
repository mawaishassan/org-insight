"""add_odoo_attachment_url_template

Revision ID: 042_odoo_att_template
Revises: 51eb58e960bb
Create Date: 2026-07-21
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "042_odoo_att_template"
down_revision: Union[str, None] = "51eb58e960bb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "organization_odoo_configs",
        sa.Column("attachment_url_template", sa.String(length=2048), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("organization_odoo_configs", "attachment_url_template")
