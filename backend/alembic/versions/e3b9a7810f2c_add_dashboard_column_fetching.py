"""add_dashboard_column_fetching

Revision ID: e3b9a7810f2c
Revises: 78c3f842f1da
Create Date: 2026-09-02 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine import reflection


# revision identifiers, used by Alembic.
revision: str = 'e3b9a7810f2c'
down_revision: Union[str, None] = '78c3f842f1da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspect_obj = reflection.Inspector.from_engine(conn)
    cols = [c["name"] for c in inspect_obj.get_columns("dashboards")]
    
    if "fetch_data_with_column" not in cols:
        op.add_column(
            "dashboards",
            sa.Column("fetch_data_with_column", sa.Boolean(), nullable=False, server_default="false")
        )
    if "column_fetching_config" not in cols:
        op.add_column(
            "dashboards",
            sa.Column("column_fetching_config", sa.JSON(), nullable=True)
        )


def downgrade() -> None:
    conn = op.get_bind()
    inspect_obj = reflection.Inspector.from_engine(conn)
    cols = [c["name"] for c in inspect_obj.get_columns("dashboards")]
    
    if "column_fetching_config" in cols:
        op.drop_column("dashboards", "column_fetching_config")
    if "fetch_data_with_column" in cols:
        op.drop_column("dashboards", "fetch_data_with_column")
