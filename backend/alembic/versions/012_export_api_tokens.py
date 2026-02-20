"""Add export_api_tokens for long-lived data-export API tokens.

Revision ID: 012_export_api_tokens
Revises: 011_assignment_type
Create Date: 2025-02-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "012_export_api_tokens"
down_revision: Union[str, None] = "011_assignment_type"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "export_api_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_export_api_tokens_organization_id"), "export_api_tokens", ["organization_id"], unique=False)
    op.create_index(op.f("ix_export_api_tokens_token_hash"), "export_api_tokens", ["token_hash"], unique=True)
    op.create_index(op.f("ix_export_api_tokens_expires_at"), "export_api_tokens", ["expires_at"], unique=False)
    op.create_index(op.f("ix_export_api_tokens_created_by_user_id"), "export_api_tokens", ["created_by_user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_export_api_tokens_created_by_user_id"), table_name="export_api_tokens")
    op.drop_index(op.f("ix_export_api_tokens_expires_at"), table_name="export_api_tokens")
    op.drop_index(op.f("ix_export_api_tokens_token_hash"), table_name="export_api_tokens")
    op.drop_index(op.f("ix_export_api_tokens_organization_id"), table_name="export_api_tokens")
    op.drop_table("export_api_tokens")
