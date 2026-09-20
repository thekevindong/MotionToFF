"""Nemotron director seam — session control only, never dialogue."""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from nemotron_client import chat_completion, nemotron_configured

logger = logging.getLogger(__name__)

History = list[dict[str, Any]]
DirectorDecision = dict[str, Any]

VALID_ACTIONS = frozenset(
    {"press_harder", "follow_up", "move_on", "curveball", "ease_off"},
)

# Neutral pacing — continue the interview without a strong steer.
DEFAULT_ACTION = "follow_up"

DIRECTOR_SYSTEM = """You are an interview session director. You never speak to the candidate.
Pick how the session should pace based on composure (0-1) and the recent transcript.

Reply with exactly ONE word from this list (no punctuation, no other text):
press_harder, follow_up, move_on, curveball, ease_off

- follow_up: default — stay on topic, ask a normal next question
- press_harder: candidate seems strong; challenge them
- move_on: enough depth on this thread
- curveball: change angle to test adaptability
- ease_off: candidate stressed; soften pacing"""


def parse_director_action(text: str) -> str:
    """Parse director action from model text; first token, then keyword scan, then default."""
    raw = (text or "").strip()
    if not raw:
        return DEFAULT_ACTION

    for line in raw.splitlines():
        line = line.strip().lower()
        if not line:
            continue
        first = re.split(r"[\s,.:;]+", line, maxsplit=1)[0].strip("\"'`")
        if first in VALID_ACTIONS:
            return first

    lowered = raw.lower()
    for action in sorted(VALID_ACTIONS, key=len, reverse=True):
        if re.search(rf"\b{re.escape(action)}\b", lowered):
            return action

    return DEFAULT_ACTION


def _latest_candidate_answer(history: History) -> str:
    for entry in reversed(history):
        if entry.get("role") == "candidate":
            text = str(entry.get("text", "")).strip()
            if text:
                return text
    return ""


def _answer_depth_signals(history: History) -> dict[str, Any]:
    """Light transcript heuristics so pacing is not composure-only."""
    answer = _latest_candidate_answer(history)
    words = len(answer.split()) if answer else 0
    return {
        "answer_words": words,
        "answer_substantive": words >= 22,
        "answer_very_brief": words < 10 and bool(answer),
    }


def _local_decide(composure: float, history: History) -> DirectorDecision:
    """Fast pacing signal for sprite UX — blends Presage composure + last answer depth."""
    comp = max(0.0, min(1.0, float(composure)))
    signals = _answer_depth_signals(history)
    turn_pairs = max(1, len(history) // 2)

    if comp < 0.28 or (comp < 0.38 and signals["answer_very_brief"]):
        action = "ease_off"
        rationale = "Low composure or a very thin answer — soften pacing."
    elif comp < 0.42:
        action = "follow_up"
        rationale = "Mild stress — steady, supportive follow-up."
    elif comp > 0.86 and signals["answer_substantive"] and turn_pairs >= 2:
        action = "press_harder"
        rationale = "Strong composure and a substantive answer — one respectful challenge."
    elif comp > 0.82 and turn_pairs >= 4 and signals["answer_substantive"]:
        action = "curveball"
        rationale = "Comfortable late in session — vary the angle once."
    elif signals["answer_very_brief"] and comp < 0.55:
        action = "follow_up"
        rationale = "Brief answer under moderate stress — clarify without pressure."
    else:
        action = DEFAULT_ACTION
        rationale = "Neutral pacing — continue with a standard follow-up."

    return {
        "action": action,
        "rationale": rationale,
        "input_snapshot": {
            "composure": comp,
            "turn_count": len(history),
            **signals,
        },
        "mock": True,
    }


def _mock_decide(composure: float, history: History) -> DirectorDecision:
    return _local_decide(composure, history)


def _history_summary(history: History, max_turns: int = 6) -> str:
    lines: list[str] = []
    for entry in history[-max_turns * 2 :]:
        role = entry.get("role", "?")
        text = str(entry.get("text", "")).strip()
        if text:
            lines.append(f"{role}: {text[:400]}")
    return "\n".join(lines) if lines else "(no prior transcript)"


def _nemotron_decide(composure: float, history: History) -> DirectorDecision:
    user_payload = {
        "composure": composure,
        "transcript_tail": _history_summary(history),
        "turn_count": len(history),
    }
    text = chat_completion(
        [
            {"role": "system", "content": DIRECTOR_SYSTEM},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False),
            },
        ],
        temperature=0.15,
        max_tokens=32,
        response_format=None,
    )
    action = parse_director_action(text)
    return {
        "action": action,
        "rationale": f"Nemotron director chose {action}.",
        "raw": text[:200],
        "input_snapshot": {
            "composure": composure,
            "turn_count": len(history),
        },
        "mock": False,
    }


def decide(composure: float, history: History) -> DirectorDecision:
    """Sprite / UX pacing hint only. Live interview tone is owned by Gemini."""
    return _local_decide(composure, history)


def decide_with_nemotron(composure: float, history: History) -> DirectorDecision:
    """Optional Nemotron director (debug / future) — not used on /turn."""
    if not nemotron_configured():
        return _local_decide(composure, history)

    try:
        return _nemotron_decide(composure, history)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Nemotron director failed, using local action: %s", exc)
        return _local_decide(composure, history)
