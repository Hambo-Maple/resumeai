from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.position import PositionTarget
from app.models.user_profile import UserProfile
from app.schemas.position import (
    CreatePositionTargetRequest,
    PositionTargetResponse,
    UpdatePositionTargetRequest,
)


class PositionService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create_position(self, payload: CreatePositionTargetRequest) -> PositionTargetResponse:
        self._ensure_profile_exists(payload.user_profile_id)
        position = PositionTarget(**payload.model_dump(by_alias=False))
        self.db.add(position)
        self.db.commit()
        self.db.refresh(position)
        return self._position_response(position)

    def list_positions(self, user_profile_id: UUID | None = None) -> list[PositionTargetResponse]:
        query = self.db.query(PositionTarget)
        if user_profile_id:
            query = query.filter(PositionTarget.user_profile_id == user_profile_id)
        positions = query.order_by(PositionTarget.created_at.desc()).all()
        return [self._position_response(position) for position in positions]

    def get_position(self, position_id: UUID) -> PositionTargetResponse:
        return self._position_response(self._get_position_model(position_id))

    def update_position(
        self, position_id: UUID, payload: UpdatePositionTargetRequest
    ) -> PositionTargetResponse:
        self._ensure_profile_exists(payload.user_profile_id)
        position = self._get_position_model(position_id)
        for key, value in payload.model_dump(by_alias=False).items():
            setattr(position, key, value)
        self.db.commit()
        self.db.refresh(position)
        return self._position_response(position)

    def delete_position(self, position_id: UUID) -> dict[str, bool]:
        position = self._get_position_model(position_id)
        self.db.delete(position)
        self.db.commit()
        return {"deleted": True}

    def _get_position_model(self, position_id: UUID) -> PositionTarget:
        position = self.db.query(PositionTarget).filter(PositionTarget.id == position_id).first()
        if not position:
            raise HTTPException(status_code=404, detail="职位信息不存在")
        return position

    def _ensure_profile_exists(self, profile_id: UUID | None) -> None:
        if not profile_id:
            return
        exists = self.db.query(UserProfile.id).filter(UserProfile.id == profile_id).first()
        if not exists:
            raise HTTPException(status_code=404, detail="用户资料不存在")

    def _position_response(self, position: PositionTarget) -> PositionTargetResponse:
        return PositionTargetResponse(
            id=position.id,
            userProfileId=position.user_profile_id,
            company=position.company,
            position=position.position,
            industry=position.industry,
            city=position.city,
            jobDescription=position.job_description,
            sourceUrl=position.source_url,
            status=position.status,
            keywords=position.keywords,
            requirements=position.requirements,
            notes=position.notes,
            extraInfo=position.extra_info,
            createdAt=position.created_at,
            updatedAt=position.updated_at,
        )
