"""Presage / fallback composure seam.

Step 5: mock stays the default so /turn stays green. Sidecar + speech fallback
are implemented here for step 7; see docs/presage-step5.md.
"""

from __future__ import annotations

import os
import re
from typing import Any

MOCK_COMPOSURE = 0.72


def sidecar_base_url() -> str:
    explicit = os.getenv("PRESAGE_SIDECAR_BASE", "").strip().rstrip("/")
    if explicit:
        return explicit
    custom = os.getenv("PRESAGE_SIDECAR_URL", "").strip()
    if custom.endswith("/composure"):
        return custom[: -len("/composure")]
    if custom:
        return custom.rstrip("/")
    return "http://127.0.0.1:8100"


def sidecar_composure_url() -> str:
    custom = os.getenv("PRESAGE_SIDECAR_URL", "").strip()
    if custom:
        return custom
    return f"{sidecar_base_url()}/composure"


def sidecar_vitals_url() -> str:
    return f"{sidecar_base_url()}/vitals"


def sidecar_health_url() -> str:
    return f"{sidecar_base_url()}/health"


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


def _fetch_json(url: str, timeout: float = 0.35) -> dict[str, Any]:
    import json
    import urllib.request

    with urllib.request.urlopen(url, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode())
    if not isinstance(payload, dict):
        raise ValueError("sidecar_invalid_json")
    return payload


def probe_sidecar() -> tuple[bool, dict[str, Any] | None, str | None]:
    """GET /composure once — used by debug and session vitals proxy."""
    try:
        raw = _fetch_json(sidecar_composure_url())
        return True, raw, None
    except Exception as exc:
        return False, None, str(exc)


def fetch_sidecar_vitals() -> dict[str, Any]:
    """GET /vitals from sidecar; falls back to composure payload fields."""
    try:
        return _fetch_json(sidecar_vitals_url())
    except Exception:
        reachable, raw, _err = probe_sidecar()
        if not reachable or not raw:
            raise
        pulse = raw.get("pulse")
        breathing = raw.get("breathing", raw.get("breathing_rate"))
        return {
            "pulse": pulse,
            "hr_bpm": pulse,
            "breathing": breathing,
            "breathing_rate": raw.get("breathing_rate", breathing),
            "source": raw.get("source"),
        }


def _fetch_sidecar_composure() -> float:
    reachable, raw, _err = probe_sidecar()
    if not reachable or not raw:
        raise RuntimeError("sidecar_unreachable")
    return to_composure(raw)


def session_vitals_payload(session_id: str) -> dict[str, Any]:
    """CORS-safe vitals for studio UI (browser never calls :8100)."""
    mode = _effective_composure_mode()
    reachable, composure_raw, error = probe_sidecar()
    pulse: float | int | None = None
    breathing: float | int | None = None
    vitals_source: str | None = None

    if reachable:
        try:
            vitals_raw = fetch_sidecar_vitals()
            pulse = vitals_raw.get("pulse") or vitals_raw.get("hr_bpm")
            breathing = vitals_raw.get("breathing") or vitals_raw.get("breathing_rate")
            src = vitals_raw.get("source")
            vitals_source = str(src) if src is not None else None
        except Exception:
            pulse = composure_raw.get("pulse") if composure_raw else None
            breathing = (
                composure_raw.get("breathing") if composure_raw else None
            ) or (composure_raw.get("breathing_rate") if composure_raw else None)

    composure_scalar: float | None = None
    if reachable and composure_raw:
        try:
            composure_scalar = to_composure(composure_raw)
        except ValueError:
            composure_scalar = None

    return {
        "session_id": session_id,
        "composure_mode": mode,
        "sidecar_reachable": reachable,
        "sidecar_error": error,
        "sidecar_base": sidecar_base_url(),
        "pulse": pulse,
        "breathing": breathing,
        "vitals_source": vitals_source,
        "composure_scalar": composure_scalar,
        "composure_raw": composure_raw,
    }


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
    sidecar_reachable, sidecar_raw, sidecar_error = probe_sidecar()

    return {
        "composure_mode": mode,
        "composure_mode_explicit": explicit_mode,
        "presage_key_configured": presage_configured(),
        "spine_uses_mock_by_default": mode == "mock" and not presage_configured(),
        "mock_value": MOCK_COMPOSURE,
        "sample_composure_output": sample_composure(answer),
        "fallback_preview": fallback_composure_from_speech(answer or "Um, I guess I led the migration."),
        "sidecar_url": sidecar_composure_url(),
        "sidecar_base": sidecar_base_url(),
        "sidecar_vitals_url": sidecar_vitals_url(),
        "sidecar_reachable": sidecar_reachable,
        "sidecar_error": sidecar_error,
        "sidecar_latest": sidecar_raw,
        "integration_plan": "sidecar_on_8100_then_auto_mode",
        "smoke_test": "presage_smoke/run_smoke.ps1",
        "sidecar_run": "cd backend && python -m presage_sidecar",
        "docs": "docs/presage-step5.md",
    }
