from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class ReviewService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def review_resume_document(
        self,
        *,
        company: str,
        position: str,
        core_abilities: list[dict[str, Any]],
        keywords: list[str],
        experiences: list[dict[str, Any]],
        resume_document: dict[str, Any],
        task_id: UUID,
    ) -> dict[str, Any]:
        prompt_input = {
            "company": company,
            "position": position,
            "coreAbilities": core_abilities,
            "keywords": keywords,
            "experiences": experiences,
            "resumeDocument": resume_document,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="review_resume_document",
            prompt_version="v1",
            variables=prompt_input,
        )
        return self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="review_resume_document",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=task_id,
        )

    def fix_resume_document(
        self,
        *,
        company: str,
        position: str,
        core_abilities: list[dict[str, Any]],
        keywords: list[str],
        experiences: list[dict[str, Any]],
        resume_document: dict[str, Any],
        review: dict[str, Any],
        task_id: UUID,
    ) -> dict[str, Any]:
        prompt_input = {
            "company": company,
            "position": position,
            "coreAbilities": core_abilities,
            "keywords": keywords,
            "experiences": experiences,
            "resumeDocument": resume_document,
            "reviewIssues": review.get("issues", []),
            "fixInstructions": review.get("fixInstructions", []),
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="fix_resume_document",
            prompt_version="v1",
            variables=prompt_input,
        )
        return self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="fix_resume_document",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=task_id,
        )
