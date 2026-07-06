import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

from app.db.session import SessionLocal  # noqa: E402
from app.schemas.resume import GenerateResumeRequest, StructureExperienceRequest  # noqa: E402
from app.schemas.resume import AnalyzeJobRequest, AssessReadinessRequest, UpdateExperienceRequest  # noqa: E402
from app.services.experience_service import ExperienceService  # noqa: E402
from app.services.job_service import JobService  # noqa: E402
from app.services.optimization_service import OptimizationService  # noqa: E402
from app.services.readiness_service import ReadinessService  # noqa: E402
from app.services.resume_service import ResumeService  # noqa: E402


def main() -> int:
    cases_path = ROOT / "tests" / "fixtures" / "resume_cases.json"
    cases = json.loads(cases_path.read_text(encoding="utf-8"))
    failures: list[str] = []

    for case in cases:
        db = SessionLocal()
        try:
            job = JobService(db).analyze_job(
                AnalyzeJobRequest(
                    company=case["company"],
                    position=case["position"],
                    jobDescription=case.get("jobDescription"),
                )
            )
            exp = ExperienceService(db).structure_experience(
                StructureExperienceRequest(
                    taskId=job.task_id,
                    jobTargetId=job.job_target_id,
                    rawExperience=case["rawExperience"],
                )
            )
            readiness = ReadinessService(db).assess_resume_readiness(
                AssessReadinessRequest(
                    taskId=job.task_id,
                    jobTargetId=job.job_target_id,
                    experienceId=exp.experience_id,
                )
            )
            if not readiness.can_generate_draft and readiness.next_question:
                OptimizationService(db).update_experience(
                    UpdateExperienceRequest(
                        taskId=job.task_id,
                        experienceId=exp.experience_id,
                        question=readiness.next_question.content,
                        answer=case.get("answers", [""])[0],
                    )
                )
            draft = ResumeService(db).generate_resume(
                GenerateResumeRequest(
                    taskId=job.task_id,
                    jobTargetId=job.job_target_id,
                    experienceIds=[exp.experience_id],
                )
            )
            optimization_service = OptimizationService(db)
            for index, answer in enumerate(case.get("answers", []), start=1):
                optimization_service.update_experience(
                    UpdateExperienceRequest(
                        taskId=job.task_id,
                        experienceId=exp.experience_id,
                        question=f"测试追问 {index}",
                        answer=answer,
                    )
                )
            if case.get("answers"):
                draft = ResumeService(db).generate_resume(
                    GenerateResumeRequest(
                        taskId=job.task_id,
                        jobTargetId=job.job_target_id,
                        experienceIds=[exp.experience_id],
                        parentDraftId=draft.resume_draft_id,
                        changeSummary="根据测试用例中的追问回答补充经历后重新生成。",
                    )
                )
            text = json.dumps(draft.resume_document.model_dump(), ensure_ascii=False)
            missing = [item for item in case.get("mustInclude", []) if item not in text]
            forbidden = [item for item in case.get("mustNotInclude", []) if item in text]
            if missing or forbidden:
                failures.append(
                    f"{case['caseId']} failed: missing={missing}, forbidden={forbidden}"
                )
            else:
                print(f"{case['caseId']} passed")
        finally:
            db.close()

    if failures:
        print("\n".join(failures))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
