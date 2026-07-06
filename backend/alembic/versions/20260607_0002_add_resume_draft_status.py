"""add resume draft status fields

Revision ID: 20260607_0002
Revises: 20260606_0001
Create Date: 2026-06-07
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260607_0002"
down_revision: str | None = "20260606_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "resume_drafts",
        sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
    )
    op.add_column(
        "resume_drafts",
        sa.Column("parent_draft_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("resume_drafts", sa.Column("change_summary", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_resume_drafts_parent_draft_id",
        "resume_drafts",
        "resume_drafts",
        ["parent_draft_id"],
        ["id"],
    )
    op.alter_column("resume_drafts", "status", server_default=None)


def downgrade() -> None:
    op.drop_constraint("fk_resume_drafts_parent_draft_id", "resume_drafts", type_="foreignkey")
    op.drop_column("resume_drafts", "change_summary")
    op.drop_column("resume_drafts", "parent_draft_id")
    op.drop_column("resume_drafts", "status")
