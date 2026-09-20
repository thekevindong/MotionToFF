"""Nemotron director seam — session control only, never dialogue."""

from __future__ import annotations

import json
import logging
from typing import Any

from judge import RubricScores
from nemotron_client import chat_json_object, nemotron_configured

logger = logging.getLogger(__name__)

History = list[dict[str, Any]]
DirectorDecision = dict[str, Any]

VALID_ACTIONS = frozenset(
    {"press_harder", "follow_up", "move_on", "curveball", "ease_off"},
)

DIRECTOR_SYSTEM = """You are an interview session director. You never speak to the candidate.
Choose the next session control action based on rubric scores and composure (0-1).
Output a single JSON object with no markdown.
Required keys:
- action: exactly one of press_harder, follow_up, move_on, curveball, ease_off
- rationale: one or two sentences for eval logs (not shown to candidate)"""


def _mock_decide(scores: RubricScores, composure: float, history: History) -> DirectorDecision:
    return {
        "action": "follow_up",
        "rationale": (
            "Mock director: scores are middling and composure is stable — "
            "probe for more specificity before moving on."
        ),
        "input_snapshot": {
            "scores": scores,
            "composure": composure,
            "turn_count": len(history),
        },
        "mock": True,
    }


def _history_summary(history: History, max_turns: int = 6) -> str:
    lines: list[str] = []
    for entry in history[-max_turns * 2 :]:
        role = entry.get("role", "?")
        text = str(entry.get("text", "")).strip()
        if text:
            lines.append(f"{role}: {text[:400]}")
    return "\n".join(lines) if lines else "(no prior transcript)"


def _nemotron_decide(
    scores: RubricScores,
    composure: float,
    history: History,
) -> DirectorDecision:
    user_payload = {
        "rubric_scores": {
            k: scores.get(k)
            for k in (
                "structure",
                "specificity",
                "confidence",
                "evidence",
                "red_flags",
                "overall",
            )
        },
        "composure": composure,
        "transcript_tail": _history_summary(history),
        "turn_count": len(history),
    }
    raw = chat_json_object(
        [
            {"role": "system", "content": DIRECTOR_SYSTEM},
            {
                "role": "user",
                "content": json.dumps(user_payload, ensure_ascii=False),
            },
        ],
        temperature=0.2,
        max_tokens=384,
    )

    action = str(raw.get("action", "follow_up")).strip().lower()
    if action not in VALID_ACTIONS:
        action = "follow_up"

    rationale = str(raw.get("rationale", "")).strip()
    if not rationale:
        rationale = f"Nemotron director chose {action}."

    return {
        "action": action,
        "rationale": rationale,
        "input_snapshot": {
            "scores": scores,
            "composure": composure,
            "turn_count": len(history),
        },
        "mock": False,
    }


def decide(scores: RubricScores, composure: float, history: History) -> DirectorDecision:
    """Choose the next session move. Uses Nemotron when NEMOTRON_API_KEY is set."""
    if not nemotron_configured():
        return _mock_decide(scores, composure, history)

    try:
        return _nemotron_decide(scores, composure, history)
    except Exception as exc:  # noqa: BLE001 — keep /turn green
        logger.warning("Nemotron director failed, using mock: %s", exc)
        return _mock_decide(scores, composure, history)
