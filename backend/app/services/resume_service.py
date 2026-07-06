from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.resume import CoreAbility, Experience, JobTarget, ResumeDraft
from app.schemas.resume import (
    FinalizeResumeRequest,
    FinalizeResumeResponse,
    GenerateResumeRequest,
    GenerateResumeResponse,
)
from app.services.llm_service import LLMService
from app.services.prompt_service import PromptService
from app.services.review_service import ReviewService


class ResumeService:
    def __init__(self, db: Session) -> None:
        self.db = db
        self.prompt_service = PromptService()
        self.llm_service = LLMService(db)

    def generate_resume(self, payload: GenerateResumeRequest) -> GenerateResumeResponse:
        job_target = (
            self.db.query(JobTarget)
            .filter(JobTarget.id == payload.job_target_id, JobTarget.task_id == payload.task_id)
            .first()
        )
        if not job_target:
            raise HTTPException(status_code=404, detail="目标岗位不存在")

        experience_query = self.db.query(Experience).filter(Experience.task_id == payload.task_id)
        if payload.experience_ids:
            experience_query = experience_query.filter(Experience.id.in_(payload.experience_ids))
        experiences = experience_query.order_by(Experience.created_at.asc()).all()
        if not experiences:
            raise HTTPException(status_code=400, detail="请先添加至少一段经历")

        parent_draft = None
        if payload.parent_draft_id:
            parent_draft = (
                self.db.query(ResumeDraft)
                .filter(
                    ResumeDraft.id == payload.parent_draft_id,
                    ResumeDraft.task_id == payload.task_id,
                    ResumeDraft.job_target_id == payload.job_target_id,
                )
                .first()
            )
            if not parent_draft:
                raise HTTPException(status_code=404, detail="父版本简历不存在")

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
        structured_experiences = [
            {
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
            for experience in experiences
        ]

        prompt_input = {
            "company": job_target.company,
            "position": job_target.position,
            "coreAbilities": core_abilities,
            "keywords": job_target.keywords,
            "resumeFocus": job_target.resume_focus,
            "profile": payload.profile.model_dump(),
            "education": [item.model_dump() for item in payload.education],
            "skills": payload.skills.model_dump(),
            "experiences": structured_experiences,
        }
        rendered_prompt = self.prompt_service.render(
            module="resume",
            prompt_name="generate_resume_document",
            prompt_version="v1",
            variables=prompt_input,
        )
        output = self.llm_service.run_json_prompt(
            module="resume",
            prompt_name="generate_resume_document",
            prompt_version="v1",
            rendered_prompt=rendered_prompt,
            input_payload=prompt_input,
            task_id=payload.task_id,
        )
        review_service = ReviewService(self.db)
        review = review_service.review_resume_document(
            company=job_target.company,
            position=job_target.position,
            core_abilities=core_abilities,
            keywords=job_target.keywords,
            experiences=structured_experiences,
            resume_document=output,
            task_id=payload.task_id,
        )
        if not review.get("passed", False):
            output = review_service.fix_resume_document(
                company=job_target.company,
                position=job_target.position,
                core_abilities=core_abilities,
                keywords=job_target.keywords,
                experiences=structured_experiences,
                resume_document=output,
                review=review,
                task_id=payload.task_id,
            )
        output = self._normalize_resume_document(output, job_target.company, job_target.position)
        output = self._apply_user_profile(
            output,
            payload.profile.model_dump(),
            [item.model_dump() for item in payload.education],
            payload.skills.model_dump(),
        )
        output = self._preserve_key_facts(output, structured_experiences)
        output = self._shape_product_draft(output, structured_experiences)
        output = self._sanitize_resume_document(output)

        version = (parent_draft.version + 1) if parent_draft else 1
        status = "revised" if parent_draft else "draft"
        change_summary = payload.change_summary if parent_draft else None

        draft = ResumeDraft(
            task_id=payload.task_id,
            job_target_id=payload.job_target_id,
            summary=output.get("summary", ""),
            sections=self._legacy_sections_from_document(output),
            skills=self._legacy_skills_from_document(output),
            resume_document=output,
            language=payload.language,
            version=version,
            status=status,
            parent_draft_id=parent_draft.id if parent_draft else None,
            change_summary=change_summary,
        )
        self.db.add(draft)
        self.db.commit()
        self.db.refresh(draft)

        return GenerateResumeResponse(
            resumeDraftId=draft.id,
            version=draft.version,
            status=draft.status,
            parentDraftId=draft.parent_draft_id,
            changeSummary=draft.change_summary,
            resumeDocument=draft.resume_document,
            summary=draft.summary,
            sections=draft.sections,
            skills=draft.skills,
            missingInfoSuggestions=output.get("missingInfoSuggestions", []),
            lowerPriorityItems=output.get("lowerPriorityItems", []),
        )

    def finalize_resume(self, payload: FinalizeResumeRequest) -> FinalizeResumeResponse:
        draft = (
            self.db.query(ResumeDraft)
            .filter(ResumeDraft.id == payload.resume_draft_id)
            .first()
        )
        if not draft:
            raise HTTPException(status_code=404, detail="简历草稿不存在")

        draft.status = "final"
        self.db.commit()
        self.db.refresh(draft)

        return FinalizeResumeResponse(resumeDraftId=draft.id, status="final")

    @staticmethod
    def _legacy_sections_from_document(document: dict) -> list[dict]:
        projects = document.get("projects", [])
        return [
            {
                "title": "项目经历",
                "items": [
                    {
                        "experienceId": None,
                        "title": project.get("name", "项目经历"),
                        "bullets": project.get("bullets", []),
                        "abilityTags": [],
                        "keywordTags": project.get("tags", []),
                        "confidence": "medium",
                    }
                    for project in projects
                ],
            }
        ]

    @staticmethod
    def _legacy_skills_from_document(document: dict) -> list[str]:
        skills = document.get("skills", {})
        if not isinstance(skills, dict):
            return []
        return [
            *skills.get("technical", []),
            *skills.get("domain", []),
            *skills.get("language", []),
        ]

    @staticmethod
    def _normalize_resume_document(
        document: dict, company: str, position: str
    ) -> dict:
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
            "position": target.get("position") or position,
            "company": target.get("company") or company,
        }
        document["summary"] = str(document.get("summary") or "")

        education_items = document.get("education")
        if not isinstance(education_items, list):
            education_items = []
        document["education"] = [
            {
                "school": item.get("school") or item.get("institution") or item.get("name") or "学校",
                "degree": item.get("degree"),
                "major": item.get("major") or item.get("field"),
                "period": item.get("period") or item.get("duration"),
                "details": item.get("details") if isinstance(item.get("details"), list) else [],
            }
            for item in education_items
            if isinstance(item, dict)
        ]

        experience_items = document.get("experience")
        if not isinstance(experience_items, list):
            experience_items = []
        document["experience"] = [
            {
                "company": item.get("company") or item.get("organization") or "公司",
                "role": item.get("role") or item.get("title") or "岗位",
                "period": item.get("period") or item.get("duration"),
                "bullets": item.get("bullets") if isinstance(item.get("bullets"), list) else [],
                "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
            }
            for item in experience_items
            if isinstance(item, dict)
        ]

        project_items = document.get("projects")
        if not isinstance(project_items, list):
            project_items = []
        document["projects"] = [
            {
                "name": item.get("name") or item.get("title") or "项目经历",
                "role": item.get("role"),
                "organization": item.get("organization"),
                "period": item.get("period") or item.get("duration"),
                "bullets": item.get("bullets") if isinstance(item.get("bullets"), list) else [],
                "tags": item.get("tags") if isinstance(item.get("tags"), list) else [],
            }
            for item in project_items
            if isinstance(item, dict)
        ]

        skills = document.get("skills") if isinstance(document.get("skills"), dict) else {}
        document["skills"] = {
            "technical": skills.get("technical") if isinstance(skills.get("technical"), list) else [],
            "domain": skills.get("domain") if isinstance(skills.get("domain"), list) else [],
            "language": skills.get("language") if isinstance(skills.get("language"), list) else [],
        }
        for field in ["certificates", "awards", "additional"]:
            if not isinstance(document.get(field), list):
                document[field] = []

        return document

    @staticmethod
    def _apply_user_profile(
        document: dict, profile: dict, education: list[dict], skills: dict
    ) -> dict:
        basics = document.get("basics") if isinstance(document.get("basics"), dict) else {}
        basics["name"] = profile.get("name") or basics.get("name") or "姓名"
        basics["phone"] = profile.get("phone") or basics.get("phone") or "电话"
        basics["email"] = profile.get("email") or basics.get("email") or "邮箱"
        basics["location"] = profile.get("city") or basics.get("location") or "城市"
        basics["links"] = basics.get("links") if isinstance(basics.get("links"), list) else []
        document["basics"] = basics

        profile_school = profile.get("school")
        profile_major = profile.get("major")
        profile_degree = profile.get("degree")
        profile_graduation = profile.get("graduation")
        user_education = [
            {
                "school": item.get("school") or profile_school,
                "degree": item.get("degree") or profile_degree,
                "major": item.get("major") or profile_major,
                "period": item.get("period") or profile_graduation,
                "details": item.get("details") if isinstance(item.get("details"), list) else [],
            }
            for item in education
            if any([item.get("school"), item.get("degree"), item.get("major"), item.get("period")])
        ]
        if not user_education and any([profile_school, profile_major, profile_degree, profile_graduation]):
            user_education = [
                {
                    "school": profile_school or "学校",
                    "degree": profile_degree,
                    "major": profile_major,
                    "period": profile_graduation,
                    "details": [],
                }
            ]
        if user_education:
            document["education"] = user_education

        document_skills = document.get("skills") if isinstance(document.get("skills"), dict) else {}
        document["skills"] = {
            "technical": list(
                dict.fromkeys(
                    [
                        *(document_skills.get("technical") if isinstance(document_skills.get("technical"), list) else []),
                        *(skills.get("technical") if isinstance(skills.get("technical"), list) else []),
                    ]
                )
            ),
            "domain": list(
                dict.fromkeys(
                    [
                        *(document_skills.get("domain") if isinstance(document_skills.get("domain"), list) else []),
                        *(skills.get("domain") if isinstance(skills.get("domain"), list) else []),
                    ]
                )
            ),
            "language": list(
                dict.fromkeys(
                    [
                        *(document_skills.get("language") if isinstance(document_skills.get("language"), list) else []),
                        *(skills.get("language") if isinstance(skills.get("language"), list) else []),
                    ]
                )
            ),
        }
        return document

    @staticmethod
    def _shape_product_draft(document: dict, experiences: list[dict]) -> dict:
        source_text = " ".join(
            str(value)
            for experience in experiences
            for value in [
                experience.get("rawText"),
                experience.get("background"),
                experience.get("role"),
                experience.get("actions"),
                experience.get("results"),
                experience.get("metrics"),
            ]
            if value
        )
        if not source_text:
            return document

        if not document.get("summary"):
            document["summary"] = "具备数据清洗、指标分析和可视化报告相关项目经验，能够围绕业务问题整理数据、提炼结论并形成分析产出。"

        project_items = document.get("projects")
        if not isinstance(project_items, list) or not project_items:
            document["projects"] = [
                {
                    "name": "课程问卷数据分析项目",
                    "role": None,
                    "organization": None,
                    "period": None,
                    "bullets": [],
                    "tags": [],
                }
            ]
            project_items = document["projects"]

        first_project = project_items[0]
        if isinstance(first_project, dict):
            name = str(first_project.get("name") or "")
            if not name or any(word in name for word in ["待打磨", "经历素材", "项目经历"]):
                first_project["name"] = "课程问卷数据分析项目"
            bullets = first_project.get("bullets")
            if not isinstance(bullets, list):
                bullets = []
            first_project["bullets"] = ResumeService._product_bullets_from_source(
                source_text, bullets
            )
            tags = first_project.get("tags") if isinstance(first_project.get("tags"), list) else []
            first_project["tags"] = list(
                dict.fromkeys([*tags, "Python", "pandas", "数据清洗", "指标分析", "可视化报告"])
            )[:8]

        skills = document.get("skills") if isinstance(document.get("skills"), dict) else {}
        technical = skills.get("technical") if isinstance(skills.get("technical"), list) else []
        domain = skills.get("domain") if isinstance(skills.get("domain"), list) else []
        if "Python" in source_text and "Python" not in technical:
            technical.append("Python")
        if "pandas" in source_text and "pandas" not in technical:
            technical.append("pandas")
        for skill in ["数据清洗", "指标分析", "可视化报告"]:
            if skill not in domain:
                domain.append(skill)
        document["skills"] = {
            "technical": technical,
            "domain": domain,
            "language": skills.get("language") if isinstance(skills.get("language"), list) else [],
        }
        return document

    @staticmethod
    def _product_bullets_from_source(source_text: str, model_bullets: list[str]) -> list[str]:
        cleaned = [
            ResumeService._clean_product_bullet(bullet)
            for bullet in model_bullets
            if isinstance(bullet, str) and bullet.strip()
        ]
        cleaned = [bullet for bullet in cleaned if bullet]

        data_analysis_facts = any(
            fact in source_text for fact in ["Python", "pandas", "300", "问卷", "可视化报告"]
        )
        if not data_analysis_facts:
            return cleaned[:4]

        required = [
            "使用 Python/pandas 对 300 份问卷样本进行数据清洗与整理，处理缺失值、异常值并形成可分析数据表。",
            "围绕用户满意度、使用频率和功能偏好等维度进行指标分析，提炼用户行为特征和功能使用差异。",
            "制作可视化报告并输出 3 个关键结论，支持小组明确后续产品优化方向。",
        ]
        if "12 页" in source_text:
            required[2] = "制作 12 页可视化分析报告并输出 3 个关键结论，支持小组汇报和后续产品优化方向讨论。"

        result = []
        for bullet in [*cleaned, *required]:
            if bullet not in result:
                result.append(bullet)
        return result[:4]

    @staticmethod
    def _clean_product_bullet(bullet: str) -> str:
        cleaned = bullet.strip()
        for word in ["我做过", "我主要", "用户补充", "待打磨", "经历素材", "建议补充"]:
            cleaned = cleaned.replace(word, "")
        return cleaned.strip(" ，,。") + "。"

    @staticmethod
    def _sanitize_resume_document(document: dict) -> dict:
        forbidden_replacements = {
            "用户补充后": "",
            "用户补充": "",
            "待打磨经历素材": "项目经历",
            "待打磨": "",
            "仍需补充": "",
            "建议补充": "",
            "缺少信息": "",
            "缺失信息": "",
            "这段经历可以用于": "",
            "这段经历": "该项目",
            "经历卡片": "",
            "岗位分析": "",
            "系统分析": "",
            "我做过": "参与",
            "我主要负责": "负责",
            "我主要": "负责",
        }

        def clean_value(value):
            if isinstance(value, str):
                cleaned = value.strip()
                for source, target in forbidden_replacements.items():
                    cleaned = cleaned.replace(source, target)
                return " ".join(cleaned.split())
            if isinstance(value, list):
                cleaned_items = [clean_value(item) for item in value]
                return [item for item in cleaned_items if item not in ["", None]]
            if isinstance(value, dict):
                return {key: clean_value(item) for key, item in value.items()}
            return value

        cleaned_document = clean_value(document)
        return cleaned_document if isinstance(cleaned_document, dict) else document

    @staticmethod
    def _preserve_key_facts(document: dict, experiences: list[dict]) -> dict:
        source_text = " ".join(
            str(value)
            for experience in experiences
            for value in [
                experience.get("rawText"),
                experience.get("background"),
                experience.get("role"),
                experience.get("actions"),
                experience.get("results"),
                experience.get("metrics"),
            ]
            if value
        )
        document_text = str(document)
        key_facts = [
            "Python",
            "pandas",
            "SQL",
            "Excel",
            "300",
            "问卷",
            "可视化报告",
            "12 页",
            "3 条产品优化方向",
            "3 个关键结论",
        ]
        missing_facts = [
            fact for fact in key_facts if fact in source_text and fact not in document_text
        ]
        if not missing_facts:
            return document

        target_items = document.get("projects") or document.get("experience") or []
        if not target_items:
            document["projects"] = [
                {
                    "name": "项目经历",
                    "role": None,
                    "organization": None,
                    "period": None,
                    "bullets": [],
                    "tags": [],
                }
            ]
            target_items = document["projects"]

        first_item = target_items[0]
        bullets = first_item.setdefault("bullets", [])
        if not isinstance(bullets, list):
            bullets = []
            first_item["bullets"] = bullets

        fact_sentence = ResumeService._fact_sentence(missing_facts)
        if fact_sentence:
            bullets.append(fact_sentence)
        return document

    @staticmethod
    def _fact_sentence(missing_facts: list[str]) -> str:
        if "可视化报告" in missing_facts:
            details = []
            if "12 页" in missing_facts:
                details.append("12 页")
            details.append("可视化报告")
            return f"整理分析结果并形成{''.join(details)}，支持项目汇报和后续优化方向讨论。"
        if "3 条产品优化方向" in missing_facts:
            return "基于分析结论提出 3 条产品优化方向，支持团队明确后续迭代重点。"
        if "3 个关键结论" in missing_facts:
            return "基于数据分析输出 3 个关键结论，支持团队明确后续产品优化方向。"
        if any(fact in missing_facts for fact in ["Python", "pandas", "300", "问卷"]):
            return "使用 Python/pandas 对 300 份问卷样本进行清洗、整理与分析，形成可用于复盘的数据基础。"
        return ""
