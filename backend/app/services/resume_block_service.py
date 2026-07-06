from typing import Any

from sqlalchemy.orm import Session

from app.schemas.resume import (
    AnalyzeResumeBlocksRequest,
    AnalyzeResumeBlocksResponse,
    UpdateResumeBlockRequest,
    UpdateResumeBlockResponse,
)
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class ResumeBlockService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def analyze_blocks(
        self, payload: AnalyzeResumeBlocksRequest
    ) -> AnalyzeResumeBlocksResponse:
        prompt_input = {
            "company": payload.company,
            "position": payload.position,
            "jobDescription": payload.job_description,
            "jobAnalysis": payload.job_analysis,
            "resumeBlocks": [
                block.model_dump(by_alias=True) for block in payload.resume_blocks
            ],
            "lockedBlockIds": payload.locked_block_ids,
            "questionHistory": payload.question_history,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="analyze_resume_blocks",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="analyze_resume_blocks",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
        )
        return AnalyzeResumeBlocksResponse.model_validate(
            self._normalize_analyze_output(output)
        )

    def update_block(self, payload: UpdateResumeBlockRequest) -> UpdateResumeBlockResponse:
        prompt_input = {
            "company": payload.company,
            "position": payload.position,
            "jobDescription": payload.job_description,
            "jobAnalysis": payload.job_analysis,
            "targetBlock": payload.target_block.model_dump(by_alias=True),
            "otherBlockSummaries": payload.other_block_summaries,
            "currentQuestion": payload.current_question,
            "answer": payload.answer,
            "blockAnswerHistory": payload.block_answer_history,
            "skippedQuestions": payload.skipped_questions,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="update_resume_block_from_dialogue",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="update_resume_block_from_dialogue",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
        )
        return UpdateResumeBlockResponse.model_validate(
            self._normalize_update_output(output, payload)
        )

    @staticmethod
    def _normalize_analyze_output(output: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(output, dict):
            output = {}
        report = output.get("globalQualityReport")
        if not isinstance(report, dict):
            report = {
                "overallScore": 0,
                "readiness": "not_ready",
                "summary": "整体分析结果为空，请重新分析。",
                "globalGaps": [],
                "weakBlocks": [],
                "nextBestAction": "请选择一个模块继续编辑。",
            }
        actions = output.get("recommendedActions")
        if not isinstance(actions, list):
            actions = []
        next_question = output.get("nextQuestion")
        if not isinstance(next_question, dict):
            next_question = None
        return {
            "globalQualityReport": report,
            "recommendedActions": actions,
            "nextQuestion": next_question,
        }

    @staticmethod
    def _normalize_update_output(
        output: dict[str, Any], payload: UpdateResumeBlockRequest
    ) -> dict[str, Any]:
        if not isinstance(output, dict):
            output = {}
        pending_block = output.get("pendingBlockDraft")
        if not isinstance(pending_block, dict):
            pending_block = payload.target_block.model_dump(by_alias=True)
        pending_block = {
            **payload.target_block.model_dump(by_alias=True),
            **pending_block,
            "id": payload.target_block.id,
            "type": payload.target_block.type,
        }

        report = output.get("blockQualityReport")
        if not isinstance(report, dict):
            report = payload.target_block.quality_report or {}
        next_question = output.get("nextQuestion")
        if not isinstance(next_question, dict):
            next_question = None
        is_complete = output.get("isCompleteForDraft")
        if not isinstance(is_complete, bool):
            is_complete = next_question is None
        return {
            "pendingBlockDraft": pending_block,
            "blockQualityReport": report,
            "nextQuestion": next_question,
            "isCompleteForDraft": is_complete,
            "updateSummary": str(output.get("updateSummary") or "已更新当前模块待确认稿。"),
        }
