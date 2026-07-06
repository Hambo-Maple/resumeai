import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  analyzeJob,
  assessReadiness,
  diagnoseResume,
  finalizeResume,
  generateDialogueAnswer,
  generateProductizedDraft,
  generateResume,
  structureExperience,
  updateExperience,
  analyzeResumeBlocks,
  createPositionTarget,
  createUserExperience,
  createUserProfile,
  deletePositionTarget,
  deleteUserExperience,
  deleteUserProfile,
  importResumeFile,
  listPositionTargets,
  listUserExperiences,
  listUserProfiles,
  updateResumeBlock,
  updateResumeSection,
  updatePositionTarget,
  updateUserExperience,
  updateUserProfile,
} from "./services/resumeApi";
import type {
  AnalyzeJobResponse,
  AssessReadinessResponse,
  DiagnoseResumeResponse,
  GenerateResumeResponse,
  ProductizedDraftResponse,
  QuestionPlan,
  ResumeDocument,
  ResumeBlock,
  SectionQualityReport,
  StructuredExperienceResponse,
  UpdateExperienceResponse,
  UpdateResumeBlockResponse,
  UpdateResumeSectionResponse,
  PositionTargetPayload,
  PositionTargetRecord,
  UserExperiencePayload,
  UserExperienceRecord,
  UserProfilePayload,
  UserProfileRecord,
} from "./types/resume";
import "./styles/main.css";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type Stage =
  | "setup"
  | "target_profile_check"
  | "experience_outline_collection"
  | "experience_detail_collection"
  | "ready_to_generate"
  | "version_generated"
  | "need_experience"
  | "pre_draft_collection"
  | "experience_ready"
  | "draft_ready"
  | "diagnosis_ready"
  | "updated_experience"
  | "final";

type ProductizedQuestion = NonNullable<ProductizedDraftResponse["nextQuestion"]> & {
  id: string;
  questionType?: ProductizedQuestionType;
};

type ProductizedAnswer = {
  questionId: string;
  question: ProductizedQuestion;
  answer: string;
  skipped?: boolean;
};

type SelectedDiagnosis =
  | { type: "section"; sectionKey: string }
  | { type: "item"; sectionKey: string; itemId: string | null; itemName: string | null };

type PendingSectionUpdate = {
  result: UpdateResumeSectionResponse;
  target: ProductizedQuestion;
  skipped?: boolean;
};

type PendingBlockUpdate = {
  result: UpdateResumeBlockResponse;
  target: ProductizedQuestion;
  blockId: string;
  skipped?: boolean;
};

type PendingUsability = "not_usable" | "weak_usable" | "usable" | "strong";

type QuestionMode = "idle" | "auto" | "manual";

type ProductizedQuestionType = "module_question" | "global_question";

type NormalizedQuestionRoute = {
  questionType: ProductizedQuestionType;
  sectionKey: string;
  itemKey: string | null;
  field: string;
};

function productizedTargetKey(question: {
  sectionKey?: string | null;
  itemId?: string | null;
  itemName?: string | null;
}) {
  return [question.sectionKey, question.itemId || question.itemName || "__section__"]
    .filter(Boolean)
    .join("|");
}

const dynamicSectionKeys = new Set([
  "work",
  "internship",
  "project",
  "campus",
  "research",
  "competition",
  "volunteer",
  "other",
]);

function mergeResumeDocumentByTarget(
  currentDocument: ResumeDocument,
  updatedDocument: ResumeDocument,
  target: ProductizedQuestion,
): ResumeDocument {
  const sectionKey = target.sectionKey;
  if (!sectionKey) return currentDocument;

  if (sectionKey === "basics") {
    return { ...currentDocument, basics: updatedDocument.basics };
  }
  if (sectionKey === "target") {
    return { ...currentDocument, target: updatedDocument.target };
  }
  if (sectionKey === "summary") {
    return { ...currentDocument, summary: updatedDocument.summary };
  }
  if (sectionKey === "education") {
    return { ...currentDocument, education: updatedDocument.education };
  }
  if (sectionKey === "skills") {
    return { ...currentDocument, skills: updatedDocument.skills };
  }
  if (sectionKey === "certificates") {
    return { ...currentDocument, certificates: updatedDocument.certificates };
  }
  if (sectionKey === "awards") {
    return { ...currentDocument, awards: updatedDocument.awards };
  }
  if (sectionKey === "additional") {
    return { ...currentDocument, additional: updatedDocument.additional };
  }
  if (!dynamicSectionKeys.has(sectionKey)) return currentDocument;

  const currentSections = currentDocument.sections ?? [];
  const updatedSections = updatedDocument.sections ?? [];
  const updatedSection = updatedSections.find((section) => section.type === sectionKey);
  if (!updatedSection) return currentDocument;

  const currentSectionIndex = currentSections.findIndex((section) => section.type === sectionKey);
  if (currentSectionIndex < 0) {
    return { ...currentDocument, sections: [...currentSections, updatedSection] };
  }

  const currentSection = currentSections[currentSectionIndex];
  let nextSection = updatedSection;
  if (target.itemId || target.itemName) {
    const updatedItem = updatedSection.items.find(
      (item) =>
        (target.itemId && item.id === target.itemId) ||
        (!target.itemId && target.itemName && item.name === target.itemName),
    );
    if (!updatedItem) return currentDocument;
    const itemIndex = currentSection.items.findIndex(
      (item) =>
        (target.itemId && item.id === target.itemId) ||
        (!target.itemId && target.itemName && item.name === target.itemName),
    );
    if (itemIndex < 0) {
      nextSection = { ...currentSection, items: [...currentSection.items, updatedItem] };
    } else {
      nextSection = {
        ...currentSection,
        items: currentSection.items.map((item, index) =>
          index === itemIndex ? updatedItem : item,
        ),
      };
    }
  }

  return {
    ...currentDocument,
    sections: currentSections.map((section, index) =>
      index === currentSectionIndex ? nextSection : section,
    ),
  };
}

function reportForBlock(
  reports: SectionQualityReport[],
  block: { type: string; id: string; title: string },
) {
  const sectionReport = reports.find((report) => report.sectionKey === block.type);
  if (!sectionReport) return null;
  if (!dynamicSectionKeys.has(block.type)) return sectionReport;
  const itemReport =
    sectionReport.itemReports.find((item) => item.itemId === block.id) ??
    sectionReport.itemReports.find((item) => item.itemName === block.title) ??
    null;
  return itemReport ? { ...itemReport, sectionKey: sectionReport.sectionKey } : sectionReport;
}

function resumeBlocksFromProductizedDraft(draft: ProductizedDraftResponse | null): ResumeBlock[] {
  if (!draft) return [];
  const document = draft.resumeDocument;
  const baseBlocks: ResumeBlock[] = [
    {
      id: "basics",
      type: "basics",
      title: "基础信息",
      content: document.basics,
      qualityReport: reportForBlock(draft.sectionQualityReports, {
        id: "basics",
        type: "basics",
        title: "基础信息",
      }),
      questions: [],
      answerHistory: [],
      status: "draft",
      locked: false,
    },
    {
      id: "education",
      type: "education",
      title: "教育背景",
      content: document.education,
      qualityReport: reportForBlock(draft.sectionQualityReports, {
        id: "education",
        type: "education",
        title: "教育背景",
      }),
      questions: [],
      answerHistory: [],
      status: "draft",
      locked: false,
    },
    {
      id: "skills",
      type: "skills",
      title: "技能",
      content: document.skills,
      qualityReport: reportForBlock(draft.sectionQualityReports, {
        id: "skills",
        type: "skills",
        title: "技能",
      }),
      questions: [],
      answerHistory: [],
      status: "draft",
      locked: false,
    },
  ];

  const dynamicBlocks =
    document.sections?.flatMap((section) =>
      section.items.map((item, index) => {
        const id = item.id || `${section.type}-${index + 1}`;
        return {
          id,
          type: section.type,
          title: item.name || section.title,
          content: item,
          qualityReport: reportForBlock(draft.sectionQualityReports, {
            id,
            type: section.type,
            title: item.name || section.title,
          }),
          questions: [],
          answerHistory: [],
          status: "draft",
          locked: false,
        } satisfies ResumeBlock;
      }),
    ) ?? [];

  return [...baseBlocks, ...dynamicBlocks];
}

function resumeDocumentFromBlocks(
  baseDocument: ResumeDocument,
  blocks: ResumeBlock[],
  pendingBlock?: ResumeBlock | null,
): ResumeDocument {
  const effectiveBlocks = pendingBlock
    ? blocks.map((block) => (block.id === pendingBlock.id ? pendingBlock : block))
    : blocks;
  const nextDocument: ResumeDocument = {
    ...baseDocument,
    sections: baseDocument.sections?.map((section) => ({ ...section, items: [] })) ?? [],
  };

  effectiveBlocks.forEach((block) => {
    if (block.type === "basics" && block.content && typeof block.content === "object") {
      nextDocument.basics = block.content as ResumeDocument["basics"];
      return;
    }
    if (block.type === "education" && Array.isArray(block.content)) {
      nextDocument.education = block.content as ResumeDocument["education"];
      return;
    }
    if (block.type === "skills" && block.content && typeof block.content === "object") {
      nextDocument.skills = block.content as ResumeDocument["skills"];
      return;
    }
    if (!dynamicSectionKeys.has(block.type)) return;
    const item = block.content as NonNullable<ResumeDocument["sections"]>[number]["items"][number];
    if (!item || typeof item !== "object") return;
    const existingSection = nextDocument.sections?.find((section) => section.type === block.type);
    if (existingSection) {
      existingSection.items.push(item);
      return;
    }
    nextDocument.sections = [
      ...(nextDocument.sections ?? []),
      {
        type: block.type,
        title: block.title,
        items: [item],
      },
    ];
  });

  nextDocument.sections = (nextDocument.sections ?? []).filter(
    (section) => section.items.length > 0,
  );
  return nextDocument;
}

function blockIdForQuestion(question: ProductizedQuestion) {
  if (question.itemId) return question.itemId;
  if (question.itemName) return `${question.sectionKey || "item"}:${question.itemName}`;
  return question.sectionKey || "unknown";
}

function findBlockForQuestion(blocks: ResumeBlock[], question: ProductizedQuestion) {
  if (question.itemId) {
    const byId = blocks.find((block) => block.id === question.itemId);
    if (byId) return byId;
  }
  if (question.itemName) {
    const byName = blocks.find(
      (block) => block.type === question.sectionKey && block.title === question.itemName,
    );
    if (byName) return byName;
  }
  return blocks.find((block) => block.id === question.sectionKey) ?? null;
}

function summarizeOtherBlocks(blocks: ResumeBlock[], targetBlockId: string) {
  return blocks
    .filter((block) => block.id !== targetBlockId)
    .map((block) => ({
      id: block.id,
      type: block.type,
      title: block.title,
      status: block.status,
      locked: block.locked,
    }));
}

const emptyProfile = {
  name: "",
  phone: "",
  email: "",
  city: "",
  school: "",
  major: "",
  degree: "",
  graduation: "",
};

type EducationEntry = {
  school: string;
  major: string;
  degree: string;
  start: string;
  end: string;
  details: string;
};

const emptyEducationEntry: EducationEntry = {
  school: "",
  major: "",
  degree: "",
  start: "",
  end: "",
  details: "",
};

type CoachExperienceEntry = {
  type: UserExperiencePayload["type"];
  title: string;
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  location: string;
  description: string;
};

type CollectionQuestion = {
  id: string;
  stage: Extract<
    Stage,
    "target_profile_check" | "experience_outline_collection" | "experience_detail_collection"
  >;
  field: string;
  content: string;
  experienceIndex?: number;
};

const emptyCoachExperienceEntry: CoachExperienceEntry = {
  type: "project",
  title: "",
  organization: "",
  role: "",
  startDate: "",
  endDate: "",
  location: "",
  description: "",
};

const skipAnswers = new Set(["没有", "暂无", "暂时没有", "不清楚", "跳过", "不适用", "无"]);

const detailFieldLabels: Record<string, string> = {
  actions: "具体行动",
  tools: "工具方法",
  metrics: "数据规模",
  results: "结果产出",
  ability: "岗位关联",
};

function isSkipAnswer(answer: string) {
  return skipAnswers.has(answer.trim());
}

function textHasAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function inferExperienceTitle(text: string) {
  if (/问卷|调研|数据分析|pandas|Python|SQL|报表|看板/i.test(text)) {
    return "数据分析相关经历";
  }
  if (/讲座|社团|活动|运营|报名|宣传|社群/.test(text)) {
    return "活动运营相关经历";
  }
  if (/后端|接口|系统|平台|Spring|Java|数据库|API/i.test(text)) {
    return "后端开发相关经历";
  }
  const cleaned = text
    .replace(/\s+/g, "")
    .replace(/[，,。；;！!？?：:、]/g, "")
    .slice(0, 14);
  return cleaned ? `${cleaned}经历` : "补充经历";
}

function appendExperienceDetail(description: string, label: string, answer: string) {
  const nextLine = `${label}：${answer.trim()}`;
  return [description.trim(), nextLine].filter(Boolean).join("\n");
}

type ImportedProfileData = {
  profile: Partial<typeof emptyProfile>;
  educationEntries: EducationEntry[];
  skillsText: string;
  links: string[];
  certificates: string[];
  awards: string[];
  additional: string[];
};

function uniqueItems(items: string[]) {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

function firstMatch(text: string, pattern: RegExp) {
  return text.match(pattern)?.[1]?.trim() ?? "";
}

function findLine(text: string, pattern: RegExp) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => pattern.test(line)) ?? "";
}

function extractResumeTextProfile(text: string): ImportedProfileData {
  const normalized = text.replace(/\u3000/g, " ").replace(/\r\n/g, "\n");
  const compact = normalized.replace(/\s+/g, " ");
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const email = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone =
    normalized.match(/(?:\+?86[-\s]?)?(1[3-9]\d{9})/)?.[1] ??
    normalized.match(/(?:电话|手机|联系方式)[:：\s]*([+\d][\d\s-]{6,})/)?.[1]?.trim() ??
    "";
  const explicitName = firstMatch(normalized, /(?:姓名|Name)[:：\s]*([\u4e00-\u9fa5A-Za-z·.\s]{2,24})/i);
  const name =
    explicitName ||
    lines.find((line) => /^[\u4e00-\u9fa5]{2,6}$/.test(line)) ||
    lines.find((line) => /^[A-Za-z][A-Za-z\s.]{2,32}$/.test(line)) ||
    "";
  const city =
    firstMatch(normalized, /(?:城市|所在地|现居|期望城市)[:：\s]*([\u4e00-\u9fa5]{2,12})/) ||
    compact.match(/(北京|上海|广州|深圳|杭州|南京|成都|武汉|西安|苏州|天津|重庆|厦门|长沙|青岛|郑州|合肥|宁波|无锡|佛山|东莞|大连|沈阳|济南)/)?.[1] ||
    "";
  const schoolLine = findLine(normalized, /(大学|学院|学校|University|College)/i);
  const school =
    firstMatch(normalized, /(?:学校|毕业院校|院校)[:：\s]*([^\n，,|]{2,40})/) ||
    schoolLine.match(/([\u4e00-\u9fa5A-Za-z\s·-]{2,40}(?:大学|学院|学校|University|College))/i)?.[1]?.trim() ||
    "";
  const major =
    firstMatch(normalized, /(?:专业|Major)[:：\s]*([^\n，,|]{2,40})/i) ||
    schoolLine.match(/(?:大学|学院|学校)\s*[|｜/\s-]+([\u4e00-\u9fa5A-Za-z0-9\s]{2,30}(?:专业)?)/)?.[1]?.replace(/专业$/, "").trim() ||
    "";
  const degree =
    compact.match(/(博士研究生|硕士研究生|本科|硕士|博士|大专|学士|研究生|MBA)/)?.[1] ?? "";
  const graduation =
    firstMatch(normalized, /(?:毕业时间|毕业年份|Graduation)[:：\s]*([0-9./年月 -]{4,20})/i) ||
    compact.match(/(20\d{2}[./年-]?\d{0,2})\s*(?:毕业|届)/)?.[1]?.replace("年", ".") ||
    "";
  const period = schoolLine.match(/(20\d{2}[./-]?\d{0,2})\s*[-至~]\s*(20\d{2}[./-]?\d{0,2}|至今)/);
  const skillLine =
    findLine(normalized, /技能|技术栈|工具|Skills/i) ||
    lines
      .filter((line) => /(Python|SQL|Excel|pandas|Tableau|Power BI|Java|C\+\+|R语言|SPSS)/i.test(line))
      .slice(0, 2)
      .join("，");
  const skills = uniqueItems(
    skillLine
      .replace(/^(专业)?技能[:：\s]*/i, "")
      .split(/[，,、/；;\s]+/)
      .filter((item) => item.length > 1),
  );
  const links = uniqueItems(normalized.match(/https?:\/\/[^\s，,；;]+/g) ?? []);
  const certificates = uniqueItems(
    lines.filter((line) => /(CET|英语|证书|资格|计算机二级|普通话|雅思|托福)/i.test(line)),
  );
  const awards = uniqueItems(lines.filter((line) => /(奖|荣誉|竞赛|比赛|Scholarship|Award)/i.test(line)));
  const additional = uniqueItems([
    ...links,
    ...lines.filter((line) => /(GitHub|作品集|个人主页|Portfolio|github\.com)/i.test(line)),
  ]);

  return {
    profile: { name, phone, email, city, school, major, degree, graduation },
    educationEntries: [
      {
        school,
        major,
        degree,
        start: period?.[1] ?? "",
        end: period?.[2] ?? graduation,
        details: "",
      },
    ].filter((entry) => [entry.school, entry.major, entry.degree, entry.start, entry.end].some(Boolean)),
    skillsText: skills.join("、"),
    links,
    certificates,
    awards,
    additional,
  };
}

function educationEntryFromProfile(
  record: Pick<
    UserProfileRecord,
    "education" | "school" | "major" | "degree" | "graduation"
  >,
): EducationEntry[] {
  const entries =
    record.education?.map((item) => {
      const [start = "", end = ""] = (item.period ?? "").split(/\s*-\s*/);
      return {
        school: item.school ?? "",
        major: item.major ?? "",
        degree: item.degree ?? "",
        start,
        end,
        details: (item.details ?? []).join("；"),
      };
    }) ?? [];

  if (entries.length > 0) return entries;
  if ([record.school, record.major, record.degree, record.graduation].some(Boolean)) {
    return [
      {
        school: record.school ?? "",
        major: record.major ?? "",
        degree: record.degree ?? "",
        start: "",
        end: record.graduation ?? "",
        details: "",
      },
    ];
  }
  return [{ ...emptyEducationEntry }];
}

function skillsTextFromProfile(record: Pick<UserProfileRecord, "skills">) {
  return uniqueItems([
    ...(record.skills?.technical ?? []),
    ...(record.skills?.tools ?? []),
    ...(record.skills?.domain ?? []),
    ...(record.skills?.language ?? []),
  ]).join("、");
}

function hasCoachExperienceContent(entry: CoachExperienceEntry) {
  return [
    entry.title,
    entry.organization,
    entry.role,
    entry.startDate,
    entry.endDate,
    entry.location,
    entry.description,
  ].some((value) => value.trim());
}

function coachExperienceToInput(entry: CoachExperienceEntry, index: number) {
  const title = entry.title.trim() || `经历 ${index + 1}`;
  const rawText = [
    title,
    [entry.organization, entry.role].filter(Boolean).join(" / "),
    [entry.startDate, entry.endDate].filter(Boolean).join(" - "),
    entry.location,
    entry.description,
  ]
    .filter(Boolean)
    .join("\n");
  return {
    id: `local-experience-${index + 1}`,
    type: entry.type,
    title,
    organization: entry.organization.trim() || null,
    role: entry.role.trim() || null,
    startDate: entry.startDate.trim() || null,
    endDate: entry.endDate.trim() || null,
    location: entry.location.trim() || null,
    description: entry.description.trim() || null,
    highlights: [],
    metrics: [],
    skills: [],
    rawText,
  };
}

function coachExperienceInputs(entries: CoachExperienceEntry[]) {
  return entries.filter(hasCoachExperienceContent).map(coachExperienceToInput);
}

