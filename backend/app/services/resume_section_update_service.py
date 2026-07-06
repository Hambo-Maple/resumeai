from typing import Any

from sqlalchemy.orm import Session

from app.schemas.resume import (
    ProductizedDraftRequest,
    UpdateResumeSectionRequest,
    UpdateResumeSectionResponse,
)
from app.services.llm_service import LLMService
from app.services.productized_draft_service import ProductizedDraftService
from app.services.prompt_service import PromptService


STATIC_SECTION_KEYS = {
    "basics",
    "target",
    "summary",
    "education",
    "skills",
    "certificates",
    "awards",
    "additional",
}

DYNAMIC_SECTION_KEYS = {
    "work",
    "internship",
    "project",
    "campus",
    "research",
    "competition",
    "volunteer",
    "other",
}


class ResumeSectionUpdateService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def update_section(
        self, payload: UpdateResumeSectionRequest
    ) -> UpdateResumeSectionResponse:
        prompt_input = {
            "company": payload.company,
            "position": payload.position,
            "jobDescription": payload.job_description,
            "questionTarget": payload.question_target.model_dump(by_alias=True),
            "resumeDocument": payload.resume_document.model_dump(by_alias=True),
            "sectionReport": payload.section_report.model_dump(by_alias=True),
            "itemReport": payload.item_report.model_dump(by_alias=True)
            if payload.item_report
            else None,
            "historyAnswers": [
                item.model_dump(by_alias=True) for item in payload.history_answers
            ],
            "question": payload.question,
            "answer": payload.answer,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="update_resume_section_from_dialogue",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="update_resume_section_from_dialogue",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
        )
        normalized = self._normalize_output(output, payload)
        return UpdateResumeSectionResponse.model_validate(normalized)

    @staticmethod
    def _normalize_output(
        output: dict[str, Any], payload: UpdateResumeSectionRequest
    ) -> dict[str, Any]:
        if not isinstance(output, dict):
            output = {}

        draft_payload = ProductizedDraftRequest(
            company=payload.company,
            position=payload.position,
            jobDescription=payload.job_description,
            sectionInputs=[],
        )
        normalized_draft = ProductizedDraftService._normalize_output(
            {
                "resumeDocument": output.get("resumeDocument")
                if isinstance(output.get("resumeDocument"), dict)
                else payload.resume_document.model_dump(by_alias=True),
                "sectionQualityReports": [
                    output.get("updatedSectionReport")
                    if isinstance(output.get("updatedSectionReport"), dict)
                    else payload.section_report.model_dump(by_alias=True)
                ],
                "resumeQualityReport": {},
                "growthMap": {},
                "nextQuestion": output.get("nextQuestion")
                if isinstance(output.get("nextQuestion"), dict)
                else None,
            },
            draft_payload,
        )

        section_report = (
            normalized_draft["sectionQualityReports"][0]
            if normalized_draft["sectionQualityReports"]
            else ProductizedDraftService._normalize_section_report(
                payload.section_report.model_dump(by_alias=True)
            )
        )
        next_question = normalized_draft.get("nextQuestion")
        is_complete = output.get("isCompleteForDraft")
        if not isinstance(is_complete, bool):
            is_complete = (
                not next_question
                and section_report.get("status") in ["usable", "strong", "hidden"]
            )

        stable_document = ResumeSectionUpdateService._merge_document_by_target(
            payload.resume_document.model_dump(by_alias=True),
            normalized_draft["resumeDocument"],
            payload.question_target.model_dump(by_alias=True),
        )

        return {
            "resumeDocument": stable_document,
            "updatedSectionReport": section_report,
            "nextQuestion": next_question,
            "isCompleteForDraft": is_complete,
            "updateSummary": str(
                output.get("updateSummary") or "已更新当前简历板块。"
            ),
        }

    @staticmethod
    def _merge_document_by_target(
        current_document: dict[str, Any],
        updated_document: dict[str, Any],
        target: dict[str, Any],
    ) -> dict[str, Any]:
        section_key = target.get("sectionKey")
        if not isinstance(section_key, str) or not section_key:
            return current_document

        merged = dict(current_document)
        if section_key in STATIC_SECTION_KEYS:
            if section_key in updated_document:
                merged[section_key] = updated_document[section_key]
            return merged

        if section_key not in DYNAMIC_SECTION_KEYS:
            return merged

        current_sections = list(current_document.get("sections") or [])
        updated_sections = list(updated_document.get("sections") or [])
        updated_section = next(
            (
                section
                for section in updated_sections
                if isinstance(section, dict) and section.get("type") == section_key
            ),
            None,
        )
        if not isinstance(updated_section, dict):
            return merged

        section_index = next(
            (
                index
                for index, section in enumerate(current_sections)
                if isinstance(section, dict) and section.get("type") == section_key
            ),
            -1,
        )
        if section_index < 0:
            merged["sections"] = [*current_sections, updated_section]
            return merged

        current_section = dict(current_sections[section_index])
        item_id = target.get("itemId")
        item_name = target.get("itemName")
        if item_id or item_name:
            current_items = list(current_section.get("items") or [])
            updated_items = list(updated_section.get("items") or [])
            updated_item = ResumeSectionUpdateService._find_item(
                updated_items,
                item_id,
                item_name,
            )
            if not isinstance(updated_item, dict):
                return merged

            item_index = ResumeSectionUpdateService._find_item_index(
                current_items,
                item_id,
                item_name,
            )
            if item_index < 0:
                current_section["items"] = [*current_items, updated_item]
            else:
                next_items = list(current_items)
                next_items[item_index] = updated_item
                current_section["items"] = next_items
            next_section = current_section
        else:
            next_section = updated_section

        next_sections = list(current_sections)
        next_sections[section_index] = next_section
        merged["sections"] = next_sections
        return merged

    @staticmethod
    def _find_item(
        items: list[Any],
        item_id: Any,
        item_name: Any,
    ) -> dict[str, Any] | None:
        item_index = ResumeSectionUpdateService._find_item_index(
            items,
            item_id,
            item_name,
        )
        if item_index < 0:
            return None
        item = items[item_index]
        return item if isinstance(item, dict) else None

    @staticmethod
    def _find_item_index(items: list[Any], item_id: Any, item_name: Any) -> int:
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            if item_id and item.get("id") == item_id:
                return index
            if not item_id and item_name and item.get("name") == item_name:
                return index
        return -1
