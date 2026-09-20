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

MOCK_SALARY_QUESTIONS = [
    "To start, what salary range are you targeting for this role, and what led you to that number?",
    "How does that expectation compare to your current or most recent compensation?",
    "If we cannot meet the base you asked for, what trade-offs would you consider — bonus, equity, title, or start date?",
    "Walk me through the specific outcomes or skills that justify the number you are asking for.",
]

CHARACTER_PERSONAS: dict[str, str] = {
    "recruiter": """You are the University Recruiter in a live salary negotiation practice session.
Tone: warm and encouraging. Acknowledge preparation, ask clarifying questions gently, and guide the candidate toward a realistic offer without being adversarial.""",
    "manager": """You are the Senior Manager (hiring manager) in a live salary negotiation practice session.
Tone: formal and structure-focused. Expect clear reasoning, benchmarks, and trade-offs. Keep pace professional and slightly reserved.""",
    "hr": """You are the HR Lead (compensation & policy) in a live salary negotiation practice session.
Tone: strict and budget-conscious. Push back firmly on numbers, cite policy and bands, and stress business constraints.""",
}

SCENARIO_SALARY_ADDENDUM = """Scenario: salary negotiation for a job offer (not a generic behavioral interview).
Focus on compensation expectations, justification, benefits, timing, and counters. After a brief acknowledgment, ask exactly ONE new negotiation question per turn."""

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
SALARY_FIRST_TURN_INPUT = (
    "The candidate has joined the salary negotiation. Open with your first compensation-focused question."
)
FOLLOWUP_SUFFIX = (
    "\n\nRespond with a brief acknowledgment of their answer, then your next interview question."
)
SALARY_FOLLOWUP_SUFFIX = (
    "\n\nRespond with a brief acknowledgment of their answer, then your next salary negotiation question."
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


def _session_persona_settings(session_id: str | None) -> dict[str, Any]:
    if not session_id:
        return {}
    from repository import get_session_settings

    settings = get_session_settings(session_id)
    return settings if isinstance(settings, dict) else {}


def _mock_question_bank(session_id: str | None) -> list[str]:
    settings = _session_persona_settings(session_id)
    if settings.get("scenario_id") == "salary":
        return MOCK_SALARY_QUESTIONS
    return MOCK_QUESTIONS


def _mock_next_turn(history: History, session_id: str | None = None) -> dict[str, str]:
    turn_index = sum(1 for entry in history if entry.get("role") == "interviewer")
    bank = _mock_question_bank(session_id)
    question = bank[turn_index % len(bank)]
    if turn_index == 0:
        return {"role": "interviewer", "text": question}
    answer = _latest_candidate_answer(history)
    if answer:
        text = f"Thanks — that's helpful context. {question}"
        return {"role": "interviewer", "text": text}
    return {"role": "interviewer", "text": question}


def _persona_instruction(session_id: str | None) -> str:
    settings = _session_persona_settings(session_id)
    character_id = settings.get("character_id")
    scenario_id = settings.get("scenario_id")

    if isinstance(character_id, str) and character_id in CHARACTER_PERSONAS:
        base = CHARACTER_PERSONAS[character_id]
        base = (
            f"{base}\n\nEach turn (except the very first), respond in a natural spoken style:\n"
            "1. Start with a brief, warm acknowledgment of what the candidate just said — one short sentence.\n"
            "2. Then ask exactly ONE new question (one or two sentences).\n\n"
            "On the first turn only, skip the acknowledgment and ask a strong opening question.\n"
            "Never repeat a question already asked. Keep the whole turn concise (about 2–4 sentences). "
            "No bullet points or section labels."
        )
    else:
        base = SYSTEM_INSTRUCTION

    if scenario_id == "salary":
        base = f"{base}\n\n{SCENARIO_SALARY_ADDENDUM}"

    return base


def _system_instruction(session_id: str | None) -> str:
    base = _persona_instruction(session_id)
    context = build_interviewer_context(session_id)
    if not context:
        return base
    return f"{base}\n\n{context}"


def _first_turn_input(session_id: str | None) -> str:
    settings = _session_persona_settings(session_id)
    if settings.get("scenario_id") == "salary":
        return SALARY_FIRST_TURN_INPUT
    return FIRST_TURN_INPUT


def _followup_suffix(session_id: str | None) -> str:
    settings = _session_persona_settings(session_id)
    if settings.get("scenario_id") == "salary":
        return SALARY_FOLLOWUP_SUFFIX
    return FOLLOWUP_SUFFIX


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
        body["input"] = _first_turn_input(session_id)
    elif previous_id:
        answer = _latest_candidate_answer(history)
        if not answer:
            raise ValueError("Turn history missing candidate answer")
        body["input"] = f"{answer}{_followup_suffix(session_id)}"
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
        return _mock_next_turn(history, session_id=session_id)

    try:
        return _gemini_next_turn(history, api_key, session_id=session_id)
    except Exception as exc:  # noqa: BLE001 — keep /turn green; log for debugging
        logger.warning("Gemini interviewer failed, using mock: %s", exc)
        return _mock_next_turn(history, session_id=session_id)


MOCK_INTERJECTIONS: dict[str, list[str]] = {
    "high_stress": [
        "Let's take a breath — you've got this. Walk me through your thinking one step at a time.",
        "I can tell this is intense. Slow down for a moment and anchor on the strongest point you want to make.",
    ],
    "composure_low": [
        "Pause for a second — what part of your ask are you most confident about?",
        "Let's reset. In one sentence, what's the core reason behind your number?",
    ],
    "hr_elevated": [
        "No rush — take a moment to collect yourself, then continue when you're ready.",
        "Let's ease the pace. What's the one fact you want me to remember from your answer?",
    ],
}

INTERJECTION_SYSTEM = """You are the interviewer in a live practice session (salary negotiation or mock interview).
The candidate's live signals show elevated stress or low composure.

Respond with exactly ONE short spoken line (1–2 sentences, under 35 words).
Help them regroup: breathe, slow down, or clarify thinking — stay warm and in character.
Do NOT ask a new rubric question. Do NOT give scores or long coaching. No bullet points."""


def _mock_interjection(trigger: str, session_id: str | None) -> str:
    pool = MOCK_INTERJECTIONS.get(trigger) or MOCK_INTERJECTIONS["high_stress"]
    settings = _session_persona_settings(session_id)
    character_id = settings.get("character_id")
    idx = hash((session_id or "", trigger, character_id)) % len(pool)
    return pool[idx]


def _gemini_interjection(
    trigger: str, snapshot: dict[str, Any], api_key: str, session_id: str | None
) -> str:
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    persona = _persona_instruction(session_id)
    metrics = json.dumps(snapshot, ensure_ascii=True)
    body: dict[str, Any] = {
        "model": model,
        "system_instruction": f"{persona}\n\n{INTERJECTION_SYSTEM}",
        "input": (
            f"Trigger: {trigger}.\nLive snapshot: {metrics}.\n"
            "Speak one brief in-character interjection now."
        ),
        "generation_config": {
            "max_output_tokens": 120,
            "thinking_level": "minimal",
        },
    }
    payload = _create_interaction(body, api_key)
    return _extract_interaction_text(payload)


MOCK_SESSION_CLOSINGS = [
    "That's our time for today — thank you for walking through this with me. Great effort; we'll wrap here.",
    "We've hit the end of our slot. I appreciate the practice — let's call it here and you can review your report.",
    "Time's up on this session. Thanks for your answers today — we'll stop here.",
]

CLOSING_SYSTEM = """You are the interviewer in a live practice session (salary negotiation or mock interview).
The scheduled session time has ended.

Deliver a warm, in-character closing in 2–3 sentences (under 45 words).
Thank the candidate, acknowledge their effort, and clearly end the interview.
Do NOT ask another question. Do NOT give scores or rubric feedback. No bullet points."""


def _mock_session_closing(session_id: str | None) -> str:
    from repository import get_turns

    turns = get_turns(session_id) if session_id else []
    idx = len(turns) % len(MOCK_SESSION_CLOSINGS)
    return MOCK_SESSION_CLOSINGS[idx]


def _gemini_session_closing(
    session_id: str | None,
    api_key: str,
    *,
    elapsed_sec: int | None,
    duration_sec: int | None,
    turn_count: int,
) -> str:
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    persona = _persona_instruction(session_id)
    tail = _transcript_summary(_history_from_session(session_id), max_turns=8)
    timing = (
        f"Elapsed: {elapsed_sec}s of {duration_sec}s scheduled."
        if elapsed_sec is not None and duration_sec is not None
        else "Scheduled session time has ended."
    )
    body: dict[str, Any] = {
        "model": model,
        "system_instruction": f"{persona}\n\n{CLOSING_SYSTEM}",
        "input": (
            f"{timing}\nTurns completed: {turn_count}.\n\n"
            f"Recent transcript:\n{tail}\n\n"
            "Speak your closing line now."
        ),
        "generation_config": {
            "max_output_tokens": 160,
            "thinking_level": "minimal",
        },
    }
    payload = _create_interaction(body, api_key)
    return _extract_interaction_text(payload)


def _history_from_session(session_id: str | None) -> History:
    if not session_id:
        return []
    from repository import get_turns

    history: History = []
    for row in get_turns(session_id):
        history.append({"role": "interviewer", "text": row.get("question", "")})
        history.append({"role": "candidate", "text": row.get("answer", "")})
    return history


def _transcript_summary(history: History, max_turns: int = 8) -> str:
    lines: list[str] = []
    for entry in history[-max_turns * 2 :]:
        role = entry.get("role")
        text = str(entry.get("text", "")).strip()
        if not text:
            continue
        label = "Interviewer" if role == "interviewer" else "Candidate"
        lines.append(f"{label}: {text[:400]}")
    return "\n".join(lines) if lines else "(no prior transcript)"


def generate_session_closing(
    session_id: str | None,
    *,
    elapsed_sec: int | None = None,
    duration_sec: int | None = None,
) -> dict[str, Any]:
    """In-character wrap-up when the session timer ends."""
    turn_count = len(_history_from_session(session_id)) // 2
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return {"text": _mock_session_closing(session_id)}

    try:
        text = _gemini_session_closing(
            session_id,
            api_key,
            elapsed_sec=elapsed_sec,
            duration_sec=duration_sec,
            turn_count=turn_count,
        )
        return {"text": text}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini session closing failed, using mock: %s", exc)
        return {"text": _mock_session_closing(session_id)}


def generate_interjection(
    session_id: str | None,
    trigger: str,
    snapshot: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Short interviewer overlay — does not advance turn history."""
    snap = snapshot if isinstance(snapshot, dict) else {}
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        text = _mock_interjection(trigger, session_id)
        return {"text": text, "resume": True}

    try:
        text = _gemini_interjection(trigger, snap, api_key, session_id)
        return {"text": text, "resume": True}
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini interjection failed, using mock: %s", exc)
        text = _mock_interjection(trigger, session_id)
        return {"text": text, "resume": True}
