"""NVIDIA Nemotron (NIM) chat client — shared by judge and director seams."""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_NEMOTRON_MODEL = "nvidia/nemotron-mini-4b-instruct"
DEFAULT_NEMOTRON_API_BASE = "https://integrate.api.nvidia.com/v1"

_JSON_FENCE = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)


def nemotron_configured() -> bool:
    return bool(os.getenv("NEMOTRON_API_KEY", "").strip())


def _api_base() -> str:
    base = os.getenv("NEMOTRON_API_BASE", DEFAULT_NEMOTRON_API_BASE).strip().rstrip("/")
    return base or DEFAULT_NEMOTRON_API_BASE


def _model() -> str:
    model = os.getenv("NEMOTRON_MODEL", DEFAULT_NEMOTRON_MODEL).strip()
    return model or DEFAULT_NEMOTRON_MODEL


def _extract_message_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        raise ValueError("Nemotron returned no choices")
    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return content.strip()
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(str(block.get("text", "")))
        text = "\n".join(p for p in parts if p).strip()
        if text:
            return text
    raise ValueError("Nemotron returned empty content")


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse a JSON object from model output (tolerates markdown fences)."""
    stripped = text.strip()
    fence = _JSON_FENCE.search(stripped)
    if fence:
        stripped = fence.group(1).strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("No JSON object found in Nemotron response")
    return json.loads(stripped[start : end + 1])


def chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int = 1024,
) -> str:
    api_key = os.getenv("NEMOTRON_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("NEMOTRON_API_KEY is not set")

    url = f"{_api_base()}/chat/completions"
    body = {
        "model": _model(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }

    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Nemotron HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Nemotron request failed: {exc.reason}") from exc

    return _extract_message_text(payload)


def chat_json_object(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int = 1024,
) -> dict[str, Any]:
    text = chat_completion(messages, temperature=temperature, max_tokens=max_tokens)
    try:
        return parse_json_object(text)
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Nemotron JSON parse failed: %s; raw=%r", exc, text[:500])
        raise RuntimeError(f"Nemotron returned invalid JSON: {exc}") from exc
