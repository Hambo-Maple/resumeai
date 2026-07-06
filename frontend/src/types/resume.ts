export type CoreAbility = {
  name: string;
  importance: number;
  description: string;
  evidenceSuggestions: string[];
};

export type AnalyzeJobRequest = {
  company: string;
  position: string;
  jobDescription?: string;
};

export type AnalyzeJobResponse = {
  taskId: string;
  jobTargetId: string;
  source: "jd" | "general_model";
  coreAbilities: CoreAbility[];
  keywords: string[];
  resumeFocus: string[];
};

export type StructureExperienceRequest = {
  taskId: string;
  jobTargetId: string;
  rawExperience: string;
};

export type StructuredExperienceResponse = {
  experienceId: string;
  type:
    | "internship"
    | "project"
    | "course"
    | "research"
    | "competition"
    | "campus"
    | "volunteer"
    | "other";
  title: string;
  organization: string | null;
  role: string | null;
  background: string | null;
  actions: string[];
  results: string[];
  metrics: string[];
  matchedAbilities: string[];
  missingInfoQuestions: string[];
  resumeValue: string;
  rewriteDirection: string[];
};

export type ResumeProfileInput = {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  school?: string | null;
  major?: string | null;
  degree?: string | null;
  graduation?: string | null;
};

export type ResumeSkillsInput = {
  technical: string[];
  domain: string[];
  language: string[];
};

export type AssessReadinessRequest = {
  taskId: string;
  jobTargetId: string;
  experienceId: string;
  profile: ResumeProfileInput;
  education?: Array<{
    school?: string | null;
    degree?: string | null;
    major?: string | null;
    period?: string | null;
    details?: string[];
  }>;
  skills: ResumeSkillsInput;
};

export type AssessReadinessResponse = {
  resumeReadiness: "not_ready" | "draft_ready" | "strong_ready";
  evidenceLevel: "low" | "medium" | "high";
  completion: {
    profile: number;
    experience: number;
    overall: number;
  };
  missingFields: string[];
  nextQuestion: {
    field: string;
    content: string;
  } | null;
  canGenerateDraft: boolean;
  reason: string;
};

export type GenerateResumeRequest = {
  taskId: string;
  jobTargetId: string;
  experienceIds?: string[];
  language?: "zh" | "en";
  parentDraftId?: string | null;
  changeSummary?: string | null;
  profile?: ResumeProfileInput;
  education?: AssessReadinessRequest["education"];
  skills?: ResumeSkillsInput;
};

export type ResumeBulletItem = {
  experienceId: string | null;
  title: string;
  bullets: string[];
  abilityTags: string[];
  keywordTags: string[];
  confidence: "high" | "medium" | "low";
};

export type ResumeSection = {
  title: string;
  items: ResumeBulletItem[];
};

export type GenerateResumeResponse = {
  resumeDraftId: string;
  version: number;
  status: "draft" | "revised" | "final";
  parentDraftId: string | null;
  changeSummary: string | null;
  resumeDocument: ResumeDocument | null;
  summary: string;
  sections: ResumeSection[];
  skills: string[];
  missingInfoSuggestions: string[];
  lowerPriorityItems: Array<{
    experienceId: string | null;
    reason: string;
  }>;
};

export type ResumeDocument = {
  basics: {
    name: string;
    phone: string;
    email: string;
    location: string;
    links: string[];
  };
  target: {
    position: string;
    company: string;
    industry?: string | null;
    city?: string | null;
  };
  summary: string;
  education: Array<{
    school: string;
    degree: string | null;
    major: string | null;
    period: string | null;
    details: string[];
  }>;
  experience: Array<{
    company: string;
    role: string;
    period: string | null;
    bullets: string[];
    tags: string[];
  }>;
  projects: Array<{
    name: string;
    role: string | null;
    organization: string | null;
    period: string | null;
    bullets: string[];
    tags: string[];
  }>;
  sections?: Array<{
    type: string;
    title: string;
    items: Array<{
      id: string | null;
      name: string;
      organization: string | null;
      role: string | null;
      period: string | null;
      location: string | null;
      bullets: string[];
      tags: string[];
      confidence: "high" | "medium" | "low";
    }>;
  }>;
  skills: {
    technical: string[];
    tools?: string[];
    domain: string[];
    language: string[];
  };
  certificates: string[];
  awards: string[];
  additional: string[];
};

export type DiagnoseResumeRequest = {
  taskId: string;
  jobTargetId: string;
  resumeDraftId: string;
};

