"""add_mli_wrapping_and_pattern_columns

Revision ID: 044_mli_wrapping
Revises: 90934b98afcb
Create Date: 2026-08-24 09:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '044_mli_wrapping'
down_revision: Union[str, None] = '90934b98afcb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to mli_text_extraction_rules
    op.add_column('mli_text_extraction_rules', sa.Column('wrap_mode', sa.String(length=30), nullable=True, server_default='none'))
    op.add_column('mli_text_extraction_rules', sa.Column('wrap_symbol', sa.String(length=50), nullable=True))
    op.add_column('mli_text_extraction_rules', sa.Column('wrap_end_symbol', sa.String(length=50), nullable=True))
    op.add_column('mli_text_extraction_rules', sa.Column('output_pattern', sa.String(length=255), nullable=True))

    # Seed missing symbols into mli_extraction_symbols if not already present
    op.execute("""
        INSERT INTO mli_extraction_symbols (label, value, is_active, sort_order, created_at, updated_at)
        SELECT v.label, v.value, true, v.sort_order, NOW(), NOW()
        FROM (VALUES
            ('Hyphen / Dash',          '-',  130),
            ('Forward Slash',          '/',  140),
            ('Pipe / Vertical bar',    '|',  150),
            ('Colon',                  ':',  160),
            ('Semicolon',              ';',  170),
            ('Comma',                  ',',  180)
        ) AS v(label, value, sort_order)
        WHERE NOT EXISTS (
            SELECT 1 FROM mli_extraction_symbols WHERE value = v.value
        );
    """)


def downgrade() -> None:
    op.drop_column('mli_text_extraction_rules', 'output_pattern')
    op.drop_column('mli_text_extraction_rules', 'wrap_end_symbol')
    op.drop_column('mli_text_extraction_rules', 'wrap_symbol')
    op.drop_column('mli_text_extraction_rules', 'wrap_mode')
