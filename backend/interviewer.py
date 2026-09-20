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

# Interactions API (recommended over legacy generateContent). See:
# https://ai.google.dev/gemini-api/docs/interactions-overview
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"
INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
INTERACTIONS_API_REVISION = "2026-05-20"
SETTINGS_INTERACTION_ID_KEY = "gemini_last_interaction_id"
SETTINGS_OPENING_QUESTION_KEY = "cached_opening_question"

History = list[dict[str, Any]]

SYSTEM_INSTRUCTION = """You are Maya Chen, a professional interviewer in a live practice mock interview.

Each turn (except the very first), respond in a natural spoken style:
1. Start with a brief, warm acknowledgment of what the candidate just said — one short sentence that shows you listened (no scoring, no coaching, no long feedback).
2. Then ask exactly ONE new interview question (one or two sentences).

On the first turn only (candidate just joined), skip the acknowledgment and ask a strong opening question.

Never repeat a question already asked. Keep the whole turn concise (about 2–4 sentences). No bullet points or section labels."""

CONTEXT_MAX_CHARS = 8000

FIRST_TURN_INPUT = (
    "The candidate has joined the call. Ask your first interview question now."
)
FOLLOWUP_SUFFIX = (
    "\n\nRespond with a brief acknowledgment of their answer, then your next interview question."
)


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
    if turn_index == 0:
        return {"role": "interviewer", "text": question}
    answer = _latest_candidate_answer(history)
    if answer:
        text = f"Thanks — that's helpful context. {question}"
        return {"role": "interviewer", "text": text}
    return {"role": "interviewer", "text": question}


def _system_instruction(session_id: str | None) -> str:
    context = build_interviewer_context(session_id)
    if not context:
        return SYSTEM_INSTRUCTION
    return f"{SYSTEM_INSTRUCTION}\n\n{context}"


def _history_as_recovery_input(history: History) -> str:
    """Rebuild prompt when server-side interaction state was lost (e.g. old session)."""
    lines: list[str] = []
    for entry in history:
        role = entry.get("role")
        text = str(entry.get("text", "")).strip()
        if not text:
            continue
        label = "Interviewer" if role == "interviewer" else "Candidate"
        lines.append(f"{label}: {text}")
    lines.append(
        "Interviewer: (briefly acknowledge their last answer, then ask the next interview question)"
    )
    return "\n".join(lines)


def _latest_candidate_answer(history: History) -> str:
    for entry in reversed(history):
        if entry.get("role") == "candidate":
            text = str(entry.get("text", "")).strip()
            if text:
                return text
    return ""


def _extract_interaction_text(payload: dict[str, Any]) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    steps = payload.get("steps") or []
    for step in reversed(steps):
        if not isinstance(step, dict):
            continue
        content = step.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                text = block.get("text")
                if isinstance(text, str) and text.strip():
                    parts.append(text.strip())
            if parts:
                return "\n".join(parts).strip()

    raise ValueError("Gemini interaction returned no text")


def _create_interaction(body: dict[str, Any], api_key: str) -> dict[str, Any]:
    request = urllib.request.Request(
        INTERACTIONS_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "Api-Revision": INTERACTIONS_API_REVISION,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini Interactions HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Gemini Interactions request failed: {exc.reason}") from exc


def _persist_interaction_id(session_id: str | None, interaction_id: str | None) -> None:
    if not session_id or not interaction_id:
        return
    from repository import set_session_setting

    set_session_setting(session_id, SETTINGS_INTERACTION_ID_KEY, interaction_id)


def _gemini_next_turn(
    history: History, api_key: str, session_id: str | None = None
) -> dict[str, str]:
    from repository import get_session_settings

    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    previous_id: str | None = None
    if session_id:
        raw = get_session_settings(session_id).get(SETTINGS_INTERACTION_ID_KEY)
        if isinstance(raw, str) and raw.strip():
            previous_id = raw.strip()

    body: dict[str, Any] = {
        "model": model,
        "generation_config": {
            "max_output_tokens": 1024,
            "thinking_level": "minimal",
        },
    }

    if not history:
        body["system_instruction"] = _system_instruction(session_id)
        body["input"] = FIRST_TURN_INPUT
    elif previous_id:
        answer = _latest_candidate_answer(history)
        if not answer:
            raise ValueError("Turn history missing candidate answer")
        body["input"] = f"{answer}{FOLLOWUP_SUFFIX}"
        body["previous_interaction_id"] = previous_id
    else:
        # No stored interaction (legacy session / mock fallback earlier) — start a new chain.
        body["system_instruction"] = _system_instruction(session_id)
        body["input"] = _history_as_recovery_input(history)

    payload = _create_interaction(body, api_key)
    interaction_id = payload.get("id")
    if isinstance(interaction_id, str):
        _persist_interaction_id(session_id, interaction_id)

    question = _extract_interaction_text(payload)
    return {"role": "interviewer", "text": question}


def opening_question(session_id: str) -> dict[str, str]:
    """First question for a session — generated once, then cached (avoids duplicate API/TTS)."""
    from repository import get_session_settings, set_session_setting

    settings = get_session_settings(session_id)
    cached = settings.get(SETTINGS_OPENING_QUESTION_KEY)
    if isinstance(cached, str) and cached.strip():
        return {"role": "interviewer", "text": cached.strip()}

    line = next_turn([], session_id=session_id)
    set_session_setting(session_id, SETTINGS_OPENING_QUESTION_KEY, line["text"])
    return line


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
