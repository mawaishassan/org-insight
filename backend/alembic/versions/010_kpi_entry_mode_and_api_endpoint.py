"""Add KPI entry_mode (manual/api) and api_endpoint_url."""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "010_kpi_entry_mode"
down_revision: Union[str, None] = "009_kpi_entry_org"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "kpis",
        sa.Column("entry_mode", sa.String(20), nullable=False, server_default="manual"),
    )
    op.add_column(
        "kpis",
        sa.Column("api_endpoint_url", sa.String(2048), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("kpis", "api_endpoint_url")
    op.drop_column("kpis", "entry_mode")
