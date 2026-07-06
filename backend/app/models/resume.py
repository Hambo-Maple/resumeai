import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class ResumeTask(Base):
    __tablename__ = "resume_tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(50), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class JobTarget(Base):
    __tablename__ = "job_targets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_tasks.id"))
    company: Mapped[str] = mapped_column(String(255))
    position: Mapped[str] = mapped_column(String(255))
    job_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(50))
    keywords: Mapped[list[str]] = mapped_column(JSONB, default=list)
    resume_focus: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CoreAbility(Base):
    __tablename__ = "core_abilities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("job_targets.id"))
    name: Mapped[str] = mapped_column(String(255))
    importance: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(Text)
    evidence_suggestions: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Experience(Base):
    __tablename__ = "experiences"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_tasks.id"))
    type: Mapped[str] = mapped_column(String(50), default="other")
    title: Mapped[str] = mapped_column(String(255))
    organization: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[str | None] = mapped_column(String(255), nullable=True)
    background: Mapped[str | None] = mapped_column(Text, nullable=True)
    actions: Mapped[list[str]] = mapped_column(JSONB, default=list)
    results: Mapped[list[str]] = mapped_column(JSONB, default=list)
    metrics: Mapped[list[str]] = mapped_column(JSONB, default=list)
    matched_abilities: Mapped[list[str]] = mapped_column(JSONB, default=list)
    missing_info_questions: Mapped[list[str]] = mapped_column(JSONB, default=list)
    raw_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ResumeDraft(Base):
    __tablename__ = "resume_drafts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_tasks.id"))
    job_target_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("job_targets.id"))
    summary: Mapped[str] = mapped_column(Text)
    sections: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    skills: Mapped[list[str]] = mapped_column(JSONB, default=list)
    resume_document: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    language: Mapped[str] = mapped_column(String(10), default="zh")
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    parent_draft_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resume_drafts.id"), nullable=True
    )
    change_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Evaluation(Base):
    __tablename__ = "evaluations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_tasks.id"))
    resume_draft_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("resume_drafts.id"))
    overall_score: Mapped[int] = mapped_column(Integer)
    dimensions: Mapped[list[dict]] = mapped_column(JSONB, default=list)
    strengths: Mapped[list[str]] = mapped_column(JSONB, default=list)
    weaknesses: Mapped[list[str]] = mapped_column(JSONB, default=list)
    suggestions: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
