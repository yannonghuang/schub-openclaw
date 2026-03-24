"""test

Revision ID: 3081af6e6244
Revises: 78fc60472d59
Create Date: 2025-09-30 16:10:52.481282

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3081af6e6244'
down_revision: Union[str, Sequence[str], None] = '78fc60472d59'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
