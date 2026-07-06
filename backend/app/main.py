from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.positions.router import router as positions_router
from app.api.resume.router import router as resume_router
from app.api.users.router import router as users_router
from app.core.config import settings

app = FastAPI(title="ResumeAI API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|192\.168\.\d+\.\d+|198\.18\.\d+\.\d+):5173",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(resume_router, prefix="/api/resume", tags=["resume"])
app.include_router(users_router, prefix="/api/users", tags=["users"])
app.include_router(positions_router, prefix="/api/positions", tags=["positions"])


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
