from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.user_profile import (
    CreateUserExperienceRequest,
    CreateUserProfileRequest,
    ImportedResumeResponse,
    UpdateUserExperienceRequest,
    UpdateUserProfileRequest,
    UserExperienceResponse,
    UserProfileResponse,
)
from app.services.resume_import_service import ResumeImportService
from app.services.user_profile_service import UserProfileService

router = APIRouter()


@router.post("", response_model=UserProfileResponse)
def create_profile(
    payload: CreateUserProfileRequest, db: Session = Depends(get_db)
) -> UserProfileResponse:
    return UserProfileService(db).create_profile(payload)


@router.get("", response_model=list[UserProfileResponse])
def list_profiles(db: Session = Depends(get_db)) -> list[UserProfileResponse]:
    return UserProfileService(db).list_profiles()


@router.post("/import-resume", response_model=ImportedResumeResponse)
async def import_resume(file: UploadFile = File(...)) -> ImportedResumeResponse:
    return await ResumeImportService().import_resume(file)


@router.get("/{profile_id}", response_model=UserProfileResponse)
def get_profile(profile_id: UUID, db: Session = Depends(get_db)) -> UserProfileResponse:
    return UserProfileService(db).get_profile(profile_id)


@router.put("/{profile_id}", response_model=UserProfileResponse)
def update_profile(
    profile_id: UUID, payload: UpdateUserProfileRequest, db: Session = Depends(get_db)
) -> UserProfileResponse:
    return UserProfileService(db).update_profile(profile_id, payload)


@router.delete("/{profile_id}")
def delete_profile(profile_id: UUID, db: Session = Depends(get_db)) -> dict[str, bool]:
    return UserProfileService(db).delete_profile(profile_id)


@router.post("/{profile_id}/experiences", response_model=UserExperienceResponse)
def create_experience(
    profile_id: UUID, payload: CreateUserExperienceRequest, db: Session = Depends(get_db)
) -> UserExperienceResponse:
    return UserProfileService(db).create_experience(profile_id, payload)


@router.get("/{profile_id}/experiences", response_model=list[UserExperienceResponse])
def list_experiences(
    profile_id: UUID, db: Session = Depends(get_db)
) -> list[UserExperienceResponse]:
    return UserProfileService(db).list_experiences(profile_id)


@router.get("/{profile_id}/experiences/{experience_id}", response_model=UserExperienceResponse)
def get_experience(
    profile_id: UUID, experience_id: UUID, db: Session = Depends(get_db)
) -> UserExperienceResponse:
    return UserProfileService(db).get_experience(profile_id, experience_id)


@router.put("/{profile_id}/experiences/{experience_id}", response_model=UserExperienceResponse)
def update_experience(
    profile_id: UUID,
    experience_id: UUID,
    payload: UpdateUserExperienceRequest,
    db: Session = Depends(get_db),
) -> UserExperienceResponse:
    return UserProfileService(db).update_experience(profile_id, experience_id, payload)


@router.delete("/{profile_id}/experiences/{experience_id}")
def delete_experience(
    profile_id: UUID, experience_id: UUID, db: Session = Depends(get_db)
) -> dict[str, bool]:
    return UserProfileService(db).delete_experience(profile_id, experience_id)
