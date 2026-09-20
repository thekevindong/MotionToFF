"""Nemotron judge seam — rubric scoring only, never dialogue."""

from __future__ import annotations

import json
import logging
import os
import re
import time
import urllib.error
import urllib.request
from typing import Any

from nemotron_client import chat_json_object, nemotron_configured, parse_json_object

logger = logging.getLogger(__name__)

GEMINI_INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
GEMINI_INTERACTIONS_API_REVISION = "2026-05-20"
DEFAULT_GEMINI_MODEL = "gemini-3.5-flash"
DEFAULT_GEMINI_SESSION_TIMEOUT = 15.0

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


def _score_turn_presage(answer: str, composure: float) -> RubricScores:
    """Presage-style heuristic rubric from answer text + stored turn composure."""
    trimmed = answer.strip()
    words = len(trimmed.split()) if trimmed else 0
    comp = _clamp01(composure, 0.5)

    if not trimmed:
        return _normalize_rubric(
            {
                "structure": 0.2,
                "specificity": 0.15,
                "confidence": comp * 0.5,
                "evidence": [],
                "red_flags": ["empty_or_too_short"],
                "overall": 0.18,
            },
            mock=True,
        )

    has_number = bool(re.search(r"\d", trimmed))
    structure = _clamp01(0.42 + min(words, 100) / 140 + comp * 0.22)
    specificity = _clamp01(0.38 + min(words, 90) / 110 + (0.12 if has_number else 0))
    confidence = _clamp01(comp * 0.85 + min(words, 60) / 200)

    evidence: list[str] = []
    if words >= 35:
        evidence.append("Answer had enough depth to follow your reasoning")
    if comp >= 0.72:
        evidence.append("Composure read as steady on this turn")
    if has_number:
        evidence.append("Used concrete figures or metrics")

    red_flags: list[str] = []
    if words < 12:
        red_flags.append("very_brief_answer")
    if comp < 0.4:
        red_flags.append("low_composure_on_turn")

    overall = _clamp01((structure + specificity + confidence) / 3)
    return _normalize_rubric(
        {
            "structure": structure,
            "specificity": specificity,
            "confidence": confidence,
            "evidence": evidence[:3],
            "red_flags": red_flags,
            "overall": overall,
        },
        mock=True,
    )


def _presage_session_report(
    turns: list[dict[str, Any]], *, fallback: bool = False
) -> dict[str, Any]:
    """Baseline session report from turn composure + answer heuristics (no Nemotron)."""
    per_turn: list[dict[str, Any]] = []
    structure_vals: list[float] = []
    specificity_vals: list[float] = []
    confidence_vals: list[float] = []
    overall_vals: list[float] = []
    session_evidence: list[str] = []
    session_flags: list[str] = []

    for row in turns:
        comp = row.get("composure")
        comp_f = float(comp) if isinstance(comp, (int, float)) else 0.5
        rubric = _score_turn_presage(str(row.get("answer", "")), comp_f)
        per_turn.append({"turn": row["turn"], **rubric})
        structure_vals.append(rubric["structure"])
        specificity_vals.append(rubric["specificity"])
        confidence_vals.append(rubric["confidence"])
        overall_vals.append(rubric["overall"])
        for line in rubric.get("evidence", []):
            if line not in session_evidence and len(session_evidence) < 5:
                session_evidence.append(line)
        for line in rubric.get("red_flags", []):
            if line not in session_flags and len(session_flags) < 5:
                session_flags.append(line)

    def _avg(vals: list[float]) -> float:
        return sum(vals) / len(vals) if vals else 0.5

    agg = _normalize_rubric(
        {
            "structure": _avg(structure_vals),
            "specificity": _avg(specificity_vals),
            "confidence": _avg(confidence_vals),
            "evidence": session_evidence
            or ["Session completed — scores derived from delivery signals and answers"],
            "red_flags": session_flags,
            "overall": _avg(overall_vals),
        },
        mock=True,
    )
    source = "presage_fallback" if fallback else "presage"
    return {
        "rubric": agg,
        "per_turn": per_turn,
        "mock": True,
        "source": source,
        "fallback": fallback,
    }


def presage_session_report(
    turns: list[dict[str, Any]], *, fallback: bool = False
) -> dict[str, Any]:
    """Public Presage baseline report (used when Nemotron is off or fails)."""
    return _presage_session_report(turns, fallback=fallback)


def _mock_session_report(
    turns: list[dict[str, Any]], *, fallback: bool = False
) -> dict[str, Any]:
    return _presage_session_report(turns, fallback=fallback)


def _transcript_clip(text: str, *, field: str) -> str:
    """Keep Nemotron prompts smaller — long answers dominate latency and max_tokens."""
    default_q, default_a = 320, 520
    raw = os.getenv("NEMOTRON_TRANSCRIPT_QUESTION_CHARS", str(default_q)).strip()
    try:
        max_q = max(80, int(raw))
    except ValueError:
        max_q = default_q
    raw = os.getenv("NEMOTRON_TRANSCRIPT_ANSWER_CHARS", str(default_a)).strip()
    try:
        max_a = max(120, int(raw))
    except ValueError:
        max_a = default_a
    limit = max_q if field == "question" else max_a
    trimmed = text.strip()
    if len(trimmed) <= limit:
        return trimmed
    return trimmed[: limit - 3].rstrip() + "..."


