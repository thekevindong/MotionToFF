"""Nemotron judge seam — rubric scoring only, never dialogue."""

from __future__ import annotations

import logging
from typing import Any

from nemotron_client import chat_json_object, nemotron_configured

logger = logging.getLogger(__name__)

RubricScores = dict[str, Any]

SETTINGS_SESSION_REPORT_KEY = "session_rubric"

JUDGE_SYSTEM = """You are an interview rubric judge. You never speak to the candidate.
Score only the candidate's answer text. Reply with exactly one JSON object: no markdown,
no preamble, no chain-of-thought, no analysis steps. The first character must be {.
All numeric scores must be floats between 0.0 and 1.0 (higher is better except red_flags).
Required keys:
- structure (float)
- specificity (float)
- confidence (float)
- evidence (array of short strings, 1-3 items)
- red_flags (array of short strings; empty if none)
- overall (float, holistic quality)"""

SESSION_JUDGE_SYSTEM = """You are an interview rubric judge scoring a completed practice session.
You never speak to the candidate. Use the full Q/A transcript and composure notes.
Reply with exactly one JSON object: no markdown, no preamble, no chain-of-thought.
The first character must be {.
All numeric scores must be floats between 0.0 and 1.0 (higher is better except red_flags).
Required keys:
- structure (float) — session-level
- specificity (float)
- confidence (float)
- evidence (array of short strings, 2-5 session strengths)
- red_flags (array of short strings; empty if none)
- overall (float, holistic session quality)
- per_turn (array) — one object per turn with:
  - turn (int, 1-based)
  - structure, specificity, confidence, overall (floats)
  - evidence (array, 0-2 strings)
  - red_flags (array)"""


def pending_turn_scores(composure: float) -> RubricScores:
    """Placeholder until end-of-session JSON rubric is built for the report."""
    base = _clamp01(composure, 0.5)
    return {
        "structure": base,
        "specificity": base,
        "confidence": base,
        "evidence": [],
        "red_flags": [],
        "overall": base,
        "pending": True,
        "mock": True,
    }


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
        max_tokens=1024,
    )
    return _normalize_rubric(raw, mock=False)


def score(answer: str) -> RubricScores:
    """Score a single answer (debug / legacy). Live path uses score_session at report time."""
    if not nemotron_configured():
        return _mock_score(answer)

    try:
        return _nemotron_score(answer)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Nemotron judge failed, using mock: %s", exc)
        return _mock_score(answer)


def _mock_session_report(
    turns: list[dict[str, Any]], *, fallback: bool = False
) -> dict[str, Any]:
    per_turn: list[dict[str, Any]] = []
    for row in turns:
        rubric = _mock_score(str(row.get("answer", "")))
        per_turn.append({"turn": row["turn"], **rubric})
    agg = _normalize_rubric(
        {
            "structure": 0.74,
            "specificity": 0.68,
            "confidence": 0.72,
            "evidence": ["Session completed with multiple answers"],
            "red_flags": [],
            "overall": 0.71,
        },
        mock=True,
    )
    source = "mock_fallback" if fallback else "mock"
    return {"rubric": agg, "per_turn": per_turn, "mock": True, "source": source, "fallback": fallback}


def _session_transcript_block(turns: list[dict[str, Any]], job_title: str | None) -> str:
    lines: list[str] = []
    if job_title:
        lines.append(f"Role / context: {job_title}")
    for row in turns:
        q = str(row.get("question", "")).strip()
        a = str(row.get("answer", "")).strip()
        comp = row.get("composure")
        comp_note = f" (composure {comp:.2f})" if isinstance(comp, (int, float)) else ""
        if q:
            lines.append(f"Interviewer: {q}")
        if a:
            lines.append(f"Candidate: {a}{comp_note}")
    return "\n".join(lines) if lines else "(empty session)"


def _nemotron_session_report(turns: list[dict[str, Any]], job_title: str | None) -> dict[str, Any]:
    transcript = _session_transcript_block(turns, job_title)
    composure_vals = [
        float(t["composure"])
        for t in turns
        if isinstance(t.get("composure"), (int, float))
    ]
    composure_summary = {
        "samples": composure_vals,
        "avg": sum(composure_vals) / len(composure_vals) if composure_vals else None,
        "min": min(composure_vals) if composure_vals else None,
    }
    user_content = (
        "Score this completed interview session.\n\n"
        f"Composure summary: {composure_summary}\n\n"
        f"Transcript:\n{transcript}"
    )
    raw = chat_json_object(
        [
            {"role": "system", "content": SESSION_JUDGE_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.15,
        max_tokens=2048,
    )
    per_turn_raw = raw.get("per_turn")
    per_turn: list[dict[str, Any]] = []
    if isinstance(per_turn_raw, list):
        for item in per_turn_raw:
            if not isinstance(item, dict):
                continue
            try:
                turn_idx = int(item.get("turn", 0))
            except (TypeError, ValueError):
                continue
            if turn_idx < 1:
                continue
            rubric = _normalize_rubric(item, mock=False)
            per_turn.append({"turn": turn_idx, **rubric})

    rubric = _normalize_rubric(raw, mock=False)
    return {
        "rubric": rubric,
        "per_turn": per_turn,
        "mock": False,
        "source": "nemotron",
        "fallback": False,
    }


def score_session(session_id: str) -> dict[str, Any]:
    """End-of-session JSON rubric (full transcript + composure)."""
    from repository import get_session_row, get_turns

    turns = get_turns(session_id)
    if not turns:
        return {
            "rubric": _normalize_rubric({}, mock=True),
            "per_turn": [],
            "mock": True,
            "source": "mock",
            "fallback": False,
        }

    row = get_session_row(session_id)
    job_title = (row.get("job_title") or "").strip() if row else None

    if not nemotron_configured():
        return _mock_session_report(turns, fallback=False)

    try:
        return _nemotron_session_report(turns, job_title or None)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Nemotron session judge failed, using mock: %s", exc)
        return _mock_session_report(turns, fallback=True)


def apply_session_report_to_turns(
    turns: list[dict[str, Any]], report: dict[str, Any]
) -> list[dict[str, Any]]:
    """Merge per_turn rubric from session report into stored turn rows."""
    per_turn = report.get("per_turn")
    if not isinstance(per_turn, list):
        return turns
    lookup: dict[int, RubricScores] = {}
    for item in per_turn:
        if not isinstance(item, dict) or "turn" not in item:
            continue
        try:
            idx = int(item["turn"])
        except (TypeError, ValueError):
            continue
        lookup[idx] = _normalize_rubric(item, mock=bool(report.get("mock")))

    session_rubric = report.get("rubric")
    fallback = (
        _normalize_rubric(session_rubric, mock=bool(report.get("mock")))
        if isinstance(session_rubric, dict)
        else None
    )

    merged: list[dict[str, Any]] = []
    for row in turns:
        copy = dict(row)
        idx = int(copy.get("turn", 0))
        if idx in lookup:
            copy["scores"] = lookup[idx]
        elif fallback is not None:
            copy["scores"] = dict(fallback)
        merged.append(copy)
    return merged
