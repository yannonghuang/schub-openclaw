"""add system_prompts table

Revision ID: a1b2c3d4e5f6
Revises: 73fa1b603bc5
Create Date: 2026-03-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '73fa1b603bc5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'system_prompts',
        sa.Column('key', sa.String(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('key'),
        if_not_exists=True,
    )


def downgrade() -> None:
    op.drop_table('system_prompts')
