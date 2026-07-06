import json
import time
from typing import Any
from uuid import UUID

from openai import OpenAI
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.prompt_run import PromptRun


class LLMService:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run_json_prompt(
        self,
        *,
        module: str,
        prompt_name: str,
        prompt_version: str,
        rendered_prompt: str,
        input_payload: dict[str, Any],
        task_id: UUID | None = None,
        user_id: UUID | None = None,
    ) -> dict[str, Any]:
        started_at = time.perf_counter()
        model = settings.llm_model

        try:
            output = self._call_model(rendered_prompt)
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            self._record_run(
                module=module,
                prompt_name=prompt_name,
                prompt_version=prompt_version,
                model=model,
                input_payload=input_payload,
                rendered_prompt=rendered_prompt,
                output=output,
                status="success",
                latency_ms=latency_ms,
                task_id=task_id,
                user_id=user_id,
            )
            return output
        except Exception as exc:
            latency_ms = int((time.perf_counter() - started_at) * 1000)
            self._record_run(
                module=module,
                prompt_name=prompt_name,
                prompt_version=prompt_version,
                model=model,
                input_payload=input_payload,
                rendered_prompt=rendered_prompt,
                output=None,
                status="failed",
                latency_ms=latency_ms,
                task_id=task_id,
                user_id=user_id,
                error_message=str(exc),
            )
            raise

    def _call_model(self, rendered_prompt: str) -> dict[str, Any]:
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY is required")

        client = OpenAI(api_key=settings.openai_api_key, base_url=settings.openai_base_url)
        response = client.chat.completions.create(
            model=settings.llm_model,
            messages=[{"role": "user", "content": rendered_prompt}],
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content or "{}"
        return json.loads(content)

    def _record_run(
        self,
        *,
        module: str,
        prompt_name: str,
        prompt_version: str,
        model: str,
        input_payload: dict[str, Any],
        rendered_prompt: str,
        output: dict[str, Any] | None,
        status: str,
        latency_ms: int,
        task_id: UUID | None,
        user_id: UUID | None,
        error_message: str | None = None,
    ) -> None:
        prompt_run = PromptRun(
            user_id=user_id,
            task_id=task_id,
            module=module,
            prompt_name=prompt_name,
            prompt_version=prompt_version,
            model=model,
            input=input_payload,
            rendered_prompt=rendered_prompt,
            output=output,
            status=status,
            error_message=error_message,
            latency_ms=latency_ms,
        )
        self.db.add(prompt_run)
        self.db.flush()
