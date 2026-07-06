from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.position import (
    CreatePositionTargetRequest,
    PositionTargetResponse,
    UpdatePositionTargetRequest,
)
from app.services.position_service import PositionService

router = APIRouter()


@router.post("", response_model=PositionTargetResponse)
def create_position(
    payload: CreatePositionTargetRequest, db: Session = Depends(get_db)
) -> PositionTargetResponse:
    return PositionService(db).create_position(payload)


@router.get("", response_model=list[PositionTargetResponse])
def list_positions(
    user_profile_id: UUID | None = Query(default=None, alias="userProfileId"),
    db: Session = Depends(get_db),
) -> list[PositionTargetResponse]:
    return PositionService(db).list_positions(user_profile_id)


@router.get("/{position_id}", response_model=PositionTargetResponse)
def get_position(position_id: UUID, db: Session = Depends(get_db)) -> PositionTargetResponse:
    return PositionService(db).get_position(position_id)


@router.put("/{position_id}", response_model=PositionTargetResponse)
def update_position(
    position_id: UUID, payload: UpdatePositionTargetRequest, db: Session = Depends(get_db)
) -> PositionTargetResponse:
    return PositionService(db).update_position(position_id, payload)


@router.delete("/{position_id}")
def delete_position(position_id: UUID, db: Session = Depends(get_db)) -> dict[str, bool]:
    return PositionService(db).delete_position(position_id)
