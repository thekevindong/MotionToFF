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


def _mock_decide(composure: float, history: History) -> DirectorDecision:
    return {
        "action": DEFAULT_ACTION,
        "rationale": (
            "Mock director: neutral pacing — continue with a standard follow-up."
        ),
        "input_snapshot": {
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
    """Choose the next session move. Uses Nemotron when NEMOTRON_API_KEY is set."""
    if not nemotron_configured():
        return _mock_decide(composure, history)

    try:
        return _nemotron_decide(composure, history)
    except Exception as exc:  # noqa: BLE001 — keep /turn green
        logger.warning("Nemotron director failed, using default action: %s", exc)
        return _mock_decide(composure, history)
