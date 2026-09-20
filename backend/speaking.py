"""Public speaking teleprompter (Gemini when keyed, deterministic mock otherwise)."""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Literal

from interviewer import _create_interaction, _extract_interaction_text

logger = logging.getLogger(__name__)

DurationMode = Literal["30", "45", "full"]
WORDS_PER_SEC = 2.2

TELEPROMPTER_SYSTEM = """You are a speech coach preparing a teleprompter for a public speaking practice app.

Given a historical speech excerpt, a duration mode, and a target speaking time, output JSON only (no markdown fences):
{"lines": ["...", "..."], "estimated_sec": number, "rationale": "short"}

Rules:
- Preserve the speaker's voice and wording from the excerpt; do not invent new content.
- For short timed modes (30s or 45s), pick only the most iconic lines that fit the word budget — never exceed it.
- For "full" mode, include the entire excerpt split into scroll-friendly chunks (~1–2 sentences per line).
- No commentary addressed to the user; lines are only what the speaker would read aloud.
- estimated_sec should reflect a natural pace near 2.5 words per second."""


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _excerpt_words(text: str) -> list[str]:
    return re.findall(r"\S+", (text or "").strip())


def _join_words(words: list[str], count: int) -> str:
    if count <= 0 or not words:
        return ""
    return " ".join(words[:count])


def _chunk_full_excerpt(text: str) -> list[str]:
    stripped = (text or "").strip()
    if not stripped:
        return []
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", stripped) if p.strip()]
    lines: list[str] = []
    for para in paragraphs:
        sentences = re.split(r"(?<=[.!?])\s+", para)
        buf = ""
        for sentence in sentences:
            sentence = sentence.strip()
            if not sentence:
                continue
            candidate = f"{buf} {sentence}".strip() if buf else sentence
            if len(candidate.split()) > 28 and buf:
                lines.append(buf)
                buf = sentence
            else:
                buf = candidate
        if buf:
            lines.append(buf)
    return lines if lines else [stripped]


def target_for_mode(duration_mode: DurationMode, est_full_duration_sec: int) -> int:
    if duration_mode == "30":
        return 30
    if duration_mode == "45":
        return 45
    return max(int(est_full_duration_sec or 0), 1)


def word_budget_for_mode(duration_mode: DurationMode, est_full_duration_sec: int) -> int | None:
    if duration_mode == "30":
        return 58
    if duration_mode == "45":
        return 88
    return None


def enforce_word_budget(lines: list[str], budget: int) -> list[str]:
    if budget <= 0 or not lines:
        return lines
    out: list[str] = []
    used = 0
    for line in lines:
        words = _excerpt_words(line)
        if not words:
            continue
        if used >= budget:
            break
        remaining = budget - used
        if len(words) <= remaining:
            out.append(line)
            used += len(words)
        else:
            out.append(_join_words(words, remaining))
            used = budget
            break
    return out if out else [_join_words(_excerpt_words(lines[0]), min(budget, len(_excerpt_words(lines[0]))))]


def _cap_timed_teleprompter(result: dict[str, Any], duration_mode: DurationMode, est_full: int) -> dict[str, Any]:
    if duration_mode == "full":
        return result
    budget = word_budget_for_mode(duration_mode, est_full)
    if not budget:
        return result
    lines = result.get("lines")
    if not isinstance(lines, list):
        return result
    trimmed = enforce_word_budget([str(ln) for ln in lines], budget)
    word_count = sum(len(_excerpt_words(ln)) for ln in trimmed)
    target_sec = int(result.get("target_sec") or target_for_mode(duration_mode, est_full))
    estimated = max(1, min(target_sec, int(word_count / WORDS_PER_SEC)))
    result = {**result, "lines": trimmed, "estimated_sec": estimated}
    return result


