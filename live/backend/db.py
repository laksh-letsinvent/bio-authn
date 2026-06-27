"""SQLite persistence for the live auth demo."""
from __future__ import annotations
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "live.db"


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id           TEXT PRIMARY KEY,
            name         TEXT NOT NULL,
            enrolled_at  TEXT NOT NULL,
            embedding    TEXT NOT NULL,
            ref_image    BLOB
        );
        CREATE TABLE IF NOT EXISTS auth_events (
            id                TEXT PRIMARY KEY,
            user_id           TEXT,
            event_type        TEXT,
            liveness_passed   INTEGER,
            arcface_score     REAL,
            arcface_verified  INTEGER,
            threshold         REAL,
            in_uncertain_band INTEGER,
            vlm_decision      TEXT,
            vlm_confidence    REAL,
            vlm_reasoning     TEXT,
            vlm_cost_usd      REAL,
            latency_ms        INTEGER,
            created_at        TEXT
        );
        """)


def create_user(name: str, embedding: list[float], ref_image: bytes | None) -> str:
    uid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            "INSERT INTO users (id, name, enrolled_at, embedding, ref_image) VALUES (?,?,?,?,?)",
            (uid, name, now, json.dumps(embedding), ref_image),
        )
    return uid


def list_users() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, name, enrolled_at FROM users ORDER BY enrolled_at DESC"
        ).fetchall()
    return [dict(r) for r in rows]


def get_user(user_id: str) -> dict | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if row is None:
        return None
    d = dict(row)
    d["embedding"] = json.loads(d["embedding"])
    return d


def log_event(
    user_id: str,
    event_type: str,
    liveness_passed: bool,
    arcface_score: float | None = None,
    arcface_verified: bool | None = None,
    threshold: float | None = None,
    in_uncertain_band: bool | None = None,
    vlm_decision: str | None = None,
    vlm_confidence: float | None = None,
    vlm_reasoning: str | None = None,
    vlm_cost_usd: float | None = None,
    latency_ms: int | None = None,
) -> str:
    eid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with _conn() as conn:
        conn.execute(
            """INSERT INTO auth_events (
               id, user_id, event_type, liveness_passed,
               arcface_score, arcface_verified, threshold, in_uncertain_band,
               vlm_decision, vlm_confidence, vlm_reasoning, vlm_cost_usd,
               latency_ms, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                eid, user_id, event_type, int(liveness_passed),
                arcface_score,
                int(arcface_verified) if arcface_verified is not None else None,
                threshold,
                int(in_uncertain_band) if in_uncertain_band is not None else None,
                vlm_decision, vlm_confidence, vlm_reasoning, vlm_cost_usd,
                latency_ms, now,
            ),
        )
    return eid


def list_events(limit: int = 50) -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            """SELECT e.*, u.name AS user_name
               FROM auth_events e
               LEFT JOIN users u ON e.user_id = u.id
               ORDER BY e.created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]
