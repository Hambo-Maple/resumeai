from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AnalyzeJobRequest(BaseModel):
    company: str = Field(min_length=1, max_length=255)
    position: str = Field(min_length=1, max_length=255)
    job_description: str | None = Field(default=None, alias="jobDescription")


class CoreAbilitySchema(BaseModel):
    name: str
    importance: int = Field(ge=1, le=5)
    description: str
    evidence_suggestions: list[str] = Field(default_factory=list, alias="evidenceSuggestions")


class AnalyzeJobResponse(BaseModel):
    task_id: UUID = Field(alias="taskId")
    job_target_id: UUID = Field(alias="jobTargetId")
    source: Literal["jd", "general_model"]
    core_abilities: list[CoreAbilitySchema] = Field(alias="coreAbilities")
    keywords: list[str]
    resume_focus: list[str] = Field(alias="resumeFocus")


class StructureExperienceRequest(BaseModel):
    task_id: UUID = Field(alias="taskId")
    job_target_id: UUID = Field(alias="jobTargetId")
    raw_experience: str = Field(alias="rawExperience", min_length=1)


class StructuredExperienceResponse(BaseModel):
    experience_id: UUID = Field(alias="experienceId")
    type: Literal[
        "internship",
        "project",
        "course",
        "research",
        "competition",
        "campus",
        "volunteer",
        "other",
    ]
    title: str
    organization: str | None = None
    role: str | None = None
    background: str | None = None
    actions: list[str] = Field(default_factory=list)
    results: list[str] = Field(default_factory=list)
    metrics: list[str] = Field(default_factory=list)
    matched_abilities: list[str] = Field(default_factory=list, alias="matchedAbilities")
    missing_info_questions: list[str] = Field(default_factory=list, alias="missingInfoQuestions")
    resume_value: str = Field(alias="resumeValue")
    rewrite_direction: list[str] = Field(default_factory=list, alias="rewriteDirection")


class ResumeProfileInput(BaseModel):
    name: str | None = None
    phone: str | None = None
    email: str | None = None
    city: str | None = None
    school: str | None = None
    major: str | None = None
    degree: str | None = None
    graduation: str | None = None


class ResumeEducationInput(BaseModel):
    school: str | None = None
    degree: str | None = None
    major: str | None = None
    period: str | None = None
    details: list[str] = Field(default_factory=list)


class ResumeSkillsInput(BaseModel):
    technical: list[str] = Field(default_factory=list)
    domain: list[str] = Field(default_factory=list)
    language: list[str] = Field(default_factory=list)


class AssessReadinessRequest(BaseModel):
    task_id: UUID = Field(alias="taskId")
    job_target_id: UUID = Field(alias="jobTargetId")
    experience_id: UUID = Field(alias="experienceId")
    profile: ResumeProfileInput = Field(default_factory=ResumeProfileInput)
    education: list[ResumeEducationInput] = Field(default_factory=list)
    skills: ResumeSkillsInput = Field(default_factory=ResumeSkillsInput)


class ReadinessCompletionSchema(BaseModel):
    profile: int = Field(ge=0, le=100)
    experience: int = Field(ge=0, le=100)
    overall: int = Field(ge=0, le=100)


class ReadinessQuestionSchema(BaseModel):
    field: str
    content: str


class AssessReadinessResponse(BaseModel):
    resume_readiness: Literal["not_ready", "draft_ready", "strong_ready"] = Field(
        alias="resumeReadiness"
    )
    evidence_level: Literal["low", "medium", "high"] = Field(alias="evidenceLevel")
    completion: ReadinessCompletionSchema
    missing_fields: list[str] = Field(default_factory=list, alias="missingFields")
    next_question: ReadinessQuestionSchema | None = Field(default=None, alias="nextQuestion")
    can_generate_draft: bool = Field(alias="canGenerateDraft")
    reason: str


