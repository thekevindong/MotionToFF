"""SQLite session store + local upload blobs (Phase 8)."""

from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DATA_DIR = Path(__file__).resolve().parent / "data"
DB_PATH = DATA_DIR / "motiontoff.db"
UPLOADS_DIR = DATA_DIR / "uploads"

LEGACY_DEFAULT_SESSION_ID = "00000000-0000-0000-0000-000000000001"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                job_title TEXT,
                document_ids_json TEXT NOT NULL DEFAULT '[]',
                settings_json TEXT NOT NULL DEFAULT '{}'
            );
            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                turn_index INTEGER NOT NULL,
                question TEXT NOT NULL,
                answer TEXT NOT NULL,
                scores_json TEXT NOT NULL,
                composure REAL NOT NULL,
                decision_json TEXT NOT NULL,
                next_question_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(session_id, turn_index),
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );
            CREATE TABLE IF NOT EXISTS documents (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                mime TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                extracted_text TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            );
            """
        )


def create_session(job_title: str | None = None) -> str:
    session_id = str(uuid.uuid4())
    now = _utc_now()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO sessions (id, created_at, status, job_title, document_ids_json, settings_json)
            VALUES (?, ?, 'active', ?, '[]', '{}')
            """,
            (session_id, now, job_title),
        )
    return session_id


def get_or_create_legacy_session() -> str:
    with _connect() as conn:
        row = conn.execute(
            "SELECT id FROM sessions WHERE id = ?",
            (LEGACY_DEFAULT_SESSION_ID,),
        ).fetchone()
        if row:
            return LEGACY_DEFAULT_SESSION_ID
        now = _utc_now()
        conn.execute(
            """
            INSERT INTO sessions (id, created_at, status, job_title, document_ids_json, settings_json)
            VALUES (?, ?, 'active', NULL, '[]', '{}')
            """,
            (LEGACY_DEFAULT_SESSION_ID, now),
        )
    return LEGACY_DEFAULT_SESSION_ID


def get_session_row(session_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id = ?", (session_id,)).fetchone()
    if not row:
        return None
    return dict(row)


def get_session_settings(session_id: str) -> dict[str, Any]:
    row = get_session_row(session_id)
    if not row:
        return {}
    raw = row.get("settings_json") or "{}"
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def set_session_setting(session_id: str, key: str, value: Any) -> None:
    settings = get_session_settings(session_id)
    settings[key] = value
    with _connect() as conn:
        conn.execute(
            "UPDATE sessions SET settings_json = ? WHERE id = ?",
            (json.dumps(settings), session_id),
        )


def session_exists(session_id: str) -> bool:
    return get_session_row(session_id) is not None


def _turn_row_to_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "turn": row["turn_index"],
        "question": row["question"],
        "answer": row["answer"],
        "scores": json.loads(row["scores_json"]),
        "composure": row["composure"],
        "decision": json.loads(row["decision_json"]),
        "next_question": json.loads(row["next_question_json"]),
    }


def get_turns(session_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM turns
            WHERE session_id = ?
            ORDER BY turn_index ASC
            """,
            (session_id,),
        ).fetchall()
    return [_turn_row_to_record(r) for r in rows]


def append_turn(session_id: str, record: dict[str, Any]) -> None:
    now = _utc_now()
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO turns (
                session_id, turn_index, question, answer,
                scores_json, composure, decision_json, next_question_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                session_id,
                record["turn"],
                record["question"],
                record["answer"],
                json.dumps(record["scores"]),
                record["composure"],
                json.dumps(record["decision"]),
                json.dumps(record["next_question"]),
                now,
            ),
        )


def clear_session(session_id: str) -> None:
    """Remove turns and documents for a session (debug / reset)."""
    with _connect() as conn:
        doc_rows = conn.execute(
            "SELECT storage_path FROM documents WHERE session_id = ?",
            (session_id,),
        ).fetchall()
        conn.execute("DELETE FROM turns WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM documents WHERE session_id = ?", (session_id,))
        conn.execute(
            "UPDATE sessions SET document_ids_json = '[]', settings_json = '{}' WHERE id = ?",
            (session_id,),
        )
    for row in doc_rows:
        path = Path(row["storage_path"])
        if path.is_file():
            path.unlink(missing_ok=True)


def add_document(
    session_id: str,
    filename: str,
    mime: str,
    content: bytes,
    extracted_text: str,
) -> dict[str, Any]:
    if not session_exists(session_id):
        raise ValueError("session_not_found")

    doc_id = str(uuid.uuid4())
    now = _utc_now()
    dest = UPLOADS_DIR / doc_id
    dest.write_bytes(content)

    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO documents (
                id, session_id, filename, mime, storage_path, extracted_text, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (doc_id, session_id, filename, mime, str(dest), extracted_text, now),
        )
        row = conn.execute(
            "SELECT document_ids_json FROM sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        ids = json.loads(row["document_ids_json"] or "[]")
        ids.append(doc_id)
        conn.execute(
            "UPDATE sessions SET document_ids_json = ? WHERE id = ?",
            (json.dumps(ids), session_id),
        )

    return {
        "id": doc_id,
        "session_id": session_id,
        "filename": filename,
        "mime": mime,
        "extracted_text_length": len(extracted_text),
        "created_at": now,
    }


def list_documents(session_id: str) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT id, session_id, filename, mime, extracted_text, created_at
            FROM documents
            WHERE session_id = ?
            ORDER BY created_at ASC
            """,
            (session_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "session_id": r["session_id"],
            "filename": r["filename"],
            "mime": r["mime"],
            "extracted_text_length": len(r["extracted_text"] or ""),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


def get_documents_for_context(session_id: str) -> list[tuple[str, str]]:
    """Return (filename, extracted_text) pairs for linked documents."""
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT filename, extracted_text
            FROM documents
            WHERE session_id = ?
            ORDER BY created_at ASC
            """,
            (session_id,),
        ).fetchall()
    return [(r["filename"], r["extracted_text"] or "") for r in rows]
