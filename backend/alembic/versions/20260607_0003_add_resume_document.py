"""add resume document

Revision ID: 20260607_0003
Revises: 20260607_0002
Create Date: 2026-06-07
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260607_0003"
down_revision: str | None = "20260607_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("resume_drafts", sa.Column("resume_document", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("resume_drafts", "resume_document")
