"""Nemotron judge seam — rubric scoring only, never dialogue."""

from __future__ import annotations

import logging
from typing import Any

from nemotron_client import chat_json_object, nemotron_configured

logger = logging.getLogger(__name__)

RubricScores = dict[str, Any]

JUDGE_SYSTEM = """You are an interview rubric judge. You never speak to the candidate.
Score only the candidate's answer text. Output a single JSON object with no markdown.
All numeric scores must be floats between 0.0 and 1.0 (higher is better except red_flags).
Required keys:
- structure (float)
- specificity (float)
- confidence (float)
- evidence (array of short strings, 1-3 items)
- red_flags (array of short strings; empty if none)
- overall (float, holistic quality)"""


def _clamp01(value: Any, default: float = 0.5) -> float:
    try:
        num = float(value)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(1.0, num))


def _normalize_rubric(raw: dict[str, Any], *, mock: bool) -> RubricScores:
    evidence = raw.get("evidence")
    if not isinstance(evidence, list):
        evidence = []
    evidence = [str(x).strip() for x in evidence if str(x).strip()]

    red_flags = raw.get("red_flags")
    if not isinstance(red_flags, list):
        red_flags = []
    red_flags = [str(x).strip() for x in red_flags if str(x).strip()]

    return {
        "structure": _clamp01(raw.get("structure")),
        "specificity": _clamp01(raw.get("specificity")),
        "confidence": _clamp01(raw.get("confidence")),
        "evidence": evidence,
        "red_flags": red_flags,
        "overall": _clamp01(raw.get("overall")),
        "mock": mock,
    }


def _mock_score(answer: str) -> RubricScores:
    trimmed = answer.strip()
    return _normalize_rubric(
        {
            "structure": 0.78,
            "specificity": 0.62,
            "confidence": 0.71,
            "evidence": [
                "Answer addresses the question directly",
                "Includes at least one concrete example",
            ],
            "red_flags": [] if trimmed else ["empty_or_too_short"],
            "overall": 0.70,
        },
        mock=True,
    )


def _nemotron_score(answer: str) -> RubricScores:
    trimmed = answer.strip()
    user_content = (
        "Score this candidate answer:\n\n"
        f"{trimmed if trimmed else '(empty answer)'}"
    )
    raw = chat_json_object(
        [
            {"role": "system", "content": JUDGE_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.15,
        max_tokens=512,
    )
    return _normalize_rubric(raw, mock=False)


def score(answer: str) -> RubricScores:
    """Score an answer against the rubric. Uses Nemotron when NEMOTRON_API_KEY is set."""
    if not nemotron_configured():
        return _mock_score(answer)

    try:
        return _nemotron_score(answer)
    except Exception as exc:  # noqa: BLE001 — keep /turn green
        logger.warning("Nemotron judge failed, using mock: %s", exc)
        return _mock_score(answer)
