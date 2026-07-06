from sqlalchemy.orm import Session

from app.models.resume import CoreAbility, JobTarget, ResumeTask
from app.schemas.resume import AnalyzeJobRequest, AnalyzeJobResponse, CoreAbilitySchema
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class JobService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def analyze_job(self, payload: AnalyzeJobRequest) -> AnalyzeJobResponse:
        task = ResumeTask(title=f"{payload.company} - {payload.position}")
        self.db.add(task)
        self.db.flush()

        prompt_input = payload.model_dump(by_alias=True)
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="analyze_job",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="analyze_job",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=task.id,
        )

        source = output.get("source") or ("jd" if payload.job_description else "general_model")
        core_abilities = output.get("coreAbilities", [])
        keywords = output.get("keywords", [])
        resume_focus = output.get("resumeFocus", [])

        job_target = JobTarget(
            task_id=task.id,
            company=payload.company,
            position=payload.position,
            job_description=payload.job_description,
            source=source,
            keywords=keywords,
            resume_focus=resume_focus,
        )
        self.db.add(job_target)
        self.db.flush()

        ability_schemas: list[CoreAbilitySchema] = []
        for item in core_abilities:
            ability = CoreAbility(
                job_target_id=job_target.id,
                name=item["name"],
                importance=item["importance"],
                description=item["description"],
                evidence_suggestions=item.get("evidenceSuggestions", []),
            )
            self.db.add(ability)
            ability_schemas.append(CoreAbilitySchema.model_validate(item))

        self.db.commit()

        return AnalyzeJobResponse(
            taskId=task.id,
            jobTargetId=job_target.id,
            source=source,
            coreAbilities=ability_schemas,
            keywords=keywords,
            resumeFocus=resume_focus,
        )
