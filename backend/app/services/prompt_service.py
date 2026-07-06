from pathlib import Path
from string import Template

from app.core.config import settings


class PromptService:
    def __init__(self, prompt_root: str | None = None) -> None:
        root = prompt_root or settings.prompt_root
        self.prompt_root = (Path(__file__).resolve().parents[3] / root).resolve()

    def load(self, module: str, prompt_name: str, prompt_version: str) -> str:
        path = self.prompt_root / module / f"{prompt_name}.{prompt_version}.md"
        if not path.exists():
            raise FileNotFoundError(f"Prompt template not found: {path}")
        return path.read_text(encoding="utf-8")

    def render(
        self,
        module: str,
        prompt_name: str,
        prompt_version: str,
        variables: dict[str, object],
    ) -> str:
        template = self.load(module, prompt_name, prompt_version)
        safe_variables = {key: self._stringify(value) for key, value in variables.items()}
        return Template(template).safe_substitute(safe_variables)

    @staticmethod
    def _stringify(value: object) -> str:
        if isinstance(value, str):
            return value
        return repr(value)