def mock_teleprompter(speech: dict[str, Any], duration_mode: DurationMode) -> dict[str, Any]:
    excerpt = str(speech.get("excerpt_text") or "")
    words = _excerpt_words(excerpt)
    est_full = int(speech.get("est_full_duration_sec") or 0)
    target_sec = target_for_mode(duration_mode, est_full)

    if duration_mode == "full":
        lines = _chunk_full_excerpt(excerpt)
        estimated = est_full or max(1, int(len(words) / WORDS_PER_SEC))
        return {
            "lines": lines,
            "target_sec": target_sec,
            "estimated_sec": estimated,
            "rationale": "Full excerpt chunked for scroll (mock).",
            "source": "mock",
        }

    budget = word_budget_for_mode(duration_mode, est_full) or 75
    slice_text = _join_words(words, budget)
    lines = _chunk_full_excerpt(slice_text) if slice_text else []
    if not lines and slice_text:
        lines = [slice_text]
    estimated = max(1, int(len(_excerpt_words(slice_text)) / WORDS_PER_SEC))
    return {
        "lines": lines,
        "target_sec": target_sec,
        "estimated_sec": estimated,
        "rationale": f"First ~{budget} words for {duration_mode}s practice (mock).",
        "source": "mock",
    }


def _parse_teleprompter_json(raw: str) -> dict[str, Any]:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("Teleprompter JSON must be an object")
    lines = data.get("lines")
    if not isinstance(lines, list) or not all(isinstance(x, str) for x in lines):
        raise ValueError("Teleprompter JSON missing lines array")
    trimmed = [ln.strip() for ln in lines if isinstance(ln, str) and ln.strip()]
    if not trimmed:
        raise ValueError("Teleprompter lines empty")
    estimated = data.get("estimated_sec")
    estimated_sec = float(estimated) if isinstance(estimated, (int, float)) else None
    rationale = str(data.get("rationale") or "").strip()
    return {
        "lines": trimmed,
        "estimated_sec": estimated_sec,
        "rationale": rationale,
    }


def gemini_teleprompter(
    speech: dict[str, Any],
    duration_mode: DurationMode,
    *,
    api_key: str,
) -> dict[str, Any]:
    est_full = int(speech.get("est_full_duration_sec") or 0)
    target_sec = target_for_mode(duration_mode, est_full)
    budget = word_budget_for_mode(duration_mode, est_full)
    budget_note = (
        f"Use roughly {budget} words total."
        if budget is not None
        else "Include the full excerpt, chunked for scrolling."
    )
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip() or "gemini-3.5-flash"
    speaker = str(speech.get("speaker") or "Speaker")
    title = str(speech.get("title") or "Speech")
    excerpt = str(speech.get("excerpt_text") or "")

    user_input = (
        f"Speaker: {speaker}\nTitle: {title}\n"
        f"Duration mode: {duration_mode}\nTarget seconds: {target_sec}\n"
        f"{budget_note}\n\n"
        f"Excerpt:\n{excerpt}"
    )

    body: dict[str, Any] = {
        "model": model,
        "system_instruction": TELEPROMPTER_SYSTEM,
        "input": user_input,
        "generation_config": {
            "max_output_tokens": 2048,
            "thinking_level": "minimal",
        },
    }
    payload = _create_interaction(body, api_key)
    raw = _extract_interaction_text(payload)
    parsed = _parse_teleprompter_json(raw)
    estimated = parsed.get("estimated_sec")
    if not isinstance(estimated, (int, float)) or estimated <= 0:
        word_count = sum(len(_excerpt_words(ln)) for ln in parsed["lines"])
        estimated = max(1, int(word_count / WORDS_PER_SEC))
    return {
        "lines": parsed["lines"],
        "target_sec": target_sec,
        "estimated_sec": int(round(float(estimated))),
        "rationale": parsed.get("rationale") or "",
        "source": "gemini",
    }


def speech_from_custom_excerpt(
    excerpt: str,
    *,
    title: str | None = None,
    speaker: str | None = None,
) -> dict[str, Any]:
    text = (excerpt or "").strip()
    words = _excerpt_words(text)
    if len(words) < 8:
        raise ValueError("custom_excerpt_too_short")
    est_full = max(1, int(len(words) / WORDS_PER_SEC))
    return {
        "id": "custom",
        "speaker": (speaker or "").strip() or "You",
        "title": (title or "").strip() or "Your speech",
        "excerpt_text": text,
        "est_full_duration_sec": est_full,
    }


