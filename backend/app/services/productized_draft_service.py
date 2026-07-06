from typing import Any

from sqlalchemy.orm import Session

from app.schemas.resume import ProductizedDraftRequest, ProductizedDraftResponse
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService


class ProductizedDraftService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def generate_draft(self, payload: ProductizedDraftRequest) -> ProductizedDraftResponse:
        prompt_input = {
            "company": payload.company,
            "position": payload.position,
            "jobDescription": payload.job_description,
            "jobAnalysis": payload.job_analysis or {},
            "sectionInputs": [
                item.model_dump(by_alias=True) for item in payload.section_inputs
            ],
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="generate_productized_draft",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="generate_productized_draft",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
        )
        normalized = self._normalize_output(output, payload)
        return ProductizedDraftResponse.model_validate(normalized)

    @staticmethod
    def _normalize_output(output: dict[str, Any], payload: ProductizedDraftRequest) -> dict[str, Any]:
        if not isinstance(output, dict):
            output = {}
        document = output.get("resumeDocument")
        if not isinstance(document, dict):
            document = {}

        basics = document.get("basics") if isinstance(document.get("basics"), dict) else {}
        document["basics"] = {
            "name": basics.get("name") or "姓名",
            "phone": basics.get("phone") or "电话",
            "email": basics.get("email") or "邮箱",
            "location": basics.get("location") or "城市",
            "links": basics.get("links") if isinstance(basics.get("links"), list) else [],
        }
        target = document.get("target") if isinstance(document.get("target"), dict) else {}
        document["target"] = {
            "position": target.get("position") or payload.position,
            "company": target.get("company") or payload.company or "",
            "industry": target.get("industry"),
            "city": target.get("city"),
        }
        document["summary"] = str(document.get("summary") or "")
        document["education"] = ProductizedDraftService._normalize_education(
            document.get("education")
        )
        document["experience"] = ProductizedDraftService._normalize_experience(
            document.get("experience")
        )
        document["projects"] = ProductizedDraftService._normalize_projects(
            document.get("projects")
        )
        document["sections"] = ProductizedDraftService._normalize_dynamic_sections(
            document.get("sections")
        )
        skills = document.get("skills") if isinstance(document.get("skills"), dict) else {}
        document["skills"] = {
            "technical": skills.get("technical") if isinstance(skills.get("technical"), list) else [],
            "tools": skills.get("tools") if isinstance(skills.get("tools"), list) else [],
            "domain": skills.get("domain") if isinstance(skills.get("domain"), list) else [],
            "language": skills.get("language") if isinstance(skills.get("language"), list) else [],
        }
        for key in ["certificates", "awards", "additional"]:
            document[key] = ProductizedDraftService._normalize_string_list(document.get(key))

        section_reports = output.get("sectionQualityReports")
        if not isinstance(section_reports, list):
            section_reports = []
        section_reports = [
            ProductizedDraftService._normalize_section_report(report)
            for report in section_reports
            if isinstance(report, dict)
        ]

        resume_report = output.get("resumeQualityReport")
        if not isinstance(resume_report, dict):
            resume_report = {}
        resume_report = ProductizedDraftService._normalize_resume_report(resume_report)
        next_question = output.get("nextQuestion") if isinstance(output.get("nextQuestion"), dict) else None
        if next_question:
            section_key = next_question.get("sectionKey")
            item_id = next_question.get("itemId")
            section_title = next_question.get("sectionTitle")
            item_name = next_question.get("itemName")
            gap_label = next_question.get("gapLabel")
            for report in section_reports:
                if section_key and report.get("sectionKey") == section_key:
                    section_title = section_title or report.get("title")
                    if not gap_label and report.get("gaps"):
                        gap_label = report["gaps"][0].get("description")
                    for item_report in report.get("itemReports", []):
                        if item_id and item_report.get("itemId") == item_id:
                            item_name = item_name or item_report.get("itemName")
                            if not gap_label and item_report.get("gaps"):
                                gap_label = item_report["gaps"][0].get("description")
            next_question = {
                "target": str(next_question.get("target") or "section"),
                "sectionKey": section_key,
                "sectionTitle": section_title,
                "itemId": item_id,
                "itemName": item_name,
                "field": next_question.get("field"),
                "gapLabel": gap_label,
                "question": ProductizedDraftService._normalize_question_text(
                    next_question.get("question")
                )
                or resume_report["nextBestAction"],
                "reason": str(next_question.get("reason") or "用于补充简历关键信息。"),
            }

        return {
            "resumeDocument": document,
            "sectionQualityReports": section_reports,
            "resumeQualityReport": resume_report,
            "growthMap": output.get("growthMap") if isinstance(output.get("growthMap"), dict) else {},
            "nextQuestion": next_question,
        }

    @staticmethod
    def _to_score(value: Any) -> int:
        try:
            return max(0, min(100, int(value)))
        except (TypeError, ValueError):
            return 0

    @staticmethod
    def _normalize_string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        normalized: list[str] = []
        for item in value:
            if isinstance(item, str):
                text = item.strip()
            elif isinstance(item, dict):
                parts = [
                    item.get("name"),
                    item.get("title"),
                    item.get("content"),
                    item.get("description"),
                    item.get("issuer"),
                    item.get("level"),
                    item.get("date"),
                ]
                text = "｜".join(str(part).strip() for part in parts if part)
            else:
                text = str(item).strip()
            if text:
                normalized.append(text)
        return normalized

    @staticmethod
    def _normalize_education(value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            school = (
                item.get("school")
                or item.get("institution")
                or item.get("university")
                or item.get("college")
                or item.get("name")
            )
            if not school:
                continue
            details = item.get("details")
            if not isinstance(details, list):
                details = item.get("courses") if isinstance(item.get("courses"), list) else []
            normalized.append(
                {
                    "school": str(school),
                    "degree": item.get("degree") or item.get("educationLevel"),
                    "major": item.get("major") or item.get("field") or item.get("fieldOfStudy"),
                    "period": item.get("period") or item.get("duration") or item.get("date"),
                    "details": [str(detail) for detail in details if detail],
                }
            )
        return normalized

    @staticmethod
    def _normalize_experience(value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            company = item.get("company") or item.get("organization") or item.get("name")
            role = item.get("role") or item.get("title") or item.get("position")
            if not company and not role:
                continue
            normalized.append(
                {
                    "company": str(company or "经历"),
                    "role": str(role or "角色"),
                    "period": item.get("period") or item.get("duration") or item.get("date"),
                    "bullets": ProductizedDraftService._normalize_string_list(item.get("bullets")),
                    "tags": ProductizedDraftService._normalize_string_list(item.get("tags")),
                }
            )
        return normalized

    @staticmethod
    def _normalize_projects(value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            name = item.get("name") or item.get("title") or item.get("projectName")
            if not name:
                continue
            normalized.append(
                {
                    "name": str(name),
                    "role": item.get("role"),
                    "organization": item.get("organization") or item.get("course") or item.get("team"),
                    "period": item.get("period") or item.get("duration") or item.get("date"),
                    "bullets": ProductizedDraftService._normalize_string_list(item.get("bullets")),
                    "tags": ProductizedDraftService._normalize_string_list(item.get("tags")),
                }
            )
        return normalized

    @staticmethod
    def _normalize_dynamic_sections(value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        normalized: list[dict[str, Any]] = []
        for section in value:
            if not isinstance(section, dict):
                continue
            items = section.get("items") if isinstance(section.get("items"), list) else []
            normalized_items = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                name = item.get("name") or item.get("title") or item.get("projectName")
                if not name:
                    continue
                confidence = item.get("confidence")
                normalized_items.append(
                    {
                        "id": str(item.get("id")) if item.get("id") else None,
                        "name": str(name),
                        "organization": item.get("organization") or item.get("company") or item.get("team"),
                        "role": item.get("role") or item.get("position"),
                        "period": item.get("period") or item.get("duration") or item.get("date"),
                        "location": item.get("location"),
                        "bullets": ProductizedDraftService._normalize_string_list(item.get("bullets")),
                        "tags": ProductizedDraftService._normalize_string_list(item.get("tags")),
                        "confidence": confidence if confidence in ["high", "medium", "low"] else "medium",
                    }
                )
            normalized.append(
                {
                    "type": str(section.get("type") or "other"),
                    "title": str(section.get("title") or "其他经历"),
                    "items": normalized_items,
                }
            )
        return normalized

    @staticmethod
    def _normalize_gap(gap: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": str(gap.get("type") or "missing_info"),
            "priority": gap.get("priority") if gap.get("priority") in ["high", "medium", "low"] else "medium",
            "description": str(gap.get("description") or "需要补充更多信息。"),
        }

    @staticmethod
    def _normalize_question_text(value: Any) -> str | None:
        if value is None:
            return None
        if isinstance(value, str):
            text = value.strip()
            return text or None
        if isinstance(value, dict):
            for key in ["question", "content", "text", "userVisibleQuestion"]:
                item = value.get(key)
                if isinstance(item, str) and item.strip():
                    return item.strip()
            parts = [value.get("gapLabel"), value.get("reason")]
            text = " ".join(str(part).strip() for part in parts if part)
            return text or None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _normalize_section_report(report: dict[str, Any]) -> dict[str, Any]:
        gaps = report.get("gaps") if isinstance(report.get("gaps"), list) else []
        item_reports = report.get("itemReports") if isinstance(report.get("itemReports"), list) else []
        return {
            "sectionKey": str(report.get("sectionKey") or "unknown"),
            "title": str(report.get("title") or "未命名板块"),
            "status": report.get("status")
            if report.get("status") in ["missing", "insufficient", "usable", "strong", "hidden"]
            else "insufficient",
            "importance": report.get("importance")
            if report.get("importance") in ["high", "medium", "low"]
            else "medium",
            "completeness": ProductizedDraftService._to_score(report.get("completeness")),
            "jobRelevance": ProductizedDraftService._to_score(report.get("jobRelevance")),
            "contentStrength": ProductizedDraftService._to_score(report.get("contentStrength")),
            "truthfulnessRisk": report.get("truthfulnessRisk")
            if report.get("truthfulnessRisk") in ["low", "medium", "high"]
            else "low",
            "summary": str(report.get("summary") or "该板块仍需补充。"),
            "gaps": [
                ProductizedDraftService._normalize_gap(gap)
                for gap in gaps
                if isinstance(gap, dict)
            ],
            "itemReports": [
                {
                    "itemId": item.get("itemId"),
                    "itemName": item.get("itemName"),
                    "score": ProductizedDraftService._to_score(item.get("score")),
                    "gaps": [
                        ProductizedDraftService._normalize_gap(gap)
                        for gap in (item.get("gaps") if isinstance(item.get("gaps"), list) else [])
                        if isinstance(gap, dict)
                    ],
                    "nextQuestion": ProductizedDraftService._normalize_question_text(
                        item.get("nextQuestion")
                    ),
                }
                for item in item_reports
                if isinstance(item, dict)
            ],
            "nextQuestion": ProductizedDraftService._normalize_question_text(
                report.get("nextQuestion")
            ),
        }

    @staticmethod
    def _normalize_resume_report(report: dict[str, Any]) -> dict[str, Any]:
        readiness = report.get("readiness")
        truthfulness_risk = report.get("truthfulnessRisk")
        return {
            "overallScore": ProductizedDraftService._to_score(report.get("overallScore")),
            "readiness": readiness if readiness in ["not_ready", "draft_ready", "strong_ready"] else "not_ready",
            "structureCompleteness": ProductizedDraftService._to_score(report.get("structureCompleteness")),
            "jobMatchScore": ProductizedDraftService._to_score(report.get("jobMatchScore")),
            "evidenceStrength": ProductizedDraftService._to_score(report.get("evidenceStrength")),
            "readabilityScore": ProductizedDraftService._to_score(report.get("readabilityScore")),
            "truthfulnessRisk": truthfulness_risk if truthfulness_risk in ["low", "medium", "high"] else "low",
            "missingSections": report.get("missingSections") if isinstance(report.get("missingSections"), list) else [],
            "weakSections": report.get("weakSections") if isinstance(report.get("weakSections"), list) else [],
            "coveredAbilities": report.get("coveredAbilities") if isinstance(report.get("coveredAbilities"), list) else [],
            "uncoveredAbilities": report.get("uncoveredAbilities") if isinstance(report.get("uncoveredAbilities"), list) else [],
            "globalGaps": report.get("globalGaps") if isinstance(report.get("globalGaps"), list) else [],
            "nextBestAction": str(report.get("nextBestAction") or "请继续补充简历资料。"),
        }
