"""add can_add to kpi_multi_line_row_access

Revision ID: a7d89774b06e
Revises: 042_odoo_att_template
Create Date: 2026-07-27 15:08:33.145521

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7d89774b06e'
down_revision: Union[str, None] = '042_odoo_att_template'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy.engine import reflection
    conn = op.get_bind()
    inspect_obj = reflection.Inspector.from_engine(conn)
    columns = [c["name"] for c in inspect_obj.get_columns("kpi_multi_line_row_access")]
    if "can_add" not in columns:
        op.add_column(
            "kpi_multi_line_row_access",
            sa.Column("can_add", sa.Boolean(), nullable=False, server_default="1")
        )


def downgrade() -> None:
    from sqlalchemy.engine import reflection
    conn = op.get_bind()
    inspect_obj = reflection.Inspector.from_engine(conn)
    columns = [c["name"] for c in inspect_obj.get_columns("kpi_multi_line_row_access")]
    if "can_add" in columns:
        op.drop_column("kpi_multi_line_row_access", "can_add")
