from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.resume import (
    AnalyzeJobRequest,
    AnalyzeJobResponse,
    AnalyzeResumeBlocksRequest,
    AnalyzeResumeBlocksResponse,
    AssessReadinessRequest,
    AssessReadinessResponse,
    DiagnoseResumeRequest,
    DiagnoseResumeResponse,
    FinalizeResumeRequest,
    FinalizeResumeResponse,
    GenerateDialogueAnswerRequest,
    GenerateDialogueAnswerResponse,
    GenerateResumeRequest,
    GenerateResumeResponse,
    ProductizedDraftRequest,
    ProductizedDraftResponse,
    StructureExperienceRequest,
    StructuredExperienceResponse,
    UpdateExperienceRequest,
    UpdateExperienceResponse,
    UpdateResumeBlockRequest,
    UpdateResumeBlockResponse,
    UpdateResumeSectionRequest,
    UpdateResumeSectionResponse,
)
from app.services.dialogue_answer_service import DialogueAnswerService
from app.services.experience_service import ExperienceService
from app.services.job_service import JobService
from app.services.optimization_service import OptimizationService
from app.services.productized_draft_service import ProductizedDraftService
from app.services.readiness_service import ReadinessService
from app.services.resume_block_service import ResumeBlockService
from app.services.resume_section_update_service import ResumeSectionUpdateService
from app.services.resume_service import ResumeService

router = APIRouter()


@router.post("/analyze-job", response_model=AnalyzeJobResponse)
def analyze_job(payload: AnalyzeJobRequest, db: Session = Depends(get_db)) -> AnalyzeJobResponse:
    return JobService(db).analyze_job(payload)


@router.post("/structure-experience", response_model=StructuredExperienceResponse)
def structure_experience(
    payload: StructureExperienceRequest, db: Session = Depends(get_db)
) -> StructuredExperienceResponse:
    return ExperienceService(db).structure_experience(payload)


@router.post("/assess-readiness", response_model=AssessReadinessResponse)
def assess_readiness(
    payload: AssessReadinessRequest, db: Session = Depends(get_db)
) -> AssessReadinessResponse:
    return ReadinessService(db).assess_resume_readiness(payload)


@router.post("/generate", response_model=GenerateResumeResponse)
def generate_resume(
    payload: GenerateResumeRequest, db: Session = Depends(get_db)
) -> GenerateResumeResponse:
    return ResumeService(db).generate_resume(payload)


@router.post("/productized-draft", response_model=ProductizedDraftResponse)
def generate_productized_draft(
    payload: ProductizedDraftRequest, db: Session = Depends(get_db)
) -> ProductizedDraftResponse:
    return ProductizedDraftService(db).generate_draft(payload)


@router.post("/finalize", response_model=FinalizeResumeResponse)
def finalize_resume(
    payload: FinalizeResumeRequest, db: Session = Depends(get_db)
) -> FinalizeResumeResponse:
    return ResumeService(db).finalize_resume(payload)


@router.post("/diagnose", response_model=DiagnoseResumeResponse)
def diagnose_resume(
    payload: DiagnoseResumeRequest, db: Session = Depends(get_db)
) -> DiagnoseResumeResponse:
    return OptimizationService(db).diagnose_resume(payload)


@router.post("/update-experience", response_model=UpdateExperienceResponse)
def update_experience(
    payload: UpdateExperienceRequest, db: Session = Depends(get_db)
) -> UpdateExperienceResponse:
    return OptimizationService(db).update_experience(payload)


@router.post("/update-resume-section", response_model=UpdateResumeSectionResponse)
def update_resume_section(
    payload: UpdateResumeSectionRequest, db: Session = Depends(get_db)
) -> UpdateResumeSectionResponse:
    return ResumeSectionUpdateService(db).update_section(payload)


@router.post("/analyze-blocks", response_model=AnalyzeResumeBlocksResponse)
def analyze_resume_blocks(
    payload: AnalyzeResumeBlocksRequest, db: Session = Depends(get_db)
) -> AnalyzeResumeBlocksResponse:
    return ResumeBlockService(db).analyze_blocks(payload)


@router.post("/update-block", response_model=UpdateResumeBlockResponse)
def update_resume_block(
    payload: UpdateResumeBlockRequest, db: Session = Depends(get_db)
) -> UpdateResumeBlockResponse:
    return ResumeBlockService(db).update_block(payload)


@router.post("/generate-answer", response_model=GenerateDialogueAnswerResponse)
def generate_dialogue_answer(
    payload: GenerateDialogueAnswerRequest, db: Session = Depends(get_db)
) -> GenerateDialogueAnswerResponse:
    return DialogueAnswerService(db).generate_answer(payload)