export type ResumeGap = {
  type: string;
  priority: "high" | "medium" | "low";
  description: string;
  relatedExperienceId: string | null;
  relatedAbility: string | null;
};

export type ResumeQuestion = {
  question: string;
  reason: string;
  relatedExperienceId: string | null;
  priority: "high" | "medium" | "low";
};

export type QuestionPlan = {
  questionId: string;
  gapType: string;
  priority: "high" | "medium" | "low";
  relatedExperienceId: string | null;
  relatedAbility: string | null;
  reason: string;
  expectedEvidence: string[];
  userVisibleQuestion: string;
  status: "pending" | "answered" | "skipped";
};

export type NextQuestion = {
  questionId: string;
  content: string;
  relatedExperienceId: string | null;
  priority: "high" | "medium" | "low";
};

export type DiagnoseResumeResponse = {
  diagnosis: string;
  gaps: ResumeGap[];
  questions: ResumeQuestion[];
  questionPlans: QuestionPlan[];
  nextQuestion: NextQuestion | null;
  nextAction: string;
};

export type UpdateExperienceRequest = {
  taskId: string;
  experienceId: string;
  question: string;
  answer: string;
};

export type UpdateExperienceResponse = {
  experienceId: string;
  updatedExperience: StructuredExperienceResponse;
  updateSummary: string;
};

export type FinalizeResumeRequest = {
  resumeDraftId: string;
};

export type FinalizeResumeResponse = {
  resumeDraftId: string;
  status: "final";
};

export type GenerateDialogueAnswerRequest = {
  taskId?: string | null;
  jobTargetId?: string | null;
  experienceId?: string | null;
  company?: string | null;
  position?: string | null;
  jobDescription?: string | null;
  profile: ResumeProfileInput;
  education?: AssessReadinessRequest["education"];
  skills: ResumeSkillsInput;
  currentQuestion: string;
  questionField?: string | null;
};

export type GenerateDialogueAnswerResponse = {
  answer: string;
  targetPatch: {
    company?: string | null;
    position?: string | null;
    jobDescription?: string | null;
  } | null;
  profilePatch: ResumeProfileInput | null;
  sectionPatch: {
    educationNotes?: string | null;
    experienceNotes?: string | null;
    certificatesText?: string | null;
    awardsText?: string | null;
    additionalText?: string | null;
  } | null;
  skillsText: string | null;
};

export type ProductizedDraftRequest = {
  company?: string | null;
  position: string;
  jobDescription?: string | null;
  jobAnalysis?: AnalyzeJobResponse | null;
  sectionInputs: Array<{
    sectionKey: string;
    title: string;
    content?: string | null;
  }>;
};

export type SectionQualityReport = {
  sectionKey: string;
  title: string;
  status: "missing" | "insufficient" | "usable" | "strong" | "hidden";
  importance: "high" | "medium" | "low";
  completeness: number;
  jobRelevance: number;
  contentStrength: number;
  truthfulnessRisk: "low" | "medium" | "high";
  summary: string;
  gaps: Array<{
    type: string;
    priority: "high" | "medium" | "low";
    description: string;
    status?: "open" | "answered" | "skipped";
  }>;
  itemReports: Array<{
    itemId: string | null;
    itemName: string | null;
    score: number;
    gaps: Array<{
      type: string;
      priority: "high" | "medium" | "low";
      description: string;
      status?: "open" | "answered" | "skipped";
    }>;
    nextQuestion: string | null;
  }>;
  nextQuestion: string | null;
};

export type ProductizedDraftResponse = {
  resumeDocument: ResumeDocument;
  sectionQualityReports: SectionQualityReport[];
  resumeQualityReport: {
    overallScore: number;
    readiness: "not_ready" | "draft_ready" | "strong_ready";
    structureCompleteness: number;
    jobMatchScore: number;
    evidenceStrength: number;
    readabilityScore: number;
    truthfulnessRisk: "low" | "medium" | "high";
    missingSections: string[];
    weakSections: string[];
    coveredAbilities: string[];
    uncoveredAbilities: string[];
    globalGaps: string[];
    nextBestAction: string;
  };
  growthMap: Record<string, unknown>;
  nextQuestion: {
    target: string;
    sectionKey: string | null;
    sectionTitle: string | null;
    itemId: string | null;
    itemName: string | null;
    field: string | null;
    gapLabel: string | null;
    question: string;
    reason: string;
  } | null;
};