def _session_report_from_judge_raw(
    raw: dict[str, Any],
    turns: list[dict[str, Any]],
    *,
    source: str,
    mock: bool,
    fallback: bool,
) -> dict[str, Any]:
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
            rubric = _normalize_rubric(item, mock=mock)
            per_turn.append({"turn": turn_idx, **rubric})

    rubric = _normalize_rubric(raw, mock=mock)
    if len(turns) > 0 and len(per_turn) < len(turns):
        have = {int(p["turn"]) for p in per_turn if "turn" in p}
        logger.warning(
            "%s session judge returned %s/%s per_turn rows; filling gaps with Presage heuristics",
            source,
            len(per_turn),
            len(turns),
        )
        for row in turns:
            idx = int(row.get("turn", 0))
            if idx < 1 or idx in have:
                continue
            comp = row.get("composure")
            comp_f = float(comp) if isinstance(comp, (int, float)) else 0.5
            gap = _score_turn_presage(str(row.get("answer", "")), comp_f)
            per_turn.append({"turn": idx, **gap})
        per_turn.sort(key=lambda item: int(item.get("turn", 0)))
    return {
        "rubric": rubric,
        "per_turn": per_turn,
        "mock": mock,
        "source": source,
        "fallback": fallback,
    }


def gemini_configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip())


def _gemini_session_timeout() -> float:
    raw = os.getenv("GEMINI_SESSION_TIMEOUT", str(DEFAULT_GEMINI_SESSION_TIMEOUT)).strip()
    try:
        return max(5.0, float(raw))
    except ValueError:
        return DEFAULT_GEMINI_SESSION_TIMEOUT


def _gemini_extract_interaction_text(payload: dict[str, Any]) -> str:
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


def _gemini_chat_json_object(
    system: str,
    user: str,
    *,
    timeout: float,
    max_tokens: int = 1536,
) -> dict[str, Any]:
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    model = os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL).strip() or DEFAULT_GEMINI_MODEL
    body: dict[str, Any] = {
        "model": model,
        "system_instruction": system,
        "input": user,
        "generation_config": {
            "max_output_tokens": max_tokens,
            "thinking_level": "minimal",
        },
    }
    request = urllib.request.Request(
        GEMINI_INTERACTIONS_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
            "Api-Revision": GEMINI_INTERACTIONS_API_REVISION,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini session judge HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Gemini session judge request failed: {exc.reason}") from exc
    text = _gemini_extract_interaction_text(payload)
    return parse_json_object(text)


def _session_transcript_block(turns: list[dict[str, Any]], job_title: str | None) -> str:
    lines: list[str] = []
    if job_title:
        lines.append(f"Role / context: {job_title}")
    for row in turns:
        q = _transcript_clip(str(row.get("question", "")), field="question")
        a = _transcript_clip(str(row.get("answer", "")), field="answer")
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
    session_timeout_raw = os.getenv("NEMOTRON_SESSION_TIMEOUT", "28").strip()
    try:
        session_timeout = max(8.0, float(session_timeout_raw))
    except ValueError:
        session_timeout = 28.0

    started = time.perf_counter()
    raw = chat_json_object(
        [
            {"role": "system", "content": SESSION_JUDGE_SYSTEM},
            {"role": "user", "content": user_content},
        ],
        temperature=0.15,
        max_tokens=1536,
        timeout=session_timeout,
    )
    logger.info(
        "Nemotron session judge completed in %.1fs (%s turns, model via NEMOTRON_MODEL)",
        time.perf_counter() - started,
        len(turns),
    )
    return _session_report_from_judge_raw(
        raw, turns, source="nemotron", mock=False, fallback=False
    )


def _gemini_session_report(turns: list[dict[str, Any]], job_title: str | None) -> dict[str, Any]:
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
    session_timeout = _gemini_session_timeout()
    started = time.perf_counter()
    raw = _gemini_chat_json_object(
        SESSION_JUDGE_SYSTEM,
        user_content,
        timeout=session_timeout,
    )
    logger.info(
        "Gemini session judge completed in %.1fs (%s turns, timeout=%ss)",
        time.perf_counter() - started,
        len(turns),
        session_timeout,
    )
    return _session_report_from_judge_raw(
        raw, turns, source="gemini", mock=False, fallback=False
    )


def _presage_fallback_report(turns: list[dict[str, Any]]) -> dict[str, Any]:
    """Charts from heuristics; UI uses transcript rule catalog for strengths/improvements."""
    return _presage_session_report(turns, fallback=True)


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

    if nemotron_configured():
        try:
            return _nemotron_session_report(turns, job_title or None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Nemotron session judge failed: %s", exc)
            if gemini_configured():
                try:
                    return _gemini_session_report(turns, job_title or None)
                except Exception as gem_exc:  # noqa: BLE001
                    logger.warning("Gemini session judge failed after Nemotron: %s", gem_exc)
            return _presage_fallback_report(turns)

    if gemini_configured():
        try:
            return _gemini_session_report(turns, job_title or None)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Gemini session judge failed: %s", exc)
            return _presage_fallback_report(turns)

    return _presage_session_report(turns, fallback=False)


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
