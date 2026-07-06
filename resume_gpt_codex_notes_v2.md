# ResumeGPT Codex Notes v2

## Goal
Build an AI resume assistant MVP: structured resume editor, template preview, ATS-friendly PDF export, AI scoring and rewriting.

## Architecture
- `resume.schema.json`: single source of truth.
- `TemplateRenderer`: maps JSON to visual templates.
- `PdfExporter`: prints HTML to A4 PDF via Playwright/Chromium.
- `AiReviewService`: returns score cards and rewrite suggestions.

## Codex Prompt
Create a React + Tailwind resume builder using the provided JSON schema. Implement ATS, Modern Two Column, Big Tech SWE, AI Research, and Product templates. Keep template switching lossless. Add PDF export with A4 pagination. Do not invent resume facts during AI rewriting.
