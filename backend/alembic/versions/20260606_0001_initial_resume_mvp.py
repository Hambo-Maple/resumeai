"""initial resume mvp

Revision ID: 20260606_0001
Revises:
Create Date: 2026-06-06
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "20260606_0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "resume_tasks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "job_targets",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_tasks.id"), nullable=False),
        sa.Column("company", sa.String(length=255), nullable=False),
        sa.Column("position", sa.String(length=255), nullable=False),
        sa.Column("job_description", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=50), nullable=False),
        sa.Column("keywords", postgresql.JSONB(), nullable=False),
        sa.Column("resume_focus", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "core_abilities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_target_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("job_targets.id"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("importance", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("evidence_suggestions", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "experiences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_tasks.id"), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("organization", sa.String(length=255), nullable=True),
        sa.Column("role", sa.String(length=255), nullable=True),
        sa.Column("background", sa.Text(), nullable=True),
        sa.Column("actions", postgresql.JSONB(), nullable=False),
        sa.Column("results", postgresql.JSONB(), nullable=False),
        sa.Column("metrics", postgresql.JSONB(), nullable=False),
        sa.Column("matched_abilities", postgresql.JSONB(), nullable=False),
        sa.Column("missing_info_questions", postgresql.JSONB(), nullable=False),
        sa.Column("raw_text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "resume_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_tasks.id"), nullable=False),
        sa.Column("job_target_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("job_targets.id"), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("sections", postgresql.JSONB(), nullable=False),
        sa.Column("skills", postgresql.JSONB(), nullable=False),
        sa.Column("language", sa.String(length=10), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "evaluations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_tasks.id"), nullable=False),
        sa.Column("resume_draft_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("resume_drafts.id"), nullable=False),
        sa.Column("overall_score", sa.Integer(), nullable=False),
        sa.Column("dimensions", postgresql.JSONB(), nullable=False),
        sa.Column("strengths", postgresql.JSONB(), nullable=False),
        sa.Column("weaknesses", postgresql.JSONB(), nullable=False),
        sa.Column("suggestions", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "prompt_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("task_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("module", sa.String(length=50), nullable=False),
        sa.Column("prompt_name", sa.String(length=100), nullable=False),
        sa.Column("prompt_version", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("input", postgresql.JSONB(), nullable=False),
        sa.Column("rendered_prompt", sa.Text(), nullable=False),
        sa.Column("output", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("token_input", sa.Integer(), nullable=True),
        sa.Column("token_output", sa.Integer(), nullable=True),
        sa.Column("cost_estimate", sa.Numeric(10, 6), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("idx_prompt_runs_task_id", "prompt_runs", ["task_id"])
    op.create_index("idx_prompt_runs_prompt", "prompt_runs", ["module", "prompt_name", "prompt_version"])
    op.create_index("idx_prompt_runs_created_at", "prompt_runs", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_prompt_runs_created_at", table_name="prompt_runs")
    op.drop_index("idx_prompt_runs_prompt", table_name="prompt_runs")
    op.drop_index("idx_prompt_runs_task_id", table_name="prompt_runs")
    op.drop_table("prompt_runs")
    op.drop_table("evaluations")
    op.drop_table("resume_drafts")
    op.drop_table("experiences")
    op.drop_table("core_abilities")
    op.drop_table("job_targets")
    op.drop_table("resume_tasks")