def build_teleprompter(speech: dict[str, Any], duration_mode: DurationMode) -> dict[str, Any]:
    est_full = int(speech.get("est_full_duration_sec") or 0)
    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if not api_key:
        return _cap_timed_teleprompter(mock_teleprompter(speech, duration_mode), duration_mode, est_full)
    try:
        return _cap_timed_teleprompter(
            gemini_teleprompter(speech, duration_mode, api_key=api_key),
            duration_mode,
            est_full,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Gemini teleprompter failed, using mock: %s", exc)
        return _cap_timed_teleprompter(mock_teleprompter(speech, duration_mode), duration_mode, est_full)


SPEAKING_JUDGE_SYSTEM = """You are a public speaking coach scoring a completed practice delivery.
You never speak to the candidate. Reply with exactly one JSON object: no markdown, no preamble.
The first character must be {.
All numeric scores must be floats between 0.0 and 1.0 (higher is better except red_flags).
Required keys:
- structure (float) — flow and pacing of the delivery
- specificity (float) — concrete language vs vague filler
- confidence (float) — vocal assurance inferred from transcript + delivery stats
- presence (float) — stage presence from composure/stress/engagement
- message_fit (float) — how well the spoken words match the teleprompter intent
- teleprompter_coverage (float) — fraction of teleprompter content reflected in speech
- overall (float)
- evidence (array of 2-5 short strings)
- red_flags (array of short strings; empty if none)
- timing (object) with keys: mode ("30"|"45"|"full"), finished_in_time (boolean), notes (string)"""


def _token_set(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9']+", (text or "").lower()))


def teleprompter_coverage_heuristic(transcript: str, teleprompter_lines: list[str]) -> float:
    from judge import _clamp01

    tp_tokens = _token_set("\n".join(teleprompter_lines))
    spoken = _token_set(transcript)
    if not tp_tokens:
        return 1.0 if spoken else 0.0
    if not spoken:
        return 0.0
    overlap = len(spoken & tp_tokens) / len(tp_tokens)
    return _clamp01(overlap)


def _delivery_summary(settings: dict[str, Any]) -> dict[str, Any]:
    stats = settings.get("delivery_stats")
    if not isinstance(stats, dict):
        return {}
    summary = stats.get("summary")
    return summary if isinstance(summary, dict) else {}


def _trim_samples_for_judge(settings: dict[str, Any], *, every_n: int = 10) -> list[dict[str, Any]]:
    stats = settings.get("delivery_stats")
    if not isinstance(stats, dict):
        return []
    samples = stats.get("samples")
    if not isinstance(samples, list):
        return []
    out: list[dict[str, Any]] = []
    for idx, item in enumerate(samples):
        if not isinstance(item, dict):
            continue
        if idx % every_n != 0 and idx != len(samples) - 1:
            continue
        out.append(
            {
                "ts_ms": item.get("ts_ms"),
                "composure": item.get("composure"),
                "stress": item.get("stress"),
                "engagement": item.get("engagement"),
            }
        )
    return out[:12]


def _parse_speaking_judge_json(raw: str) -> dict[str, Any]:
    cleaned = (raw or "").strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    data = json.loads(cleaned)
    if not isinstance(data, dict):
        raise ValueError("Speaking judge JSON must be an object")
    return data


def presage_speaking_judge(
    *,
    transcript: str,
    teleprompter_lines: list[str],
    duration_mode: str,
    finished_in_time: bool,
    target_duration_sec: int,
    elapsed_sec: int,
    delivery_summary: dict[str, Any],
    composure_turn: float,
    ended_by: str = "user",
) -> dict[str, Any]:
    from judge import _clamp01

    trimmed = transcript.strip()
    coverage = teleprompter_coverage_heuristic(trimmed, teleprompter_lines)
    avg_comp = delivery_summary.get("avg_composure")
    comp = _clamp01(avg_comp if isinstance(avg_comp, (int, float)) else composure_turn, 0.5)
    min_comp = delivery_summary.get("min_composure")
    min_comp_f = _clamp01(min_comp if isinstance(min_comp, (int, float)) else comp, comp)
    fillers = delivery_summary.get("filler_count")
    filler_count = int(fillers) if isinstance(fillers, (int, float)) else 0
    wpm = delivery_summary.get("avg_wpm")
    wpm_f = float(wpm) if isinstance(wpm, (int, float)) else None

    words = len(_excerpt_words(trimmed)) if trimmed else 0
    structure = _clamp01(0.35 + coverage * 0.45 + min(words, 120) / 200)
    specificity = _clamp01(0.32 + coverage * 0.5 + (0.08 if words >= 40 else 0))
    confidence = _clamp01(comp * 0.75 + (0.15 if wpm_f and 110 <= wpm_f <= 170 else 0))
    presence = _clamp01(comp * 0.7 + min_comp_f * 0.2 + 0.05)
    message_fit = _clamp01(coverage * 0.85 + comp * 0.1)
    overall = _clamp01((structure + specificity + confidence + presence + message_fit) / 5)

    evidence: list[str] = []
    if coverage >= 0.55:
        evidence.append("You covered a solid share of the teleprompter lines.")
    if comp >= 0.68:
        evidence.append("Facial delivery stayed composed for much of the speech.")
    if wpm_f and 105 <= wpm_f <= 175:
        evidence.append("Pacing sat in a listenable public-speaking range.")
    if words >= 50:
        evidence.append("Transcript length shows you stayed with the material.")
    if delivery_summary.get("presage_degraded"):
        evidence.append("Camera was off — face metrics used degraded heuristics for this run.")
    if not evidence:
        evidence.append("Session completed — scores derived from delivery signals and transcript.")

    red_flags: list[str] = []
    if not trimmed:
        red_flags.append("empty_delivery")
    timed = duration_mode in ("30", "45")
    if timed and not finished_in_time:
        red_flags.append("missed_time_budget")
    if coverage < 0.35 and trimmed:
        red_flags.append("low_teleprompter_coverage")
    if filler_count >= 6:
        red_flags.append("high_filler_rate")
    if comp < 0.42:
        red_flags.append("low_composure_delivery")

    timing_notes: list[str] = []
    ended = (ended_by or "user").strip().lower()
    if timed and target_duration_sec > 0:
        timing_notes.append(f"Target {target_duration_sec}s; spoke ~{elapsed_sec}s.")
    elif duration_mode == "full":
        timing_notes.append(f"Full-length mode; elapsed ~{elapsed_sec}s.")
    if not trimmed:
        timing_notes.append("No spoken transcript captured.")
    elif ended == "early_exit":
        timing_notes.append("Session ended early before the practice window was complete.")
    elif ended == "user" and timed and elapsed_sec < target_duration_sec and finished_in_time:
        timing_notes.append("You finished before the countdown ended; delivery still counts as in time.")
    elif ended == "timer" and timed and elapsed_sec >= target_duration_sec:
        timing_notes.append("Countdown reached zero.")
    elif finished_in_time and trimmed:
        timing_notes.append("Finished within the practice window.")
    elif timed and not finished_in_time:
        timing_notes.append("Did not finish within the timed window or left early.")

    return {
        "structure": structure,
        "specificity": specificity,
        "confidence": confidence,
        "presence": presence,
        "message_fit": message_fit,
        "teleprompter_coverage": coverage,
        "overall": overall,
        "evidence": evidence[:5],
        "red_flags": red_flags,
        "timing": {
            "mode": duration_mode,
            "finished_in_time": finished_in_time,
            "notes": " ".join(timing_notes).strip(),
        },
    }


def gemini_speaking_judge(
    *,
    transcript: str,
    teleprompter_lines: list[str],
    duration_mode: str,
    finished_in_time: bool,
    target_duration_sec: int,
    elapsed_sec: int,
    delivery_summary: dict[str, Any],
    sample_trend: list[dict[str, Any]],
    speech_title: str,
    speaker: str,
    api_key: str,
    ended_by: str = "user",
) -> dict[str, Any]:
    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash").strip() or "gemini-3.5-flash"
    teleprompter_block = "\n".join(f"- {ln}" for ln in teleprompter_lines if str(ln).strip())
    user_input = (
        f"Speech: {speech_title} by {speaker}\n"
        f"Duration mode: {duration_mode}\n"
        f"Target seconds: {target_duration_sec}\n"
        f"Elapsed seconds: {elapsed_sec}\n"
        f"Finished in time: {finished_in_time}\n"
        f"Ended by: {ended_by}\n"
        f"Delivery summary: {json.dumps(delivery_summary, ensure_ascii=True)}\n"
        f"Sample trend (every ~10s): {json.dumps(sample_trend, ensure_ascii=True)}\n\n"
        f"Teleprompter lines:\n{teleprompter_block or '(none)'}\n\n"
        f"Candidate transcript:\n{transcript.strip() or '(empty)'}"
    )
    body: dict[str, Any] = {
        "model": model,
        "system_instruction": SPEAKING_JUDGE_SYSTEM,
        "input": user_input,
        "generation_config": {
            "max_output_tokens": 2048,
            "thinking_level": "minimal",
        },
    }
    payload = _create_interaction(body, api_key)
    raw = _extract_interaction_text(payload)
    return _parse_speaking_judge_json(raw)


def _speaking_report_from_raw(
    raw: dict[str, Any],
    turn_index: int,
    *,
    source: str,
    mock: bool,
    fallback: bool,
) -> dict[str, Any]:
    from judge import _normalize_rubric

    rubric = _normalize_rubric(raw, mock=mock)
    per_turn = [{"turn": turn_index, **dict(rubric)}]
    return {
        "rubric": rubric,
        "per_turn": per_turn,
        "mock": mock,
        "source": source,
        "fallback": fallback,
    }


def score_speaking_session(session_id: str) -> dict[str, Any]:
    """End-of-session speaking rubric (Gemini when keyed, Presage heuristics otherwise)."""
    from repository import get_session_settings, get_turns
    from judge import _normalize_rubric

    settings = get_session_settings(session_id)
    turns = get_turns(session_id)
    if not turns:
        return {
            "rubric": _normalize_rubric({}, mock=True),
            "per_turn": [],
            "mock": True,
            "source": "mock",
            "fallback": False,
        }

    turn = turns[-1]
    turn_idx = int(turn.get("turn") or len(turns))
    transcript = str(turn.get("answer") or "")
    comp_f = float(turn["composure"]) if isinstance(turn.get("composure"), (int, float)) else 0.5

    lines_raw = settings.get("teleprompter_lines")
    teleprompter_lines = [str(ln) for ln in lines_raw] if isinstance(lines_raw, list) else []

    duration_mode = str(settings.get("duration_mode") or "full")
    target_duration_sec = int(settings.get("target_duration_sec") or 0)
    finished_raw = settings.get("finished_in_time")
    finished_in_time = bool(finished_raw) if isinstance(finished_raw, bool) else False

    stats = settings.get("delivery_stats")
    elapsed_sec = 0
    if isinstance(stats, dict) and isinstance(stats.get("elapsed_sec"), (int, float)):
        elapsed_sec = int(stats["elapsed_sec"])

    delivery_summary = _delivery_summary(settings)
    sample_trend = _trim_samples_for_judge(settings)
    speech_title = str(settings.get("speech_title") or "Speech")
    speaker = str(settings.get("speaker") or "Speaker")
    ended_by = "user"
    stats_raw = settings.get("delivery_stats")
    if isinstance(stats_raw, dict):
        eb = stats_raw.get("ended_by")
        if isinstance(eb, str) and eb.strip():
            ended_by = eb.strip()

    api_key = os.getenv("GEMINI_API_KEY", "").strip()
    if api_key:
        try:
            raw = gemini_speaking_judge(
                transcript=transcript,
                teleprompter_lines=teleprompter_lines,
                duration_mode=duration_mode,
                finished_in_time=finished_in_time,
                target_duration_sec=target_duration_sec,
                elapsed_sec=elapsed_sec,
                delivery_summary=delivery_summary,
                sample_trend=sample_trend,
                speech_title=speech_title,
                speaker=speaker,
                api_key=api_key,
                ended_by=ended_by,
            )
            return _speaking_report_from_raw(
                raw, turn_idx, source="gemini", mock=False, fallback=False
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Gemini speaking judge failed, using Presage heuristics: %s", exc)

    raw = presage_speaking_judge(
        transcript=transcript,
        teleprompter_lines=teleprompter_lines,
        duration_mode=duration_mode,
        finished_in_time=finished_in_time,
        target_duration_sec=target_duration_sec,
        elapsed_sec=elapsed_sec,
        delivery_summary=delivery_summary,
        composure_turn=comp_f,
        ended_by=ended_by,
    )
    return _speaking_report_from_raw(
        raw, turn_idx, source="presage", mock=True, fallback=False
    )
