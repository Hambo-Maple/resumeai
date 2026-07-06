import type {
  AnalyzeJobRequest,
  AnalyzeJobResponse,
  AnalyzeResumeBlocksRequest,
  AnalyzeResumeBlocksResponse,
  AssessReadinessRequest,
  AssessReadinessResponse,
  DiagnoseResumeRequest,
  DiagnoseResumeResponse,
  FinalizeResumeRequest,
  FinalizeResumeResponse,
  GenerateDialogueAnswerRequest,
  GenerateDialogueAnswerResponse,
  GenerateResumeRequest,
  GenerateResumeResponse,
  ProductizedDraftRequest,
  ProductizedDraftResponse,
  StructuredExperienceResponse,
  StructureExperienceRequest,
  UpdateExperienceRequest,
  UpdateExperienceResponse,
  UpdateResumeBlockRequest,
  UpdateResumeBlockResponse,
  UpdateResumeSectionRequest,
  UpdateResumeSectionResponse,
  PositionTargetPayload,
  PositionTargetRecord,
  ImportedResumeResponse,
  UserExperiencePayload,
  UserExperienceRecord,
  UserProfilePayload,
  UserProfileRecord,
} from "../types/resume";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export async function analyzeJob(payload: AnalyzeJobRequest): Promise<AnalyzeJobResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/analyze-job`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "岗位分析失败");
  }

  return response.json();
}

export async function structureExperience(
  payload: StructureExperienceRequest,
): Promise<StructuredExperienceResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/structure-experience`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "经历结构化失败");
  }

  return response.json();
}

export async function assessReadiness(
  payload: AssessReadinessRequest,
): Promise<AssessReadinessResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/assess-readiness`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "简历资料完整度评估失败");
  }

  return response.json();
}

export async function generateResume(
  payload: GenerateResumeRequest,
): Promise<GenerateResumeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "简历生成失败");
  }

  return response.json();
}

export async function diagnoseResume(
  payload: DiagnoseResumeRequest,
): Promise<DiagnoseResumeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/diagnose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "简历诊断失败");
  }

  return response.json();
}

export async function updateExperience(
  payload: UpdateExperienceRequest,
): Promise<UpdateExperienceResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/update-experience`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "经历更新失败");
  }

  return response.json();
}

export async function finalizeResume(
  payload: FinalizeResumeRequest,
): Promise<FinalizeResumeResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/finalize`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "确认最终版失败");
  }

  return response.json();
}

export async function generateDialogueAnswer(
  payload: GenerateDialogueAnswerRequest,
): Promise<GenerateDialogueAnswerResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/generate-answer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "AI 生成参考回答失败");
  }

  return response.json();
}

export async function generateProductizedDraft(
  payload: ProductizedDraftRequest,
): Promise<ProductizedDraftResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/productized-draft`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "更新简历失败");
  }

  return response.json();
}

export async function updateResumeSection(
  payload: UpdateResumeSectionRequest,
): Promise<UpdateResumeSectionResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/update-resume-section`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "更新当前简历板块失败");
  }

  return response.json();
}

export async function analyzeResumeBlocks(
  payload: AnalyzeResumeBlocksRequest,
): Promise<AnalyzeResumeBlocksResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/analyze-blocks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "整体分析失败");
  }

  return response.json();
}

export async function updateResumeBlock(
  payload: UpdateResumeBlockRequest,
): Promise<UpdateResumeBlockResponse> {
  const response = await fetch(`${API_BASE_URL}/api/resume/update-block`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "更新当前模块失败");
  }

  return response.json();
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "请求失败");
  }

  return response.json();
}

export function listUserProfiles(): Promise<UserProfileRecord[]> {
  return requestJson<UserProfileRecord[]>("/api/users");
}

export function createUserProfile(payload: UserProfilePayload): Promise<UserProfileRecord> {
  return requestJson<UserProfileRecord>("/api/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUserProfile(
  profileId: string,
  payload: UserProfilePayload,
): Promise<UserProfileRecord> {
  return requestJson<UserProfileRecord>(`/api/users/${profileId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteUserProfile(profileId: string): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(`/api/users/${profileId}`, {
    method: "DELETE",
  });
}

export async function importResumeFile(file: File): Promise<ImportedResumeResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_BASE_URL}/api/users/import-resume`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || "简历解析失败");
  }

  return response.json();
}

export function listUserExperiences(profileId: string): Promise<UserExperienceRecord[]> {
  return requestJson<UserExperienceRecord[]>(`/api/users/${profileId}/experiences`);
}

export function createUserExperience(
  profileId: string,
  payload: UserExperiencePayload,
): Promise<UserExperienceRecord> {
  return requestJson<UserExperienceRecord>(`/api/users/${profileId}/experiences`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUserExperience(
  profileId: string,
  experienceId: string,
  payload: UserExperiencePayload,
): Promise<UserExperienceRecord> {
  return requestJson<UserExperienceRecord>(
    `/api/users/${profileId}/experiences/${experienceId}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteUserExperience(
  profileId: string,
  experienceId: string,
): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(
    `/api/users/${profileId}/experiences/${experienceId}`,
    {
      method: "DELETE",
    },
  );
}

export function listPositionTargets(userProfileId?: string | null): Promise<PositionTargetRecord[]> {
  const query = userProfileId ? `?userProfileId=${encodeURIComponent(userProfileId)}` : "";
  return requestJson<PositionTargetRecord[]>(`/api/positions${query}`);
}

export function createPositionTarget(
  payload: PositionTargetPayload,
): Promise<PositionTargetRecord> {
  return requestJson<PositionTargetRecord>("/api/positions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updatePositionTarget(
  positionId: string,
  payload: PositionTargetPayload,
): Promise<PositionTargetRecord> {
  return requestJson<PositionTargetRecord>(`/api/positions/${positionId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deletePositionTarget(positionId: string): Promise<{ deleted: boolean }> {
  return requestJson<{ deleted: boolean }>(`/api/positions/${positionId}`, {
    method: "DELETE",
  });
}
