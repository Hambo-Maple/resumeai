from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.position import PositionTarget
from app.models.user_profile import UserExperience, UserProfile
from app.schemas.user_profile import (
    CreateUserExperienceRequest,
    CreateUserProfileRequest,
    UpdateUserExperienceRequest,
    UpdateUserProfileRequest,
    UserExperienceResponse,
    UserProfileResponse,
)


class UserProfileService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_profile(self, payload: CreateUserProfileRequest) -> UserProfileResponse:
        profile = UserProfile(**payload.model_dump(by_alias=False))
        self.db.add(profile)
        self.db.commit()
        self.db.refresh(profile)
        return self._profile_response(profile)

    def list_profiles(self) -> list[UserProfileResponse]:
        profiles = self.db.query(UserProfile).order_by(UserProfile.created_at.desc()).all()
        return [self._profile_response(profile) for profile in profiles]

    def get_profile(self, profile_id: UUID) -> UserProfileResponse:
        return self._profile_response(self._get_profile_model(profile_id))

    def update_profile(
        self, profile_id: UUID, payload: UpdateUserProfileRequest
    ) -> UserProfileResponse:
        profile = self._get_profile_model(profile_id)
        for key, value in payload.model_dump(by_alias=False).items():
            setattr(profile, key, value)
        self.db.commit()
        self.db.refresh(profile)
        return self._profile_response(profile)

    def delete_profile(self, profile_id: UUID) -> dict[str, bool]:
        profile = self._get_profile_model(profile_id)
        self.db.query(UserExperience).filter(UserExperience.user_profile_id == profile_id).delete()
        (
            self.db.query(PositionTarget)
            .filter(PositionTarget.user_profile_id == profile_id)
            .update({"user_profile_id": None})
        )
        self.db.delete(profile)
        self.db.commit()
        return {"deleted": True}

    def create_experience(
        self, profile_id: UUID, payload: CreateUserExperienceRequest
    ) -> UserExperienceResponse:
        self._get_profile_model(profile_id)
        experience = UserExperience(
            user_profile_id=profile_id,
            **payload.model_dump(by_alias=False),
        )
        self.db.add(experience)
        self.db.commit()
        self.db.refresh(experience)
        return self._experience_response(experience)

    def list_experiences(self, profile_id: UUID) -> list[UserExperienceResponse]:
        self._get_profile_model(profile_id)
        experiences = (
            self.db.query(UserExperience)
            .filter(UserExperience.user_profile_id == profile_id)
            .order_by(UserExperience.created_at.desc())
            .all()
        )
        return [self._experience_response(experience) for experience in experiences]

    def get_experience(self, profile_id: UUID, experience_id: UUID) -> UserExperienceResponse:
        return self._experience_response(self._get_experience_model(profile_id, experience_id))

    def update_experience(
        self, profile_id: UUID, experience_id: UUID, payload: UpdateUserExperienceRequest
    ) -> UserExperienceResponse:
        experience = self._get_experience_model(profile_id, experience_id)
        for key, value in payload.model_dump(by_alias=False).items():
            setattr(experience, key, value)
        self.db.commit()
        self.db.refresh(experience)
        return self._experience_response(experience)

    def delete_experience(self, profile_id: UUID, experience_id: UUID) -> dict[str, bool]:
        experience = self._get_experience_model(profile_id, experience_id)
        self.db.delete(experience)
        self.db.commit()
        return {"deleted": True}

    def _get_profile_model(self, profile_id: UUID) -> UserProfile:
        profile = self.db.query(UserProfile).filter(UserProfile.id == profile_id).first()
        if not profile:
            raise HTTPException(status_code=404, detail="用户资料不存在")
        return profile

    def _get_experience_model(self, profile_id: UUID, experience_id: UUID) -> UserExperience:
        experience = (
            self.db.query(UserExperience)
            .filter(
                UserExperience.id == experience_id,
                UserExperience.user_profile_id == profile_id,
            )
            .first()
        )
        if not experience:
            raise HTTPException(status_code=404, detail="用户经历不存在")
        return experience

    def _profile_response(self, profile: UserProfile) -> UserProfileResponse:
        return UserProfileResponse(
            id=profile.id,
            name=profile.name,
            phone=profile.phone,
            email=profile.email,
            city=profile.city,
            school=profile.school,
            major=profile.major,
            degree=profile.degree,
            graduation=profile.graduation,
            links=profile.links,
            skills=profile.skills,
            education=profile.education,
            extraInfo=profile.extra_info,
            createdAt=profile.created_at,
            updatedAt=profile.updated_at,
        )

    def _experience_response(self, experience: UserExperience) -> UserExperienceResponse:
        return UserExperienceResponse(
            id=experience.id,
            userProfileId=experience.user_profile_id,
            type=experience.type,
            title=experience.title,
            organization=experience.organization,
            role=experience.role,
            startDate=experience.start_date,
            endDate=experience.end_date,
            location=experience.location,
            description=experience.description,
            highlights=experience.highlights,
            metrics=experience.metrics,
            skills=experience.skills,
            rawText=experience.raw_text,
            extraInfo=experience.extra_info,
            createdAt=experience.created_at,
            updatedAt=experience.updated_at,
        )
