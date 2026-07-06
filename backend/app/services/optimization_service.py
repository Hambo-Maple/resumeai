from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.resume import CoreAbility, Experience, JobTarget, ResumeDraft
from app.schemas.resume import (
    DiagnoseResumeRequest,
    DiagnoseResumeResponse,
    NextQuestionSchema,
    QuestionPlanSchema,
    ResumeGapSchema,
    ResumeQuestionSchema,
    StructuredExperienceResponse,
    UpdateExperienceRequest,
    UpdateExperienceResponse,
)
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class OptimizationService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def diagnose_resume(self, payload: DiagnoseResumeRequest) -> DiagnoseResumeResponse:
        job_target = (
            self.db.query(JobTarget)
            .filter(JobTarget.id == payload.job_target_id, JobTarget.task_id == payload.task_id)
            .first()
        )
        if not job_target:
            raise HTTPException(status_code=404, detail="目标岗位不存在")

        resume_draft = (
            self.db.query(ResumeDraft)
            .filter(
                ResumeDraft.id == payload.resume_draft_id,
                ResumeDraft.task_id == payload.task_id,
                ResumeDraft.job_target_id == payload.job_target_id,
            )
            .first()
        )
        if not resume_draft:
            raise HTTPException(status_code=404, detail="简历草稿不存在")

        abilities = (
            self.db.query(CoreAbility)
            .filter(CoreAbility.job_target_id == payload.job_target_id)
            .order_by(CoreAbility.importance.desc())
            .all()
        )
        experiences = (
            self.db.query(Experience)
            .filter(Experience.task_id == payload.task_id)
            .order_by(Experience.created_at.asc())
            .all()
        )

        prompt_input = {
            "company": job_target.company,
            "position": job_target.position,
            "coreAbilities": [
                {
                    "name": ability.name,
                    "importance": ability.importance,
                    "description": ability.description,
                    "evidenceSuggestions": ability.evidence_suggestions,
                }
                for ability in abilities
            ],
            "keywords": job_target.keywords,
            "experiences": [
                {
                    "id": str(experience.id),
                    "type": experience.type,
                    "title": experience.title,
                    "role": experience.role,
                    "background": experience.background,
                    "actions": experience.actions,
                    "results": experience.results,
                    "metrics": experience.metrics,
                    "matchedAbilities": experience.matched_abilities,
                    "missingInfoQuestions": experience.missing_info_questions,
                }
                for experience in experiences
            ],
            "resumeDraft": {
                "id": str(resume_draft.id),
                "version": resume_draft.version,
                "status": resume_draft.status,
                "summary": resume_draft.summary,
                "sections": resume_draft.sections,
                "skills": resume_draft.skills,
            },
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="diagnose_resume_gap",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="diagnose_resume_gap",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=payload.task_id,
        )

        gaps = [ResumeGapSchema.model_validate(item) for item in output.get("gaps", [])]
        questions = [
            ResumeQuestionSchema.model_validate(item) for item in output.get("questions", [])
        ]
        question_plans = self._build_question_plans(gaps, questions)
        next_question = None
        if question_plans:
            first_plan = question_plans[0]
            next_question = NextQuestionSchema(
                questionId=first_plan.question_id,
                content=first_plan.user_visible_question,
                relatedExperienceId=first_plan.related_experience_id,
                priority=first_plan.priority,
            )

        return DiagnoseResumeResponse(
            diagnosis=output.get("diagnosis", "当前简历仍需补充更多具体证据。"),
            gaps=gaps,
            questions=questions,
            questionPlans=question_plans,
            nextQuestion=next_question,
            nextAction=output.get("nextAction", "请先回答优先级最高的问题。"),
        )

    @staticmethod
    def _build_question_plans(
        gaps: list[ResumeGapSchema], questions: list[ResumeQuestionSchema]
    ) -> list[QuestionPlanSchema]:
        plans = []
        for index, question in enumerate(questions):
            related_gap = gaps[index] if index < len(gaps) else None
            gap_type = related_gap.type if related_gap else "unknown"
            related_ability = related_gap.related_ability if related_gap else None
            plans.append(
                QuestionPlanSchema(
                    questionId=f"q_{index + 1}",
                    gapType=gap_type,
                    priority=question.priority,
                    relatedExperienceId=question.related_experience_id,
                    relatedAbility=related_ability,
                    reason=question.reason,
                    expectedEvidence=OptimizationService._expected_evidence_for_gap(gap_type),
                    userVisibleQuestion=OptimizationService._to_user_visible_question(
                        question.question
                    ),
                    status="pending",
                )
            )
        return plans

    @staticmethod
    def _expected_evidence_for_gap(gap_type: str) -> list[str]:
        mapping = {
            "missing_role": ["个人角色", "责任边界", "主导或独立完成的事项"],
            "missing_method": ["工具", "流程", "方法", "判断标准"],
            "missing_result": ["结果", "反馈", "影响", "复盘结论"],
            "missing_metric": ["人数", "比例", "时长", "数量", "排名"],
            "keyword_gap": ["岗位关键词", "相关工具", "能力证据"],
        }
        return mapping.get(gap_type, ["真实事实", "可用于简历的证据"])

    @staticmethod
    def _to_user_visible_question(question: str) -> str:
        text = question.strip()
        for prefix in ["请回答：", "问题：", "追问："]:
            if text.startswith(prefix):
                text = text.removeprefix(prefix).strip()
        return text

    def update_experience(self, payload: UpdateExperienceRequest) -> UpdateExperienceResponse:
        experience = (
            self.db.query(Experience)
            .filter(Experience.id == payload.experience_id, Experience.task_id == payload.task_id)
            .first()
        )
        if not experience:
            raise HTTPException(status_code=404, detail="经历不存在")

        job_target = (
            self.db.query(JobTarget)
            .filter(JobTarget.task_id == payload.task_id)
            .order_by(JobTarget.created_at.desc())
            .first()
        )
        if not job_target:
            raise HTTPException(status_code=404, detail="目标岗位不存在")

        abilities = (
            self.db.query(CoreAbility)
            .filter(CoreAbility.job_target_id == job_target.id)
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
        experience_payload = {
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
        prompt_input = {
            "company": job_target.company,
            "position": job_target.position,
            "coreAbilities": core_abilities,
            "experience": experience_payload,
            "question": payload.question,
            "answer": payload.answer,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="update_experience_from_dialogue",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="update_experience_from_dialogue",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=payload.task_id,
        )
        updated = output.get("updatedExperience", {})

        experience.type = updated.get("type", experience.type)
        experience.title = updated.get("title", experience.title)
        experience.organization = updated.get("organization", experience.organization)
        experience.role = updated.get("role", experience.role)
        experience.background = updated.get("background", experience.background)
        experience.actions = updated.get("actions", experience.actions)
        experience.results = updated.get("results", experience.results)
        experience.metrics = updated.get("metrics", experience.metrics)
        experience.matched_abilities = updated.get("matchedAbilities", experience.matched_abilities)
        experience.missing_info_questions = updated.get(
            "missingInfoQuestions", experience.missing_info_questions
        )
        self.db.commit()
        self.db.refresh(experience)

        updated_response = StructuredExperienceResponse(
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
            resumeValue=updated.get("resumeValue", "这段经历的信息已更新，可继续用于简历优化。"),
            rewriteDirection=updated.get("rewriteDirection", []),
        )
        return UpdateExperienceResponse(
            experienceId=experience.id,
            updatedExperience=updated_response,
            updateSummary=output.get("updateSummary", "已根据用户回答更新经历卡片。"),
        )
