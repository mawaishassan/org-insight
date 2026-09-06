"""Drop uq_org_unique_user_key unique constraint on users table.

Revision ID: 047_drop_uq_org_unique_user_key
Revises: 046_merge_045_and_a2b3c4d5e6f7
Create Date: 2026-09-06

"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "047_drop_uq_org_unique_user_key"
down_revision: Union[str, Sequence[str], None] = "046_merge_045_and_a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    constraints = [c["name"] for c in insp.get_unique_constraints("users")]
    if "uq_org_unique_user_key" in constraints:
        op.drop_constraint("uq_org_unique_user_key", "users", type_="unique")


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    constraints = [c["name"] for c in insp.get_unique_constraints("users")]
    if "uq_org_unique_user_key" not in constraints:
        op.create_unique_constraint("uq_org_unique_user_key", "users", ["organization_id", "unique_user_key"])
