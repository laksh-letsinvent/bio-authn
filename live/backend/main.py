"""bio-authN live — FastAPI entry point."""
from __future__ import annotations
import sys
from pathlib import Path

# Repo root on sys.path so engine/ imports work when running from live/backend/
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .routes import router

app = FastAPI(title="bio-authN live", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    db.init_db()
    print("[live] SQLite ready.")


app.include_router(router)
