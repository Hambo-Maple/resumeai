from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.resume import CoreAbility, Experience, JobTarget
from app.schemas.resume import AssessReadinessRequest, AssessReadinessResponse
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class ReadinessService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def assess_resume_readiness(
        self, payload: AssessReadinessRequest
    ) -> AssessReadinessResponse:
        job_target = (
            self.db.query(JobTarget)
            .filter(JobTarget.id == payload.job_target_id, JobTarget.task_id == payload.task_id)
            .first()
        )
        if not job_target:
            raise HTTPException(status_code=404, detail="目标岗位不存在")

        experience = (
            self.db.query(Experience)
            .filter(Experience.id == payload.experience_id, Experience.task_id == payload.task_id)
            .first()
        )
        if not experience:
            raise HTTPException(status_code=404, detail="经历不存在")

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
            "keywords": job_target.keywords,
            "profile": payload.profile.model_dump(),
            "education": [item.model_dump() for item in payload.education],
            "skills": payload.skills.model_dump(),
            "experience": experience_payload,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="assess_resume_readiness",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="assess_resume_readiness",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=payload.task_id,
        )
        output = self._normalize_readiness_output(output)
        return AssessReadinessResponse.model_validate(output)

    @staticmethod
    def _normalize_readiness_output(output: dict) -> dict:
        if not isinstance(output, dict):
            output = {}

        completion = output.get("completion")
        if not isinstance(completion, dict):
            completion = {}

        def to_percent(value: object) -> int:
            try:
                number = float(value)
            except (TypeError, ValueError):
                return 0
            if 0 <= number <= 1:
                number *= 100
            return max(0, min(100, int(round(number))))

        output["completion"] = {
            "profile": to_percent(completion.get("profile")),
            "experience": to_percent(completion.get("experience")),
            "overall": to_percent(completion.get("overall")),
        }

        readiness = output.get("resumeReadiness")
        if readiness not in ["not_ready", "draft_ready", "strong_ready"]:
            output["resumeReadiness"] = (
                "draft_ready" if output["completion"]["overall"] >= 65 else "not_ready"
            )

        evidence_level = output.get("evidenceLevel")
        if evidence_level not in ["low", "medium", "high"]:
            score = output["completion"]["experience"]
            output["evidenceLevel"] = "high" if score >= 80 else "medium" if score >= 55 else "low"

        output["missingFields"] = output.get("missingFields", [])
        if not isinstance(output["missingFields"], list):
            output["missingFields"] = []

        next_question = output.get("nextQuestion")
        if next_question is not None and not isinstance(next_question, dict):
            output["nextQuestion"] = None

        output = ReadinessService._stabilize_readiness_output(output)
        output["canGenerateDraft"] = bool(output.get("canGenerateDraft"))
        output["reason"] = str(output.get("reason") or "当前资料完整度已完成评估。")
        return output

    @staticmethod
    def _stabilize_readiness_output(output: dict) -> dict:
        missing_fields = output.get("missingFields", [])
        if not isinstance(missing_fields, list):
            missing_fields = []
        output["missingFields"] = [
            ReadinessService._normalize_missing_field(field)
            for field in missing_fields
            if field
        ]

        next_question = output.get("nextQuestion")
        if next_question is not None and not isinstance(next_question, dict):
            next_question = None

        if isinstance(next_question, dict):
            field = ReadinessService._normalize_missing_field(next_question.get("field"))
            fallback_field = output["missingFields"][0] if output["missingFields"] else "details"
            field = field or fallback_field
            content = str(next_question.get("content") or "").strip()
            output["nextQuestion"] = {
                "field": field,
                "content": content or ReadinessService._question_for_field(field),
            }
        else:
            output["nextQuestion"] = None

        can_generate = output.get("canGenerateDraft")
        if not isinstance(can_generate, bool):
            completion = output.get("completion", {})
            can_generate = completion.get("profile", 0) >= 45 and completion.get("experience", 0) >= 70
        output["canGenerateDraft"] = can_generate

        if not output["canGenerateDraft"] and output["nextQuestion"] is None:
            field = output["missingFields"][0] if output["missingFields"] else "details"
            output["nextQuestion"] = {
                "field": field,
                "content": ReadinessService._question_for_field(field),
            }
        return output

    @staticmethod
    def _normalize_missing_field(field: object) -> str:
        value = str(field or "").strip()
        mapping = {
            "personal_info": "profile",
            "basic_info": "profile",
            "profile": "profile",
            "responsibility": "role",
            "responsibilities": "role",
            "role": "role",
            "action": "actions",
            "actions": "actions",
            "method": "methods",
            "methods": "methods",
            "tool": "methods",
            "tools": "methods",
            "result": "results",
            "results": "results",
            "impact": "results",
            "metric": "metrics",
            "metrics": "metrics",
            "quantification": "metrics",
        }
        return mapping.get(value, value or "details")

    @staticmethod
    def _question_for_field(field: str) -> str:
        questions = {
            "profile": "先补一下简历头部信息吧：你的姓名、电话或邮箱、城市、学校、专业和学历分别是什么？",
            "role": "你在这个项目中具体负责哪一部分？哪些工作是你独立完成或主导推进的？",
            "actions": "这个项目里你最关键的 2-3 个行动分别是什么？",
            "methods": "你完成这项工作时用了哪些工具、方法、流程或判断标准？",
            "results": "这个项目最后产出了什么？有没有报告、结论、反馈或被采纳的建议？",
            "metrics": "这段经历里有没有数量、样本量、比例、时长、排名或其他可以量化的信息？",
        }
        return questions.get(field, "为了让初稿更完整，请再补充一个与这段经历相关的关键信息。")