class GenerateResumeRequest(BaseModel):
    task_id: UUID = Field(alias="taskId")
    job_target_id: UUID = Field(alias="jobTargetId")
    experience_ids: list[UUID] | None = Field(default=None, alias="experienceIds")
    language: Literal["zh", "en"] = "zh"
    parent_draft_id: UUID | None = Field(default=None, alias="parentDraftId")
    change_summary: str | None = Field(default=None, alias="changeSummary")
    profile: ResumeProfileInput = Field(default_factory=ResumeProfileInput)
    education: list[ResumeEducationInput] = Field(default_factory=list)
    skills: ResumeSkillsInput = Field(default_factory=ResumeSkillsInput)


class ResumeBulletItem(BaseModel):
    experience_id: UUID | None = Field(default=None, alias="experienceId")
    title: str
    bullets: list[str] = Field(default_factory=list)
    ability_tags: list[str] = Field(default_factory=list, alias="abilityTags")
    keyword_tags: list[str] = Field(default_factory=list, alias="keywordTags")
    confidence: Literal["high", "medium", "low"] = "medium"


class ResumeSectionSchema(BaseModel):
    title: str
    items: list[ResumeBulletItem] = Field(default_factory=list)


class LowerPriorityItem(BaseModel):
    experience_id: UUID | None = Field(default=None, alias="experienceId")
    reason: str


class ResumeBasicsSchema(BaseModel):
    name: str
    phone: str
    email: str
    location: str
    links: list[str] = Field(default_factory=list)


class ResumeTargetSchema(BaseModel):
    position: str
    company: str
    industry: str | None = None
    city: str | None = None


class ResumeEducationItem(BaseModel):
    school: str
    degree: str | None = None
    major: str | None = None
    period: str | None = None
    details: list[str] = Field(default_factory=list)


class ResumeExperienceItem(BaseModel):
    company: str
    role: str
    period: str | None = None
    bullets: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class ResumeProjectItem(BaseModel):
    name: str
    role: str | None = None
    organization: str | None = None
    period: str | None = None
    bullets: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)


class ResumeSkillsSchema(BaseModel):
    technical: list[str] = Field(default_factory=list)
    tools: list[str] = Field(default_factory=list)
    domain: list[str] = Field(default_factory=list)
    language: list[str] = Field(default_factory=list)


class ResumeDynamicItemSchema(BaseModel):
    id: str | None = None
    name: str
    organization: str | None = None
    role: str | None = None
    period: str | None = None
    location: str | None = None
    bullets: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    confidence: Literal["high", "medium", "low"] = "medium"


class ResumeDynamicSectionSchema(BaseModel):
    type: str
    title: str
    items: list[ResumeDynamicItemSchema] = Field(default_factory=list)


class ResumeDocumentSchema(BaseModel):
    basics: ResumeBasicsSchema
    target: ResumeTargetSchema
    summary: str
    education: list[ResumeEducationItem] = Field(default_factory=list)
    experience: list[ResumeExperienceItem] = Field(default_factory=list)
    projects: list[ResumeProjectItem] = Field(default_factory=list)
    sections: list[ResumeDynamicSectionSchema] = Field(default_factory=list)
    skills: ResumeSkillsSchema
    certificates: list[str] = Field(default_factory=list)
    awards: list[str] = Field(default_factory=list)
    additional: list[str] = Field(default_factory=list)


class SectionInputSchema(BaseModel):
    section_key: str = Field(alias="sectionKey")
    title: str
    content: str | None = None


class ProductizedDraftRequest(BaseModel):
    company: str | None = None
    position: str = Field(min_length=1)
    job_description: str | None = Field(default=None, alias="jobDescription")
    job_analysis: dict | None = Field(default=None, alias="jobAnalysis")
    section_inputs: list[SectionInputSchema] = Field(default_factory=list, alias="sectionInputs")


class QualityGapSchema(BaseModel):
    type: str
    priority: Literal["high", "medium", "low"]
    description: str


class SectionItemQualityReportSchema(BaseModel):
    item_id: str | None = Field(default=None, alias="itemId")
    item_name: str | None = Field(default=None, alias="itemName")
    score: int = Field(default=0, ge=0, le=100)
    gaps: list[QualityGapSchema] = Field(default_factory=list)
    next_question: str | None = Field(default=None, alias="nextQuestion")


