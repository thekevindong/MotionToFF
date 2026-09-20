"""Nemotron director seam — session control only, never dialogue (mock)."""

from typing import Any

from judge import RubricScores

History = list[dict[str, Any]]
DirectorDecision = dict[str, Any]

# Later: action must be one of press_harder | follow_up | move_on | curveball | ease_off


def decide(scores: RubricScores, composure: float, history: History) -> DirectorDecision:
    """Choose the next session move (later: Nemotron)."""
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
