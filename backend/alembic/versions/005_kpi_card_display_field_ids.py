"""Add card_display_field_ids to KPIs for domain card preview.

Revision ID: 005_card_display
Revises: 004_org_tags
Create Date: 2025-01-31

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "005_card_display"
down_revision: Union[str, None] = "004_org_tags"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("kpis", sa.Column("card_display_field_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("kpis", "card_display_field_ids")
