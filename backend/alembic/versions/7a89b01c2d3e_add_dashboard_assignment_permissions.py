"""add_dashboard_assignment_permissions

Revision ID: 7a89b01c2d3e
Revises: 613c7b3398cc
Create Date: 2026-09-02 17:40:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


from sqlalchemy.engine import reflection


# revision identifiers, used by Alembic.
revision: str = '7a89b01c2d3e'
down_revision: Union[str, None] = '613c7b3398cc'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    inspect_obj = reflection.Inspector.from_engine(conn)
    cols = [c["name"] for c in inspect_obj.get_columns("dashboard_access_permissions")]

    # Add new permission and filter configuration columns to dashboard_access_permissions
    if 'can_load_lms' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('can_load_lms', sa.Boolean(), server_default='true', nullable=False))
    if 'can_change_period' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('can_change_period', sa.Boolean(), server_default='true', nullable=False))
    if 'can_use_unique_value' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('can_use_unique_value', sa.Boolean(), server_default='false', nullable=False))
    if 'filter_kpi_id' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('filter_kpi_id', sa.Integer(), nullable=True))
    if 'filter_mli_id' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('filter_mli_id', sa.Integer(), nullable=True))
    if 'filter_sub_field_key' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('filter_sub_field_key', sa.String(length=100), nullable=True))
    if 'filter_column_configs' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('filter_column_configs', sa.JSON(), nullable=True))
    if 'filter_operator' not in cols:
        op.add_column('dashboard_access_permissions', sa.Column('filter_operator', sa.String(length=50), server_default='=', nullable=False))

    fks = [fk.get("name") for fk in inspect_obj.get_foreign_keys("dashboard_access_permissions")]
    if 'fk_dashboard_access_permissions_filter_kpi_id' not in fks:
        op.create_foreign_key('fk_dashboard_access_permissions_filter_kpi_id', 'dashboard_access_permissions', 'kpis', ['filter_kpi_id'], ['id'], ondelete='CASCADE')
    if 'fk_dashboard_access_permissions_filter_mli_id' not in fks:
        op.create_foreign_key('fk_dashboard_access_permissions_filter_mli_id', 'dashboard_access_permissions', 'kpi_fields', ['filter_mli_id'], ['id'], ondelete='CASCADE')

    indexes = [idx.get("name") for idx in inspect_obj.get_indexes("dashboard_access_permissions")]
    if op.f('ix_dashboard_access_permissions_filter_kpi_id') not in indexes:
        op.create_index(op.f('ix_dashboard_access_permissions_filter_kpi_id'), 'dashboard_access_permissions', ['filter_kpi_id'], unique=False)
    if op.f('ix_dashboard_access_permissions_filter_mli_id') not in indexes:
        op.create_index(op.f('ix_dashboard_access_permissions_filter_mli_id'), 'dashboard_access_permissions', ['filter_mli_id'], unique=False)


def downgrade() -> None:
    conn = op.get_bind()
    inspect_obj = reflection.Inspector.from_engine(conn)
    cols = [c["name"] for c in inspect_obj.get_columns("dashboard_access_permissions")]
    fks = [fk.get("name") for fk in inspect_obj.get_foreign_keys("dashboard_access_permissions")]
    indexes = [idx.get("name") for idx in inspect_obj.get_indexes("dashboard_access_permissions")]

    if op.f('ix_dashboard_access_permissions_filter_mli_id') in indexes:
        op.drop_index(op.f('ix_dashboard_access_permissions_filter_mli_id'), table_name='dashboard_access_permissions')
    if op.f('ix_dashboard_access_permissions_filter_kpi_id') in indexes:
        op.drop_index(op.f('ix_dashboard_access_permissions_filter_kpi_id'), table_name='dashboard_access_permissions')

    if 'fk_dashboard_access_permissions_filter_mli_id' in fks:
        op.drop_constraint('fk_dashboard_access_permissions_filter_mli_id', 'dashboard_access_permissions', type_='foreignkey')
    if 'fk_dashboard_access_permissions_filter_kpi_id' in fks:
        op.drop_constraint('fk_dashboard_access_permissions_filter_kpi_id', 'dashboard_access_permissions', type_='foreignkey')

    if 'filter_column_configs' in cols:
        op.drop_column('dashboard_access_permissions', 'filter_column_configs')
    if 'filter_operator' in cols:
        op.drop_column('dashboard_access_permissions', 'filter_operator')
    if 'filter_sub_field_key' in cols:
        op.drop_column('dashboard_access_permissions', 'filter_sub_field_key')
    if 'filter_mli_id' in cols:
        op.drop_column('dashboard_access_permissions', 'filter_mli_id')
    if 'filter_kpi_id' in cols:
        op.drop_column('dashboard_access_permissions', 'filter_kpi_id')
    if 'can_use_unique_value' in cols:
        op.drop_column('dashboard_access_permissions', 'can_use_unique_value')
    if 'can_change_period' in cols:
        op.drop_column('dashboard_access_permissions', 'can_change_period')
    if 'can_load_lms' in cols:
        op.drop_column('dashboard_access_permissions', 'can_load_lms')
