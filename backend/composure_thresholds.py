"""Shared Presage reaction thresholds (mirror frontend composure-thresholds.ts)."""

from __future__ import annotations

INTERJECT_STRESS_HIGH = 0.78
INTERJECT_COMPOSURE_LOW = 0.32
INTERJECT_HR_ELEVATED = 108
INTERJECT_COOLDOWN_MS = 50_000
INTERJECT_MAX_PER_SESSION = 4
INTERJECT_SUSTAINED_SEC = 4

ALLOWED_INTERJECT_TRIGGERS = frozenset(
    {
        "high_stress",
        "composure_low",
        "hr_elevated",
        "pace_fast",
        "low_eye_contact",
    }
)

SETTINGS_INTERJECT_COUNT = "interject_count"
SETTINGS_LAST_INTERJECT_AT_MS = "last_interject_at_ms"