class SectionQualityReportSchema(BaseModel):
    section_key: str = Field(alias="sectionKey")
    title: str
    status: Literal["missing", "insufficient", "usable", "strong", "hidden"]
    importance: Literal["high", "medium", "low"]
    completeness: int = Field(ge=0, le=100)
    job_relevance: int = Field(alias="jobRelevance", ge=0, le=100)
    content_strength: int = Field(alias="contentStrength", ge=0, le=100)
    truthfulness_risk: Literal["low", "medium", "high"] = Field(alias="truthfulnessRisk")
    summary: str
    gaps: list[QualityGapSchema] = Field(default_factory=list)
    item_reports: list[SectionItemQualityReportSchema] = Field(
        default_factory=list, alias="itemReports"
    )
    next_question: str | None = Field(default=None, alias="nextQuestion")


class ResumeQualityReportSchema(BaseModel):
    overall_score: int = Field(alias="overallScore", ge=0, le=100)
    readiness: Literal["not_ready", "draft_ready", "strong_ready"]
    structure_completeness: int = Field(alias="structureCompleteness", ge=0, le=100)
    job_match_score: int = Field(alias="jobMatchScore", ge=0, le=100)
    evidence_strength: int = Field(alias="evidenceStrength", ge=0, le=100)
    readability_score: int = Field(alias="readabilityScore", ge=0, le=100)
    truthfulness_risk: Literal["low", "medium", "high"] = Field(alias="truthfulnessRisk")
    missing_sections: list[str] = Field(default_factory=list, alias="missingSections")
    weak_sections: list[str] = Field(default_factory=list, alias="weakSections")
    covered_abilities: list[str] = Field(default_factory=list, alias="coveredAbilities")
    uncovered_abilities: list[str] = Field(default_factory=list, alias="uncoveredAbilities")
    global_gaps: list[str] = Field(default_factory=list, alias="globalGaps")
    next_best_action: str = Field(alias="nextBestAction")


class ProductizedNextQuestionSchema(BaseModel):
    target: str
    section_key: str | None = Field(default=None, alias="sectionKey")
    section_title: str | None = Field(default=None, alias="sectionTitle")
    item_id: str | None = Field(default=None, alias="itemId")
    item_name: str | None = Field(default=None, alias="itemName")
    field: str | None = None
    gap_label: str | None = Field(default=None, alias="gapLabel")
    question: str
    reason: str


class ProductizedDraftResponse(BaseModel):
    resume_document: ResumeDocumentSchema = Field(alias="resumeDocument")
    section_quality_reports: list[SectionQualityReportSchema] = Field(
        default_factory=list, alias="sectionQualityReports"
    )
    resume_quality_report: ResumeQualityReportSchema = Field(alias="resumeQualityReport")
    growth_map: dict = Field(default_factory=dict, alias="growthMap")
    next_question: ProductizedNextQuestionSchema | None = Field(
        default=None, alias="nextQuestion"
    )


class DialogueAnswerRecordSchema(BaseModel):
    question_id: str | None = Field(default=None, alias="questionId")
    question: str
    answer: str
    section_key: str | None = Field(default=None, alias="sectionKey")
    section_title: str | None = Field(default=None, alias="sectionTitle")
    item_id: str | None = Field(default=None, alias="itemId")
    item_name: str | None = Field(default=None, alias="itemName")
    field: str | None = None
    gap_label: str | None = Field(default=None, alias="gapLabel")


class UpdateResumeSectionRequest(BaseModel):
    company: str | None = None
    position: str = Field(min_length=1)
    job_description: str | None = Field(default=None, alias="jobDescription")
    question_target: ProductizedNextQuestionSchema = Field(alias="questionTarget")
    resume_document: ResumeDocumentSchema = Field(alias="resumeDocument")
    section_report: SectionQualityReportSchema = Field(alias="sectionReport")
    item_report: SectionItemQualityReportSchema | None = Field(
        default=None, alias="itemReport"
    )
    question: str
    answer: str
    history_answers: list[DialogueAnswerRecordSchema] = Field(
        default_factory=list, alias="historyAnswers"
    )


