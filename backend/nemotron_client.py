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
# Nemotron / reasoning models may emit a thinking block before JSON.
_THINKING_BLOCK = re.compile(
    r"<think(?:ing)?>[\s\S]*?</think(?:ing)?>",
    re.IGNORECASE,
)


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


def _strip_reasoning_preamble(text: str) -> str:
    stripped = _THINKING_BLOCK.sub("", text).strip()
    fence = _JSON_FENCE.search(stripped)
    if fence:
        return fence.group(1).strip()
    return stripped


def parse_json_object(text: str) -> dict[str, Any]:
    """Parse a JSON object from model output (fences, preamble, or trailing CoT)."""
    stripped = _strip_reasoning_preamble(text)

    decoder = json.JSONDecoder()
    for index, char in enumerate(stripped):
        if char != "{":
            continue
        try:
            obj, _ = decoder.raw_decode(stripped[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            return obj

    raise ValueError("No JSON object found in Nemotron response")


_JSON_RETRY_USER = (
    "Output ONLY one JSON object. First character must be {. "
    "No markdown, no preamble, no chain-of-thought, no analysis."
)


def chat_completion(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int = 1024,
    response_format: dict[str, Any] | None = None,
) -> str:
    api_key = os.getenv("NEMOTRON_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("NEMOTRON_API_KEY is not set")

    url = f"{_api_base()}/chat/completions"
    body: dict[str, Any] = {
        "model": _model(),
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if response_format is not None:
        body["response_format"] = response_format

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


def _json_response_format() -> dict[str, Any] | None:
    """NIM OpenAI-compatible JSON mode; disable with NEMOTRON_JSON_MODE=off."""
    mode = os.getenv("NEMOTRON_JSON_MODE", "json_object").strip().lower()
    if mode in ("off", "false", "0", "none"):
        return None
    if mode == "json_object":
        return {"type": "json_object"}
    raise ValueError(f"Unsupported NEMOTRON_JSON_MODE: {mode}")


def chat_json_object(
    messages: list[dict[str, str]],
    *,
    temperature: float = 0.2,
    max_tokens: int = 1024,
    response_format: dict[str, Any] | None = None,
) -> dict[str, Any]:
    fmt = response_format if response_format is not None else _json_response_format()
    try:
        text = chat_completion(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=fmt,
        )
    except RuntimeError as exc:
        # Some hosted models reject response_format; retry once without it.
        if fmt is not None and "HTTP 400" in str(exc):
            logger.warning("Nemotron rejected response_format, retrying without: %s", exc)
            text = chat_completion(
                messages,
                temperature=temperature,
                max_tokens=max_tokens,
                response_format=None,
            )
        else:
            raise
    try:
        return parse_json_object(text)
    except (json.JSONDecodeError, ValueError) as first_exc:
        logger.warning("Nemotron JSON parse failed: %s; raw=%r", first_exc, text[:500])
        retry_messages = [
            *messages,
            {"role": "user", "content": _JSON_RETRY_USER},
        ]
        try:
            retry_text = chat_completion(
                retry_messages,
                temperature=min(temperature, 0.1),
                max_tokens=max(max_tokens, 1024),
                response_format=fmt,
            )
            return parse_json_object(retry_text)
        except (json.JSONDecodeError, ValueError, RuntimeError) as retry_exc:
            logger.warning("Nemotron JSON retry failed: %s", retry_exc)
            raise RuntimeError(f"Nemotron returned invalid JSON: {first_exc}") from first_exc
