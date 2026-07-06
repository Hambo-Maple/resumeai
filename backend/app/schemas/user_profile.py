from datetime import datetime
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class UserEducationInput(BaseModel):
    school: str | None = None
    degree: str | None = None
    major: str | None = None
    period: str | None = None
    details: list[str] = Field(default_factory=list)


class UserSkillsInput(BaseModel):
    technical: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    domain: list[str] = Field(default_factory=list)
    language: list[str] = Field(default_factory=list)


class UserProfileBase(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=255)
    city: str | None = Field(default=None, max_length=100)
    school: str | None = Field(default=None, max_length=255)
    major: str | None = Field(default=None, max_length=255)
    degree: str | None = Field(default=None, max_length=100)
    graduation: str | None = Field(default=None, max_length=100)
    links: list[str] = Field(default_factory=list)
    skills: UserSkillsInput = Field(default_factory=UserSkillsInput)
    education: list[UserEducationInput] = Field(default_factory=list)
    extra_info: dict[str, Any] = Field(default_factory=dict, alias="extraInfo")


class CreateUserProfileRequest(UserProfileBase):
    pass


class UpdateUserProfileRequest(UserProfileBase):
    pass


class UserProfileResponse(UserProfileBase):
    id: UUID
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class UserExperienceBase(BaseModel):
    type: Literal[
        "internship",
        "project",
        "course",
        "research",
        "competition",
        "campus",
        "volunteer",
        "work",
        "other",
    ] = "other"
    title: str = Field(min_length=1, max_length=255)
    organization: str | None = Field(default=None, max_length=255)
    role: str | None = Field(default=None, max_length=255)
    start_date: str | None = Field(default=None, max_length=50, alias="startDate")
    end_date: str | None = Field(default=None, max_length=50, alias="endDate")
    location: str | None = Field(default=None, max_length=100)
    description: str | None = None
    highlights: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    raw_text: str | None = Field(default=None, alias="rawText")
    extra_info: dict[str, Any] = Field(default_factory=dict, alias="extraInfo")


class CreateUserExperienceRequest(UserExperienceBase):
    pass


class UpdateUserExperienceRequest(UserExperienceBase):
    pass


class UserExperienceResponse(UserExperienceBase):
    id: UUID
    user_profile_id: UUID = Field(alias="userProfileId")
    created_at: datetime = Field(alias="createdAt")
    updated_at: datetime = Field(alias="updatedAt")


class ImportedResumeSource(BaseModel):
    file_name: str = Field(alias="fileName")
    content_type: str | None = Field(default=None, alias="contentType")
    raw_text: str = Field(alias="rawText")


class ImportedResumeResponse(BaseModel):
    profile: CreateUserProfileRequest
    experiences: list[CreateUserExperienceRequest] = Field(default_factory=list)
    source: ImportedResumeSource
    warnings: list[str] = Field(default_factory=list)
