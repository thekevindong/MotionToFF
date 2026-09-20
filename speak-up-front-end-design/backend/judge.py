"""Nemotron judge seam — rubric scoring only, never dialogue (mock)."""

from typing import Any

RubricScores = dict[str, Any]


def score(answer: str) -> RubricScores:
    """Score an answer against the rubric (later: Nemotron)."""
    trimmed = answer.strip()
    return {
        "structure": 0.78,
        "specificity": 0.62,
        "confidence": 0.71,
        "evidence": [
            "Answer addresses the question directly",
            "Includes at least one concrete example",
        ],
        "red_flags": [] if trimmed else ["empty_or_too_short"],
        "overall": 0.70,
        "mock": True,
    }
