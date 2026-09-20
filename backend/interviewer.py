"""Gemini interviewer seam — dialogue only (mock when GEMINI_API_KEY is unset)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

MOCK_QUESTIONS = [
    "Tell me about yourself and why you're interested in this role.",
    "Describe a time you had to disagree with a teammate. What was the outcome?",
    "Walk me through a technical challenge you solved recently. What trade-offs did you make?",
    "Where do you see the biggest gap in your experience for this position?",
]

DEFAULT_GEMINI_MODEL = "gemini-2.0-flash"
GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

History = list[dict[str, Any]]

SYSTEM_INSTRUCTION = """You are a professional job interviewer conducting a practice mock interview.
Ask exactly ONE clear spoken question per turn — no preamble, scoring, or feedback.
Stay concise (one or two sentences). Do not repeat a question already asked in the transcript.
If the conversation is empty, open with a strong first interview question."""

CONTEXT_MAX_CHARS = 8000


def build_interviewer_context(session_id: str | None) -> str:
    """Load job title + document text for Gemini grounding (truncated)."""
    if not session_id:
        return ""
    from repository import get_documents_for_context, get_session_row

    row = get_session_row(session_id)
    if not row:
        return ""

    parts: list[str] = []
    job_title = (row.get("job_title") or "").strip()
    if job_title:
        parts.append(f"Target role / job title: {job_title}")

    for filename, text in get_documents_for_context(session_id):
        snippet = (text or "").strip()
        if not snippet:
            continue
        parts.append(f"--- {filename} ---\n{snippet}")

    if not parts:
        return ""

    block = "\n\n".join(parts)
    if len(block) > CONTEXT_MAX_CHARS:
        block = block[: CONTEXT_MAX_CHARS - 3].rstrip() + "..."
    return (
        "Use the candidate background below to ask relevant, specific interview questions. "
        "Reference their experience when natural; do not read the documents aloud.\n\n"
        + block
    )


def _mock_next_turn(history: History) -> dict[str, str]:
    turn_index = sum(1 for entry in history if entry.get("role") == "interviewer")
    question = MOCK_QUESTIONS[turn_index % len(MOCK_QUESTIONS)]
    return {"role": "interviewer", "text": question}


def _history_to_contents(history: History) -> list[dict[str, Any]]:
    contents: list[dict[str, Any]] = []
    for entry in history:
        role = entry.get("role")
        text = str(entry.get("text", "")).strip()
        if not text:
            continue
        if role == "interviewer":
            contents.append({"role": "model", "parts": [{"text": text}]})
        elif role == "candidate":
            contents.append({"role": "user", "parts": [{"text": text}]})
    return contents


def _extract_question_text(payload: dict[str, Any]) -> str:
    candidates = payload.get("candidates") or []
    if not candidates:
        raise ValueError("Gemini returned no candidates")
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    text_parts = [str(p.get("text", "")).strip() for p in parts if p.get("text")]
    text = "\n".join(t for t in text_parts if t).strip()
    if not text:
        raise ValueError("Gemini returned empty text")
    return text


def _gemini_next_turn(
    history: History, api_key: str, session_id: str | None = None
) -> dict[str, str]:
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    url = f"{GEMINI_API_BASE}/models/{model}:generateContent?key={api_key}"

    context = build_interviewer_context(session_id)
    system_text = SYSTEM_INSTRUCTION
    if context:
        system_text = f"{SYSTEM_INSTRUCTION}\n\n{context}"

    contents = _history_to_contents(history)
    if not contents:
        contents = [
            {
                "role": "user",
                "parts": [
                    {
                        "text": (
                            "The candidate has joined the call. "
                            "Ask your first interview question now."
                        )
                    }
                ],
            }
        ]

    body = {
        "systemInstruction": {"parts": [{"text": system_text}]},
        "contents": contents,
        "generationConfig": {
            "temperature": 0.75,
            "maxOutputTokens": 256,
        },
    }

    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Gemini request failed: {exc.reason}") from exc

    question = _extract_question_text(payload)
    return {"role": "interviewer", "text": question}


def next_turn(history: History, session_id: str | None = None) -> dict[str, str]:
    """Return the next interviewer line ({ role, text }). Uses Gemini when keyed."""
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return _mock_next_turn(history)

    try:
        return _gemini_next_turn(history, api_key, session_id=session_id)
    except Exception as exc:  # noqa: BLE001 — keep /turn green; log for debugging
        logger.warning("Gemini interviewer failed, using mock: %s", exc)
        return _mock_next_turn(history)
