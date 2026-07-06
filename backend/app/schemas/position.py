from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class PositionTargetBase(BaseModel):
    user_profile_id: UUID | None = Field(default=None, alias="userProfileId")
    company: str | None = Field(default=None, max_length=255)
    position: str = Field(min_length=1, max_length=255)
    industry: str | None = Field(default=None, max_length=100)
    city: str | None = Field(default=None, max_length=100)
    job_description: str | None = Field(default=None, alias="jobDescription")
    source_url: str | None = Field(default=None, max_length=1000, alias="sourceUrl")
    status: Literal["interested", "applied", "interviewing", "offered", "rejected", "closed"] = (
        "interested"
    )
    keywords: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    notes: str | None = None
    extra_info: dict[str, Any] = Field(default_factory=dict, alias="extraInfo")


class CreatePositionTargetRequest(PositionTargetBase):
    pass


class UpdatePositionTargetRequest(PositionTargetBase):
    pass


class PositionTargetResponse(PositionTargetBase):
    id: UUID
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")
