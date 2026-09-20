"""ElevenLabs STT/TTS proxies — keys stay in backend/.env only."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

SCRIBE_MODEL_ID = "scribe_v1"
DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"
TTS_MODEL_ID = "eleven_turbo_v2_5"


def voice_status() -> dict[str, bool]:
    configured = bool(os.environ.get("ELEVENLABS_API_KEY", "").strip())
    return {"stt": configured, "tts": configured}


def _api_key() -> str:
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not key:
        raise HTTPException(
            status_code=500,
            detail="ELEVENLABS_API_KEY is not configured.",
        )
    return key


async def speech_to_text(audio: UploadFile) -> dict[str, Any]:
    api_key = _api_key()
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="Missing `audio` file.")

    filename = audio.filename or "answer.webm"
    files = {"file": (filename, content, audio.content_type or "audio/webm")}
    data = {"model_id": SCRIBE_MODEL_ID}

    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(
            "https://api.elevenlabs.io/v1/speech-to-text",
            headers={"xi-api-key": api_key},
            files=files,
            data=data,
        )

    if res.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={"error": "STT request failed.", "detail": res.text},
        )

    payload = res.json()
    return {
        "transcript": payload.get("text") if isinstance(payload.get("text"), str) else "",
        "languageCode": payload.get("language_code"),
        "words": payload.get("words") if isinstance(payload.get("words"), list) else [],
    }


class TtsRequest(BaseModel):
    text: str = Field(..., min_length=1)
    voiceId: str = DEFAULT_VOICE_ID


async def text_to_speech(body: TtsRequest) -> Response:
    api_key = _api_key()
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Missing `text`.")

    async with httpx.AsyncClient(timeout=120.0) as client:
        res = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{body.voiceId}",
            headers={
                "xi-api-key": api_key,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
            },
            json={
                "text": text,
                "model_id": TTS_MODEL_ID,
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
        )

    if res.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail={"error": "TTS request failed.", "detail": res.text},
        )

    return Response(
        content=res.content,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-store"},
    )
