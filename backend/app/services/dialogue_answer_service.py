from typing import Any

from sqlalchemy.orm import Session

from app.models.resume import Experience, JobTarget
from app.schemas.resume import GenerateDialogueAnswerRequest, GenerateDialogueAnswerResponse
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class DialogueAnswerService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def generate_answer(
        self, payload: GenerateDialogueAnswerRequest
    ) -> GenerateDialogueAnswerResponse:
        job_target = self._get_job_target(payload)
        experience = self._get_experience(payload)

        prompt_input = {
            "company": job_target.company if job_target else payload.company,
            "position": job_target.position if job_target else payload.position,
            "jobDescription": job_target.job_description if job_target else payload.job_description,
            "profile": payload.profile.model_dump(),
            "education": [item.model_dump() for item in payload.education],
            "skills": payload.skills.model_dump(),
            "experience": experience,
            "currentQuestion": payload.current_question,
            "questionField": payload.question_field,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="generate_dialogue_answer",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="generate_dialogue_answer",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=payload.task_id,
        )
        return GenerateDialogueAnswerResponse.model_validate(
            self._normalize_output(output, payload.current_question)
        )

    def _get_job_target(self, payload: GenerateDialogueAnswerRequest) -> JobTarget | None:
        if not payload.task_id or not payload.job_target_id:
            return None
        return (
            self.db.query(JobTarget)
            .filter(JobTarget.id == payload.job_target_id, JobTarget.task_id == payload.task_id)
            .first()
        )

    def _get_experience(self, payload: GenerateDialogueAnswerRequest) -> dict[str, Any] | None:
        if not payload.task_id or not payload.experience_id:
            return None
        experience = (
            self.db.query(Experience)
            .filter(Experience.id == payload.experience_id, Experience.task_id == payload.task_id)
            .first()
        )
        if not experience:
            return None
        return {
            "id": str(experience.id),
            "type": experience.type,
            "title": experience.title,
            "organization": experience.organization,
            "role": experience.role,
            "background": experience.background,
            "actions": experience.actions,
            "results": experience.results,
            "metrics": experience.metrics,
            "matchedAbilities": experience.matched_abilities,
            "missingInfoQuestions": experience.missing_info_questions,
            "rawText": experience.raw_text,
        }

    @staticmethod
    def _normalize_output(output: dict[str, Any], current_question: str) -> dict[str, Any]:
        if not isinstance(output, dict):
            output = {}
        answer = str(output.get("answer") or "").strip()
        if not answer:
            answer = f"针对这个问题，我可以补充：{current_question}"
        profile_patch = output.get("profilePatch")
        if profile_patch is not None and not isinstance(profile_patch, dict):
            profile_patch = None
        target_patch = output.get("targetPatch")
        if target_patch is not None and not isinstance(target_patch, dict):
            target_patch = None
        section_patch = output.get("sectionPatch")
        if section_patch is not None and not isinstance(section_patch, dict):
            section_patch = None
        skills_text = output.get("skillsText")
        if skills_text is not None:
            skills_text = str(skills_text)
        return {
            "answer": answer,
            "targetPatch": target_patch,
            "profilePatch": profile_patch,
            "sectionPatch": section_patch,
            "skillsText": skills_text,
        }
