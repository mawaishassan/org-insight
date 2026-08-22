"""make_kpi_odoo_config_request_body_nullable

Revision ID: 64bb32f296e8
Revises: 898d8a7a1470
Create Date: 2026-08-21 20:04:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '64bb32f296e8'
down_revision: Union[str, None] = '898d8a7a1470'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column('kpi_odoo_configs', 'request_body',
               existing_type=sa.JSON(),
               nullable=True)


def downgrade() -> None:
    op.alter_column('kpi_odoo_configs', 'request_body',
               existing_type=sa.JSON(),
               nullable=False)