class UpdateResumeSectionResponse(BaseModel):
    resume_document: ResumeDocumentSchema = Field(alias="resumeDocument")
    updated_section_report: SectionQualityReportSchema = Field(alias="updatedSectionReport")
    next_question: ProductizedNextQuestionSchema | None = Field(
        default=None, alias="nextQuestion"
    )
    is_complete_for_draft: bool = Field(alias="isCompleteForDraft")
    update_summary: str = Field(alias="updateSummary")


class ResumeBlockSchema(BaseModel):
    id: str
    type: str
    title: str
    content: dict[str, Any] | list[Any] | str | None = None
    quality_report: dict[str, Any] | None = Field(default=None, alias="qualityReport")
    questions: list[dict[str, Any]] = Field(default_factory=list)
    answer_history: list[dict[str, Any]] = Field(default_factory=list, alias="answerHistory")
    status: str = "draft"
    locked: bool = False
    last_updated_at: str | None = Field(default=None, alias="lastUpdatedAt")


class AnalyzeResumeBlocksRequest(BaseModel):
    company: str | None = None
    position: str = Field(min_length=1)
    job_description: str | None = Field(default=None, alias="jobDescription")
    job_analysis: dict[str, Any] | None = Field(default=None, alias="jobAnalysis")
    resume_blocks: list[ResumeBlockSchema] = Field(alias="resumeBlocks")
    locked_block_ids: list[str] = Field(default_factory=list, alias="lockedBlockIds")
    question_history: list[dict[str, Any]] = Field(
        default_factory=list, alias="questionHistory"
    )


class AnalyzeResumeBlocksResponse(BaseModel):
    global_quality_report: dict[str, Any] = Field(alias="globalQualityReport")
    recommended_actions: list[dict[str, Any]] = Field(
        default_factory=list, alias="recommendedActions"
    )
    next_question: dict[str, Any] | None = Field(default=None, alias="nextQuestion")


class UpdateResumeBlockRequest(BaseModel):
    company: str | None = None
    position: str = Field(min_length=1)
    job_description: str | None = Field(default=None, alias="jobDescription")
    job_analysis: dict[str, Any] | None = Field(default=None, alias="jobAnalysis")
    target_block: ResumeBlockSchema = Field(alias="targetBlock")
    other_block_summaries: list[dict[str, Any]] = Field(
        default_factory=list, alias="otherBlockSummaries"
    )
    current_question: dict[str, Any] = Field(alias="currentQuestion")
    answer: str
    block_answer_history: list[dict[str, Any]] = Field(
        default_factory=list, alias="blockAnswerHistory"
    )
    skipped_questions: list[dict[str, Any]] = Field(
        default_factory=list, alias="skippedQuestions"
    )


class UpdateResumeBlockResponse(BaseModel):
    pending_block_draft: ResumeBlockSchema | None = Field(
        default=None, alias="pendingBlockDraft"
    )
    block_quality_report: dict[str, Any] = Field(
        default_factory=dict, alias="blockQualityReport"
    )
    next_question: dict[str, Any] | None = Field(default=None, alias="nextQuestion")
    is_complete_for_draft: bool = Field(alias="isCompleteForDraft")
    update_summary: str = Field(alias="updateSummary")


class GenerateResumeResponse(BaseModel):
    resume_draft_id: UUID = Field(alias="resumeDraftId")
    version: int
    status: Literal["draft", "revised", "final"]
    parent_draft_id: UUID | None = Field(default=None, alias="parentDraftId")
    change_summary: str | None = Field(default=None, alias="changeSummary")
    resume_document: ResumeDocumentSchema | None = Field(default=None, alias="resumeDocument")
    summary: str
    sections: list[ResumeSectionSchema] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    missing_info_suggestions: list[str] = Field(
        default_factory=list, alias="missingInfoSuggestions"
    )
    lower_priority_items: list[LowerPriorityItem] = Field(
        default_factory=list, alias="lowerPriorityItems"
    )


