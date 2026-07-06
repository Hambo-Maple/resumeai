import base64
import json
import re
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile
from openai import OpenAI

from app.core.config import settings
from app.schemas.user_profile import (
    CreateUserExperienceRequest,
    CreateUserProfileRequest,
    ImportedResumeResponse,
    ImportedResumeSource,
    UserEducationInput,
    UserSkillsInput,
)


class ResumeImportService:
    MAX_FILE_SIZE = 8 * 1024 * 1024
    MAX_RAW_TEXT_SIZE = 120_000

    async def import_resume(self, file: UploadFile) -> ImportedResumeResponse:
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="上传文件为空")
        if len(data) > self.MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="文件过大，请上传 8MB 以内的简历文件")

        file_name = file.filename or "resume"
        suffix = Path(file_name).suffix.lower()
        content_type = file.content_type
        if self._is_image_file(suffix, content_type):
            parsed = self._parse_image_resume(data, suffix, content_type)
            source = ImportedResumeSource(
                fileName=file_name,
                contentType=content_type,
                rawText=parsed.pop("raw_text"),
            )
            return ImportedResumeResponse(source=source, **parsed)

        raw_text = self._extract_text(data, suffix)
        if not raw_text.strip():
            raise HTTPException(status_code=400, detail="没有从文件中读取到可解析文本")

        raw_text = raw_text[: self.MAX_RAW_TEXT_SIZE]
        parsed = self._parse_json_resume(raw_text)
        if parsed is None:
            parsed = self._parse_text_resume(raw_text)

        source = ImportedResumeSource(
            fileName=file_name,
            contentType=content_type,
            rawText=raw_text,
        )
        return ImportedResumeResponse(source=source, **parsed)

    def _extract_text(self, data: bytes, suffix: str) -> str:
        if suffix in {".txt", ".md", ".json", ""}:
            return self._decode_text(data)
        if suffix == ".pdf":
            return self._extract_pdf_text(data)
        if suffix == ".docx":
            return self._extract_docx_text(data)
        raise HTTPException(
            status_code=400,
            detail="暂不支持该文件类型，请上传 txt、md、json、pdf、docx 或图片简历",
        )

    @staticmethod
    def _is_image_file(suffix: str, content_type: str | None) -> bool:
        return suffix in {".png", ".jpg", ".jpeg", ".webp"} or (
            content_type is not None and content_type.startswith("image/")
        )

    def _parse_image_resume(
        self, data: bytes, suffix: str, content_type: str | None
    ) -> dict[str, Any]:
        if not settings.openai_api_key:
            raise HTTPException(status_code=500, detail="后端未配置 OPENAI_API_KEY，暂不能解析图片简历")

        mime_type = content_type or self._mime_type_from_suffix(suffix)
        image_url = f"data:{mime_type};base64,{base64.b64encode(data).decode('ascii')}"
        prompt = """
你是简历图片解析器。请从图片简历中提取可用于个人资料模块的信息。

只输出合法 JSON，不要输出 Markdown。不要编造图片中没有的信息。

JSON 格式：
{
  "rawText": "尽量完整转写图片中的简历文字",
  "profile": {
    "name": null,
    "phone": null,
    "email": null,
    "city": null,
    "school": null,
    "major": null,
    "degree": null,
    "graduation": null,
    "links": [],
    "skills": {
      "technical": [],
      "tools": [],
      "domain": [],
      "language": []
    },
    "education": [
      {
        "school": null,
        "degree": null,
        "major": null,
        "period": null,
        "details": []
      }
    ],
    "extraInfo": {
      "importedCertificates": [],
      "importedAwards": [],
      "importedAdditional": []
    }
  },
  "experiences": [
    {
      "type": "internship|project|course|research|competition|campus|volunteer|work|other",
      "title": "经历标题",
      "organization": null,
      "role": null,
      "startDate": null,
      "endDate": null,
      "location": null,
      "description": "经历概述",
      "highlights": [],
      "metrics": [],
      "skills": [],
      "rawText": "这段经历的原文",
      "extraInfo": {}
    }
  ],
  "warnings": []
}

字段规则：
- phone/email/link 必须来自图片原文。
- education 只放教育背景，不要把“专业技能”误当作专业字段。
- experiences 按图片里的实习、项目、工作、校园、科研、竞赛等经历拆分。
- 无法确认的字段填 null 或空数组。
"""
        client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
        try:
            output = self._call_vision_model(client, prompt, image_url)
        except Exception as exc:
            detail = str(exc)
            if "unknown variant" in detail or "expected `text`" in detail:
                detail = (
                    "当前配置的模型接口不支持图片输入。请切换到支持视觉输入的 OpenAI 接口，"
                    "或配置 VISION_MODEL 为视觉模型后重试。"
                )
            raise HTTPException(status_code=502, detail=f"图片简历解析失败：{detail}") from exc

        profile_payload = output.get("profile") if isinstance(output.get("profile"), dict) else {}
        profile = CreateUserProfileRequest(
            name=self._string_or_none(profile_payload.get("name")),
            phone=self._string_or_none(profile_payload.get("phone")),
            email=self._string_or_none(profile_payload.get("email")),
            city=self._string_or_none(profile_payload.get("city")),
            school=self._string_or_none(profile_payload.get("school")),
            major=self._string_or_none(profile_payload.get("major")),
            degree=self._string_or_none(profile_payload.get("degree")),
            graduation=self._string_or_none(profile_payload.get("graduation")),
            links=self._list_of_strings(profile_payload.get("links")),
            skills=UserSkillsInput(**self._skills_from_dict(profile_payload.get("skills"))),
            education=[
                UserEducationInput(**item)
                for item in experiences_safe_list(profile_payload.get("education"))
                if isinstance(item, dict)
            ],
            extraInfo=profile_payload.get("extraInfo")
            if isinstance(profile_payload.get("extraInfo"), dict)
            else {},
        )
        experiences = [
            self._experience_from_dict(item)
            for item in experiences_safe_list(output.get("experiences"))
            if isinstance(item, dict)
            and self._string_or_none(item.get("title") or item.get("name"))
        ]
        raw_text = str(output.get("rawText") or output.get("raw_text") or "").strip()
        if not raw_text:
            raw_text = "[图片简历文字由视觉模型解析，未返回完整转写文本]"
        warnings = self._list_of_strings(output.get("warnings"))
        return {
            "profile": profile,
            "experiences": experiences,
            "warnings": warnings,
            "raw_text": raw_text,
        }

    def _call_vision_model(self, client: OpenAI, prompt: str, image_url: str) -> dict[str, Any]:
        model = settings.vision_model or settings.llm_model
        responses_error: Exception | None = None
        try:
            response = client.responses.create(
                model=model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": prompt},
                            {"type": "input_image", "image_url": image_url},
                        ],
                    }
                ],
                text={"format": {"type": "json_object"}},
            )
            content = getattr(response, "output_text", None)
            if not content:
                content = self._extract_response_text(response)
            return json.loads(content or "{}")
        except Exception as exc:
            responses_error = exc

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": image_url}},
                        ],
                    }
                ],
                response_format={"type": "json_object"},
            )
            return json.loads(response.choices[0].message.content or "{}")
        except Exception as chat_exc:
            raise RuntimeError(
                f"Responses API error: {responses_error}; Chat Completions error: {chat_exc}"
            ) from chat_exc

    @staticmethod
    def _extract_response_text(response: object) -> str:
        output = getattr(response, "output", None)
        if not isinstance(output, list):
            return ""
        parts = []
        for item in output:
            content = getattr(item, "content", None)
            if not isinstance(content, list):
                continue
            for content_item in content:
                text = getattr(content_item, "text", None)
                if isinstance(text, str):
                    parts.append(text)
        return "\n".join(parts)

    @staticmethod
    def _mime_type_from_suffix(suffix: str) -> str:
        if suffix == ".png":
            return "image/png"
        if suffix == ".webp":
            return "image/webp"
        return "image/jpeg"

    @staticmethod
    def _decode_text(data: bytes) -> str:
        for encoding in ("utf-8-sig", "utf-8", "gb18030"):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                continue
        return data.decode("utf-8", errors="ignore")

    @staticmethod
    def _extract_pdf_text(data: bytes) -> str:
        try:
            from pypdf import PdfReader
        except ImportError as exc:
            raise HTTPException(status_code=500, detail="后端缺少 pypdf，暂不能解析 PDF") from exc

        reader = PdfReader(BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)

    @staticmethod
    def _extract_docx_text(data: bytes) -> str:
        try:
            from docx import Document
        except ImportError as exc:
            raise HTTPException(
                status_code=500, detail="后端缺少 python-docx，暂不能解析 Word 简历"
            ) from exc

        document = Document(BytesIO(data))
        return "\n".join(paragraph.text for paragraph in document.paragraphs)

    def _parse_json_resume(self, raw_text: str) -> dict[str, Any] | None:
        text = raw_text.strip()
        if not text.startswith("{"):
            return None
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            return None
        if not isinstance(payload, dict):
            return None

        profile_payload = payload.get("profile") if isinstance(payload.get("profile"), dict) else payload
        experiences_payload = payload.get("experiences") if isinstance(payload.get("experiences"), list) else []
        extra_info = profile_payload.get("extraInfo") or profile_payload.get("extra_info") or {}
        if not isinstance(extra_info, dict):
            extra_info = {}

        profile = CreateUserProfileRequest(
            name=self._string_or_none(profile_payload.get("name")),
            phone=self._string_or_none(profile_payload.get("phone")),
            email=self._string_or_none(profile_payload.get("email")),
            city=self._string_or_none(profile_payload.get("city")),
            school=self._string_or_none(profile_payload.get("school")),
            major=self._string_or_none(profile_payload.get("major")),
            degree=self._string_or_none(profile_payload.get("degree")),
            graduation=self._string_or_none(profile_payload.get("graduation")),
            links=self._list_of_strings(profile_payload.get("links")),
            skills=UserSkillsInput(**self._skills_from_dict(profile_payload.get("skills"))),
            education=[
                UserEducationInput(**item)
                for item in experiences_safe_list(profile_payload.get("education"))
                if isinstance(item, dict)
            ],
            extraInfo=extra_info,
        )
        experiences = [
            self._experience_from_dict(item)
            for item in experiences_payload
            if isinstance(item, dict) and self._string_or_none(item.get("title"))
        ]
        return {"profile": profile, "experiences": experiences, "warnings": []}

    def _parse_text_resume(self, raw_text: str) -> dict[str, Any]:
        normalized = self._normalize_text(raw_text)
        lines = [line.strip() for line in normalized.split("\n") if line.strip()]
        compact = re.sub(r"\s+", " ", normalized)

        email = self._first_regex(normalized, r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", 0, re.I)
        phone = self._first_regex(normalized, r"(?:\+?86[-\s]?)?(1[3-9]\d{9})")
        explicit_name = self._first_regex(
            normalized, r"(?:姓名|Name)[:：\s]*([\u4e00-\u9fa5A-Za-z·.\s]{2,24})", flags=re.I
        )
        name = explicit_name or self._infer_name(lines)
        city = self._infer_city(normalized, compact)
        school, major, degree, graduation, education = self._infer_education(normalized, compact)
        skills = self._infer_skills(normalized, lines)
        links = self._unique(re.findall(r"https?://[^\s，,；;]+", normalized))
        certificates = self._extract_section_items(
            normalized,
            ["证书", "资格证书", "技能证书", "证书资质", "Certificates"],
            r"(CET|英语|证书|资格|计算机二级|普通话|雅思|托福|CPA|ACCA)",
        )
        awards = self._extract_section_items(
            normalized,
            ["荣誉奖项", "获奖经历", "奖项荣誉", "荣誉", "奖项", "Awards"],
            r"(奖|荣誉|竞赛|比赛|Scholarship|Award)",
        )
        awards = self._clean_award_items(awards)
        additional = self._unique(
            links + self._lines_matching(lines, r"(GitHub|作品集|个人主页|Portfolio|github\.com)")
        )
        experiences = self._infer_experiences(normalized)

        profile = CreateUserProfileRequest(
            name=name or None,
            phone=phone or None,
            email=email or None,
            city=city or None,
            school=school or None,
            major=major or None,
            degree=degree or None,
            graduation=graduation or None,
            links=links,
            skills=skills,
            education=education,
            extraInfo={
                "importedCertificates": certificates,
                "importedAwards": awards,
                "importedAdditional": additional,
            },
        )
        warnings = []
        if not experiences:
            warnings.append("未能稳定识别经历模块，请在经历信息中手动补充。")
        return {"profile": profile, "experiences": experiences, "warnings": warnings}

    @staticmethod
    def _normalize_text(text: str) -> str:
        text = text.replace("\u3000", " ").replace("\r\n", "\n")
        text = re.sub(r"[ \t]+", " ", text)
        return text

    @staticmethod
    def _string_or_none(value: object) -> str | None:
        if value is None:
            return None
        text = ResumeImportService._clean_info_item(value)
        return text or None

    @staticmethod
    def _list_of_strings(value: object) -> list[str]:
        if isinstance(value, list):
            return [text for item in value if (text := ResumeImportService._clean_info_item(item))]
        if isinstance(value, str):
            return [
                text
                for item in re.split(r"[，,、；;\n]+", value)
                if (text := ResumeImportService._clean_info_item(item))
            ]
        return []

    @staticmethod
    def _clean_info_item(value: object) -> str:
        text = str(value or "").strip()
        if not text:
            return ""
        heading_pattern = (
            r"个人信息|基础信息|教育背景|专业技能|技术栈|工具平台|业务/领域能力|领域能力|语言能力|"
            r"软件技能|计算机能力|技能|证书|资格证书|技能证书|荣誉奖项|奖项荣誉|获奖经历|获奖情况|"
            r"奖项|荣誉|概要|概述|链接|个人链接|其他信息|补充信息|title|name|value|content|label|"
            r"text|rawText|raw_text"
        )
        text = re.sub(r"""^[\s"'`\[\{(]+|[\s"'`\]\})]+$""", "", text)
        text = re.sub(r"^[-*•·●○◆◇▪▫]\s*", "", text)
        text = re.sub(r"^\d+[.)、]\s*", "", text)
        text = re.sub(
            rf"^(?:{heading_pattern})\s*[:：=]\s*",
            "",
            text,
            flags=re.I,
        )
        text = re.sub(r"[，,、；;。]+$", "", text).strip()
        if re.fullmatch(rf"(?:{heading_pattern})", text, re.I):
            return ""
        return text

    @staticmethod
    def _clean_award_items(items: list[str]) -> list[str]:
        return [
            item
            for item in items
            if not re.match(r"^(概要|概述|获奖情况|候选人|具备|拥有|具有|并具备|通过全国)", item)
        ]

    @staticmethod
    def _skills_from_dict(value: object) -> dict[str, list[str]]:
        if not isinstance(value, dict):
            return {"technical": [], "tools": [], "domain": [], "language": []}
        return {
            "technical": ResumeImportService._list_of_strings(value.get("technical")),
            "tools": ResumeImportService._list_of_strings(value.get("tools")),
            "domain": ResumeImportService._list_of_strings(value.get("domain")),
            "language": ResumeImportService._list_of_strings(value.get("language")),
        }

    def _experience_from_dict(self, value: dict[str, Any]) -> CreateUserExperienceRequest:
        return CreateUserExperienceRequest(
            type=value.get("type") or "other",
            title=str(value.get("title") or value.get("name") or "").strip(),
            organization=self._string_or_none(value.get("organization") or value.get("company")),
            role=self._string_or_none(value.get("role")),
            startDate=self._string_or_none(value.get("startDate") or value.get("start_date")),
            endDate=self._string_or_none(value.get("endDate") or value.get("end_date")),
            location=self._string_or_none(value.get("location")),
            description=self._string_or_none(value.get("description")),
            highlights=self._list_of_strings(value.get("highlights") or value.get("bullets")),
            metrics=self._list_of_strings(value.get("metrics")),
            skills=self._list_of_strings(value.get("skills")),
            rawText=self._string_or_none(value.get("rawText") or value.get("raw_text")),
            extraInfo=value.get("extraInfo") if isinstance(value.get("extraInfo"), dict) else {},
        )

    @staticmethod
    def _first_regex(text: str, pattern: str, group: int = 1, flags: int = 0) -> str:
        match = re.search(pattern, text, flags)
        if not match:
            return ""
        return match.group(group).strip()

    @staticmethod
    def _infer_name(lines: list[str]) -> str:
        for line in lines[:8]:
            if re.fullmatch(r"[\u4e00-\u9fa5]{2,6}", line):
                return line
        for line in lines[:8]:
            if re.fullmatch(r"[A-Za-z][A-Za-z\s.]{2,32}", line):
                return line
        return ""

    def _infer_city(self, text: str, compact: str) -> str:
        explicit = self._first_regex(text, r"(?:城市|所在地|现居|期望城市)[:：\s]*([\u4e00-\u9fa5]{2,12})")
        if explicit:
            return explicit
        match = re.search(
            r"(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|厦门|长沙|青岛|郑州|合肥|宁波|无锡|佛山|东莞|大连|沈阳|济南)",
            compact,
        )
        return match.group(1) if match else ""

    def _infer_education(
        self, text: str, compact: str
    ) -> tuple[str, str, str, str, list[UserEducationInput]]:
        school_line = self._find_line(text, r"(大学|学院|学校|University|College)")
        school = self._first_regex(text, r"(?:学校|毕业院校|院校)[:：\s]*([^\n，,|]{2,40})")
        if not school and school_line:
            school = self._first_regex(
                school_line,
                r"([\u4e00-\u9fa5A-Za-z\s·-]{2,40}(?:大学|学院|学校|University|College))",
                flags=re.I,
            )

        major = self._first_regex(
            text, r"(?:^|\n)\s*(?:专业(?!技能)|Major)[:：\s]*([^\n，,|]{2,40})", flags=re.I
        )
        degree = self._first_regex(compact, r"(博士研究生|硕士研究生|本科|硕士|博士|大专|学士|研究生|MBA)")
        graduation = self._first_regex(
            text, r"(?:毕业时间|毕业年份|Graduation)[:：\s]*([0-9./年月 -]{4,20})", flags=re.I
        )
        if not graduation:
            graduation = self._first_regex(compact, r"(20\d{2}[./年-]?\d{0,2})\s*(?:毕业|届)")
            graduation = graduation.replace("年", ".")

        if not major and school and school_line:
            major_candidate = school_line.replace(school, "")
            major_candidate = re.sub(
                r"(博士研究生|硕士研究生|本科|硕士|博士|大专|学士|研究生|MBA)", "",
                major_candidate,
            )
            major_candidate = re.sub(r"20\d{2}[./-]?\d{0,2}\s*[-至~]\s*(20\d{2}[./-]?\d{0,2}|至今)?", "", major_candidate)
            major_candidate = major_candidate.strip(" |｜/，,;-")
            if 2 <= len(major_candidate) <= 30:
                major = major_candidate

        period_match = re.search(r"(20\d{2}[./-]?\d{0,2})\s*[-至~]\s*(20\d{2}[./-]?\d{0,2}|至今)", school_line)
        period = " - ".join(period_match.groups()) if period_match else graduation
        education = []
        if any([school, degree, major, period]):
            education.append(
                UserEducationInput(
                    school=school or None,
                    degree=degree or None,
                    major=major or None,
                    period=period or None,
                    details=[],
                )
            )
        return school, major, degree, graduation, education

    def _infer_skills(self, text: str, lines: list[str]) -> UserSkillsInput:
        skill_section = self._extract_section_text(text, ["技能", "专业技能", "技术栈", "Skills"])
        candidates = skill_section or "\n".join(
            line
            for line in lines
            if re.search(r"Python|SQL|Excel|pandas|Tableau|Power BI|Java|C\+\+|R语言|SPSS", line, re.I)
        )
        skill_items = [self._clean_info_item(item) for item in re.split(r"[，,、/；;\n\s]+", candidates)]
        items = self._unique(
            item
            for item in skill_items
            if len(item) > 1 and not re.fullmatch(r"技能|技术栈|熟悉|掌握", item)
        )
        technical_keywords = {"python", "sql", "java", "c++", "r", "html", "css", "javascript"}
        tools_keywords = {"excel", "pandas", "tableau", "power", "bi", "spss", "numpy"}
        technical = []
        tools = []
        domain = []
        language = []
        for item in items:
            lowered = item.lower()
            if re.search(r"英语|普通话|雅思|托福|cet|ielts|toefl|mandarin", item, re.I):
                language.append(item)
            elif any(keyword in lowered for keyword in technical_keywords):
                technical.append(item)
            elif any(keyword in lowered for keyword in tools_keywords):
                tools.append(item)
            else:
                domain.append(item)
        return UserSkillsInput(
            technical=self._unique(technical),
            tools=self._unique(tools),
            domain=self._unique(domain),
            language=self._unique(language),
        )

    def _infer_experiences(self, text: str) -> list[CreateUserExperienceRequest]:
        section_keywords = {
            "internship": ["实习经历", "实习经验"],
            "work": ["工作经历", "工作经验"],
            "project": ["项目经历", "项目经验", "项目实践"],
            "campus": ["校园经历", "学生工作", "社团经历"],
            "research": ["科研经历", "研究经历"],
            "competition": ["竞赛经历", "比赛经历"],
            "volunteer": ["志愿经历", "志愿服务"],
        }
        experiences = []
        for exp_type, headings in section_keywords.items():
            section_text = self._extract_section_text(text, headings)
            if not section_text:
                continue
            experiences.extend(self._split_experience_section(section_text, exp_type))
        if experiences:
            return experiences[:8]

        fallback = self._extract_section_text(text, ["经历", "Experience"])
        if fallback:
            experiences = self._split_experience_section(fallback, "other")
        return experiences[:8]

    def _split_experience_section(
        self, section_text: str, exp_type: str
    ) -> list[CreateUserExperienceRequest]:
        lines = [self._clean_info_item(line) for line in section_text.split("\n") if self._clean_info_item(line)]
        if not lines:
            return []

        chunks: list[list[str]] = []
        current: list[str] = []
        title_pattern = re.compile(
            r"(项目|实习|公司|活动|比赛|竞赛|研究|课题|系统|平台|分析|运营|助理|负责人|成员|Intern|Project|Assistant)",
            re.I,
        )
        period_pattern = re.compile(r"(20\d{2}[./-]?\d{0,2})\s*[-至~]\s*(20\d{2}[./-]?\d{0,2}|至今)")
        bullet_prefix = ("负责", "参与", "使用", "通过", "完成", "协助", "实现", "产出", "搭建", "优化", "•", "-", "·")
        for line in lines:
            is_title = (
                (bool(period_pattern.search(line)) or bool(title_pattern.search(line)))
                and len(line) <= 90
                and not line.startswith(bullet_prefix)
            )
            if is_title and current:
                chunks.append(current)
                current = [line]
            else:
                current.append(line)
        if current:
            chunks.append(current)

        if len(chunks) == 1 and len(chunks[0]) > 8:
            chunks = [chunks[0][:8]]

        experiences = []
        for chunk in chunks:
            title = self._clean_info_item(chunk[0])[:80]
            body_lines = [self._clean_info_item(line) for line in (chunk[1:] if len(chunk) > 1 else chunk)]
            body = "\n".join(body_lines).strip()
            if not body and len(title) < 8:
                continue
            skills = self._unique(
                re.findall(
                    r"Python|SQL|Excel|pandas|Tableau|Power BI|Java|C\+\+|SPSS|Axure|Figma",
                    "\n".join(chunk),
                    re.I,
                )
            )
            metrics = self._unique(re.findall(r"\d+(?:\.\d+)?\s*(?:%|人|份|次|页|个|天|周|月)", "\n".join(chunk)))
            period_match = period_pattern.search("\n".join(chunk))
            start_date = period_match.group(1) if period_match else None
            end_date = period_match.group(2) if period_match else None
            clean_title = self._clean_info_item(period_pattern.sub("", title).strip(" |｜/，,;-"))
            experiences.append(
                CreateUserExperienceRequest(
                    type=exp_type,
                    title=clean_title or title,
                    organization=None,
                    role=None,
                    startDate=start_date,
                    endDate=end_date,
                    description=body or title,
                    highlights=body_lines[:6],
                    metrics=metrics,
                    skills=skills,
                    rawText="\n".join(chunk),
                    extraInfo={},
                )
            )
        return experiences

    @staticmethod
    def _find_line(text: str, pattern: str) -> str:
        regex = re.compile(pattern, re.I)
        for line in text.split("\n"):
            if regex.search(line):
                return line.strip()
        return ""

    @staticmethod
    def _extract_section_text(text: str, headings: list[str]) -> str:
        heading_pattern = "|".join(re.escape(heading) for heading in headings)
        all_headings = (
            "个人信息|基础信息|教育背景|专业技能|技术栈|技能|实习经历|实习经验|工作经历|工作经验|"
            "项目经历|项目经验|项目实践|校园经历|学生工作|社团经历|科研经历|研究经历|竞赛经历|"
            "比赛经历|志愿经历|志愿服务|资格证书|技能证书|证书资质|证书|荣誉奖项|获奖经历|"
            "奖项荣誉|荣誉|奖项|自我评价|求职意向|Experience|Education|Skills|Projects|Awards|Certificates"
        )
        pattern = re.compile(
            rf"(?:^|\n)\s*(?:{heading_pattern})\s*[:：]?\s*\n?(.*?)(?=\n\s*(?:{all_headings})\s*[:：]?\s*\n|$)",
            re.S | re.I,
        )
        match = pattern.search(text)
        return match.group(1).strip() if match else ""

    def _extract_section_items(self, text: str, headings: list[str], fallback_pattern: str) -> list[str]:
        section_text = self._extract_section_text(text, headings)
        if section_text:
            return self._unique(
                self._clean_info_item(item)
                for item in re.split(r"[，,、；;\n]+", section_text)
                if item.strip() and not re.fullmatch(r"[\-•·]+", item.strip())
            )
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        return self._lines_matching(lines, fallback_pattern)

    @staticmethod
    def _lines_matching(lines: list[str], pattern: str) -> list[str]:
        regex = re.compile(pattern, re.I)
        return ResumeImportService._unique(ResumeImportService._clean_info_item(line) for line in lines if regex.search(line))

    @staticmethod
    def _unique(items) -> list[str]:
        seen = set()
        result = []
        for item in items:
            text = ResumeImportService._clean_info_item(item)
            if not text:
                continue
            key = text.lower()
            if key in seen:
                continue
            seen.add(key)
            result.append(text)
        return result


def experiences_safe_list(value: object) -> list[object]:
    return value if isinstance(value, list) else []
