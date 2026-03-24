"""add name to mcP-registry

Revision ID: be48a8401ff1
Revises: 3081af6e6244
Create Date: 2025-10-05 11:04:07.806108

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'be48a8401ff1'
down_revision: Union[str, Sequence[str], None] = '3081af6e6244'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