class DiagnoseResumeRequest(BaseModel):
    task_id: UUID = Field(alias="taskId")
    job_target_id: UUID = Field(alias="jobTargetId")
    resume_draft_id: UUID = Field(alias="resumeDraftId")


class ResumeGapSchema(BaseModel):
    type: str
    priority: Literal["high", "medium", "low"]
    description: str
    related_experience_id: UUID | None = Field(default=None, alias="relatedExperienceId")
    related_ability: str | None = Field(default=None, alias="relatedAbility")


class ResumeQuestionSchema(BaseModel):
    question: str
    reason: str
    related_experience_id: UUID | None = Field(default=None, alias="relatedExperienceId")
    priority: Literal["high", "medium", "low"]


class QuestionPlanSchema(BaseModel):
    question_id: str = Field(alias="questionId")
    gap_type: str = Field(alias="gapType")
    priority: Literal["high", "medium", "low"]
    related_experience_id: UUID | None = Field(default=None, alias="relatedExperienceId")
    related_ability: str | None = Field(default=None, alias="relatedAbility")
    reason: str
    expected_evidence: list[str] = Field(default_factory=list, alias="expectedEvidence")
    user_visible_question: str = Field(alias="userVisibleQuestion")
    status: Literal["pending", "answered", "skipped"] = "pending"


class NextQuestionSchema(BaseModel):
    question_id: str = Field(alias="questionId")
    content: str
    related_experience_id: UUID | None = Field(default=None, alias="relatedExperienceId")
    priority: Literal["high", "medium", "low"]


class DiagnoseResumeResponse(BaseModel):
    diagnosis: str
    gaps: list[ResumeGapSchema] = Field(default_factory=list)
    questions: list[ResumeQuestionSchema] = Field(default_factory=list)
    question_plans: list[QuestionPlanSchema] = Field(default_factory=list, alias="questionPlans")
    next_question: NextQuestionSchema | None = Field(default=None, alias="nextQuestion")
    next_action: str = Field(alias="nextAction")


class UpdateExperienceRequest(BaseModel):
    task_id: UUID = Field(alias="taskId")
    experience_id: UUID = Field(alias="experienceId")
    question: str = Field(min_length=1)
    answer: str = Field(min_length=1)


class UpdateExperienceResponse(BaseModel):
    experience_id: UUID = Field(alias="experienceId")
    updated_experience: StructuredExperienceResponse = Field(alias="updatedExperience")
    update_summary: str = Field(alias="updateSummary")


class GenerateDialogueAnswerRequest(BaseModel):
    task_id: UUID | None = Field(default=None, alias="taskId")
    job_target_id: UUID | None = Field(default=None, alias="jobTargetId")
    experience_id: UUID | None = Field(default=None, alias="experienceId")
    company: str | None = None
    position: str | None = None
    job_description: str | None = Field(default=None, alias="jobDescription")
    profile: ResumeProfileInput = Field(default_factory=ResumeProfileInput)
    education: list[ResumeEducationInput] = Field(default_factory=list)
    skills: ResumeSkillsInput = Field(default_factory=ResumeSkillsInput)
    current_question: str = Field(alias="currentQuestion", min_length=1)
    question_field: str | None = Field(default=None, alias="questionField")


class GenerateDialogueAnswerResponse(BaseModel):
    answer: str
    target_patch: dict[str, str | None] | None = Field(default=None, alias="targetPatch")
    profile_patch: ResumeProfileInput | None = Field(default=None, alias="profilePatch")
    section_patch: dict[str, str | None] | None = Field(default=None, alias="sectionPatch")
    skills_text: str | None = Field(default=None, alias="skillsText")


class FinalizeResumeRequest(BaseModel):
    resume_draft_id: UUID = Field(alias="resumeDraftId")


class FinalizeResumeResponse(BaseModel):
    resume_draft_id: UUID = Field(alias="resumeDraftId")
    status: Literal["final"]
