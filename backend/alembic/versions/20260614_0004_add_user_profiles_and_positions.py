"""add user profiles and positions

Revision ID: 20260614_0004
Revises: 20260607_0003
Create Date: 2026-06-14
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260614_0004"
down_revision: str | None = "20260607_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_profiles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=100), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("school", sa.String(length=255), nullable=True),
        sa.Column("major", sa.String(length=255), nullable=True),
        sa.Column("degree", sa.String(length=100), nullable=True),
        sa.Column("graduation", sa.String(length=100), nullable=True),
        sa.Column("links", postgresql.JSONB(), nullable=False),
        sa.Column("skills", postgresql.JSONB(), nullable=False),
        sa.Column("education", postgresql.JSONB(), nullable=False),
        sa.Column("extra_info", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_table(
        "user_experiences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_profiles.id"),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("organization", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=255), nullable=True),
        sa.Column("start_date", sa.String(length=50), nullable=True),
        sa.Column("end_date", sa.String(length=50), nullable=True),
        sa.Column("location", sa.String(length=100), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("highlights", postgresql.JSONB(), nullable=False),
        sa.Column("metrics", postgresql.JSONB(), nullable=False),
        sa.Column("skills", postgresql.JSONB(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=True),
        sa.Column("extra_info", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "idx_user_experiences_user_profile_id",
        "user_experiences",
        ["user_profile_id"],
    )
    op.create_table(
        "position_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_profile_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_profiles.id"),
            nullable=True,
        ),
        sa.Column("company", sa.String(length=255), nullable=True),
        sa.Column("position", sa.String(length=255), nullable=False),
        sa.Column("industry", sa.String(length=100), nullable=True),
        sa.Column("city", sa.String(length=100), nullable=True),
        sa.Column("job_description", sa.Text(), nullable=True),
        sa.Column("source_url", sa.String(length=1000), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("keywords", postgresql.JSONB(), nullable=False),
        sa.Column("requirements", postgresql.JSONB(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("extra_info", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index("idx_position_targets_user_profile_id", "position_targets", ["user_profile_id"])
    op.create_index("idx_position_targets_status", "position_targets", ["status"])


def downgrade() -> None:
    op.drop_index("idx_position_targets_status", table_name="position_targets")
    op.drop_index("idx_position_targets_user_profile_id", table_name="position_targets")
    op.drop_table("position_targets")
    op.drop_index("idx_user_experiences_user_profile_id", table_name="user_experiences")
    op.drop_table("user_experiences")
    op.drop_table("user_profiles")
