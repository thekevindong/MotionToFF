"""Presage / fallback composure seam.

Step 5: mock stays the default so /turn stays green. Sidecar + speech fallback
are implemented here for step 7; see docs/presage-step5.md.
"""

from __future__ import annotations

import os
import re
from typing import Any

MOCK_COMPOSURE = 0.72
SIDECAR_URL = os.getenv("PRESAGE_SIDECAR_URL", "http://127.0.0.1:8100/composure")


def presage_configured() -> bool:
    """True when a Presage / SmartSpectra API key is present in the environment."""
    return bool(
        os.getenv("PRESAGE_API_KEY", "").strip()
        or os.getenv("SMARTSPECTRA_API_KEY", "").strip()
    )


def _effective_composure_mode() -> str:
    """
    Explicit COMPOSURE_MODE wins. With Presage keys and no explicit mode, use auto
    (sidecar then speech fallback). Without keys, default mock — same pattern as Gemini.
    """
    explicit = os.getenv("COMPOSURE_MODE", "").strip().lower()
    if explicit:
        return explicit
    if presage_configured():
        return "auto"
    return "mock"

FILLER_PATTERN = re.compile(
    r"\b(um+|uh+|erm|like|you know|sort of|kind of)\b",
    re.IGNORECASE,
)


def to_composure(raw: dict[str, Any]) -> float:
    """Map sidecar JSON (pulse, breathing, expression, confidence) → 0–1."""
    if raw.get("error"):
        raise ValueError(raw["error"])

    confidence = float(raw.get("confidence", 0.5))
    confidence = max(0.0, min(1.0, confidence))

    pulse = raw.get("pulse")
    pulse_score = 0.7
    if isinstance(pulse, (int, float)) and pulse > 0:
        # Calm resting band ~60–85 bpm; very high may indicate stress.
        if pulse < 55:
            pulse_score = 0.55
        elif pulse <= 85:
            pulse_score = 0.85
        elif pulse <= 100:
            pulse_score = 0.65
        else:
            pulse_score = 0.45

    expression = raw.get("expression") or {}
    if isinstance(expression, dict) and expression:
        nums = [float(v) for v in expression.values() if isinstance(v, (int, float))]
        expr_score = sum(nums) / len(nums) if nums else 0.65
        expr_score = max(0.0, min(1.0, expr_score))
    else:
        expr_score = 0.65

    talking = raw.get("talking")
    talk_penalty = 0.05 if talking is True else 0.0

    blended = 0.35 * pulse_score + 0.35 * expr_score + 0.30 * confidence - talk_penalty
    return max(0.0, min(1.0, blended))


def fallback_composure_from_speech(
    answer: str = "",
    *,
    latency_ms: float | None = None,
) -> float:
    """Degrade gracefully when Presage is unavailable (timing + filler heuristics)."""
    text = answer.strip()
    if not text:
        return 0.5

    words = re.findall(r"[a-zA-Z']+", text)
    if not words:
        return 0.5

    filler_hits = len(FILLER_PATTERN.findall(text))
    filler_ratio = filler_hits / max(len(words), 1)
    base = 0.88 - filler_ratio * 3.0

    if latency_ms is not None:
        if latency_ms > 8000:
            base -= 0.12
        elif latency_ms > 4000:
            base -= 0.06
        elif latency_ms < 800:
            base -= 0.04

    if len(words) < 8:
        base -= 0.08

    return max(0.0, min(1.0, base))


def _fetch_sidecar_composure() -> float:
    import urllib.error
    import urllib.request

    with urllib.request.urlopen(SIDECAR_URL, timeout=0.35) as resp:
        import json

        raw = json.loads(resp.read().decode())
    return to_composure(raw)


def sample_composure(answer: str = "") -> float:
    """Return a 0–1 composure scalar for the current turn."""
    mode = _effective_composure_mode()

    if mode == "mock":
        return MOCK_COMPOSURE

    if mode == "fallback":
        return fallback_composure_from_speech(answer)

    if mode == "sidecar":
        try:
            return _fetch_sidecar_composure()
        except Exception:
            return fallback_composure_from_speech(answer)

    if mode == "auto":
        try:
            return _fetch_sidecar_composure()
        except Exception:
            return fallback_composure_from_speech(answer)

    return MOCK_COMPOSURE


def composure_seam_status(answer: str = "") -> dict[str, Any]:
    """Diagnostics for step 5 / presage integration."""
    mode = _effective_composure_mode()
    explicit_mode = os.getenv("COMPOSURE_MODE", "").strip().lower() or None
    sidecar_reachable = False
    sidecar_error: str | None = None
    sidecar_raw: dict[str, Any] | None = None

    try:
        import json
        import urllib.error
        import urllib.request

        with urllib.request.urlopen(SIDECAR_URL, timeout=0.35) as resp:
            sidecar_raw = json.loads(resp.read().decode())
        sidecar_reachable = True
    except Exception as exc:
        sidecar_error = str(exc)

    return {
        "composure_mode": mode,
        "composure_mode_explicit": explicit_mode,
        "presage_key_configured": presage_configured(),
        "spine_uses_mock_by_default": mode == "mock" and not presage_configured(),
        "mock_value": MOCK_COMPOSURE,
        "sample_composure_output": sample_composure(answer),
        "fallback_preview": fallback_composure_from_speech(answer or "Um, I guess I led the migration."),
        "sidecar_url": SIDECAR_URL,
        "sidecar_reachable": sidecar_reachable,
        "sidecar_error": sidecar_error,
        "sidecar_latest": sidecar_raw,
        "integration_plan": "sidecar_on_8100_then_auto_mode",
        "smoke_test": "presage_smoke/run_smoke.ps1",
        "docs": "docs/presage-step5.md",
    }