export type DialogueAnswerRecord = {
  questionId?: string | null;
  question: string;
  answer: string;
  sectionKey?: string | null;
  sectionTitle?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  field?: string | null;
  gapLabel?: string | null;
};

export type UpdateResumeSectionRequest = {
  company?: string | null;
  position: string;
  jobDescription?: string | null;
  questionTarget: NonNullable<ProductizedDraftResponse["nextQuestion"]>;
  resumeDocument: ResumeDocument;
  sectionReport: SectionQualityReport;
  itemReport?: SectionQualityReport["itemReports"][number] | null;
  question: string;
  answer: string;
  historyAnswers: DialogueAnswerRecord[];
};

export type UpdateResumeSectionResponse = {
  resumeDocument: ResumeDocument;
  updatedSectionReport: SectionQualityReport;
  nextQuestion: ProductizedDraftResponse["nextQuestion"];
  isCompleteForDraft: boolean;
  updateSummary: string;
};

export type ResumeBlock = {
  id: string;
  type: string;
  title: string;
  content: unknown;
  qualityReport?: Record<string, unknown> | null;
  questions: Array<Record<string, unknown>>;
  answerHistory: Array<Record<string, unknown>>;
  status: "draft" | "editing" | "pending" | "completed" | "locked" | string;
  locked: boolean;
  lastUpdatedAt?: string | null;
};

export type AnalyzeResumeBlocksRequest = {
  company?: string | null;
  position: string;
  jobDescription?: string | null;
  jobAnalysis?: Record<string, unknown> | null;
  resumeBlocks: ResumeBlock[];
  lockedBlockIds: string[];
  questionHistory: Array<Record<string, unknown>>;
};

export type AnalyzeResumeBlocksResponse = {
  globalQualityReport: Record<string, unknown>;
  recommendedActions: Array<Record<string, unknown>>;
  nextQuestion: Record<string, unknown> | null;
};

export type UpdateResumeBlockRequest = {
  company?: string | null;
  position: string;
  jobDescription?: string | null;
  jobAnalysis?: Record<string, unknown> | null;
  targetBlock: ResumeBlock;
  otherBlockSummaries: Array<Record<string, unknown>>;
  currentQuestion: Record<string, unknown>;
  answer: string;
  blockAnswerHistory: Array<Record<string, unknown>>;
  skippedQuestions: Array<Record<string, unknown>>;
};

export type UpdateResumeBlockResponse = {
  pendingBlockDraft: ResumeBlock | null;
  blockQualityReport: Record<string, unknown>;
  nextQuestion: Record<string, unknown> | null;
  isCompleteForDraft: boolean;
  updateSummary: string;
};

export type UserEducationInput = {
  school?: string | null;
  degree?: string | null;
  major?: string | null;
  period?: string | null;
  details: string[];
};

export type UserSkillsInput = {
  technical: string[];
  tools: string[];
  domain: string[];
  language: string[];
};

export type UserProfileRecord = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  school?: string | null;
  major?: string | null;
  degree?: string | null;
  graduation?: string | null;
  links: string[];
  skills: UserSkillsInput;
  education: UserEducationInput[];
  extraInfo: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UserProfilePayload = Omit<UserProfileRecord, "id" | "createdAt" | "updatedAt">;

export type UserExperienceRecord = {
  id: string;
  userProfileId: string;
  type:
    | "internship"
    | "project"
    | "course"
    | "research"
    | "competition"
    | "campus"
    | "volunteer"
    | "work"
    | "other";
  title: string;
  organization?: string | null;
  role?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  description?: string | null;
  highlights: string[];
  metrics: string[];
  skills: string[];
  rawText?: string | null;
  extraInfo: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type UserExperiencePayload = Omit<
  UserExperienceRecord,
  "id" | "userProfileId" | "createdAt" | "updatedAt"
>;

export type ImportedResumeResponse = {
  profile: UserProfilePayload;
  experiences: UserExperiencePayload[];
  source: {
    fileName: string;
    contentType?: string | null;
    rawText: string;
  };
  warnings: string[];
};

export type PositionTargetRecord = {
  id: string;
  userProfileId?: string | null;
  company?: string | null;
  position: string;
  industry?: string | null;
  city?: string | null;
  jobDescription?: string | null;
  sourceUrl?: string | null;
  status: "interested" | "applied" | "interviewing" | "offered" | "rejected" | "closed";
  keywords: string[];
  requirements: string[];
  notes?: string | null;
  extraInfo: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PositionTargetPayload = Omit<
  PositionTargetRecord,
  "id" | "createdAt" | "updatedAt"
>;
