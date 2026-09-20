"""Minimal Presage HTTP sidecar (127.0.0.1:8100).

Serves demo vitals until SmartSpectra hello_vitals is wired in. JSON shapes match
backend/composure.py ``to_composure()`` inputs.
"""

from __future__ import annotations

import math
import os
import time
from typing import Any

from fastapi import FastAPI

app = FastAPI(title="Presage Sidecar", version="0.1.0")

_START = time.time()


def _demo_raw() -> dict[str, Any]:
    """Synthetic cardio / expression for UI and composure mapping (no camera)."""
    t = time.time() - _START
    pulse = 72 + math.sin(t / 4.2) * 8 + math.sin(t / 1.1) * 3
    breathing = 14 + math.sin(t / 5.5) * 2
    stress = 0.22 + (math.sin(t / 6) + 1) * 0.08
    neutral = max(0.0, min(1.0, 1.0 - stress - 0.15))
    return {
        "pulse": round(pulse, 1),
        "breathing": round(breathing, 2),
        "breathing_rate": round(breathing, 2),
        "expression": {
            "neutral": round(neutral, 3),
            "stress": round(stress, 3),
        },
        "confidence": round(0.78 + math.sin(t / 8) * 0.08, 3),
        "talking": False,
        "source": os.getenv("PRESAGE_SIDECAR_SOURCE", "demo"),
    }


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "service": "presage_sidecar", "mode": _demo_raw()["source"]}


@app.get("/composure")
def composure() -> dict[str, Any]:
    return _demo_raw()


@app.get("/vitals")
def vitals() -> dict[str, Any]:
    raw = _demo_raw()
    pulse = raw.get("pulse")
    breathing = raw.get("breathing")
    return {
        "pulse": pulse,
        "hr_bpm": pulse,
        "breathing": breathing,
        "breathing_rate": raw.get("breathing_rate", breathing),
        "source": raw.get("source"),
        "ts": time.time(),
    }