function coachExperienceContext(entries: CoachExperienceEntry[]) {
  return coachExperienceInputs(entries)
    .map((entry) =>
      [
        entry.title,
        [entry.organization, entry.role].filter(Boolean).join(" / "),
        [entry.startDate, entry.endDate].filter(Boolean).join(" - "),
        entry.description,
      ]
        .filter(Boolean)
        .join("，"),
    )
    .join("；");
}

function coachExperienceFromRecord(record: UserExperienceRecord | UserExperiencePayload) {
  return {
    type: record.type,
    title: record.title ?? "",
    organization: record.organization ?? "",
    role: record.role ?? "",
    startDate: record.startDate ?? "",
    endDate: record.endDate ?? "",
    location: record.location ?? "",
    description: [
      record.description,
      ...(record.highlights ?? []),
      record.rawText && !record.description ? record.rawText : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function normalizeQuestionId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function inferQuestionTopic(question: {
  field?: string | null;
  gapLabel?: string | null;
  question?: string | null;
}) {
  const text = [question.field, question.gapLabel, question.question]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/sql|数据库|查询|取数|database|query/.test(text)) return "sql";
  if (/角色|负责|职责|role|responsib/.test(text)) return "role";
  if (/结果|产出|成果|反馈|影响|result|outcome|impact/.test(text)) return "result";
  if (/工具|方法|技术|python|pandas|excel|tableau|power\s*bi|tool|method/.test(text)) {
    return "tool_method";
  }
  if (/时间|周期|日期|period|date|duration/.test(text)) return "period";
  if (/指标|数据|比例|数量|metric|quant/.test(text)) return "metric";
  return question.field || question.gapLabel || question.question || "";
}

function isOutOfCurrentItemScope(question: ProductizedQuestion) {
  if (!question.itemId && !question.itemName) return false;
  return /除.*项目|除.*经历|其他.*项目|其他.*经历|其他.*sql|还有.*sql|其他.*证书|其他.*奖项/.test(
    question.question,
  );
}

function normalizeQuestionField(question: {
  field?: string | null;
  gapLabel?: string | null;
  question?: string | null;
}) {
  const text = [question.field, question.gapLabel, question.question]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/sql|数据库|查询|取数|database|query/.test(text)) return "tool";
  if (/python|pandas|numpy|excel|tableau|power\s*bi|matplotlib|seaborn|工具|方法|技术|tool|method/.test(text)) {
    return "tool";
  }
  if (/时间|周期|日期|学期|起止|完成|period|date|duration/.test(text)) return "period";
  if (/角色|负责|职责|分工|独立|团队|协作|role|responsib/.test(text)) return "role";
  if (/动作|任务|工作|执行|处理|分析|清洗|搭建|制作|action/.test(text)) return "action";
  if (/背景|来源|课程|场景|业务|context|background/.test(text)) return "context";
  if (/样本|规模|范围|覆盖|数量|scope|sample/.test(text)) return "scope";
  if (/指标|比例|转化|排名|金额|人数|metric|quant/.test(text)) return "metric";
  if (/结果|产出|成果|反馈|影响|结论|采纳|提升|优化建议|result|outcome|impact/.test(text)) return "result";
  if (/证书|奖项|竞赛|比赛|实习|其他经历|能力覆盖|ability|coverage/.test(text)) {
    return "ability_coverage";
  }
  return normalizeQuestionId(question.field || question.gapLabel || question.question || "other");
}

function normalizeQuestionRoute(question: {
  sectionKey?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  field?: string | null;
  gapLabel?: string | null;
  question?: string | null;
}): NormalizedQuestionRoute {
  const text = [question.field, question.gapLabel, question.question]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const field = normalizeQuestionField(question);
  const hasItem = Boolean(question.itemId || question.itemName);
  const asksBeyondCurrentItem =
    /除了|除这个|除该|其他|还有没有|是否还有|更匹配|整份简历|整体|目标岗位|求职方向|能力覆盖/.test(
      text,
    );
  const asksMissingGlobalSection =
    !hasItem && /证书|奖项|竞赛|比赛|实习|其他经历|更匹配的经历/.test(text);

  if (asksBeyondCurrentItem || asksMissingGlobalSection) {
    return {
      questionType: "global_question",
      sectionKey: "global",
      itemKey: null,
      field:
        field === "tool" && /sql/.test(text)
          ? "sql_evidence"
          : field === "ability_coverage"
            ? "ability_coverage"
            : field,
    };
  }

  return {
    questionType: "module_question",
    sectionKey: question.sectionKey || "unknown",
    itemKey: question.itemId || question.itemName || null,
    field,
  };
}

function productizedQuestionKey(question: {
  sectionKey?: string | null;
  itemId?: string | null;
  itemName?: string | null;
  field?: string | null;
  gapLabel?: string | null;
  question?: string | null;
}) {
  const route = normalizeQuestionRoute(question);
  if (route.questionType === "global_question") {
    return `global:${route.field}`;
  }
  return `module:${route.sectionKey}:${route.itemKey || "__section__"}:${route.field}`;
}

function makeProductizedQuestion(
  question: Partial<NonNullable<ProductizedDraftResponse["nextQuestion"]>> & {
    question: string;
  },
  fallback: {
    sectionKey?: string | null;
    sectionTitle?: string | null;
    itemId?: string | null;
    itemName?: string | null;
    field?: string | null;
    gapLabel?: string | null;
    reason?: string | null;
  } = {},
): ProductizedQuestion {
  const normalized = {
    target: question.target ?? (fallback.itemId || fallback.itemName ? "item" : "section"),
    sectionKey: question.sectionKey ?? fallback.sectionKey ?? null,
    sectionTitle: question.sectionTitle ?? fallback.sectionTitle ?? null,
    itemId: question.itemId ?? fallback.itemId ?? null,
    itemName: question.itemName ?? fallback.itemName ?? null,
    field: question.field ?? fallback.field ?? null,
    gapLabel: question.gapLabel ?? fallback.gapLabel ?? null,
    question: question.question,
    reason:
      question.reason ??
      fallback.reason ??
      "补充这个信息后，可以提升对应简历板块的可信度和完整度。",
  };
  const route = normalizeQuestionRoute(normalized);
  return {
    ...normalized,
    target: route.questionType === "global_question" ? "section" : normalized.target,
    sectionKey: route.questionType === "global_question" ? "global" : normalized.sectionKey,
    itemId: route.questionType === "global_question" ? null : normalized.itemId,
    itemName: route.questionType === "global_question" ? null : normalized.itemName,
    field: route.field,
    questionType: route.questionType,
    id: normalizeQuestionId(productizedQuestionKey(normalized)),
  };
}

function makeProductizedQuestionFromBlockQuestion(
  question: Record<string, unknown> | null | undefined,
  fallback: ProductizedQuestion,
): ProductizedQuestion | null {
  if (!question || typeof question.question !== "string") return null;
  return makeProductizedQuestion(
    {
      target: "item",
      sectionKey: fallback.sectionKey,
      sectionTitle: fallback.sectionTitle,
      itemId: fallback.itemId,
      itemName: fallback.itemName,
      field: typeof question.field === "string" ? question.field : fallback.field,
      gapLabel: typeof question.field === "string" ? question.field : fallback.gapLabel,
      question: question.question,
      reason: typeof question.reason === "string" ? question.reason : fallback.reason,
    },
    {
      sectionKey: fallback.sectionKey,
      sectionTitle: fallback.sectionTitle,
      itemId: fallback.itemId,
      itemName: fallback.itemName,
    },
  );
}

function collectProductizedQuestions(
  draft: ProductizedDraftResponse,
  answeredKeys: Set<string> = new Set(),
  completedTargetKeys: Set<string> = new Set(),
): ProductizedQuestion[] {
  const questions: ProductizedQuestion[] = [];
  const globalQuestions: ProductizedQuestion[] = [];
  const seen = new Set<string>();

  function add(question: ProductizedQuestion | null) {
    if (!question?.question?.trim()) return;
    const route = normalizeQuestionRoute(question);
    if (route.questionType === "module_question" && isOutOfCurrentItemScope(question)) return;
    if (route.questionType === "module_question" && completedTargetKeys.has(productizedTargetKey(question))) {
      return;
    }
    const key =
      productizedQuestionKey(question) || normalizeQuestionId(question.question);
    if (answeredKeys.has(key)) return;
    if (seen.has(key)) return;
    seen.add(key);
    if (route.questionType === "global_question") {
      globalQuestions.push(question);
    } else {
      questions.push(question);
    }
  }

  draft.sectionQualityReports.forEach((report) => {
    report.itemReports.forEach((item) => {
      const openGaps = item.gaps.filter((gap) => gap.status !== "skipped");
      add(
        item.nextQuestion && openGaps.length > 0
          ? makeProductizedQuestion(
              {
                target: "item",
                sectionKey: report.sectionKey,
                sectionTitle: report.title,
                itemId: item.itemId,
                itemName: item.itemName,
                question: item.nextQuestion,
                gapLabel: openGaps[0]?.description ?? null,
                field: openGaps[0]?.type ?? null,
                reason: openGaps[0]?.description ?? report.summary,
              },
              { sectionKey: report.sectionKey, sectionTitle: report.title },
            )
          : null,
      );
    });
  });

  draft.sectionQualityReports.forEach((report) => {
    const openGaps = report.gaps.filter((gap) => gap.status !== "skipped");
    add(
      report.nextQuestion && openGaps.length > 0
        ? makeProductizedQuestion(
            {
              target: "section",
              sectionKey: report.sectionKey,
              sectionTitle: report.title,
              question: report.nextQuestion,
              gapLabel: openGaps[0]?.description ?? null,
              field: openGaps[0]?.type ?? null,
              reason: report.summary,
            },
            { sectionKey: report.sectionKey, sectionTitle: report.title },
          )
        : null,
    );
  });

  add(draft.nextQuestion ? makeProductizedQuestion(draft.nextQuestion) : null);

  return [...questions, ...globalQuestions];
}

function getPendingUsability(pending: PendingSectionUpdate): PendingUsability {
  const report = pending.result.updatedSectionReport;
  const itemReport =
    pending.target.itemId || pending.target.itemName
      ? report.itemReports.find(
          (item) =>
            (pending.target.itemId && item.itemId === pending.target.itemId) ||
            (!pending.target.itemId && item.itemName === pending.target.itemName),
        )
      : null;
  const score = itemReport?.score ?? report.completeness;
  const gaps = itemReport?.gaps ?? report.gaps;
  const openGaps = gaps.filter((gap) => gap.status !== "skipped");
  const skippedGaps = gaps.filter((gap) => gap.status === "skipped");
  const requiredGaps = openGaps.filter(
    (gap) => gap.priority === "high" || gap.priority === "medium",
  );
  const isExperienceItem =
    Boolean(itemReport) && dynamicSectionKeys.has(pending.target.sectionKey ?? "");
  const blockingCoreGaps = isExperienceItem
    ? openGaps.filter((gap) => requiredExperienceFields.has(normalizedGapField(gap)))
    : [];
  const skippedCoreGaps = isExperienceItem
    ? skippedGaps.filter((gap) => requiredExperienceFields.has(normalizedGapField(gap)))
    : [];

  if (blockingCoreGaps.length > 0) return "not_usable";
  if (skippedCoreGaps.length > 0) return "weak_usable";

  if (score >= 85 && requiredGaps.length === 0) return "strong";
  if (pending.result.isCompleteForDraft || (score >= 70 && requiredGaps.length === 0)) {
    return "usable";
  }
  if (pending.skipped || score >= 50 || !pending.result.nextQuestion) return "weak_usable";
  return "not_usable";
}

function markQuestionSkippedInReport(
  report: SectionQualityReport,
  question: ProductizedQuestion,
): SectionQualityReport {
  const markGap = (gap: SectionQualityReport["gaps"][number]) => {
    const sameType = question.field && gap.type === question.field;
    const sameDescription =
      question.gapLabel &&
      normalizeQuestionId(gap.description) === normalizeQuestionId(question.gapLabel);
    return sameType || sameDescription ? { ...gap, status: "skipped" as const } : gap;
  };

  if (question.itemId || question.itemName) {
    return {
      ...report,
      itemReports: report.itemReports.map((item) => {
        const isTarget =
          (question.itemId && item.itemId === question.itemId) ||
          (!question.itemId && question.itemName && item.itemName === question.itemName);
        if (!isTarget) return item;
        return {
          ...item,
          gaps: item.gaps.map(markGap),
          nextQuestion: null,
        };
      }),
    };
  }

  return {
    ...report,
    gaps: report.gaps.map(markGap),
    nextQuestion: null,
  };
}

const requiredExperienceFields = new Set(["period", "role", "action", "tool", "result"]);

function normalizedGapField(gap: { type?: string | null; description?: string | null }) {
  return normalizeQuestionField({
    field: gap.type,
    gapLabel: gap.description,
    question: gap.description,
  });
}

function usabilityLabel(value: PendingUsability) {
  if (value === "strong") return "强经历";
  if (value === "usable") return "可写入";
  if (value === "weak_usable") return "可写弱版本";
  return "暂不可写";
}

function App() {
  const [workspaceMode, setWorkspaceMode] = useState<"coach" | "library">("coach");
  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [profile, setProfile] = useState(emptyProfile);
  const [availableProfiles, setAvailableProfiles] = useState<UserProfileRecord[]>([]);
  const [selectedFillProfileId, setSelectedFillProfileId] = useState("");
  const [availablePositions, setAvailablePositions] = useState<PositionTargetRecord[]>([]);
  const [selectedFillPositionId, setSelectedFillPositionId] = useState("");
  const [targetFillStatus, setTargetFillStatus] = useState("");
  const [availableProfileExperiences, setAvailableProfileExperiences] = useState<
    UserExperienceRecord[]
  >([]);
  const [selectedFillExperienceId, setSelectedFillExperienceId] = useState("");
  const [profileFillStatus, setProfileFillStatus] = useState("");
  const [skillsText, setSkillsText] = useState("");
  const [educationEntries, setEducationEntries] = useState<EducationEntry[]>([
    { ...emptyEducationEntry },
  ]);
  const [coachExperienceEntries, setCoachExperienceEntries] = useState<CoachExperienceEntry[]>([
    { ...emptyCoachExperienceEntry },
  ]);
  const [certificatesText, setCertificatesText] = useState<string[]>([""]);
  const [awardsText, setAwardsText] = useState<string[]>([""]);
  const [additionalText, setAdditionalText] = useState<string[]>([""]);
  const [isTargetCollapsed, setIsTargetCollapsed] = useState(false);
  const [isProfileCollapsed, setIsProfileCollapsed] = useState(false);
  const [isExperienceCollapsed, setIsExperienceCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const lastChatQuestionId = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "你好，我是你的简历教练。先填写目标岗位和个人基础信息，然后输入一段真实经历。",
    },
  ]);
  const [stage, setStage] = useState<Stage>("setup");
  const [jobResult, setJobResult] = useState<AnalyzeJobResponse | null>(null);
  const [experienceResult, setExperienceResult] =
    useState<StructuredExperienceResponse | null>(null);
  const [readinessResult, setReadinessResult] = useState<AssessReadinessResponse | null>(null);
  const [resumeResult, setResumeResult] = useState<GenerateResumeResponse | null>(null);
  const [productizedDraft, setProductizedDraft] = useState<ProductizedDraftResponse | null>(null);
  const [resumeBlocks, setResumeBlocks] = useState<ResumeBlock[]>([]);
  const [globalBlockAnalysis, setGlobalBlockAnalysis] = useState<Record<string, unknown> | null>(
    null,
  );
  const [productizedAnswerHistory, setProductizedAnswerHistory] = useState<ProductizedAnswer[]>([]);
  const [pendingSectionUpdate, setPendingSectionUpdate] = useState<PendingSectionUpdate | null>(
    null,
  );
  const [pendingBlockUpdate, setPendingBlockUpdate] = useState<PendingBlockUpdate | null>(null);
  const [manualEditQuestion, setManualEditQuestion] = useState<ProductizedQuestion | null>(null);
  const [questionMode, setQuestionMode] = useState<QuestionMode>("idle");
  const [collectionQuestion, setCollectionQuestion] = useState<CollectionQuestion | null>(null);
  const [skippedCollectionKeys, setSkippedCollectionKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [shouldAdvanceCollection, setShouldAdvanceCollection] = useState(false);
  const [completedTargetKeys, setCompletedTargetKeys] = useState<Set<string>>(() => new Set());
  const [optionalTargetKeys, setOptionalTargetKeys] = useState<Set<string>>(() => new Set());
  const [diagnosisResult, setDiagnosisResult] = useState<DiagnoseResumeResponse | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [askedPreDraftFields, setAskedPreDraftFields] = useState<string[]>([]);
  const [updateResult, setUpdateResult] = useState<UpdateExperienceResponse | null>(null);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState("");

  const isBusy = Boolean(loadingLabel);
  const currentQuestionPlan: QuestionPlan | null =
    diagnosisResult?.questionPlans[currentQuestionIndex] ?? null;
  const currentBackendQuestion =
    diagnosisResult?.questions[currentQuestionIndex]?.question ??
    currentQuestionPlan?.userVisibleQuestion ??
    "";
  const handledProductizedQuestionKeys = useMemo(
    () =>
      new Set(
        productizedAnswerHistory.map((item) => productizedQuestionKey(item.question)),
      ),
    [productizedAnswerHistory],
  );
  const blockedCompletedTargetKeys = useMemo(
    () =>
      new Set(
        Array.from(completedTargetKeys).filter((key) => !optionalTargetKeys.has(key)),
      ),
    [completedTargetKeys, optionalTargetKeys],
  );
  const productizedQuestions = useMemo(
    () =>
      productizedDraft
        ? collectProductizedQuestions(
            productizedDraft,
            handledProductizedQuestionKeys,
            blockedCompletedTargetKeys,
          )
        : [],
    [blockedCompletedTargetKeys, handledProductizedQuestionKeys, productizedDraft],
  );
  const pendingUsability = pendingSectionUpdate
    ? getPendingUsability(pendingSectionUpdate)
    : null;
  const pendingBlockQuestion =
    pendingBlockUpdate?.result.nextQuestion && !pendingBlockUpdate.result.isCompleteForDraft
      ? makeProductizedQuestionFromBlockQuestion(
          pendingBlockUpdate.result.nextQuestion,
          pendingBlockUpdate.target,
        )
      : null;
  const pendingQuestion =
    pendingBlockQuestion ??
    (pendingSectionUpdate?.result.nextQuestion && pendingUsability === "not_usable"
      ? makeProductizedQuestion(pendingSectionUpdate.result.nextQuestion, {
          sectionKey: pendingSectionUpdate.target.sectionKey,
          sectionTitle: pendingSectionUpdate.target.sectionTitle,
          itemId: pendingSectionUpdate.target.itemId,
          itemName: pendingSectionUpdate.target.itemName,
        })
      : null);
  const currentProductizedQuestion = pendingBlockUpdate || pendingSectionUpdate
    ? pendingQuestion
    : questionMode === "manual"
      ? manualEditQuestion
      : questionMode === "auto"
        ? productizedQuestions[0] ?? null
        : null;
  const showConversation =
    Boolean(productizedDraft) ||
    [
      "target_profile_check",
      "experience_outline_collection",
      "experience_detail_collection",
      "ready_to_generate",
      "version_generated",
      "pre_draft_collection",
      "draft_ready",
      "diagnosis_ready",
      "updated_experience",
      "final",
    ].includes(
      stage,
    );

  const assistantHint = useMemo(() => {
    if (stage === "setup") return "先填写基础信息，然后让系统逐步提问补齐资料。";
    if (stage === "target_profile_check") return "正在检查目标岗位和个人信息缺口。";
    if (stage === "experience_outline_collection") return "先把可用经历的大框架列出来。";
    if (stage === "experience_detail_collection") return "正在逐个事例补充关键细节。";
    if (stage === "ready_to_generate") return "资料已达到生成新版本的最低标准。";
    if (stage === "version_generated") return "当前 Markdown 简历版本已生成，可继续补充后再生成新版本。";
    if (stage === "need_experience") return "在下方输入一段真实经历。";
    if (stage === "pre_draft_collection") return "先补齐更新简历需要的关键信息。";
    if (stage === "experience_ready") return "资料已达到更新简历标准。";
    if (stage === "draft_ready") return "简历已更新，可以继续补充或确认版本。";
    if (stage === "diagnosis_ready") return "请回答当前追问。";
    if (stage === "updated_experience") return "经历已更新，可以生成新版本。";
    return "当前版本已确认最终版。";
  }, [stage]);

  function addMessage(role: ChatMessage["role"], content: string) {
    setMessages((current) => [...current, { id: crypto.randomUUID(), role, content }]);
  }

  function formatQuestionMessage(question: ProductizedQuestion) {
    return [
      question.sectionTitle || question.itemName
        ? `当前补充：${[question.sectionTitle, question.itemName].filter(Boolean).join(" / ")}`
        : null,
      question.question,
    ]
      .filter(Boolean)
      .join("\n");
  }

  useEffect(() => {
    if (!currentProductizedQuestion) {
      lastChatQuestionId.current = null;
      return;
    }
    if (lastChatQuestionId.current === currentProductizedQuestion.id) return;
    lastChatQuestionId.current = currentProductizedQuestion.id;
    addMessage("assistant", formatQuestionMessage(currentProductizedQuestion));
  }, [currentProductizedQuestion?.id]);

  useEffect(() => {
    refreshAvailableProfiles();
    refreshAvailablePositions();
  }, [workspaceMode]);

  useEffect(() => {
    refreshAvailableProfileExperiences(selectedFillProfileId);
  }, [selectedFillProfileId]);

  useEffect(() => {
    if (!shouldAdvanceCollection) return;
    setShouldAdvanceCollection(false);
    const nextQuestion = nextCollectionQuestion();
    if (nextQuestion) {
      setCollectionQuestion(nextQuestion);
      setStage(nextQuestion.stage);
      addMessage("assistant", nextQuestion.content);
      return;
    }
    setCollectionQuestion(null);
    setStage("ready_to_generate");
    addMessage("assistant", "这些信息已经可以先生成一个新版本。你也可以继续补充经历，之后再生成更新版本。");
  }, [shouldAdvanceCollection]);

  function resetRunState() {
    setJobResult(null);
    setExperienceResult(null);
    setReadinessResult(null);
    setResumeResult(null);
    setProductizedDraft(null);
    setResumeBlocks([]);
    setGlobalBlockAnalysis(null);
    setProductizedAnswerHistory([]);
    setPendingSectionUpdate(null);
    setPendingBlockUpdate(null);
    setManualEditQuestion(null);
    setQuestionMode("idle");
    setCollectionQuestion(null);
    setSkippedCollectionKeys(new Set());
    setShouldAdvanceCollection(false);
    setCompletedTargetKeys(new Set());
    setOptionalTargetKeys(new Set());
    setDiagnosisResult(null);
    setUpdateResult(null);
    setCurrentQuestionIndex(0);
    setAskedPreDraftFields([]);
    setStage("setup");
  }

  async function runAction<T>(label: string, action: () => Promise<T>): Promise<T | null> {
    setLoadingLabel(label);
    setError("");
    try {
      return await action();
    } catch (err) {
      const message = err instanceof Error ? err.message : `${label}失败`;
      setError(message);
      addMessage("assistant", message);
      return null;
    } finally {
      setLoadingLabel("");
    }
  }

  async function refreshAvailableProfiles() {
    try {
      const data = await listUserProfiles();
      setAvailableProfiles(data);
      setSelectedFillProfileId((current) =>
        current && data.some((item) => item.id === current) ? current : data[0]?.id ?? "",
      );
    } catch {
      setAvailableProfiles([]);
      setSelectedFillProfileId("");
    }
  }

  async function refreshAvailablePositions() {
    try {
      const data = await listPositionTargets();
      setAvailablePositions(data);
      setSelectedFillPositionId((current) =>
        current && data.some((item) => item.id === current) ? current : data[0]?.id ?? "",
      );
    } catch {
      setAvailablePositions([]);
      setSelectedFillPositionId("");
    }
  }

  async function refreshAvailableProfileExperiences(profileId: string) {
    if (!profileId) {
      setAvailableProfileExperiences([]);
      setSelectedFillExperienceId("");
      return;
    }
    try {
      const data = await listUserExperiences(profileId);
      setAvailableProfileExperiences(data);
      setSelectedFillExperienceId((current) =>
        current && data.some((item) => item.id === current) ? current : data[0]?.id ?? "",
      );
    } catch {
      setAvailableProfileExperiences([]);
      setSelectedFillExperienceId("");
    }
  }

  function applyProfileRecordToCoach(record: UserProfileRecord) {
    setProfile({
      name: record.name ?? "",
      phone: record.phone ?? "",
      email: record.email ?? "",
      city: record.city ?? "",
      school: record.school ?? "",
      major: record.major ?? "",
      degree: record.degree ?? "",
      graduation: record.graduation ?? "",
    });
    setEducationEntries(educationEntryFromProfile(record));
    setSkillsText(skillsTextFromProfile(record));
    const profileCertificates = extraInfoList(record.extraInfo, "certificates", "importedCertificates");
    const profileAwards = extraInfoList(record.extraInfo, "awards", "importedAwards");
    if (profileCertificates.length > 0) {
      setCertificatesText(profileCertificates);
    }
    if (profileAwards.length > 0) {
      setAwardsText(profileAwards);
    }
    setAdditionalText((current) => {
      const imported = uniqueItems([...(record.links ?? []), ...filledItems(current)]);
      return imported.length > 0 ? imported : [""];
    });
    setProfileFillStatus(`已填入 ${record.name || "未命名用户"} 的个人资料`);
    addMessage("assistant", "已从个人资料填入基础信息、教育背景、技能、证书、荣誉奖项和链接。");
  }

  function applySelectedProfileToCoach() {
    const record = availableProfiles.find((item) => item.id === selectedFillProfileId);
    if (!record) {
      setProfileFillStatus("请先在个人资料里创建或选择一份资料。");
      return;
    }
    applyProfileRecordToCoach(record);
  }

  function applyPositionRecordToCoach(record: PositionTargetRecord) {
    setCompany(record.company ?? "");
    setPosition(record.position);
    setJobDescription(record.jobDescription ?? "");
    setTargetFillStatus(
      `已填入职位：${[record.company, record.position].filter(Boolean).join(" / ")}`,
    );
    addMessage("assistant", "已从职位模块填入目标公司、目标岗位和岗位 JD。");
  }

  function applySelectedPositionToCoach() {
    const record = availablePositions.find((item) => item.id === selectedFillPositionId);
    if (!record) {
      setTargetFillStatus("请先在职位模块里创建或选择一个职位。");
      return;
    }
    applyPositionRecordToCoach(record);
  }

  function mergeCoachExperienceEntries(incoming: CoachExperienceEntry[]) {
    setCoachExperienceEntries((current) => {
      const existing = current.filter(hasCoachExperienceContent);
      const next = [...existing, ...incoming];
      return next.length > 0 ? next : [{ ...emptyCoachExperienceEntry }];
    });
  }

  function applySelectedExperienceToCoach() {
    const record = availableProfileExperiences.find((item) => item.id === selectedFillExperienceId);
    if (!record) {
      setProfileFillStatus("请先选择一条个人资料中的经历。");
      return;
    }
    mergeCoachExperienceEntries([coachExperienceFromRecord(record)]);
    setProfileFillStatus(`已填入经历：${record.title}`);
  }

  function applyAllExperiencesToCoach() {
    if (availableProfileExperiences.length === 0) {
      setProfileFillStatus("当前个人资料还没有保存经历。");
      return;
    }
    mergeCoachExperienceEntries(availableProfileExperiences.map(coachExperienceFromRecord));
    setProfileFillStatus(`已填入 ${availableProfileExperiences.length} 段经历`);
  }

  function skillsFromText() {
    return skillsText
      .split(/[，,、/\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function educationPayload() {
    return educationEntries
      .filter((item) =>
        [item.school, item.major, item.degree, item.start, item.end, item.details].some(
          (value) => value.trim(),
        ),
      )
      .map((item) => ({
        school: item.school || null,
        major: item.major || null,
        degree: item.degree || null,
        period: [item.start, item.end].filter(Boolean).join(" - ") || null,
        details: item.details
          .split(/[；;\n]+/)
          .map((detail) => detail.trim())
          .filter(Boolean),
      }));
  }

  function skillsPayload() {
    return {
      technical: skillsFromText(),
      domain: [],
      language: [],
    };
  }

  function splitGeneratedItems(value: string) {
    const items = value
      .split(/\n+|；|;|、(?=(?:英语|计算机|校级|省级|国家级|CET|GitHub|作品集))/)
      .map((item) => item.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean);
    return items.length > 0 ? items : [value.trim()];
  }

  function filledItems(items: string[]) {
    return items.map((item) => item.trim()).filter(Boolean);
  }

  function skipped(key: string) {
    return skippedCollectionKeys.has(key);
  }

  function profileHasContact() {
    return Boolean(profile.phone.trim() || profile.email.trim());
  }

  function hasEducationBasics() {
    return educationEntries.some((entry) =>
      [entry.school, entry.major, entry.degree, entry.end, entry.details].some((value) =>
        value.trim(),
      ),
    );
  }

  function usableCoachExperiences() {
    return coachExperienceEntries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => hasCoachExperienceContent(entry));
  }

  function detailMissingField(entry: CoachExperienceEntry, index: number) {
    const text = `${entry.title}\n${entry.organization}\n${entry.role}\n${entry.description}`;
    const fieldChecks: Array<{
      field: string;
      missing: boolean;
      question: string;
    }> = [
      {
        field: "role",
        missing: !entry.role.trim(),
        question: `在“${entry.title || `经历 ${index + 1}`}”里，你本人主要负责哪一部分？`,
      },
      {
        field: "actions",
        missing:
          entry.description.trim().length < 35 ||
          !textHasAny(text, [/负责|完成|搭建|分析|整理|设计|开发|推进|输出|维护|协调/]),
        question: `你在“${entry.title || `经历 ${index + 1}`}”里具体做了哪些动作？可以从你亲手完成的 2-3 件事说起。`,
      },
      {
        field: "tools",
        missing: !textHasAny(text, [
          /Python|pandas|SQL|Excel|Tableau|Power\s?BI|SPSS|Java|Spring|MySQL|Redis|Figma|Axure/i,
        ]),
        question: `这个事例里你用了哪些工具、方法或平台？例如 Excel、Python、SQL、问卷星、Java、数据库，能想到几个说几个。`,
      },
      {
        field: "metrics",
        missing: !/\d/.test(text),
        question: `这个事例大概涉及多少规模或数据？比如样本数、用户数、活动人数、接口数量、周期、提升幅度，估计值也可以。`,
      },
      {
        field: "results",
        missing: !textHasAny(text, [/结果|产出|报告|上线|反馈|提升|降低|完成|获奖|通过|到场|转化|结论/]),
        question: `这个事例最后产出了什么结果？比如报告、展示、上线功能、结论建议、老师或团队反馈。`,
      },
      {
        field: "ability",
        missing: !textHasAny(text, [/分析|沟通|协作|执行|拆解|开发|运营|表达|推进|复盘/]),
        question: `如果投递“${position || "目标岗位"}”，你最希望这段经历体现哪种能力？比如分析、沟通、执行、开发、问题拆解或工具使用。`,
      },
    ];

    return fieldChecks.find(({ field, missing }) => missing && !skipped(`experience.${index}.${field}`));
  }

  function experienceStatus(index: number, entry: CoachExperienceEntry) {
    if (!hasCoachExperienceContent(entry)) return "待补充";
    if (!detailMissingField(entry, index)) return "可生成";
    const skippedAny = Array.from(skippedCollectionKeys).some((key) =>
      key.startsWith(`experience.${index}.`),
    );
    return skippedAny ? "已跳过" : "补充中";
  }

  function nextCollectionQuestion(): CollectionQuestion | null {
    const targetQuestions: Array<{
      key: string;
      field: string;
      missing: boolean;
      content: string;
    }> = [
      {
        key: "target.position",
        field: "target.position",
        missing: !position.trim(),
        content: "你这次主要想投递什么岗位？可以直接写岗位名称，比如“数据分析实习生”。",
      },
      {
        key: "target.company",
        field: "target.company",
        missing: !company.trim(),
        content:
          "你这次主要想投递哪个公司？如果暂时没有具体公司，也可以回复“没有”，我会先按目标岗位来整理。",
      },
      {
        key: "target.jobDescription",
        field: "target.jobDescription",
        missing: !jobDescription.trim(),
        content:
          "这个岗位的 JD 方便粘贴一下吗？如果暂时没有，也可以回复“跳过”，我会先按岗位名称判断需要的能力。",
      },
      {
        key: "profile.contact",
        field: "profile.contact",
        missing: !profileHasContact(),
        content:
          "你的邮箱或手机号希望放在简历上吗？可以发其中一个；如果暂时不想填，也可以回复“跳过”。",
      },
      {
        key: "profile.education",
        field: "profile.education",
        missing: !hasEducationBasics(),
        content:
          "你的教育背景可以补充一下吗？学校、专业、学历、毕业时间里，先发你方便提供的部分就行。",
      },
      {
        key: "profile.skills",
        field: "profile.skills",
        missing: !skillsText.trim(),
        content:
          "你希望简历里体现哪些技能或工具？例如 Python、SQL、Excel、沟通协作、活动策划等。",
      },
      {
        key: "profile.certificatesAwards",
        field: "profile.certificatesAwards",
        missing: filledItems(certificatesText).length === 0 && filledItems(awardsText).length === 0,
        content:
          "你有没有证书、奖项或荣誉可以放进简历？没有也可以回复“没有”，我会跳过这一项。",
      },
    ];
    const targetQuestion = targetQuestions.find((item) => item.missing && !skipped(item.key));
    if (targetQuestion) {
      return {
        id: targetQuestion.key,
        stage: "target_profile_check",
        field: targetQuestion.field,
        content: targetQuestion.content,
      };
    }

    const experiences = usableCoachExperiences();
    if (experiences.length === 0 && !skipped("experience.outline")) {
      return {
        id: "experience.outline",
        stage: "experience_outline_collection",
        field: "experience.outline",
        content:
          "为了匹配这个岗位，你可以先想一想：有没有做过和数据、表格、问卷、报表、用户分析、活动复盘、系统开发或团队协作相关的事情？课程项目、社团活动、比赛、实习都可以。",
      };
    }
    if (experiences.length === 1 && !skipped("experience.more")) {
      return {
        id: "experience.more",
        stage: "experience_outline_collection",
        field: "experience.more",
        content:
          "这段经历我先记下了。除了这个事例，你还有没有其他能体现分析、沟通、执行、工具使用或岗位相关能力的经历？课程作业、社团、比赛、实习、小组项目都可以。",
      };
    }

    for (const { entry, index } of experiences) {
      const missing = detailMissingField(entry, index);
      if (missing) {
        return {
          id: `experience.${index}.${missing.field}`,
          stage: "experience_detail_collection",
          field: `experience.${index}.${missing.field}`,
          content: missing.question,
          experienceIndex: index,
        };
      }
    }

    return null;
  }

  function applyTargetProfileAnswer(question: CollectionQuestion, answer: string) {
    if (question.field === "target.position") {
      setPosition(answer);
      return;
    }
    if (question.field === "target.company") {
      setCompany(answer);
      return;
    }
    if (question.field === "target.jobDescription") {
      setJobDescription(answer);
      return;
    }
    if (question.field === "profile.contact") {
      if (/@/.test(answer)) {
        setProfile((current) => ({ ...current, email: answer }));
      } else {
        setProfile((current) => ({ ...current, phone: answer }));
      }
      return;
    }
    if (question.field === "profile.education") {
      setEducationEntries((current) => {
        const first = current[0] ?? { ...emptyEducationEntry };
        return [
          {
            ...first,
            details: [first.details, answer].filter(Boolean).join("；"),
          },
          ...current.slice(1),
        ];
      });
      return;
    }
    if (question.field === "profile.skills") {
      setSkillsText((current) => uniqueItems([...splitList(current), ...splitList(answer)]).join("、"));
      return;
    }
    if (question.field === "profile.certificatesAwards") {
      const items = splitList(answer);
      const awardItems = items.filter((item) => /奖|荣誉|Scholarship|Award/i.test(item));
      const certificateItems = items.filter((item) => !awardItems.includes(item));
      if (certificateItems.length > 0) {
        setCertificatesText((current) => uniqueItems([...filledItems(current), ...certificateItems]));
      }
      if (awardItems.length > 0) {
        setAwardsText((current) => uniqueItems([...filledItems(current), ...awardItems]));
      }
    }
  }

  function addExperienceFromAnswer(answer: string) {
    const chunks = answer
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const descriptions = chunks.length > 1 ? chunks : [answer];
    const incoming = descriptions.map((description) => ({
      ...emptyCoachExperienceEntry,
      title: inferExperienceTitle(description),
      description,
    }));
    mergeCoachExperienceEntries(incoming);
  }

  function applyExperienceDetailAnswer(question: CollectionQuestion, answer: string) {
    if (question.experienceIndex === undefined) return;
    const [, indexText, field] = question.field.split(".");
    const index = Number(indexText);
    setCoachExperienceEntries((current) =>
      current.map((entry, entryIndex) => {
        if (entryIndex !== index) return entry;
        if (field === "role") {
          return { ...entry, role: answer };
        }
        const label = detailFieldLabels[field] ?? "补充信息";
        return {
          ...entry,
          description: appendExperienceDetail(entry.description, label, answer),
        };
      }),
    );
  }

  function handleCollectionAnswer(answer: string) {
    if (!collectionQuestion) {
      setShouldAdvanceCollection(true);
      return;
    }
    if (isSkipAnswer(answer)) {
      setSkippedCollectionKeys((current) => new Set([...current, collectionQuestion.id]));
      setShouldAdvanceCollection(true);
      return;
    }
    if (collectionQuestion.stage === "target_profile_check") {
      applyTargetProfileAnswer(collectionQuestion, answer);
    }
    if (collectionQuestion.stage === "experience_outline_collection") {
      addExperienceFromAnswer(answer);
    }
    if (collectionQuestion.stage === "experience_detail_collection") {
      applyExperienceDetailAnswer(collectionQuestion, answer);
    }
    setShouldAdvanceCollection(true);
  }

  async function handleStartGuidedCollection() {
    resetRunState();
    if (company.trim() && position.trim()) {
      const result = await runAction("岗位分析中", () =>
        analyzeJob({ company, position, jobDescription }),
      );
      if (result) {
        setJobResult(result);
      }
    }
    addMessage("user", "开始分析资料");
    setShouldAdvanceCollection(true);
  }

  function findSectionReport(question: ProductizedQuestion) {
    return (
      productizedDraft?.sectionQualityReports.find(
        (report) => report.sectionKey === question.sectionKey,
      ) ??
      productizedDraft?.sectionQualityReports.find(
        (report) => report.title === question.sectionTitle,
      ) ??
      null
    );
  }

  function findItemReport(report: SectionQualityReport | null, question: ProductizedQuestion) {
    if (!report) return null;
    return (
      report.itemReports.find(
        (item) => question.itemId && item.itemId === question.itemId,
      ) ??
      report.itemReports.find(
        (item) => !question.itemId && item.itemName === question.itemName,
      ) ??
      null
    );
  }

  function applySectionUpdate(
    result: Awaited<ReturnType<typeof updateResumeSection>>,
    target: ProductizedQuestion,
  ) {
    setProductizedDraft((current) => {
      if (!current) return current;
      const updatedReports = current.sectionQualityReports.some(
        (report) => report.sectionKey === result.updatedSectionReport.sectionKey,
      )
        ? current.sectionQualityReports.map((report) =>
            report.sectionKey === result.updatedSectionReport.sectionKey
              ? result.updatedSectionReport
              : report,
          )
        : [...current.sectionQualityReports, result.updatedSectionReport];
      return {
        ...current,
        resumeDocument: mergeResumeDocumentByTarget(
          current.resumeDocument,
          result.resumeDocument,
          target,
        ),
        sectionQualityReports: updatedReports,
        nextQuestion: result.nextQuestion,
      };
    });
  }

  function mergeProfilePatch(
    patch: Partial<Record<keyof typeof emptyProfile, string | null | undefined>>,
  ) {
    setProfile((current) => {
      const next = { ...current };
      (Object.keys(emptyProfile) as Array<keyof typeof emptyProfile>).forEach((key) => {
        const value = patch[key];
        if (typeof value === "string" && value.trim()) {
          next[key] = value.trim();
        }
      });
      return next;
    });
  }

  function applyGeneratedAnswerPatch(result: {
    targetPatch?: {
      company?: string | null;
      position?: string | null;
      jobDescription?: string | null;
    } | null;
    profilePatch?: Partial<Record<keyof typeof emptyProfile, string | null | undefined>> | null;
    sectionPatch?: {
      educationNotes?: string | null;
      experienceNotes?: string | null;
      certificatesText?: string | null;
      awardsText?: string | null;
      additionalText?: string | null;
    } | null;
    skillsText?: string | null;
  }) {
    if (result.targetPatch?.company?.trim()) {
      setCompany(result.targetPatch.company.trim());
    }
    if (result.targetPatch?.position?.trim()) {
      setPosition(result.targetPatch.position.trim());
    }
    if (result.targetPatch?.jobDescription?.trim()) {
      setJobDescription(result.targetPatch.jobDescription.trim());
    }
    if (result.profilePatch) {
      mergeProfilePatch(result.profilePatch);
      setEducationEntries((current) => {
        const first = current[0] ?? { ...emptyEducationEntry };
        return [
          {
            ...first,
            school: result.profilePatch?.school ?? first.school,
            major: result.profilePatch?.major ?? first.major,
            degree: result.profilePatch?.degree ?? first.degree,
            end: result.profilePatch?.graduation ?? first.end,
          },
          ...current.slice(1),
        ];
      });
    }
    if (result.sectionPatch?.educationNotes?.trim()) {
      setEducationEntries((current) => {
        const first = current[0] ?? { ...emptyEducationEntry };
        return [
          { ...first, details: result.sectionPatch?.educationNotes?.trim() ?? first.details },
          ...current.slice(1),
        ];
      });
    }
    if (result.sectionPatch?.experienceNotes?.trim()) {
      setCoachExperienceEntries(
        splitGeneratedItems(result.sectionPatch.experienceNotes).map((description, index) => ({
          ...emptyCoachExperienceEntry,
          title: `经历 ${index + 1}`,
          description,
        })),
      );
    }
    if (result.sectionPatch?.certificatesText?.trim()) {
      setCertificatesText(splitGeneratedItems(result.sectionPatch.certificatesText));
    }
    if (result.sectionPatch?.awardsText?.trim()) {
      setAwardsText(splitGeneratedItems(result.sectionPatch.awardsText));
    }
    if (result.sectionPatch?.additionalText?.trim()) {
      setAdditionalText(splitGeneratedItems(result.sectionPatch.additionalText));
    }
    if (result.skillsText?.trim()) {
      setSkillsText(result.skillsText.trim());
    }
  }

  function currentDialogueQuestion() {
    if (collectionQuestion) {
      return {
        question: collectionQuestion.content,
        field: collectionQuestion.field,
      };
    }
    if (productizedDraft && currentProductizedQuestion) {
      return {
        question: [
          currentProductizedQuestion.question,
          currentProductizedQuestion.sectionTitle
            ? `追问板块：${currentProductizedQuestion.sectionTitle}`
            : "",
          currentProductizedQuestion.itemName
            ? `追问对象：${currentProductizedQuestion.itemName}`
            : "",
          currentProductizedQuestion.gapLabel
            ? `需要补充：${currentProductizedQuestion.gapLabel}`
            : "",
          `已有经历内容：${coachExperienceContext(coachExperienceEntries)}`,
          `已经补充过的回答：${productizedAnswerHistory
            .map((item) => `${item.question.question}：${item.answer}`)
            .join("；")}`,
          "用户发送回答后，系统会立即用该回答更新简历和质量报告。",
        ]
          .filter(Boolean)
          .join("\n"),
        field: currentProductizedQuestion.field ?? currentProductizedQuestion.sectionKey,
      };
    }
    if (stage === "pre_draft_collection") {
      return {
        question: readinessResult?.nextQuestion?.content ?? "",
        field: readinessResult?.nextQuestion?.field ?? null,
      };
    }
    if (stage === "diagnosis_ready") {
      return {
        question: currentQuestionPlan?.userVisibleQuestion ?? currentBackendQuestion,
        field: currentQuestionPlan?.gapType ?? null,
      };
    }
    return { question: "", field: null };
  }

  async function handleGenerateReferenceAnswer() {
    const { question, field } = currentDialogueQuestion();
    if (!question) {
      addMessage("assistant", "当前没有需要回答的问题。");
      return;
    }

    const result = await runAction("AI 生成参考回答中", () =>
      generateDialogueAnswer({
        taskId: jobResult?.taskId ?? null,
        jobTargetId: jobResult?.jobTargetId ?? null,
        experienceId: experienceResult?.experienceId ?? null,
        company,
        position,
        jobDescription,
        profile,
        education: educationPayload(),
        skills: skillsPayload(),
        currentQuestion: question,
        questionField: field,
      }),
    );
    if (!result) return;

    applyGeneratedAnswerPatch(result);
    setChatInput(result.answer);
    addMessage("assistant", "已生成一段参考回答，你可以检查后发送。");
  }

  async function handleGenerateInitialProfile() {
    const result = await runAction("AI 生成资料中", () =>
      generateDialogueAnswer({
        company,
        position,
        jobDescription,
        profile,
        education: educationPayload(),
        skills: skillsPayload(),
        currentQuestion:
          "请生成一组可用于产品演示的目标公司、目标岗位、岗位JD、个人基础信息和技能关键词。",
        questionField: "initial_setup",
      }),
    );
    if (!result) return;

    applyGeneratedAnswerPatch(result);
    addMessage("assistant", result.answer || "已生成一组可编辑资料。");
  }

  async function handleGenerateProductizedDraft(dialogueAnswers = productizedAnswerHistory) {
    const pendingQuestion = nextCollectionQuestion();
    if (pendingQuestion) {
      setCollectionQuestion(pendingQuestion);
      setStage(pendingQuestion.stage);
      addMessage("assistant", pendingQuestion.content);
      return;
    }
    setCollectionQuestion(null);
    if (!position.trim()) {
      const positionQuestion: CollectionQuestion = {
        id: "target.position.required",
        stage: "target_profile_check",
        field: "target.position",
        content: "生成新版本前至少需要一个目标岗位。你想投递什么岗位？",
      };
      setCollectionQuestion(positionQuestion);
      setStage("target_profile_check");
      addMessage("assistant", positionQuestion.content);
      return;
    }

    const sectionInputs = [
      {
        sectionKey: "basics",
        title: "基础信息",
        content: JSON.stringify(profile),
      },
      {
        sectionKey: "target",
        title: "求职意向",
        content: JSON.stringify({ company, position, jobDescription }),
      },
      {
        sectionKey: "education",
        title: "教育背景",
        content: JSON.stringify(educationPayload()),
      },
      {
        sectionKey: "skills",
        title: "专业技能",
        content: skillsText,
      },
      {
        sectionKey: "experience",
        title: "经历内容",
        content: JSON.stringify(coachExperienceInputs(coachExperienceEntries)),
      },
      {
        sectionKey: "certificates",
        title: "证书",
        content: filledItems(certificatesText).join("；"),
      },
      {
        sectionKey: "awards",
        title: "荣誉奖项",
        content: filledItems(awardsText).join("；"),
      },
      {
        sectionKey: "additional",
        title: "其他信息",
        content: filledItems(additionalText).join("；"),
      },
    ];

    if (dialogueAnswers.length > 0) {
      sectionInputs.push({
        sectionKey: "dialogue_answers",
        title: "本次追问回答",
        content: JSON.stringify(
          dialogueAnswers.map((item) => ({
            questionId: item.questionId,
            answer: item.answer,
            question: item.question.question,
            sectionKey: item.question.sectionKey,
            sectionTitle: item.question.sectionTitle,
            itemId: item.question.itemId,
            itemName: item.question.itemName,
            field: item.question.field,
            gapLabel: item.question.gapLabel,
          })),
        ),
      });
    }

    const result = await runAction("更新简历中", () =>
      generateProductizedDraft({
        company,
        position,
        jobDescription,
        jobAnalysis: jobResult,
        sectionInputs,
      }),
    );
    if (!result) return;

    setProductizedDraft(result);
    const nextBlocks = resumeBlocksFromProductizedDraft(result);
    setResumeBlocks(nextBlocks);
    setGlobalBlockAnalysis(null);
    setPendingSectionUpdate(null);
    setPendingBlockUpdate(null);
    setManualEditQuestion(null);
    setCompletedTargetKeys(new Set());
    setOptionalTargetKeys(new Set());
    setStage("version_generated");
    setIsProfileCollapsed(true);
    setIsExperienceCollapsed(true);
    const nextQuestionCount = collectProductizedQuestions(result).length;
    setQuestionMode(nextQuestionCount > 0 ? "auto" : "idle");
    addMessage(
      "assistant",
      nextQuestionCount > 0
        ? "新版本已生成。接下来可以继续逐个补充关键细节，补完后再生成更新版本。"
        : "新版本已生成。你可以继续补充信息，之后再生成更新版本。",
    );
  }

  async function handleAnalyzeJob(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const result = await runAction("岗位分析中", () =>
      analyzeJob({ company, position, jobDescription }),
    );
    if (!result) return;

    setJobResult(result);
    setExperienceResult(null);
    setReadinessResult(null);
    setResumeResult(null);
    setDiagnosisResult(null);
    setCurrentQuestionIndex(0);
    setAskedPreDraftFields([]);
    setUpdateResult(null);
    setStage("need_experience");
    addMessage("user", `目标：${company} - ${position}`);
    addMessage("assistant", "岗位分析完成。继续补充资料后，可以更新右侧简历。");
  }

  async function handleAnalyzeResumeBlocks() {
    if (!productizedDraft || resumeBlocks.length === 0) {
      addMessage("assistant", "请先更新简历，生成模块化草稿后再做整体分析。");
      return;
    }
    const analysisBlocks = pendingBlockUpdate?.result.pendingBlockDraft
      ? resumeBlocks.map((block) =>
          block.id === pendingBlockUpdate.blockId
            ? {
                ...block,
                ...pendingBlockUpdate.result.pendingBlockDraft,
                qualityReport: pendingBlockUpdate.result.blockQualityReport,
                status: "pending",
              }
            : block,
        )
      : resumeBlocks;
    const result = await runAction("整体分析中", () =>
      analyzeResumeBlocks({
        company,
        position,
        jobDescription,
        jobAnalysis: jobResult ? (jobResult as unknown as Record<string, unknown>) : null,
        resumeBlocks: analysisBlocks,
        lockedBlockIds: analysisBlocks.filter((block) => block.locked).map((block) => block.id),
        questionHistory: productizedAnswerHistory.map((item) => ({
          questionId: item.questionId,
          question: item.question.question,
          answer: item.answer,
          skipped: Boolean(item.skipped),
          blockId: item.question.itemId || item.question.sectionKey,
          field: item.question.field,
        })),
      }),
    );
    if (!result) return;
    setGlobalBlockAnalysis(result.globalQualityReport);
    const summary =
      typeof result.globalQualityReport.summary === "string"
        ? result.globalQualityReport.summary
        : "整体分析完成。";
    addMessage("assistant", summary);
  }

  function toDialogueAnswerRecords(items: ProductizedAnswer[]) {
    return items.map((item) => ({
      questionId: item.questionId,
      question: item.question.question,
      answer: item.answer,
      sectionKey: item.question.sectionKey,
      sectionTitle: item.question.sectionTitle,
      itemId: item.question.itemId,
      itemName: item.question.itemName,
      field: item.question.field,
      gapLabel: item.question.gapLabel,
    }));
  }

  async function handleProductizedQuestionAnswer(answer: string, skipped = false) {
    if (!productizedDraft || !currentProductizedQuestion) return;
    const sectionReport =
      pendingSectionUpdate?.result.updatedSectionReport ??
      findSectionReport(currentProductizedQuestion);
    const normalizedAnswer = skipped
      ? `用户选择强制跳过该问题。不要再围绕同一缺口继续追问；如果该信息不是简历最低可用标准的必需项，请将其降级为可选优化。原问题：${currentProductizedQuestion.question}`
      : answer;
    const nextHistory = [
      ...productizedAnswerHistory.filter(
        (item) =>
          productizedQuestionKey(item.question) !==
          productizedQuestionKey(currentProductizedQuestion),
      ),
      {
        questionId: currentProductizedQuestion.id,
        question: currentProductizedQuestion,
        answer: normalizedAnswer,
        skipped,
      },
    ];
    setProductizedAnswerHistory(nextHistory);

    const targetBlock =
      pendingBlockUpdate?.result.pendingBlockDraft ??
      findBlockForQuestion(resumeBlocks, currentProductizedQuestion);
    if (!targetBlock) {
      addMessage("assistant", "没有找到当前问题对应的简历模块，请先重新更新简历。");
      return;
    }

    const blockResult = await runAction(skipped ? "跳过并更新当前模块中" : "更新当前模块中", () =>
      updateResumeBlock({
        company,
        position,
        jobDescription,
        jobAnalysis: jobResult ? (jobResult as unknown as Record<string, unknown>) : null,
        targetBlock,
        otherBlockSummaries: summarizeOtherBlocks(resumeBlocks, targetBlock.id),
        currentQuestion: {
          questionType: currentProductizedQuestion.questionType ?? "module_question",
          blockId: targetBlock.id,
          field: currentProductizedQuestion.field,
          question: currentProductizedQuestion.question,
          reason: currentProductizedQuestion.reason,
        },
        answer: normalizedAnswer,
        blockAnswerHistory: nextHistory
          .filter((item) => blockIdForQuestion(item.question) === targetBlock.id)
          .map((item) => ({
            questionId: item.questionId,
            question: item.question.question,
            answer: item.answer,
            field: item.question.field,
            skipped: Boolean(item.skipped),
          })),
        skippedQuestions: nextHistory
          .filter((item) => item.skipped && blockIdForQuestion(item.question) === targetBlock.id)
          .map((item) => ({
            questionId: item.questionId,
            question: item.question.question,
            field: item.question.field,
          })),
      }),
    );
    if (!blockResult) return;
    setPendingSectionUpdate(null);
    setPendingBlockUpdate({
      result: blockResult,
      target: currentProductizedQuestion,
      blockId: targetBlock.id,
      skipped,
    });
    addMessage(
      "assistant",
      skipped
        ? "已跳过这个问题，并生成了当前模块的待确认修改稿。"
        : blockResult.nextQuestion
          ? "已记录你的回答。请继续看下一个问题。"
          : blockResult.isCompleteForDraft
            ? "已根据你的回答生成当前模块的待确认修改稿，可以点击“更新到简历”。"
            : "已根据你的回答生成当前模块的待确认修改稿。",
    );
    return;

  }

  async function handleSkipProductizedQuestion() {
    if (!currentProductizedQuestion) return;
    addMessage("user", `跳过：${currentProductizedQuestion.question}`);
    await handleProductizedQuestionAnswer("", true);
  }

  function handleCommitPendingSectionUpdate() {
    if (!pendingSectionUpdate && !pendingBlockUpdate) return;
    if (pendingSectionUpdate) {
      applySectionUpdate(pendingSectionUpdate.result, pendingSectionUpdate.target);
    }
    if (pendingBlockUpdate?.result.pendingBlockDraft) {
      setResumeBlocks((current) =>
        current.map((block) =>
          block.id === pendingBlockUpdate.blockId
            ? {
                ...block,
                ...pendingBlockUpdate.result.pendingBlockDraft,
                qualityReport: pendingBlockUpdate.result.blockQualityReport,
                status: "completed",
                locked: true,
                lastUpdatedAt: new Date().toISOString(),
              }
            : block,
        ),
      );
    }
    const target = pendingBlockUpdate?.target ?? pendingSectionUpdate?.target;
    if (!target) return;
    const targetKey = productizedTargetKey(target);
    setCompletedTargetKeys((current) => new Set([...current, targetKey]));
    setOptionalTargetKeys((current) => {
      const next = new Set(current);
      next.delete(targetKey);
      return next;
    });
    setPendingSectionUpdate(null);
    setPendingBlockUpdate(null);
    setManualEditQuestion(null);
    setQuestionMode("idle");
    addMessage("assistant", "已更新到正式简历。");
  }
  function handleDiscardPendingSectionUpdate() {
    setPendingSectionUpdate(null);
    setPendingBlockUpdate(null);
    setManualEditQuestion(null);
    setQuestionMode("idle");
    addMessage("assistant", "已放弃本次待确认修改，正式简历保持不变。");
  }

  function handleContinueOptimizePendingTarget() {
    const target = pendingBlockUpdate?.target ?? pendingSectionUpdate?.target;
    if (!target) return;
    const targetKey = productizedTargetKey(target);
    setOptionalTargetKeys((current) => new Set([...current, targetKey]));
    setManualEditQuestion(target);
    setQuestionMode("manual");
    setPendingSectionUpdate(null);
    setPendingBlockUpdate(null);
    addMessage("assistant", "已进入继续优化模式，可以继续补充这段内容的加分信息。");
  }

  function handleManualEditQuestion(question: ProductizedQuestion) {
    setPendingSectionUpdate(null);
    setManualEditQuestion(question);
    setQuestionMode("manual");
    addMessage("assistant", "已进入手动优化模式，请回答当前选中板块的追问。");
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = chatInput.trim();
    if (!text) return;
    setChatInput("");
    addMessage("user", text);

    if (collectionQuestion) {
      handleCollectionAnswer(text);
      return;
    }

    if (productizedDraft && currentProductizedQuestion) {
      await handleProductizedQuestionAnswer(text);
      return;
      /*
      const sectionReport = findSectionReport(currentProductizedQuestion);
      if (!sectionReport) {
        await handleGenerateProductizedDraft([
          {
            questionId: currentProductizedQuestion.id,
            question: currentProductizedQuestion,
            answer: text,
          },
        ]);
        return;
      }
      const nextHistory = [
        ...productizedAnswerHistory.filter(
          (item) => item.questionId !== currentProductizedQuestion.id,
        ),
        {
          questionId: currentProductizedQuestion.id,
          question: currentProductizedQuestion,
          answer: text,
        },
      ];
      setProductizedAnswerHistory(nextHistory);
      const itemReport = findItemReport(sectionReport, currentProductizedQuestion);
      const result = await runAction("更新当前板块中", () =>
        updateResumeSection({
          company,
          position,
          jobDescription,
          questionTarget: currentProductizedQuestion,
          resumeDocument: productizedDraft.resumeDocument,
          sectionReport,
          itemReport,
          question: currentProductizedQuestion.question,
          answer: text,
          historyAnswers: nextHistory.map((item) => ({
            questionId: item.questionId,
            question: item.question.question,
            answer: item.answer,
            sectionKey: item.question.sectionKey,
            sectionTitle: item.question.sectionTitle,
            itemId: item.question.itemId,
            itemName: item.question.itemName,
            field: item.question.field,
            gapLabel: item.question.gapLabel,
          })),
        }),
      );
      if (!result) return;
      applySectionUpdate(result);
      addMessage(
        "assistant",
        result.nextQuestion
          ? result.updateSummary
          : result.isCompleteForDraft
            ? `${result.updateSummary} 当前对象已达到可写入简历标准。`
            : result.updateSummary,
      );
      */
      return;
    }

    if (stage === "need_experience") {
      await handleStructureExperience(text);
      return;
    }
    if (stage === "pre_draft_collection") {
      await handlePreDraftAnswer(text);
      return;
    }
    if (stage === "diagnosis_ready") {
      await handleUpdateExperience(text);
      return;
    }
    addMessage("assistant", "收到。请使用下方操作按钮继续推进简历版本。");
  }

  async function handleStructureExperience(rawExperience: string) {
    if (!jobResult) {
      addMessage("assistant", "请先完成岗位分析。");
      return;
    }
    const result = await runAction("整理经历中", () =>
      structureExperience({
        taskId: jobResult.taskId,
        jobTargetId: jobResult.jobTargetId,
        rawExperience,
      }),
    );
    if (!result) return;

    setExperienceResult(result);
    await handleAssessReadiness(result);
  }

  async function handleAssessReadiness(experience: StructuredExperienceResponse) {
    if (!jobResult) return;
    const result = await runAction("评估资料完整度中", () =>
      assessReadiness({
        taskId: jobResult.taskId,
        jobTargetId: jobResult.jobTargetId,
        experienceId: experience.experienceId,
        profile,
        education: educationPayload(),
        skills: skillsPayload(),
      }),
    );
    if (!result) return;

    setReadinessResult(result);
    if (result.canGenerateDraft) {
      setStage("experience_ready");
      addMessage("assistant", "资料已经达到更新专业简历的最低标准。可以更新简历了。");
      return;
    }

    if (
      result.nextQuestion?.field &&
      askedPreDraftFields.includes(result.nextQuestion.field) &&
      result.missingFields.length > 0
    ) {
      const nextField = result.missingFields.find((field) => !askedPreDraftFields.includes(field));
      if (!nextField) {
        setStage("experience_ready");
        setReadinessResult({ ...result, canGenerateDraft: true });
        addMessage("assistant", "这一轮资料采集已经完成。可以先更新简历，后续再继续优化。");
        return;
      }
    }

    setStage("pre_draft_collection");
    addMessage(
      "assistant",
      result.nextQuestion?.content ?? "为了让简历更完整，请再补充一个与这段经历相关的关键信息。",
    );
  }

  function normalizeSkipAnswer(answer: string, field?: string) {
    if (!["没有", "暂无", "不清楚", "跳过", "不适用", "无"].includes(answer.trim())) {
      return answer;
    }
    return `用户确认该项信息暂时没有或不适用：${field ?? "details"}`;
  }

  async function handlePreDraftAnswer(answer: string) {
    if (!jobResult || !experienceResult || !readinessResult?.nextQuestion) {
      addMessage("assistant", "当前没有待回答的简历更新前追问。");
      return;
    }
    const field = readinessResult.nextQuestion.field;
    const result = await runAction("更新经历资料中", () =>
      updateExperience({
        taskId: jobResult.taskId,
        experienceId: experienceResult.experienceId,
        question: readinessResult.nextQuestion?.content ?? "",
        answer: normalizeSkipAnswer(answer, field),
      }),
    );
    if (!result) return;

    setAskedPreDraftFields((current) =>
      current.includes(field) ? current : [...current, field],
    );
    setUpdateResult(result);
    setExperienceResult(result.updatedExperience);
    await handleAssessReadiness(result.updatedExperience);
  }

  async function handleGenerateResume(parent?: GenerateResumeResponse) {
    if (!jobResult || !experienceResult) {
      addMessage("assistant", "请先完成岗位分析和经历整理。");
      return;
    }
    const result = await runAction(parent ? "生成新版本中" : "更新简历中", () =>
      generateResume({
        taskId: jobResult.taskId,
        jobTargetId: jobResult.jobTargetId,
        experienceIds: [experienceResult.experienceId],
        language: "zh",
        parentDraftId: parent?.resumeDraftId ?? null,
        changeSummary: parent
          ? updateResult?.updateSummary ?? "根据用户补充信息生成新版本。"
          : null,
        profile,
        education: educationPayload(),
        skills: skillsPayload(),
      }),
    );
    if (!result) return;

    setResumeResult(result);
    setDiagnosisResult(null);
    setCurrentQuestionIndex(0);
    setUpdateResult(null);
    setStage("draft_ready");
    addMessage(
      "assistant",
      parent
        ? `已生成 v${result.version} 修改稿。你可以继续优化，或确认最终版。`
        : "简历已更新。建议继续补充一次，让内容更扎实。",
    );
  }

  async function handleDiagnoseResume() {
    if (!jobResult || !resumeResult) {
      addMessage("assistant", "请先更新一版简历。");
      return;
    }
    const result = await runAction("诊断中", () =>
      diagnoseResume({
        taskId: jobResult.taskId,
        jobTargetId: jobResult.jobTargetId,
        resumeDraftId: resumeResult.resumeDraftId,
      }),
    );
    if (!result) return;

    setDiagnosisResult(result);
    setCurrentQuestionIndex(0);
    setStage("diagnosis_ready");
    addMessage(
      "assistant",
      `我想先补充一个关键信息：${result.nextQuestion?.content ?? result.nextAction}`,
    );
  }

  async function handleUpdateExperience(answer: string) {
    if (!jobResult || !experienceResult || !currentBackendQuestion) {
      addMessage("assistant", "当前没有待回答的追问。");
      return;
    }
    const result = await runAction("更新经历中", () =>
      updateExperience({
        taskId: jobResult.taskId,
        experienceId: experienceResult.experienceId,
        question: currentBackendQuestion,
        answer,
      }),
    );
    if (!result) return;

    setUpdateResult(result);
    setExperienceResult(result.updatedExperience);

    const nextIndex = currentQuestionIndex + 1;
    const nextQuestion = diagnosisResult?.questionPlans[nextIndex];
    if (nextQuestion) {
      setCurrentQuestionIndex(nextIndex);
      setStage("diagnosis_ready");
      addMessage("assistant", `我再确认一个细节：${nextQuestion.userVisibleQuestion}`);
      return;
    }

    setStage("updated_experience");
    addMessage("assistant", "这一轮追问完成了，现在可以生成新版本。");
  }

  async function handleFinalizeResume() {
    if (!resumeResult) {
      addMessage("assistant", "请先生成一个简历版本。");
      return;
    }
    const result = await runAction("确认最终版中", () =>
      finalizeResume({ resumeDraftId: resumeResult.resumeDraftId }),
    );
    if (!result) return;

    setResumeResult({ ...resumeResult, status: result.status });
    setStage("final");
    addMessage("assistant", "已确认最终版。");
  }

  if (workspaceMode === "library") {
    return (
      <main className="libraryShell">
        <WorkspaceSwitch mode={workspaceMode} onChange={setWorkspaceMode} />
        <ProfileManager />
      </main>
    );
  }

  return (
    <main className="coachShell">
      <WorkspaceSwitch mode={workspaceMode} onChange={setWorkspaceMode} />
      <section className={`chatPane ${showConversation ? "chatMode" : "formMode"}`}>
        <header className="chatHeader">
          <p className="eyebrow">ResumeAI Coach</p>
          <h1>对话式简历教练</h1>
          <p>{assistantHint}</p>
        </header>

        <section className={`setupBox ${isTargetCollapsed ? "collapsedBox" : ""}`}>
          <div className="profileHeader">
            <div className="profileHeaderActions">
              {jobResult && <span>已分析</span>}
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => setIsTargetCollapsed((current) => !current)}
              >
                {isTargetCollapsed ? "展开" : "收起"}
              </button>
            </div>
            <strong>目标岗位</strong>
            {jobResult && <span>岗位已分析</span>}
          </div>
          <div className="profileSourceBar">
            <label>
              已保存职位
              <select
                value={selectedFillPositionId}
                onChange={(event) => setSelectedFillPositionId(event.target.value)}
              >
                <option value="">选择职位</option>
                {availablePositions.map((item) => (
                  <option value={item.id} key={item.id}>
                    {[item.company, item.position, item.city].filter(Boolean).join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <div className="profileSourceActions">
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={applySelectedPositionToCoach}
                disabled={isBusy || !selectedFillPositionId}
              >
                填入目标
              </button>
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={refreshAvailablePositions}
                disabled={isBusy}
              >
                刷新
              </button>
            </div>
            {targetFillStatus && <span>{targetFillStatus}</span>}
          </div>
          <div className="setupGrid">
            <label>
              目标公司
              <input
                value={company}
                onChange={(event) => setCompany(event.target.value)}
                placeholder="例如：腾讯"
                required
              />
            </label>
            <label>
              目标岗位
              <input
                value={position}
                onChange={(event) => setPosition(event.target.value)}
                placeholder="例如：数据分析实习生"
                required
              />
            </label>
          </div>
          <label>
            岗位 JD
            <textarea
              value={jobDescription}
              onChange={(event) => setJobDescription(event.target.value)}
              placeholder="粘贴岗位职责和任职要求"
              rows={4}
            />
          </label>
        </section>

        <ProfileBox
          profile={profile}
          setProfile={setProfile}
          educationEntries={educationEntries}
          setEducationEntries={setEducationEntries}
          skillsText={skillsText}
          setSkillsText={setSkillsText}
          certificatesText={certificatesText}
          setCertificatesText={setCertificatesText}
          awardsText={awardsText}
          setAwardsText={setAwardsText}
          additionalText={additionalText}
          setAdditionalText={setAdditionalText}
          readinessResult={readinessResult}
          availableProfiles={availableProfiles}
          selectedFillProfileId={selectedFillProfileId}
          setSelectedFillProfileId={setSelectedFillProfileId}
          profileFillStatus={profileFillStatus}
          onApplySavedProfile={applySelectedProfileToCoach}
          onRefreshProfiles={refreshAvailableProfiles}
          onGenerateInitialProfile={handleGenerateInitialProfile}
          isBusy={isBusy}
          collapsed={isProfileCollapsed}
          onToggle={() => setIsProfileCollapsed((current) => !current)}
        />

        <section className={`sectionInputBox ${isExperienceCollapsed ? "collapsedBox" : ""}`}>
          <div className="profileHeader">
            <strong>经历内容</strong>
            <div className="profileHeaderActions">
              <span>支持多段经历</span>
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => setIsExperienceCollapsed((current) => !current)}
              >
                {isExperienceCollapsed ? "展开" : "收起"}
              </button>
            </div>
          </div>
          {!isExperienceCollapsed && (
            <CoachExperienceFields
              entries={coachExperienceEntries}
              setEntries={setCoachExperienceEntries}
              statuses={coachExperienceEntries.map((entry, index) =>
                experienceStatus(index, entry),
              )}
              profileExperiences={availableProfileExperiences}
              selectedExperienceId={selectedFillExperienceId}
              setSelectedExperienceId={setSelectedFillExperienceId}
              onApplySelectedExperience={applySelectedExperienceToCoach}
              onApplyAllExperiences={applyAllExperiencesToCoach}
              disabled={isBusy}
            />
          )}
        </section>

        {showConversation && pendingSectionUpdate && (
          <PendingUpdateCardV2
            pending={pendingSectionUpdate}
            onCommit={handleCommitPendingSectionUpdate}
            onDiscard={handleDiscardPendingSectionUpdate}
            onContinueOptimize={handleContinueOptimizePendingTarget}
            disabled={isBusy}
          />
        )}

        {showConversation && !pendingSectionUpdate && pendingBlockUpdate && (
          <PendingBlockUpdateCard
            pending={pendingBlockUpdate}
            onCommit={handleCommitPendingSectionUpdate}
            onDiscard={handleDiscardPendingSectionUpdate}
            onContinueOptimize={handleContinueOptimizePendingTarget}
            disabled={isBusy}
          />
        )}

        {showConversation && (
          <div className="messageList">
            {messages.map((message) => (
              <div className={`message ${message.role}`} key={message.id}>
                {message.content}
              </div>
            ))}
            {error && <div className="message assistant errorMessage">{error}</div>}
          </div>
        )}

        <div className="actionBar">
          <button
            type="button"
            onClick={handleStartGuidedCollection}
            disabled={isBusy}
          >
            {loadingLabel === "岗位分析中" ? "分析中..." : "分析并提问"}
          </button>
          <button
            type="button"
            onClick={() => handleGenerateProductizedDraft()}
            disabled={isBusy}
          >
            生成新版本
          </button>
          <button
            type="button"
            className="secondaryButton globalAnalysisButton"
            onClick={handleAnalyzeResumeBlocks}
            disabled={isBusy || resumeBlocks.length === 0}
            aria-label="整体分析"
          >
            整体分析
          </button>
        </div>

        {showConversation && (
          <form className="chatInput" onSubmit={handleChatSubmit}>
            <textarea
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder={
                collectionQuestion
                  ? "回答当前问题；如果没有，可以输入“没有”或“跳过”"
                  : stage === "need_experience"
                  ? "输入一段真实经历，例如：我做过一个课程数据分析项目..."
                  : stage === "pre_draft_collection" || stage === "diagnosis_ready"
                    ? "回答当前追问；如果没有，可以输入“没有”或“跳过”"
                    : "继续补充你想让简历体现的信息..."
              }
              rows={3}
            />
            <div className="chatInputActions">
              {(Boolean(collectionQuestion) ||
                Boolean(currentProductizedQuestion) ||
                stage === "pre_draft_collection" ||
                stage === "diagnosis_ready") && (
                <>
                  <button
                    type="button"
                    className="secondaryButton"
                    onClick={handleGenerateReferenceAnswer}
                    disabled={isBusy}
                  >
                    AI 生成参考回答
                  </button>
                  <span className="answerHint">请回答当前问题；没有相关信息可以输入“没有”或“跳过”。</span>
                </>
              )}
              {(collectionQuestion || currentProductizedQuestion) && (
                <button
                  type="button"
                  className="secondaryButton"
                  onClick={() => {
                    if (collectionQuestion) {
                      addMessage("user", `跳过：${collectionQuestion.content}`);
                      handleCollectionAnswer("跳过");
                      return;
                    }
                    handleSkipProductizedQuestion();
                  }}
                  disabled={isBusy}
                >
                  跳过当前问题
                </button>
              )}
              <button type="submit" disabled={isBusy}>
                {isBusy ? loadingLabel : "发送"}
              </button>
            </div>
          </form>
        )}
      </section>

      <aside className="resumePane">
        <ResumePreview
          jobResult={jobResult}
          experienceResult={experienceResult}
          readinessResult={readinessResult}
          resumeResult={resumeResult}
          productizedDraft={productizedDraft}
          resumeBlocks={resumeBlocks}
          pendingSectionUpdate={pendingSectionUpdate}
          pendingBlockUpdate={pendingBlockUpdate}
          onManualEditQuestion={handleManualEditQuestion}
          diagnosisResult={diagnosisResult}
          updateResult={updateResult}
        />
      </aside>
    </main>
  );
}

function ProfileBox({
  profile,
  setProfile,
  educationEntries,
  setEducationEntries,
  skillsText,
  setSkillsText,
  certificatesText,
  setCertificatesText,
  awardsText,
  setAwardsText,
  additionalText,
  setAdditionalText,
  readinessResult,
  availableProfiles,
  selectedFillProfileId,
  setSelectedFillProfileId,
  profileFillStatus,
  onApplySavedProfile,
  onRefreshProfiles,
  onGenerateInitialProfile,
  isBusy,
  collapsed,
  onToggle,
}: {
  profile: typeof emptyProfile;
  setProfile: React.Dispatch<React.SetStateAction<typeof emptyProfile>>;
  educationEntries: EducationEntry[];
  setEducationEntries: React.Dispatch<React.SetStateAction<EducationEntry[]>>;
  skillsText: string;
  setSkillsText: React.Dispatch<React.SetStateAction<string>>;
  certificatesText: string[];
  setCertificatesText: React.Dispatch<React.SetStateAction<string[]>>;
  awardsText: string[];
  setAwardsText: React.Dispatch<React.SetStateAction<string[]>>;
  additionalText: string[];
  setAdditionalText: React.Dispatch<React.SetStateAction<string[]>>;
  readinessResult: AssessReadinessResponse | null;
  availableProfiles: UserProfileRecord[];
  selectedFillProfileId: string;
  setSelectedFillProfileId: React.Dispatch<React.SetStateAction<string>>;
  profileFillStatus: string;
  onApplySavedProfile: () => void;
  onRefreshProfiles: () => void;
  onGenerateInitialProfile: () => void;
  isBusy: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`profileBox ${collapsed ? "collapsedBox" : ""}`}>
      <div className="profileHeader">
        <strong>个人基础信息</strong>
        <div className="profileHeaderActions">
          {readinessResult && <span>资料完整度 {readinessResult.completion.overall}%</span>}
          <button
            type="button"
            className="secondaryButton compactButton"
            onClick={onGenerateInitialProfile}
            disabled={isBusy}
          >
            AI 生成并覆盖
          </button>
          <button
            type="button"
            className="secondaryButton compactButton"
            onClick={onToggle}
          >
            {collapsed ? "展开" : "收起"}
          </button>
        </div>
      </div>
      {!collapsed && (
        <>
          <div className="profileSourceBar">
            <label>
              个人资料
              <select
                value={selectedFillProfileId}
                onChange={(event) => setSelectedFillProfileId(event.target.value)}
              >
                <option value="">选择个人资料</option>
                {availableProfiles.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.name || "未命名用户"}{item.school ? ` / ${item.school}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="profileSourceActions">
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={onApplySavedProfile}
                disabled={isBusy || !selectedFillProfileId}
              >
                一键填入
              </button>
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={onRefreshProfiles}
                disabled={isBusy}
              >
                刷新
              </button>
            </div>
            {profileFillStatus && <span>{profileFillStatus}</span>}
          </div>
          <div className="profileGrid">
            {[
              ["name", "姓名"],
              ["phone", "电话"],
              ["email", "邮箱"],
              ["city", "城市"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={profile[key as keyof typeof profile]}
                  onChange={(event) =>
                    setProfile((current) => ({ ...current, [key]: event.target.value }))
                  }
                />
              </label>
            ))}
          </div>
          <EducationFields entries={educationEntries} setEntries={setEducationEntries} />
          <label>
            技能关键词
            <input
              value={skillsText}
              onChange={(event) => setSkillsText(event.target.value)}
              placeholder="例如：Python、pandas、SQL、Excel"
            />
          </label>
          <MultiInput
            label="证书"
            values={certificatesText}
            onChange={setCertificatesText}
            placeholder="例如：CET-6、计算机二级"
          />
          <MultiInput
            label="荣誉奖项"
            values={awardsText}
            onChange={setAwardsText}
            placeholder="例如：奖学金、竞赛奖项"
          />
          <MultiInput
            label="其他信息"
            values={additionalText}
            onChange={setAdditionalText}
            placeholder="例如：作品集、GitHub、个人网站"
          />
          {readinessResult && !readinessResult.canGenerateDraft && (
            <p className="readinessHint">{readinessResult.reason}</p>
          )}
        </>
      )}
    </div>
  );
}

function EducationFields({
  entries,
  setEntries,
}: {
  entries: EducationEntry[];
  setEntries: React.Dispatch<React.SetStateAction<EducationEntry[]>>;
}) {
  function updateEntry(index: number, field: keyof EducationEntry, value: string) {
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
  }

  function addEntry() {
    setEntries((current) => [...current, { ...emptyEducationEntry }]);
  }

  function removeEntry(index: number) {
    setEntries((current) =>
      current.length <= 1 ? [{ ...emptyEducationEntry }] : current.filter((_, i) => i !== index),
    );
  }

  return (
    <div className="nestedSection">
      <div className="multiInputHeader">
        <strong>教育背景</strong>
        <div className="profileHeaderActions">
          <span>支持本科/硕士/博士多段教育</span>
          <button type="button" className="secondaryButton compactButton" onClick={addEntry}>
            添加
          </button>
        </div>
      </div>
      <div className="educationList">
        {entries.map((entry, index) => (
          <div className="educationEntry" key={`education-${index}`}>
            <div className="setupGrid">
              <label>
                学校
                <input
                  value={entry.school}
                  onChange={(event) => updateEntry(index, "school", event.target.value)}
                  placeholder="例如：北京大学"
                />
              </label>
              <label>
                专业
                <input
                  value={entry.major}
                  onChange={(event) => updateEntry(index, "major", event.target.value)}
                  placeholder="例如：信息管理与信息系统"
                />
              </label>
            </div>
            <div className="setupGrid">
              <label>
                学历
                <input
                  value={entry.degree}
                  onChange={(event) => updateEntry(index, "degree", event.target.value)}
                  placeholder="例如：本科 / 硕士 / 博士"
                />
              </label>
              <label>
                入学时间
                <input
                  value={entry.start}
                  onChange={(event) => updateEntry(index, "start", event.target.value)}
                  placeholder="例如：2022.09"
                />
              </label>
            </div>
            <div className="setupGrid">
              <label>
                毕业时间
                <input
                  value={entry.end}
                  onChange={(event) => updateEntry(index, "end", event.target.value)}
                  placeholder="例如：2026.06"
                />
              </label>
              <label>
                补充信息
                <input
                  value={entry.details}
                  onChange={(event) => updateEntry(index, "details", event.target.value)}
                  placeholder="例如：GPA、主修课程、校内荣誉"
                />
              </label>
            </div>
            <div className="entryActions">
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => removeEntry(index)}
              >
                删除该教育经历
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CoachExperienceFields({
  entries,
  setEntries,
  statuses,
  profileExperiences,
  selectedExperienceId,
  setSelectedExperienceId,
  onApplySelectedExperience,
  onApplyAllExperiences,
  disabled,
}: {
  entries: CoachExperienceEntry[];
  setEntries: React.Dispatch<React.SetStateAction<CoachExperienceEntry[]>>;
  statuses: string[];
  profileExperiences: UserExperienceRecord[];
  selectedExperienceId: string;
  setSelectedExperienceId: (id: string) => void;
  onApplySelectedExperience: () => void;
  onApplyAllExperiences: () => void;
  disabled: boolean;
}) {
  function updateEntry(index: number, field: keyof CoachExperienceEntry, value: string) {
    setEntries((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, [field]: value } : entry,
      ),
    );
  }

  function addEntry() {
    setEntries((current) => [...current, { ...emptyCoachExperienceEntry }]);
  }

  function removeEntry(index: number) {
    setEntries((current) =>
      current.length <= 1
        ? [{ ...emptyCoachExperienceEntry }]
        : current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  return (
    <div className="nestedSection">
      <div className="multiInputHeader">
        <strong>经历信息</strong>
        <div className="profileHeaderActions">
          <span>每段经历单独填写，生成时会按结构化内容读取</span>
          <button type="button" className="secondaryButton compactButton" onClick={addEntry}>
            添加
          </button>
        </div>
      </div>
      <div className="profileSourceBar">
        <label>
          个人资料经历
          <select
            value={selectedExperienceId}
            onChange={(event) => setSelectedExperienceId(event.target.value)}
            disabled={profileExperiences.length === 0}
          >
            <option value="">
              {profileExperiences.length > 0 ? "选择已保存经历" : "当前个人资料暂无经历"}
            </option>
            {profileExperiences.map((item) => (
              <option value={item.id} key={item.id}>
                {[item.title, item.organization, item.role].filter(Boolean).join(" / ")}
              </option>
            ))}
          </select>
        </label>
        <div className="profileSourceActions">
          <button
            type="button"
            className="secondaryButton compactButton"
            onClick={onApplySelectedExperience}
            disabled={disabled || !selectedExperienceId}
          >
            填入经历
          </button>
          <button
            type="button"
            className="secondaryButton compactButton"
            onClick={onApplyAllExperiences}
            disabled={disabled || profileExperiences.length === 0}
          >
            全部填入
          </button>
        </div>
        <span>先在“个人资料”保存经历，再回到这里选择使用。</span>
      </div>
      <div className="educationList">
        {entries.map((entry, index) => (
          <div className="educationEntry" key={`coach-experience-${index}`}>
            <div className="formSectionTitle">
              <strong>{entry.title || `经历 ${index + 1}`}</strong>
              <span>{statuses[index] ?? "待补充"}</span>
            </div>
            <div className="setupGrid">
              <label>
                类型
                <select
                  value={entry.type}
                  onChange={(event) =>
                    updateEntry(index, "type", event.target.value as UserExperiencePayload["type"])
                  }
                >
                  {[
                    "project",
                    "internship",
                    "work",
                    "course",
                    "research",
                    "competition",
                    "campus",
                    "volunteer",
                    "other",
                  ].map((type) => (
                    <option value={type} key={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                标题
                <input
                  value={entry.title}
                  onChange={(event) => updateEntry(index, "title", event.target.value)}
                  placeholder="例如：用户增长分析项目"
                />
              </label>
            </div>
            <div className="setupGrid">
              <label>
                组织/公司
                <input
                  value={entry.organization}
                  onChange={(event) => updateEntry(index, "organization", event.target.value)}
                  placeholder="例如：某科技公司"
                />
              </label>
              <label>
                角色
                <input
                  value={entry.role}
                  onChange={(event) => updateEntry(index, "role", event.target.value)}
                  placeholder="例如：数据分析实习生"
                />
              </label>
            </div>
            <div className="setupGrid">
              <label>
                开始
                <input
                  value={entry.startDate}
                  onChange={(event) => updateEntry(index, "startDate", event.target.value)}
                  placeholder="例如：2024.06"
                />
              </label>
              <label>
                结束
                <input
                  value={entry.endDate}
                  onChange={(event) => updateEntry(index, "endDate", event.target.value)}
                  placeholder="例如：2024.09"
                />
              </label>
            </div>
            <LibraryInput
              label="地点"
              value={entry.location}
              onChange={(location) => updateEntry(index, "location", location)}
            />
            <LibraryTextarea
              label="描述"
              value={entry.description}
              rows={3}
              onChange={(description) => updateEntry(index, "description", description)}
            />
            <div className="entryActions">
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => removeEntry(index)}
              >
                删除该经历
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MultiInput({
  label,
  values,
  onChange,
  placeholder,
  multiline = false,
  hideHeader = false,
}: {
  label: string;
  values: string[];
  onChange: React.Dispatch<React.SetStateAction<string[]>>;
  placeholder: string;
  multiline?: boolean;
  hideHeader?: boolean;
}) {
  function updateItem(index: number, value: string) {
    onChange((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function addItem() {
    onChange((current) => [...current, ""]);
  }

  function removeItem(index: number) {
    onChange((current) =>
      current.length <= 1 ? [""] : current.filter((_, itemIndex) => itemIndex !== index),
    );
  }

  return (
    <div className="multiInputGroup">
      {!hideHeader && (
        <div className="multiInputHeader">
          <strong>{label}</strong>
          <button type="button" className="secondaryButton compactButton" onClick={addItem}>
            添加
          </button>
        </div>
      )}
      {hideHeader && (
        <div className="multiInputToolbar">
          <button type="button" className="secondaryButton compactButton" onClick={addItem}>
            添加
          </button>
        </div>
      )}
      {values.map((value, index) => (
        <div className="multiInputRow" key={`${label}-${index}`}>
          {multiline ? (
            <textarea
              value={value}
              onChange={(event) => updateItem(index, event.target.value)}
              placeholder={placeholder}
              rows={3}
            />
          ) : (
            <input
              value={value}
              onChange={(event) => updateItem(index, event.target.value)}
              placeholder={placeholder}
            />
          )}
          <button
            type="button"
            className="secondaryButton compactButton"
            onClick={() => removeItem(index)}
          >
            删除
          </button>
        </div>
      ))}
    </div>
  );
}

function QuestionCard({
  question,
  total,
}: {
  question: ProductizedQuestion;
  total: number;
}) {
  const targetLabel = [question.sectionTitle, question.itemName].filter(Boolean).join(" · ");
  return (
    <section className="questionCard">
      <div className="questionCardHeader">
        <span>当前追问{total > 1 ? ` · 待处理缺口 ${total}` : ""}</span>
        {targetLabel && <strong>{targetLabel}</strong>}
      </div>
      <p className="questionProgress">回答后会生成待确认修改稿；确认后才会写入正式简历。</p>
      {question.gapLabel && (
        <p>
          <b>需要补充：</b>
          {question.gapLabel}
        </p>
      )}
      <p>
        <b>为什么问：</b>
        {question.reason}
      </p>
      <div className="questionText">{question.question}</div>
    </section>
  );
}

function PendingUpdateCard({
  pending,
  onCommit,
  onDiscard,
  disabled,
}: {
  pending: PendingSectionUpdate;
  onCommit: () => void;
  onDiscard: () => void;
  disabled: boolean;
}) {
  const targetLabel = [pending.target.sectionTitle, pending.target.itemName]
    .filter(Boolean)
    .join(" · ");
  return (
    <section className="pendingUpdateCard">
      <div className="questionCardHeader">
        <span>待确认修改</span>
        {targetLabel && <strong>{targetLabel}</strong>}
      </div>
      <p>{pending.result.updateSummary}</p>
      <p className="questionProgress">
        {pending.result.isCompleteForDraft
          ? "当前内容已达到可写入简历标准。确认后才会写入正式简历。"
          : "右侧已展示实时预览，但还没有写入正式简历。可以继续回答追问。"}
      </p>
      <div className="pendingUpdateActions">
        <button type="button" onClick={onCommit} disabled={disabled}>
          更新到简历
        </button>
        <button type="button" className="secondaryButton" onClick={onDiscard} disabled={disabled}>
          放弃本次修改
        </button>
      </div>
    </section>
  );
}

function PendingUpdateCardV2({
  pending,
  onCommit,
  onDiscard,
  onContinueOptimize,
  disabled,
}: {
  pending: PendingSectionUpdate;
  onCommit: () => void;
  onDiscard: () => void;
  onContinueOptimize: () => void;
  disabled: boolean;
}) {
  const targetLabel = [pending.target.sectionTitle, pending.target.itemName]
    .filter(Boolean)
    .join(" · ");
  const usability = getPendingUsability(pending);
  const canCommit = usability !== "not_usable";
  return (
    <section className="pendingUpdateCard">
      <div className="questionCardHeader">
        <span>待确认修改 · {usabilityLabel(usability)}</span>
        {targetLabel && <strong>{targetLabel}</strong>}
      </div>
      <p>{pending.result.updateSummary}</p>
      <p className="questionProgress">
        {usability === "not_usable"
          ? "当前内容还需要继续补充，请回答下一个问题；如果没有相关信息，也可以跳过。"
          : usability === "weak_usable"
            ? "当前内容已生成待确认稿，确认后才会写入正式简历；也可以继续补充这段。"
            : "当前内容已达到可写入简历标准。确认后才会写入正式简历。"}
      </p>
      <div className="pendingUpdateActions">
        <button type="button" onClick={onCommit} disabled={disabled || !canCommit}>
          更新到简历
        </button>
        <button
          type="button"
          className="secondaryButton"
          onClick={onContinueOptimize}
          disabled={disabled}
        >
          继续补充这段
        </button>
        <button type="button" className="secondaryButton" onClick={onDiscard} disabled={disabled}>
          放弃本次修改
        </button>
      </div>
    </section>
  );
}

function PendingBlockUpdateCard({
  pending,
  onCommit,
  onDiscard,
  onContinueOptimize,
  disabled,
}: {
  pending: PendingBlockUpdate;
  onCommit: () => void;
  onDiscard: () => void;
  onContinueOptimize: () => void;
  disabled: boolean;
}) {
  const blockTitle =
    pending.result.pendingBlockDraft?.title ||
    pending.target.itemName ||
    pending.target.sectionTitle ||
    "当前模块";
  const canCommit = pending.result.isCompleteForDraft || Boolean(pending.skipped);
  return (
    <section className="pendingUpdateCard">
      <div className="questionCardHeader">
        <span>待确认修改</span>
        <strong>{blockTitle}</strong>
      </div>
      <p>{pending.result.updateSummary}</p>
      <p className="questionProgress">
        {canCommit
          ? "当前模块已生成待确认稿，确认后只会写入该模块。"
          : "当前模块还需要继续补充，请回答下一个问题。"}
      </p>
      <div className="pendingUpdateActions">
        <button type="button" onClick={onCommit} disabled={disabled || !canCommit}>
          更新到简历
        </button>
        <button
          type="button"
          className="secondaryButton"
          onClick={onContinueOptimize}
          disabled={disabled}
        >
          继续补充这段
        </button>
        <button type="button" className="secondaryButton" onClick={onDiscard} disabled={disabled}>
          放弃本次修改
        </button>
      </div>
    </section>
  );
}

function ResumePreview({
  jobResult,
  experienceResult,
  readinessResult,
  resumeResult,
  productizedDraft,
  resumeBlocks,
  pendingSectionUpdate,
  pendingBlockUpdate,
  onManualEditQuestion,
  diagnosisResult,
  updateResult,
}: {
  jobResult: AnalyzeJobResponse | null;
  experienceResult: StructuredExperienceResponse | null;
  readinessResult: AssessReadinessResponse | null;
  resumeResult: GenerateResumeResponse | null;
  productizedDraft: ProductizedDraftResponse | null;
  resumeBlocks: ResumeBlock[];
  pendingSectionUpdate: PendingSectionUpdate | null;
  pendingBlockUpdate: PendingBlockUpdate | null;
  onManualEditQuestion: (question: ProductizedQuestion) => void;
  diagnosisResult: DiagnoseResumeResponse | null;
  updateResult: UpdateExperienceResponse | null;
}) {
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<SelectedDiagnosis | null>(null);
  const pendingPreviewBlock = pendingBlockUpdate?.result.pendingBlockDraft ?? null;
  const blockPreviewDocument =
    productizedDraft && resumeBlocks.length > 0
      ? resumeDocumentFromBlocks(productizedDraft.resumeDocument, resumeBlocks, pendingPreviewBlock)
      : null;
  const previewDraft =
    productizedDraft && pendingSectionUpdate
      ? {
          ...productizedDraft,
          resumeDocument:
            blockPreviewDocument ??
            mergeResumeDocumentByTarget(
              productizedDraft.resumeDocument,
              pendingSectionUpdate.result.resumeDocument,
              pendingSectionUpdate.target,
            ),
          sectionQualityReports: productizedDraft.sectionQualityReports.some(
            (report) =>
              report.sectionKey === pendingSectionUpdate.result.updatedSectionReport.sectionKey,
          )
            ? productizedDraft.sectionQualityReports.map((report) =>
                report.sectionKey === pendingSectionUpdate.result.updatedSectionReport.sectionKey
                  ? pendingSectionUpdate.result.updatedSectionReport
                  : report,
              )
            : [
                ...productizedDraft.sectionQualityReports,
                pendingSectionUpdate.result.updatedSectionReport,
              ],
        }
      : productizedDraft && blockPreviewDocument
        ? { ...productizedDraft, resumeDocument: blockPreviewDocument }
        : productizedDraft;
  const suggestionItems = [
    ...(readinessResult?.missingFields.map((field) => `需要补充：${field}`) ?? []),
    ...(readinessResult?.nextQuestion ? [readinessResult.nextQuestion.content] : []),
    ...(experienceResult?.missingInfoQuestions ?? []),
    ...(resumeResult?.missingInfoSuggestions ?? []),
    ...(previewDraft?.resumeQualityReport.globalGaps ?? []),
    ...(previewDraft?.sectionQualityReports.flatMap((report) =>
      report.gaps.map((gap) => gap.description),
    ) ?? []),
    ...(diagnosisResult?.gaps.map((gap) => gap.description) ?? []),
    ...(diagnosisResult?.nextQuestion ? [diagnosisResult.nextQuestion.content] : []),
  ].filter(Boolean);

  return (
    <div className="resumeWorkspace">
      <div className="resumeCanvas">
        <header className="previewHeader">
          <div>
            <p className="eyebrow">Live Resume</p>
            <h2>简历预览</h2>
          </div>
          {resumeResult && (
            <span>
              历史版本 v{resumeResult.version}
            </span>
          )}
        </header>

        {!resumeResult && !productizedDraft && (
          <section className="previewSection resumePaper draftPlaceholder">
            <div className="resumeNameBlock">
              <h1>姓名</h1>
              <p>电话 | 邮箱 | 城市</p>
            </div>
            <ResumeSection title="求职意向">
              <p>{jobResult ? "目标岗位 | 目标公司" : "分析资料后生成"}</p>
            </ResumeSection>
            <ResumeSection title="教育背景">
              <p>学校 | 学历 | 专业 | 时间</p>
            </ResumeSection>
            <ResumeSection title="项目/实习经历">
              <p>补充经历大框架并完成关键细节追问后，这里会生成可投递的简历正文。</p>
            </ResumeSection>
            <ResumeSection title="技能">
              <p>技能关键词会根据用户填写内容和经历证据生成。</p>
            </ResumeSection>
          </section>
        )}

        {previewDraft && (
          <ResumeDocumentTemplate
            document={previewDraft.resumeDocument}
            fallbackSummary={previewDraft.resumeQualityReport.nextBestAction}
            qualityReports={previewDraft.sectionQualityReports}
            selectedDiagnosis={selectedDiagnosis}
            onSelectDiagnosis={setSelectedDiagnosis}
            activeEditingTarget={pendingBlockUpdate?.target ?? pendingSectionUpdate?.target ?? null}
          />
        )}

        {!previewDraft && resumeResult && (
          <ResumeDocumentTemplate document={resumeResult.resumeDocument} fallback={resumeResult} />
        )}
      </div>

      {previewDraft && (
        <ResumeHealthPanel
          draft={previewDraft}
          selectedDiagnosis={selectedDiagnosis}
          onSelectDiagnosis={setSelectedDiagnosis}
          onManualEditQuestion={onManualEditQuestion}
        />
      )}

      {jobResult && !resumeResult && (
        <section className="suggestionDock">
          <h3>岗位匹配方向</h3>
          <div className="tagWrap">
            {jobResult.coreAbilities.map((ability) => (
              <span key={ability.name}>
                {ability.name} {ability.importance}/5
              </span>
            ))}
          </div>
        </section>
      )}

      <SuggestionPanel
        readinessResult={readinessResult}
        diagnosisResult={diagnosisResult}
        updateResult={updateResult}
        items={suggestionItems}
      />

      {updateResult && (
        <section className="suggestionDock successPanel">
          <h3>资料已更新</h3>
          <p>{updateResult.updateSummary}</p>
        </section>
      )}
    </div>
  );
}

function WorkspaceSwitch({
  mode,
  onChange,
}: {
  mode: "coach" | "library";
  onChange: (mode: "coach" | "library") => void;
}) {
  return (
    <nav className="workspaceSwitch">
      <button
        type="button"
        className={mode === "coach" ? "active" : "secondaryButton"}
        onClick={() => onChange("coach")}
      >
        简历教练
      </button>
      <button
        type="button"
        className={mode === "library" ? "active" : "secondaryButton"}
        onClick={() => onChange("library")}
      >
        个人资料
      </button>
    </nav>
  );
}

const emptyLibraryProfile: UserProfilePayload = {
  name: "",
  phone: "",
  email: "",
  city: "",
  school: "",
  major: "",
  degree: "",
  graduation: "",
  links: [],
  skills: { technical: [], tools: [], domain: [], language: [] },
  education: [],
  extraInfo: {},
};

const emptyLibraryExperience: UserExperiencePayload = {
  type: "project",
  title: "",
  organization: "",
  role: "",
  startDate: "",
  endDate: "",
  location: "",
  description: "",
  highlights: [],
  metrics: [],
  skills: [],
  rawText: "",
  extraInfo: {},
};

const emptyLibraryPosition: PositionTargetPayload = {
  userProfileId: null,
  company: "",
  position: "",
  industry: "",
  city: "",
  jobDescription: "",
  sourceUrl: "",
  status: "interested",
  keywords: [],
  requirements: [],
  notes: "",
  extraInfo: {},
};

function splitList(value: string) {
  return value
    .split(/[，,、；;\n]+/)
    .map((item) => normalizeInfoItem(item))
    .filter(Boolean);
}

function joinList(value: string[] | undefined) {
  return (value ?? []).join("，");
}

function cleanList(value: string[] | undefined) {
  return (value ?? []).map((item) => normalizeInfoItem(item)).filter(Boolean);
}

function cleanAwardList(value: string[] | undefined) {
  return cleanList(value).filter(
    (item) => !/^(概要|概述|获奖情况|候选人|具备|拥有|具有|并具备|通过全国)/.test(item),
  );
}

function inputRows(value: string[] | undefined) {
  const rows = cleanList(value);
  return rows.length > 0 ? rows : [""];
}

function mergeInputRows(current: string[] | undefined, incoming: string[] | undefined) {
  return inputRows(uniqueItems([...cleanList(current), ...cleanList(incoming)]));
}

function normalizeInfoItem(value: unknown) {
  const headingPattern =
    "个人信息|基础信息|教育背景|专业技能|技术栈|工具平台|业务/领域能力|领域能力|语言能力|软件技能|计算机能力|技能|证书|资格证书|技能证书|荣誉奖项|奖项荣誉|获奖经历|获奖情况|奖项|荣誉|概要|概述|链接|个人链接|其他信息|补充信息|title|name|value|content|label|text|rawText|raw_text";
  let text = `${value ?? ""}`.trim();
  if (!text) return "";
  text = text
    .replace(/^[\s"'`[{(]+|[\s"'`\])}]+$/g, "")
    .replace(/^[-*•·●○◆◇▪▫]\s*/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(new RegExp(`^(?:${headingPattern})\\s*[:：=]\\s*`, "i"), "")
    .replace(/[，,、；;。]+$/g, "")
    .trim();
  if (new RegExp(`^(?:${headingPattern})$`, "i").test(text)) {
    return "";
  }
  return text;
}

function safeJsonObject(value: string) {
  if (!value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function listFromUnknown(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeInfoItem(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    return splitList(value);
  }
  return [];
}

function extraInfoList(
  extraInfo: Record<string, unknown> | null | undefined,
  primaryKey: string,
  importedKey: string,
) {
  return uniqueItems([
    ...listFromUnknown(extraInfo?.[primaryKey]),
    ...listFromUnknown(extraInfo?.[importedKey]),
  ]);
}

function educationPayloadFromEntries(entries: EducationEntry[]): UserProfilePayload["education"] {
  return entries
    .filter((item) =>
      [item.school, item.major, item.degree, item.start, item.end, item.details].some((value) =>
        value.trim(),
      ),
    )
    .map((item) => ({
      school: item.school || null,
      major: item.major || null,
      degree: item.degree || null,
      period: [item.start, item.end].filter(Boolean).join(" - ") || null,
      details: splitList(item.details),
    }));
}

function ProfileManager() {
  const [profiles, setProfiles] = useState<UserProfileRecord[]>([]);
  const [experiences, setExperiences] = useState<UserExperienceRecord[]>([]);
  const [positions, setPositions] = useState<PositionTargetRecord[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [editingExperienceId, setEditingExperienceId] = useState<string | null>(null);
  const [editingPositionId, setEditingPositionId] = useState<string | null>(null);
  const [profileForm, setProfileForm] = useState({
    ...emptyLibraryProfile,
    linksItems: [""],
    technicalItems: [""],
    toolsItems: [""],
    domainItems: [""],
    languageItems: [""],
    certificatesItems: [""],
    awardsItems: [""],
    extraInfoText: "{}",
  });
  const [profileEducationEntries, setProfileEducationEntries] = useState<EducationEntry[]>([
    { ...emptyEducationEntry },
  ]);
  const [experienceForm, setExperienceForm] = useState({
    ...emptyLibraryExperience,
    extraInfoText: "{}",
  });
  const [positionForm, setPositionForm] = useState({
    ...emptyLibraryPosition,
    keywordsText: "",
    requirementsText: "",
    extraInfoText: "{}",
  });
  const [resumeImportSummary, setResumeImportSummary] = useState("");
  const [importedExperienceDrafts, setImportedExperienceDrafts] = useState<UserExperiencePayload[]>(
    [],
  );
  const [libraryNotice, setLibraryNotice] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [libraryLoading, setLibraryLoading] = useState("");

  const selectedProfile = profiles.find((item) => item.id === selectedProfileId) ?? null;

  function setProfileListField(
    field:
      | "linksItems"
      | "technicalItems"
      | "toolsItems"
      | "domainItems"
      | "languageItems"
      | "certificatesItems"
      | "awardsItems",
  ): React.Dispatch<React.SetStateAction<string[]>> {
    return (value) => {
      setProfileForm((current) => ({
        ...current,
        [field]: inputRows(typeof value === "function" ? value(current[field]) : value),
      }));
    };
  }

  useEffect(() => {
    refreshProfiles();
    refreshPositions();
  }, []);

  useEffect(() => {
    if (!selectedProfileId) {
      setExperiences([]);
      return;
    }
    refreshExperiences(selectedProfileId);
  }, [selectedProfileId]);

  async function runLibraryAction(label: string, action: () => Promise<void>) {
    setLibraryLoading(label);
    setLibraryError("");
    setLibraryNotice("");
    try {
      await action();
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : `${label}失败`);
    } finally {
      setLibraryLoading("");
    }
  }

  async function refreshProfiles() {
    const data = await listUserProfiles();
    setProfiles(data);
    setSelectedProfileId((current) => current || data[0]?.id || "");
  }

  async function refreshExperiences(profileId = selectedProfileId) {
    if (!profileId) return;
    setExperiences(await listUserExperiences(profileId));
  }

  async function refreshPositions() {
    setPositions(await listPositionTargets());
  }

  function profilePayload(): UserProfilePayload {
    const education = educationPayloadFromEntries(profileEducationEntries);
    const primary = education[0] ?? null;
    const extraInfo = safeJsonObject(profileForm.extraInfoText);
    const certificates = cleanList(profileForm.certificatesItems);
    const awards = cleanAwardList(profileForm.awardsItems);
    return {
      name: profileForm.name || null,
      phone: profileForm.phone || null,
      email: profileForm.email || null,
      city: profileForm.city || null,
      school: primary?.school ?? null,
      major: primary?.major ?? null,
      degree: primary?.degree ?? null,
      graduation: primary?.period ?? null,
      links: cleanList(profileForm.linksItems),
      skills: {
        technical: cleanList(profileForm.technicalItems),
        tools: cleanList(profileForm.toolsItems),
        domain: cleanList(profileForm.domainItems),
        language: cleanList(profileForm.languageItems),
      },
      education,
      extraInfo: {
        ...extraInfo,
        certificates,
        awards,
        importedCertificates: certificates,
        importedAwards: awards,
      },
    };
  }

  function experiencePayload(): UserExperiencePayload {
    return {
      type: experienceForm.type,
      title: experienceForm.title,
      organization: experienceForm.organization || null,
      role: experienceForm.role || null,
      startDate: experienceForm.startDate || null,
      endDate: experienceForm.endDate || null,
      location: experienceForm.location || null,
      description: experienceForm.description || null,
      highlights: [],
      metrics: [],
      skills: [],
      rawText: experienceForm.rawText || null,
      extraInfo: safeJsonObject(experienceForm.extraInfoText),
    };
  }

  function positionPayload(): PositionTargetPayload {
    return {
      userProfileId: positionForm.userProfileId || null,
      company: positionForm.company || null,
      position: positionForm.position,
      industry: positionForm.industry || null,
      city: positionForm.city || null,
      jobDescription: positionForm.jobDescription || null,
      sourceUrl: positionForm.sourceUrl || null,
      status: positionForm.status,
      keywords: splitList(positionForm.keywordsText),
      requirements: splitList(positionForm.requirementsText),
      notes: positionForm.notes || null,
      extraInfo: safeJsonObject(positionForm.extraInfoText),
    };
  }

  function resetProfileForm() {
    setEditingProfileId(null);
    setProfileForm({
      ...emptyLibraryProfile,
      linksItems: [""],
      technicalItems: [""],
      toolsItems: [""],
      domainItems: [""],
      languageItems: [""],
      certificatesItems: [""],
      awardsItems: [""],
      extraInfoText: "{}",
    });
    setProfileEducationEntries([{ ...emptyEducationEntry }]);
  }

  function resetExperienceForm() {
    setEditingExperienceId(null);
    setExperienceForm({
      ...emptyLibraryExperience,
      extraInfoText: "{}",
    });
  }

  function resetPositionForm() {
    setEditingPositionId(null);
    setPositionForm({
      ...emptyLibraryPosition,
      userProfileId: selectedProfileId || null,
      keywordsText: "",
      requirementsText: "",
      extraInfoText: "{}",
    });
  }

  function editProfile(item: UserProfileRecord) {
    const profileCertificates = extraInfoList(item.extraInfo, "certificates", "importedCertificates");
    const profileAwards = cleanAwardList(extraInfoList(item.extraInfo, "awards", "importedAwards"));
    setEditingProfileId(item.id);
    setSelectedProfileId(item.id);
    setProfileForm({
      ...item,
      linksItems: inputRows(item.links),
      technicalItems: inputRows(item.skills.technical),
      toolsItems: inputRows(item.skills.tools),
      domainItems: inputRows(item.skills.domain),
      languageItems: inputRows(item.skills.language),
      certificatesItems: inputRows(profileCertificates),
      awardsItems: inputRows(profileAwards),
      extraInfoText: JSON.stringify(item.extraInfo ?? {}, null, 2),
    });
    setProfileEducationEntries(educationEntryFromProfile(item));
  }

  function editExperience(item: UserExperienceRecord) {
    setEditingExperienceId(item.id);
    fillExperienceForm(item);
  }

  function fillExperienceForm(item: UserExperiencePayload | UserExperienceRecord) {
    setExperienceForm({
      ...item,
      extraInfoText: JSON.stringify(item.extraInfo ?? {}, null, 2),
    });
  }

  function editPosition(item: PositionTargetRecord) {
    setEditingPositionId(item.id);
    setPositionForm({
      ...item,
      userProfileId: item.userProfileId ?? null,
      keywordsText: joinList(item.keywords),
      requirementsText: joinList(item.requirements),
      extraInfoText: JSON.stringify(item.extraInfo ?? {}, null, 2),
    });
  }

  async function handleResumeFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setLibraryError("");
    setLibraryLoading("解析简历");
    try {
      const imported = await importResumeFile(file);
      const importedProfile = imported.profile;
      const extraInfo = importedProfile.extraInfo ?? {};
      const importedCertificates = extraInfoList(extraInfo, "certificates", "importedCertificates");
      const importedAwards = cleanAwardList(extraInfoList(extraInfo, "awards", "importedAwards"));

      const mergedExtraInfo = {
        ...safeJsonObject(profileForm.extraInfoText),
        uploadedResume: {
          fileName: imported.source.fileName,
          contentType: imported.source.contentType,
          importedAt: new Date().toISOString(),
        },
        certificates: importedCertificates,
        awards: importedAwards,
        importedCertificates,
        importedAwards,
        importedAdditional: extraInfo.importedAdditional ?? [],
      };

      setProfileForm((current) => ({
        ...current,
        name: importedProfile.name || current.name,
        phone: importedProfile.phone || current.phone,
        email: importedProfile.email || current.email,
        city: importedProfile.city || current.city,
        linksItems: mergeInputRows(current.linksItems, importedProfile.links),
        technicalItems: mergeInputRows(current.technicalItems, importedProfile.skills.technical),
        toolsItems: mergeInputRows(current.toolsItems, importedProfile.skills.tools),
        domainItems: mergeInputRows(current.domainItems, importedProfile.skills.domain),
        languageItems: mergeInputRows(current.languageItems, importedProfile.skills.language),
        certificatesItems: mergeInputRows(current.certificatesItems, importedCertificates),
        awardsItems: mergeInputRows(current.awardsItems, importedAwards),
        extraInfoText: JSON.stringify(mergedExtraInfo, null, 2),
      }));
      if (importedProfile.education.length > 0) {
        setProfileEducationEntries(educationEntryFromProfile(importedProfile));
      }
      setImportedExperienceDrafts(imported.experiences);
      if (imported.experiences[0]) {
        fillExperienceForm(imported.experiences[0]);
      }

      const filledCount = [
        importedProfile.name,
        importedProfile.phone,
        importedProfile.email,
        importedProfile.city,
        importedProfile.school,
        importedProfile.major,
        importedProfile.degree,
        importedProfile.graduation,
      ].filter(Boolean).length;
      const warningText = imported.warnings.length > 0 ? `；${imported.warnings.join("；")}` : "";
      setResumeImportSummary(
        `已从 ${file.name} 提炼 ${filledCount} 项基础信息、${imported.experiences.length} 段经历${warningText}`,
      );
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "上传简历失败");
    } finally {
      setLibraryLoading("");
      event.target.value = "";
    }
  }

  async function submitProfile() {
    await runLibraryAction("保存用户信息", async () => {
      const payload = profilePayload();
      const saved = editingProfileId
        ? await updateUserProfile(editingProfileId, payload)
        : await createUserProfile(payload);
      const localSaved = {
        ...saved,
        ...payload,
        id: saved.id,
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      };
      setProfiles((current) => {
        const others = current.filter((item) => item.id !== localSaved.id);
        return [localSaved, ...others];
      });
      editProfile(localSaved);
      setLibraryNotice(`个人资料已保存：${payload.name || "未命名用户"}`);
    });
  }

  async function submitExperience() {
    if (!selectedProfileId) {
      setLibraryError("请先选择或创建一个用户");
      return;
    }
    await runLibraryAction("保存经历", async () => {
      if (editingExperienceId) {
        await updateUserExperience(selectedProfileId, editingExperienceId, experiencePayload());
      } else {
        await createUserExperience(selectedProfileId, experiencePayload());
      }
      resetExperienceForm();
      await refreshExperiences(selectedProfileId);
    });
  }

  async function saveImportedExperienceDrafts() {
    if (!selectedProfileId) {
      setLibraryError("请先保存或选择一个用户，再保存提炼出的经历");
      return;
    }
    if (importedExperienceDrafts.length === 0) return;
    await runLibraryAction("保存提炼经历", async () => {
      for (const item of importedExperienceDrafts) {
        await createUserExperience(selectedProfileId, item);
      }
      setImportedExperienceDrafts([]);
      resetExperienceForm();
      await refreshExperiences(selectedProfileId);
    });
  }

  async function submitPosition() {
    await runLibraryAction("保存职位", async () => {
      if (editingPositionId) {
        await updatePositionTarget(editingPositionId, positionPayload());
      } else {
        await createPositionTarget(positionPayload());
      }
      resetPositionForm();
      await refreshPositions();
    });
  }

  return (
    <div className="libraryGrid">
      <section className="libraryPanel profileLibraryPanel">
        <div className="libraryHeader">
          <div>
            <p className="eyebrow">Profile Library</p>
            <h1>个人资料</h1>
          </div>
          <div className="libraryHeaderActions">
            <button type="button" onClick={submitProfile} disabled={Boolean(libraryLoading)}>
              保存个人资料
            </button>
            <button type="button" className="secondaryButton compactButton" onClick={resetProfileForm}>
              新建
            </button>
          </div>
        </div>
        {(libraryNotice || libraryLoading) && (
          <p className="saveStatus">{libraryLoading || libraryNotice}</p>
        )}
        {libraryError && <p className="errorMessage message">{libraryError}</p>}
        <div className="resumeUploadBox">
          <label>
            上传简历
            <input
              type="file"
              accept=".txt,.md,.json,.pdf,.docx,.png,.jpg,.jpeg,.webp,image/*"
              onChange={handleResumeFileUpload}
            />
          </label>
          {resumeImportSummary && <span>{resumeImportSummary}</span>}
        </div>
        <div className="libraryList">
          {profiles.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`libraryListItem ${selectedProfileId === item.id ? "selected" : ""}`}
              onClick={() => editProfile(item)}
            >
              <strong>{item.name || "未命名用户"}</strong>
              <span>{[item.school, item.major, item.city].filter(Boolean).join(" / ")}</span>
            </button>
          ))}
        </div>
        <div className="libraryForm">
          <div className="formSectionTitle">
            <strong>基础信息</strong>
            <span>
              {editingProfileId ? "正在编辑已保存资料" : "这些信息会一键填入简历生成页"}
            </span>
          </div>
          <div className="setupGrid">
            <LibraryInput label="姓名" value={profileForm.name ?? ""} onChange={(name) => setProfileForm({ ...profileForm, name })} />
            <LibraryInput label="电话" value={profileForm.phone ?? ""} onChange={(phone) => setProfileForm({ ...profileForm, phone })} />
            <LibraryInput label="邮箱" value={profileForm.email ?? ""} onChange={(email) => setProfileForm({ ...profileForm, email })} />
            <LibraryInput label="城市" value={profileForm.city ?? ""} onChange={(city) => setProfileForm({ ...profileForm, city })} />
          </div>
          <MultiInput
            label="简历顶部联系方式 - 个人链接"
            values={profileForm.linksItems}
            onChange={setProfileListField("linksItems")}
            placeholder="例如：GitHub、作品集、个人主页；多个用逗号分隔"
          />
          <div className="formSectionTitle">
            <strong>专业技能</strong>
            <span>对应简历预览中的“技能”板块</span>
          </div>
          <div className="setupGrid">
            <MultiInput
              label="专业技能 - 技术栈"
              values={profileForm.technicalItems}
              onChange={setProfileListField("technicalItems")}
              placeholder="例如：Python"
            />
            <MultiInput
              label="专业技能 - 工具平台"
              values={profileForm.toolsItems}
              onChange={setProfileListField("toolsItems")}
              placeholder="例如：Excel"
            />
            <MultiInput
              label="专业技能 - 业务/领域能力"
              values={profileForm.domainItems}
              onChange={setProfileListField("domainItems")}
              placeholder="例如：数据分析"
            />
            <MultiInput
              label="专业技能 - 语言能力"
              values={profileForm.languageItems}
              onChange={setProfileListField("languageItems")}
              placeholder="例如：英语 CET-6"
            />
          </div>
          <div className="formSectionTitle">
            <strong>证书</strong>
            <span>对应简历预览中的“证书”板块</span>
          </div>
          <MultiInput
            label="证书 - 证书名称"
            values={profileForm.certificatesItems}
            onChange={setProfileListField("certificatesItems")}
            placeholder="例如：CET-6"
          />
          <div className="formSectionTitle">
            <strong>荣誉奖项</strong>
            <span>对应简历预览中的“荣誉奖项”板块</span>
          </div>
          <MultiInput
            label="荣誉奖项 - 奖项名称"
            values={profileForm.awardsItems}
            onChange={setProfileListField("awardsItems")}
            placeholder="例如：国家励志奖学金"
          />
          <EducationFields
            entries={profileEducationEntries}
            setEntries={setProfileEducationEntries}
          />
          <div className="actionBar">
            <button type="button" onClick={submitProfile} disabled={Boolean(libraryLoading)}>
              保存个人资料
            </button>
            {editingProfileId && (
              <button type="button" className="secondaryButton" onClick={resetProfileForm}>
                取消编辑
              </button>
            )}
            {selectedProfileId && (
              <button
                type="button"
                className="dangerButton"
                onClick={() =>
                  runLibraryAction("删除用户", async () => {
                    await deleteUserProfile(selectedProfileId);
                    resetProfileForm();
                    setSelectedProfileId("");
                    await refreshProfiles();
                    await refreshPositions();
                  })
                }
              >
                删除用户
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="libraryPanel">
        <div className="libraryHeader">
          <div>
            <p className="eyebrow">Experience</p>
            <h2>经历信息</h2>
          </div>
          <button type="button" className="secondaryButton compactButton" onClick={resetExperienceForm}>
            新建
          </button>
        </div>
        <div className="libraryForm">
          {importedExperienceDrafts.length > 0 && (
            <div className="importedDraftBox">
              <div className="formSectionTitle">
                <strong>从简历提炼出的经历</strong>
                <span>可检查后保存到当前用户</span>
              </div>
              <div className="recordList">
                {importedExperienceDrafts.map((item, index) => (
                  <div className="recordItem" key={`${item.title}-${index}`}>
                    <div>
                      <strong>{item.title || `经历 ${index + 1}`}</strong>
                      <span>{[item.type, item.organization, item.role].filter(Boolean).join(" / ")}</span>
                    </div>
                    <div className="recordActions">
                      <button
                        type="button"
                        className="secondaryButton compactButton"
                        onClick={() => fillExperienceForm(item)}
                      >
                        填入表单
                      </button>
                      <button
                        type="button"
                        className="secondaryButton compactButton"
                        onClick={() =>
                          setImportedExperienceDrafts((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        忽略
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="actionBar">
                <button
                  type="button"
                  onClick={saveImportedExperienceDrafts}
                  disabled={Boolean(libraryLoading || !selectedProfileId)}
                >
                  保存全部经历
                </button>
              </div>
            </div>
          )}
          <div className="setupGrid">
            <label>
              类型
              <select value={experienceForm.type} onChange={(event) => setExperienceForm({ ...experienceForm, type: event.target.value as UserExperiencePayload["type"] })}>
                {["project", "internship", "work", "course", "research", "competition", "campus", "volunteer", "other"].map((type) => (
                  <option value={type} key={type}>{type}</option>
                ))}
              </select>
            </label>
            <LibraryInput label="标题" value={experienceForm.title} onChange={(title) => setExperienceForm({ ...experienceForm, title })} />
            <LibraryInput label="组织/公司" value={experienceForm.organization ?? ""} onChange={(organization) => setExperienceForm({ ...experienceForm, organization })} />
            <LibraryInput label="角色" value={experienceForm.role ?? ""} onChange={(role) => setExperienceForm({ ...experienceForm, role })} />
            <LibraryInput label="开始" value={experienceForm.startDate ?? ""} onChange={(startDate) => setExperienceForm({ ...experienceForm, startDate })} />
            <LibraryInput label="结束" value={experienceForm.endDate ?? ""} onChange={(endDate) => setExperienceForm({ ...experienceForm, endDate })} />
          </div>
          <LibraryTextarea label="描述" value={experienceForm.description ?? ""} rows={3} onChange={(description) => setExperienceForm({ ...experienceForm, description })} />
          <div className="actionBar">
            <button type="button" onClick={submitExperience} disabled={Boolean(libraryLoading || !selectedProfileId)}>
              {editingExperienceId ? "更新经历" : "添加经历"}
            </button>
            {editingExperienceId && <button type="button" className="secondaryButton" onClick={resetExperienceForm}>取消编辑</button>}
          </div>
        </div>
        <RecordList
          items={experiences}
          title={(item) => item.title}
          subtitle={(item) => [item.type, item.organization, item.role].filter(Boolean).join(" / ")}
          onEdit={editExperience}
          onDelete={(item) =>
            runLibraryAction("删除经历", async () => {
              await deleteUserExperience(selectedProfileId, item.id);
              await refreshExperiences(selectedProfileId);
            })
          }
        />
      </section>

      <section className="libraryPanel">
        <div className="libraryHeader">
          <div>
            <p className="eyebrow">Position</p>
            <h2>职位模块</h2>
          </div>
          <button type="button" className="secondaryButton compactButton" onClick={resetPositionForm}>
            新建
          </button>
        </div>
        <div className="libraryForm">
          <div className="setupGrid">
            <label>
              关联用户
              <select value={positionForm.userProfileId ?? ""} onChange={(event) => setPositionForm({ ...positionForm, userProfileId: event.target.value || null })}>
                <option value="">不关联</option>
                {profiles.map((item) => (
                  <option value={item.id} key={item.id}>{item.name || item.id}</option>
                ))}
              </select>
            </label>
            <LibraryInput label="公司" value={positionForm.company ?? ""} onChange={(company) => setPositionForm({ ...positionForm, company })} />
            <LibraryInput label="职位" value={positionForm.position} onChange={(position) => setPositionForm({ ...positionForm, position })} />
            <LibraryInput label="城市" value={positionForm.city ?? ""} onChange={(city) => setPositionForm({ ...positionForm, city })} />
            <LibraryInput label="行业" value={positionForm.industry ?? ""} onChange={(industry) => setPositionForm({ ...positionForm, industry })} />
            <label>
              状态
              <select value={positionForm.status} onChange={(event) => setPositionForm({ ...positionForm, status: event.target.value as PositionTargetPayload["status"] })}>
                {["interested", "applied", "interviewing", "offered", "rejected", "closed"].map((status) => (
                  <option value={status} key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>
          <LibraryTextarea label="岗位 JD" value={positionForm.jobDescription ?? ""} rows={4} onChange={(jobDescription) => setPositionForm({ ...positionForm, jobDescription })} />
          <LibraryInput label="关键词" value={positionForm.keywordsText} onChange={(keywordsText) => setPositionForm({ ...positionForm, keywordsText })} />
          <LibraryInput label="要求" value={positionForm.requirementsText} onChange={(requirementsText) => setPositionForm({ ...positionForm, requirementsText })} />
          <LibraryTextarea label="备注" value={positionForm.notes ?? ""} rows={2} onChange={(notes) => setPositionForm({ ...positionForm, notes })} />
          <div className="actionBar">
            <button type="button" onClick={submitPosition} disabled={Boolean(libraryLoading || !positionForm.position.trim())}>
              {editingPositionId ? "更新职位" : "添加职位"}
            </button>
            {editingPositionId && <button type="button" className="secondaryButton" onClick={resetPositionForm}>取消编辑</button>}
          </div>
        </div>
        <RecordList
          items={positions}
          title={(item) => item.position}
          subtitle={(item) => [item.company, item.city, item.status].filter(Boolean).join(" / ")}
          onEdit={editPosition}
          onDelete={(item) =>
            runLibraryAction("删除职位", async () => {
              await deletePositionTarget(item.id);
              await refreshPositions();
            })
          }
        />
      </section>

      <section className="libraryPanel structuredPanel">
        <div className="libraryHeader">
          <div>
            <p className="eyebrow">Structured Output</p>
            <h2>结构化输出</h2>
          </div>
          {libraryLoading && <span>{libraryLoading}</span>}
        </div>
        {libraryError && <p className="errorMessage message">{libraryError}</p>}
        <StructuredJson
          value={{
            selectedProfile,
            experiences,
            positions: positions.filter(
              (item) => !selectedProfileId || item.userProfileId === selectedProfileId,
            ),
          }}
        />
      </section>
    </div>
  );
}

function LibraryInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function LibraryTextarea({
  label,
  value,
  rows,
  onChange,
}: {
  label: string;
  value: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function RecordList<T extends { id: string }>({
  items,
  title,
  subtitle,
  onEdit,
  onDelete,
}: {
  items: T[];
  title: (item: T) => string;
  subtitle: (item: T) => string;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
}) {
  if (items.length === 0) return <p className="muted">暂无记录</p>;
  return (
    <div className="recordList">
      {items.map((item) => (
        <div className="recordItem" key={item.id}>
          <div>
            <strong>{title(item)}</strong>
            <span>{subtitle(item)}</span>
          </div>
          <div className="recordActions">
            <button type="button" className="secondaryButton compactButton" onClick={() => onEdit(item)}>
              编辑
            </button>
            <button type="button" className="dangerButton compactButton" onClick={() => onDelete(item)}>
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StructuredJson({ value }: { value: unknown }) {
  return <pre className="structuredJson">{JSON.stringify(value, null, 2)}</pre>;
}

function ResumeDocumentTemplate({
  document,
  fallback,
  fallbackSummary,
  qualityReports = [],
  selectedDiagnosis,
  onSelectDiagnosis,
  activeEditingTarget,
}: {
  document: ResumeDocument | null;
  fallback?: GenerateResumeResponse;
  fallbackSummary?: string;
  qualityReports?: SectionQualityReport[];
  selectedDiagnosis?: SelectedDiagnosis | null;
  onSelectDiagnosis?: (selection: SelectedDiagnosis) => void;
  activeEditingTarget?: ProductizedQuestion | null;
}) {
  if (!document) {
    return (
      <section className="previewSection resumePaper">
        <div className="resumeNameBlock">
          <h1>姓名</h1>
          <p>电话 | 邮箱 | 城市</p>
        </div>
        <h3>个人简介</h3>
        <p>{fallback?.summary ?? fallbackSummary ?? ""}</p>
      </section>
    );
  }

  const contact = [
    document.basics.phone,
    document.basics.email,
    document.basics.location,
    ...document.basics.links,
  ].filter(Boolean);
  const findReport = (sectionKey: string, title?: string) =>
    qualityReports.find((report) => report.sectionKey === sectionKey) ??
    qualityReports.find((report) => report.title === title);
  const isSelectedSection = (sectionKey: string) =>
    selectedDiagnosis?.type === "section" && selectedDiagnosis.sectionKey === sectionKey;
  const isSelectedItem = (sectionKey: string, itemId: string | null, itemName: string | null) =>
    selectedDiagnosis?.type === "item" &&
    selectedDiagnosis.sectionKey === sectionKey &&
    ((itemId && selectedDiagnosis.itemId === itemId) ||
      (!itemId && selectedDiagnosis.itemName === itemName));
  const selectSection = (sectionKey: string) => onSelectDiagnosis?.({ type: "section", sectionKey });
  const selectItem = (sectionKey: string, itemId: string | null, itemName: string | null) =>
    onSelectDiagnosis?.({ type: "item", sectionKey, itemId, itemName });
  const isEditingSection = (sectionKey: string) =>
    activeEditingTarget?.sectionKey === sectionKey && !activeEditingTarget.itemId;
  const isEditingItem = (sectionKey: string, itemId: string | null, itemName: string | null) =>
    activeEditingTarget?.sectionKey === sectionKey &&
    ((itemId && activeEditingTarget.itemId === itemId) ||
      (!itemId && activeEditingTarget.itemName === itemName));

  return (
    <section className="previewSection resumePaper atsResume">
      <div className="resumeNameBlock">
        <h1>{document.basics.name}</h1>
        <p>{contact.join(" | ")}</p>
      </div>

      <ResumeSection
        title="求职意向"
        report={findReport("target", "求职意向")}
        selected={isSelectedSection("target")}
        editing={isEditingSection("target")}
        onSelect={() => selectSection("target")}
      >
        <p>
          {document.target.company} · {document.target.position}
        </p>
      </ResumeSection>

      {document.summary && (
        <ResumeSection
          title="个人简介"
          report={findReport("summary", "个人简介")}
          selected={isSelectedSection("summary")}
          editing={isEditingSection("summary")}
          onSelect={() => selectSection("summary")}
        >
          <p>{document.summary}</p>
        </ResumeSection>
      )}

      {document.education.length > 0 && (
        <ResumeSection
          title="教育背景"
          report={findReport("education", "教育背景")}
          selected={isSelectedSection("education")}
          editing={isEditingSection("education")}
          onSelect={() => selectSection("education")}
        >
          {document.education.map((item) => (
            <div className="resumeEntry" key={`${item.school}-${item.major}`}>
              <div className="entryHeader">
                <strong>{item.school}</strong>
                {item.period && <span>{item.period}</span>}
              </div>
              <p>{[item.degree, item.major].filter(Boolean).join(" · ")}</p>
              <BulletList items={item.details} />
            </div>
          ))}
        </ResumeSection>
      )}

      {document.sections && document.sections.length > 0 && (
        <>
          {document.sections.map((section) => {
            const report = findReport(section.type, section.title);
            return (
            <ResumeSection
              title={section.title}
              key={`${section.type}-${section.title}`}
              report={report}
              selected={isSelectedSection(section.type)}
              editing={isEditingSection(section.type)}
              onSelect={() => selectSection(section.type)}
            >
              {section.items.map((item) => (
                <div
                  className={`resumeEntry clickableEntry ${
                    isSelectedItem(section.type, item.id, item.name) ? "selectedEntry" : ""
                  } ${isEditingItem(section.type, item.id, item.name) ? "editingEntry" : ""}`}
                  key={`${item.name}-${item.role ?? ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectItem(section.type, item.id, item.name);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      event.stopPropagation();
                      selectItem(section.type, item.id, item.name);
                    }
                  }}
                >
                  <div className="entryHeader">
                    <strong>{item.name}</strong>
                    {item.period && <span>{item.period}</span>}
                  </div>
                  {(item.role || item.organization || item.location) && (
                    <p>{[item.role, item.organization, item.location].filter(Boolean).join(" · ")}</p>
                  )}
                  <BulletList items={item.bullets} />
                </div>
              ))}
            </ResumeSection>
            );
          })}
        </>
      )}

      {(!document.sections || document.sections.length === 0) && document.experience.length > 0 && (
        <ResumeSection
          title="实习/工作经历"
          report={findReport("work", "实习/工作经历") ?? findReport("internship", "实习/工作经历")}
          selected={isSelectedSection("work") || isSelectedSection("internship")}
          editing={isEditingSection("work") || isEditingSection("internship")}
          onSelect={() => selectSection(findReport("internship", "实习/工作经历") ? "internship" : "work")}
        >
          {document.experience.map((item) => (
            <div className="resumeEntry" key={`${item.company}-${item.role}`}>
              <div className="entryHeader">
                <strong>{item.company}</strong>
                {item.period && <span>{item.period}</span>}
              </div>
              <p>{item.role}</p>
              <BulletList items={item.bullets} />
            </div>
          ))}
        </ResumeSection>
      )}

      {(!document.sections || document.sections.length === 0) && document.projects.length > 0 && (
        <ResumeSection
          title="项目经历"
          report={findReport("project", "项目经历")}
          selected={isSelectedSection("project")}
          editing={isEditingSection("project")}
          onSelect={() => selectSection("project")}
        >
          {document.projects.map((item) => (
            <div className="resumeEntry" key={item.name}>
              <div className="entryHeader">
                <strong>{item.name}</strong>
                {item.period && <span>{item.period}</span>}
              </div>
              {(item.role || item.organization) && (
                <p>{[item.role, item.organization].filter(Boolean).join(" · ")}</p>
              )}
              <BulletList items={item.bullets} />
            </div>
          ))}
        </ResumeSection>
      )}

      <ResumeSection
        title="技能"
        report={findReport("skills", "技能")}
        selected={isSelectedSection("skills")}
        editing={isEditingSection("skills")}
        onSelect={() => selectSection("skills")}
      >
        <p>
          {[
            ...document.skills.technical,
            ...(document.skills.tools ?? []),
            ...document.skills.domain,
            ...document.skills.language,
          ].join(
            " / ",
          )}
        </p>
      </ResumeSection>

      {document.certificates.length > 0 && (
        <ResumeSection
          title="证书"
          report={findReport("certificates", "证书")}
          selected={isSelectedSection("certificates")}
          editing={isEditingSection("certificates")}
          onSelect={() => selectSection("certificates")}
        >
          <BulletList items={document.certificates} />
        </ResumeSection>
      )}

      {document.awards.length > 0 && (
        <ResumeSection
          title="荣誉奖项"
          report={findReport("awards", "荣誉奖项")}
          selected={isSelectedSection("awards")}
          editing={isEditingSection("awards")}
          onSelect={() => selectSection("awards")}
        >
          <BulletList items={document.awards} />
        </ResumeSection>
      )}
    </section>
  );
}

function SuggestionPanel({
  readinessResult,
  diagnosisResult,
  updateResult,
  items,
}: {
  readinessResult: AssessReadinessResponse | null;
  diagnosisResult: DiagnoseResumeResponse | null;
  updateResult: UpdateExperienceResponse | null;
  items: string[];
}) {
  if (!readinessResult && !diagnosisResult && !updateResult && items.length === 0) return null;

  return (
    <section className="suggestionDock">
      <h3>优化建议</h3>
      {readinessResult && (
        <div className="readinessGrid">
          <span>基础信息 {readinessResult.completion.profile}%</span>
          <span>经历信息 {readinessResult.completion.experience}%</span>
          <span>整体 {readinessResult.completion.overall}%</span>
        </div>
      )}
      {diagnosisResult?.diagnosis && <p>{diagnosisResult.diagnosis}</p>}
      {items.length > 0 && <InfoBlock title="建议补充" items={Array.from(new Set(items))} />}
      {diagnosisResult?.nextAction && <InfoBlock title="下一步" items={[diagnosisResult.nextAction]} />}
    </section>
  );
}

function ResumeHealthPanel({
  draft,
  selectedDiagnosis,
  onSelectDiagnosis,
  onManualEditQuestion,
}: {
  draft: ProductizedDraftResponse;
  selectedDiagnosis: SelectedDiagnosis | null;
  onSelectDiagnosis: (selection: SelectedDiagnosis | null) => void;
  onManualEditQuestion: (question: ProductizedQuestion) => void;
}) {
  const selectedReport =
    selectedDiagnosis?.type === "section"
      ? draft.sectionQualityReports.find(
          (report) => report.sectionKey === selectedDiagnosis.sectionKey,
        )
      : draft.sectionQualityReports.find(
          (report) => report.sectionKey === selectedDiagnosis?.sectionKey,
        );
  const selectedItemReport =
    selectedDiagnosis?.type === "item"
      ? selectedReport?.itemReports.find(
          (item) =>
            (selectedDiagnosis.itemId && item.itemId === selectedDiagnosis.itemId) ||
            (!selectedDiagnosis.itemId && item.itemName === selectedDiagnosis.itemName),
        )
      : null;
  const displayTitle = selectedItemReport?.itemName ?? selectedReport?.title ?? "未选择板块";
  const gaps = selectedItemReport?.gaps ?? selectedReport?.gaps ?? [];
  const openGaps = gaps.filter((gap) => gap.status !== "skipped");
  const skippedGaps = gaps.filter((gap) => gap.status === "skipped");
  function handleManualEdit() {
    if (!selectedReport) return;
    const question = makeProductizedQuestion({
      target: selectedItemReport ? "item" : "section",
      sectionKey: selectedReport.sectionKey,
      sectionTitle: selectedReport.title,
      itemId: selectedItemReport?.itemId ?? null,
      itemName: selectedItemReport?.itemName ?? null,
      field: "manual_edit",
      gapLabel: "用户主动编辑",
      question: selectedItemReport
        ? `你想如何修改「${selectedItemReport.itemName ?? selectedReport.title}」这条内容？可以直接描述要补充、删除或改写的地方。`
        : `你想如何修改「${selectedReport.title}」这个板块？可以直接描述要补充、删除或改写的地方。`,
      reason: "用户主动选择该内容进行编辑。",
    });
    onManualEditQuestion(question);
  }

  return (
    <section className="healthPanel">
      <div className="healthHeader">
        <div>
          <p className="eyebrow">Resume Health</p>
          <h3>简历体检</h3>
        </div>
        <span className={`statusPill ${draft.resumeQualityReport.readiness}`}>
          {readinessLabel(draft.resumeQualityReport.readiness)}
        </span>
      </div>
      <div className="healthMetrics">
        <Metric label="整体" value={draft.resumeQualityReport.overallScore} />
        <Metric label="匹配" value={draft.resumeQualityReport.jobMatchScore} />
        <Metric label="证据" value={draft.resumeQualityReport.evidenceStrength} />
        <Metric label="可读" value={draft.resumeQualityReport.readabilityScore} />
      </div>
      <p>{draft.resumeQualityReport.nextBestAction}</p>
      <div className="selectedDiagnosisCard">
        <div className="diagnosisHeader">
          <strong>{displayTitle}</strong>
          {selectedDiagnosis && (
            <div className="diagnosisActions">
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={handleManualEdit}
              >
                通过对话编辑
              </button>
              <button
                type="button"
                className="secondaryButton compactButton"
                onClick={() => onSelectDiagnosis(null)}
              >
                取消选择
              </button>
            </div>
          )}
        </div>
        {!selectedReport && <p>点击右侧简历中的板块或经历，查看对应质量诊断。</p>}
        {selectedReport && (
          <>
            <div className="healthMetrics compactMetrics">
              <Metric
                label={selectedItemReport ? "单项" : "完成"}
                value={selectedItemReport?.score ?? selectedReport.completeness}
              />
              {!selectedItemReport && <Metric label="相关" value={selectedReport.jobRelevance} />}
              {!selectedItemReport && <Metric label="强度" value={selectedReport.contentStrength} />}
            </div>
            <p>{selectedItemReport ? "当前经历诊断" : selectedReport.summary}</p>
            {openGaps.length > 0 && (
              <InfoBlock
                title="主要缺口"
                items={gaps.map((gap) => `${priorityLabel(gap.priority)}：${gap.description}`)}
              />
            )}
            {skippedGaps.length > 0 && (
              <InfoBlock
                title="已跳过的问题"
                items={skippedGaps.map(
                  (gap) => `${priorityLabel(gap.priority)}：${gap.description}`,
                )}
              />
            )}
            {(selectedItemReport?.nextQuestion || selectedReport.nextQuestion) && (
              <InfoBlock
                title="建议追问"
                items={[selectedItemReport?.nextQuestion ?? selectedReport.nextQuestion ?? ""]}
              />
            )}
          </>
        )}
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <b>{value}</b>
      {label}
    </span>
  );
}

function readinessLabel(value: ProductizedDraftResponse["resumeQualityReport"]["readiness"]) {
  if (value === "strong_ready") return "可投递";
  if (value === "draft_ready") return "可生成";
  return "需补充";
}

function priorityLabel(value: "high" | "medium" | "low") {
  if (value === "high") return "高";
  if (value === "medium") return "中";
  return "低";
}

function statusLabel(value?: SectionQualityReport["status"]) {
  if (value === "strong") return "强";
  if (value === "usable") return "可用";
  if (value === "insufficient") return "偏弱";
  if (value === "missing") return "缺失";
  if (value === "hidden") return "隐藏";
  return "待评估";
}

function ResumeSection({
  title,
  children,
  report,
  selected = false,
  editing = false,
  onSelect,
}: {
  title: string;
  children: React.ReactNode;
  report?: SectionQualityReport;
  selected?: boolean;
  editing?: boolean;
  onSelect?: () => void;
}) {
  return (
    <div
      className={`atsSection ${onSelect ? "clickableSection" : ""} ${selected ? "selectedSection" : ""} ${
        editing ? "editingSection" : ""
      }`}
      role={onSelect ? "button" : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (!onSelect) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <h3>
        <span>{title}</span>
        <span className="sectionStatusGroup">
          {editing && <em className="editingBadge">正在修改</em>}
          {report && <em className={`sectionStatus ${report.status}`}>{statusLabel(report.status)}</em>}
        </span>
      </h3>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function InfoBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="infoBlock">
      <h4>{title}</h4>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted">暂无信息。</p>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
