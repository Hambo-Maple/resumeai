from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.resume import CoreAbility, Experience, JobTarget
from app.schemas.resume import StructureExperienceRequest, StructuredExperienceResponse
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class ExperienceService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def structure_experience(
        self, payload: StructureExperienceRequest
    ) -> StructuredExperienceResponse:
        job_target = (
            self.db.query(JobTarget)
            .filter(JobTarget.id == payload.job_target_id, JobTarget.task_id == payload.task_id)
            .first()
        )
        if not job_target:
            raise HTTPException(status_code=404, detail="目标岗位不存在")

        abilities = (
            self.db.query(CoreAbility)
            .filter(CoreAbility.job_target_id == payload.job_target_id)
            .order_by(CoreAbility.importance.desc())
            .all()
        )
        core_abilities = [
            {
                "name": ability.name,
                "importance": ability.importance,
                "description": ability.description,
                "evidenceSuggestions": ability.evidence_suggestions,
            }
            for ability in abilities
        ]

        prompt_input = {
            "company": job_target.company,
            "position": job_target.position,
            "coreAbilities": core_abilities,
            "keywords": job_target.keywords,
            "rawExperience": payload.raw_experience,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="structure_experience",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="structure_experience",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=payload.task_id,
        )

        experience = Experience(
            task_id=payload.task_id,
            type=output.get("type", "other"),
            title=output.get("title", "未命名经历"),
            organization=output.get("organization"),
            role=output.get("role"),
            background=output.get("background"),
            actions=output.get("actions", []),
            results=output.get("results", []),
            metrics=output.get("metrics", []),
            matched_abilities=output.get("matchedAbilities", []),
            missing_info_questions=output.get("missingInfoQuestions", []),
            raw_text=payload.raw_experience,
        )
        self.db.add(experience)
        self.db.commit()
        self.db.refresh(experience)

        return StructuredExperienceResponse(
            experienceId=experience.id,
            type=experience.type,
            title=experience.title,
            organization=experience.organization,
            role=experience.role,
            background=experience.background,
            actions=experience.actions,
            results=experience.results,
            metrics=experience.metrics,
            matchedAbilities=experience.matched_abilities,
            missingInfoQuestions=experience.missing_info_questions,
            resumeValue=output.get("resumeValue", "这段经历可作为简历素材，建议继续补充细节。"),
            rewriteDirection=output.get("rewriteDirection", []),
        )
