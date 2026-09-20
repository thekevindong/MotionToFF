"""Gemini interviewer seam — dialogue only (mock until API keys are wired)."""

from typing import Any

MOCK_QUESTIONS = [
    "Tell me about yourself and why you're interested in this role.",
    "Describe a time you had to disagree with a teammate. What was the outcome?",
    "Walk me through a technical challenge you solved recently. What trade-offs did you make?",
    "Where do you see the biggest gap in your experience for this position?",
]

History = list[dict[str, Any]]


def next_turn(history: History) -> dict[str, str]:
    """Return the next interviewer line (later: Gemini)."""
    turn_index = sum(1 for entry in history if entry.get("role") == "interviewer")
    question = MOCK_QUESTIONS[turn_index % len(MOCK_QUESTIONS)]
    return {"role": "interviewer", "text": question}
