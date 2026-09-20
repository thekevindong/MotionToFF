import asyncio

import os

import time

from contextlib import asynccontextmanager

from datetime import datetime, timezone

from typing import Any



from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, File, HTTPException, UploadFile

from voice import speech_to_text, text_to_speech, voice_status, TtsRequest

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field



from composure import composure_seam_status, sample_composure, session_vitals_payload

from director import decide

from documents import extract_text, validate_upload

from composure_thresholds import (
    ALLOWED_INTERJECT_TRIGGERS,
    INTERJECT_COOLDOWN_MS,
    INTERJECT_MAX_PER_SESSION,
    SETTINGS_INTERJECT_COUNT,
    SETTINGS_LAST_INTERJECT_AT_MS,
)
from interviewer import generate_interjection, generate_session_closing, next_turn, opening_question

from judge import (
    SETTINGS_SESSION_REPORT_KEY,
    apply_session_report_to_turns,
    pending_turn_scores,
    presage_session_report,
    schedule_nemotron_session_log,
    score,
    score_session,
)

from repository import (

    add_document,

    append_turn,

    clear_session,

    create_session,

    get_or_create_legacy_session,

    get_session_row,

    get_speech,

    get_turns,

    init_db,

    list_documents,

    list_speeches,

    get_session_settings,

    session_exists,

    set_session_setting,

)

from speaking import build_teleprompter, speech_from_custom_excerpt

from thesis import (
    ALLOWED_THESIS_SESSION_DURATION_SEC,
    ThesisValidationError,
    gemini_handoff_line,
    thesis_prepare,
    thesis_presentation_complete,
    thesis_qa_start,
)



MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))



# Vite falls back to 5174/5175 when 5173 is already taken; 127.0.0.1 is a

# different browser origin from localhost.

VITE_DEV_ORIGINS = [

    "http://localhost:5173",

    "http://localhost:5174",

    "http://localhost:5175",

    "http://127.0.0.1:5173",

    "http://127.0.0.1:5174",

    "http://127.0.0.1:5175",

    "http://localhost:3000",

    "http://127.0.0.1:3000",

]





def _cors_origins() -> list[str]:

    extra = os.environ.get("CORS_EXTRA_ORIGINS", "")

    from_env = [o.strip() for o in extra.split(",") if o.strip()]

    return VITE_DEV_ORIGINS + from_env





@asynccontextmanager

async def lifespan(_app: FastAPI):

    init_db()

    yield





app = FastAPI(title="Practice Interview API", lifespan=lifespan)



app.add_middleware(

    CORSMiddleware,

    allow_origins=_cors_origins(),

    allow_credentials=True,

    allow_methods=["*"],

    allow_headers=["*"],

)





@app.get("/health")

def health():

    return {"ok": True}


@app.get("/speeches")
def get_speeches_catalog():
    return {"speeches": list_speeches()}





@app.get("/health/voice")

def health_voice():

    return voice_status()





@app.post("/api/stt")

async def api_stt(audio: UploadFile = File(...)):

    return await speech_to_text(audio)





@app.post("/api/tts")

async def api_tts(body: TtsRequest):

    return await text_to_speech(body)





History = list[dict[str, str]]





def _history_from_turns(records: list[dict[str, Any]]) -> History:

    history: History = []

    for record in records:

        history.append({"role": "interviewer", "text": record["question"]})

        history.append({"role": "candidate", "text": record["answer"]})

    return history





def _current_question(session_id: str) -> dict[str, str]:

    records = get_turns(session_id)

    if not records:

        return opening_question(session_id)

    return records[-1]["next_question"]





def _session_payload(session_id: str) -> dict[str, Any]:

    row = get_session_row(session_id)

    if not row:

        raise HTTPException(status_code=404, detail="session_not_found")

    settings = get_session_settings(session_id)
    persona_settings = {
        key: settings[key]
        for key in (
            "scenario_id",
            "character_id",
            "session_duration_sec",
            "thesis_pack",
            "presentation_duration_sec",
            "qa_duration_sec",
            "defense_document_id",
            "defense_filename",
            "defense_text_preview",
            "thesis_phase",
            "skipped_qa",
            "speech_id",
            "speech_title",
            "speaker",
            "duration_mode",
            "target_duration_sec",
            "teleprompter_lines",
            "teleprompter_prepared_at",
        )
        if key in settings
    }

    return {

        "session_id": session_id,

        "job_title": row.get("job_title"),

        "settings": persona_settings,

        "current_question": _current_question(session_id),

        "turns": get_turns(session_id),

        "documents": list_documents(session_id),

    }





ALLOWED_SCENARIO_IDS = frozenset({"salary", "interview", "speaking", "thesis"})
ALLOWED_CHARACTER_IDS = frozenset({"recruiter", "manager", "hr"})
ALLOWED_SESSION_DURATION_SEC = frozenset({60, 180, 300, 600, 900})
ALLOWED_SPEAKING_SESSION_DURATION_SEC = frozenset({0, 30, 45})
ALLOWED_SPEAKING_DURATION_MODES = frozenset({"30", "45", "full"})


class CreateSessionRequest(BaseModel):

    job_title: str | None = None

    scenario_id: str | None = None

    character_id: str | None = None

    session_duration_sec: int | None = None


class TurnRequest(BaseModel):

    answer: str = Field(..., min_length=1)
    qa_time_remaining_sec: int | None = None
    qa_expired: bool | None = None


class InterjectRequest(BaseModel):

    trigger: str = Field(..., min_length=1)

    snapshot: dict[str, Any] = Field(default_factory=dict)


class InterjectResponse(BaseModel):

    text: str

    resume: bool = True


class SessionCloseRequest(BaseModel):

    elapsed_sec: int | None = None

    duration_sec: int | None = None


class SessionCloseResponse(BaseModel):

    text: str


class SpeakingPrepareRequest(BaseModel):

    speech_id: str | None = Field(default=None, min_length=1)

    duration_mode: str = Field(..., min_length=1)

    custom_title: str | None = Field(default=None, max_length=200)

    custom_speaker: str | None = Field(default=None, max_length=120)

    custom_excerpt: str | None = Field(default=None, max_length=50000)


class SpeakingPrepareResponse(BaseModel):

    speech_id: str

    speech_title: str

    speaker: str

    duration_mode: str

    target_sec: int

    lines: list[str]

    estimated_sec: int | None = None

    rationale: str | None = None

    source: str | None = None

    teleprompter_prepared_at: str


class SpeakingDeliverySample(BaseModel):
    ts_ms: int
    composure: float
    stress: float
    engagement: float


class SpeakingDeliverySummary(BaseModel):
    avg_composure: float | None = None
    min_composure: float | None = None
    max_stress: float | None = None
    avg_wpm: float | None = None
    filler_count: int | None = None
    presage_degraded: bool | None = None


class SpeakingCompleteRequest(BaseModel):
    transcript: str = ""
    elapsed_sec: int = 0
    finished_in_time: bool = False
    ended_by: str = "user"
    samples: list[SpeakingDeliverySample] = Field(default_factory=list)
    summary: SpeakingDeliverySummary | None = None


class SpeakingCompleteResponse(BaseModel):
    ok: bool = True
    end_session: bool = True


class ThesisPrepareRequest(BaseModel):
    thesis_pack: str


class ThesisPrepareResponse(BaseModel):
    thesis_pack: str
    presentation_duration_sec: int
    qa_duration_sec: int
    character_id: str
    defense_document_id: str
    defense_filename: str
    defense_text_preview: str


class ThesisPresentationCompleteRequest(BaseModel):
    transcript: str = ""
    elapsed_sec: int = 0
    finished_in_time: bool = False
    ended_by: str = "user"
    samples: list[SpeakingDeliverySample] = Field(default_factory=list)
    summary: SpeakingDeliverySummary | None = None
    skip_qa: bool = False


class ThesisPresentationCompleteResponse(BaseModel):
    ok: bool = True
    end_session: bool = False
    skip_qa: bool = False
    committee_character_id: str | None = None
    qa_duration_sec: int | None = None
    handoff_line: str | None = None


class ThesisQaStartResponse(BaseModel):
    question: dict[str, Any]
    end_session: bool = False


def _raise_thesis_validation(exc: ThesisValidationError) -> None:
    raise HTTPException(status_code=400, detail=exc.code) from exc


@app.post("/sessions")

def post_sessions(body: CreateSessionRequest = CreateSessionRequest()):
    job_title = body.job_title.strip() if body.job_title else None
    scenario_id = body.scenario_id.strip() if body.scenario_id else None
    character_id = body.character_id.strip() if body.character_id else None

    if scenario_id and scenario_id not in ALLOWED_SCENARIO_IDS:
        raise HTTPException(status_code=400, detail="invalid_scenario_id")
    if character_id and character_id not in ALLOWED_CHARACTER_IDS:
        raise HTTPException(status_code=400, detail="invalid_character_id")

    duration_sec = body.session_duration_sec
    if duration_sec is not None:
        if scenario_id == "speaking":
            allowed = ALLOWED_SPEAKING_SESSION_DURATION_SEC
        elif scenario_id == "thesis":
            allowed = ALLOWED_THESIS_SESSION_DURATION_SEC
        else:
            allowed = ALLOWED_SESSION_DURATION_SEC
        if duration_sec not in allowed:
            raise HTTPException(status_code=400, detail="invalid_session_duration")

    settings: dict[str, Any] = {}
    if scenario_id:
        settings["scenario_id"] = scenario_id
    if character_id:
        settings["character_id"] = character_id
    if duration_sec is not None:
        settings["session_duration_sec"] = duration_sec

    session_id = create_session(job_title=job_title or None, settings=settings if settings else None)
    return {
        "session_id": session_id,
        "job_title": job_title,
        "settings": settings,
    }





@app.get("/sessions/{session_id}")

def get_session_by_id(session_id: str):

    return _session_payload(session_id)


@app.post("/sessions/{session_id}/speaking/prepare")
def post_speaking_prepare(session_id: str, body: SpeakingPrepareRequest):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")

    settings = get_session_settings(session_id)
    scenario_id = settings.get("scenario_id")
    if scenario_id != "speaking":
        raise HTTPException(status_code=400, detail="not_speaking_session")

    duration_mode = body.duration_mode.strip()
    if duration_mode not in ALLOWED_SPEAKING_DURATION_MODES:
        raise HTTPException(status_code=400, detail="invalid_duration_mode")

    custom_excerpt = (body.custom_excerpt or "").strip()
    if custom_excerpt:
        try:
            speech = speech_from_custom_excerpt(
                custom_excerpt,
                title=body.custom_title,
                speaker=body.custom_speaker,
            )
        except ValueError:
            raise HTTPException(status_code=400, detail="custom_excerpt_too_short") from None
    else:
        speech_id = (body.speech_id or "").strip()
        if not speech_id:
            raise HTTPException(status_code=400, detail="speech_id_required")
        speech = get_speech(speech_id)
        if not speech:
            raise HTTPException(status_code=404, detail="speech_not_found")

    teleprompter = build_teleprompter(speech, duration_mode)
    prepared_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    target_sec = int(teleprompter.get("target_sec") or 0)
    lines = teleprompter.get("lines")
    if not isinstance(lines, list):
        lines = []

    set_session_setting(session_id, "speech_id", speech["id"])
    set_session_setting(session_id, "speech_title", speech["title"])
    set_session_setting(session_id, "speaker", speech["speaker"])
    set_session_setting(session_id, "duration_mode", duration_mode)
    set_session_setting(session_id, "target_duration_sec", target_sec)
    set_session_setting(session_id, "teleprompter_lines", lines)
    set_session_setting(session_id, "teleprompter_prepared_at", prepared_at)

    return SpeakingPrepareResponse(
        speech_id=speech["id"],
        speech_title=speech["title"],
        speaker=speech["speaker"],
        duration_mode=duration_mode,
        target_sec=target_sec,
        lines=[str(ln) for ln in lines],
        estimated_sec=teleprompter.get("estimated_sec"),
        rationale=teleprompter.get("rationale"),
        source=teleprompter.get("source"),
        teleprompter_prepared_at=prepared_at,
    )


@app.post("/sessions/{session_id}/speaking/complete", response_model=SpeakingCompleteResponse)
async def post_speaking_complete(session_id: str, body: SpeakingCompleteRequest):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")

    settings = get_session_settings(session_id)
    if settings.get("scenario_id") != "speaking":
        raise HTTPException(status_code=400, detail="not_speaking_session")

    lines = settings.get("teleprompter_lines")
    if not isinstance(lines, list):
        lines = []
    teleprompter_text = "\n".join(str(ln) for ln in lines)

    transcript = body.transcript.strip()
    summary = body.summary.model_dump() if body.summary else {}
    avg_composure = summary.get("avg_composure")
    if isinstance(avg_composure, (int, float)):
        composure_value = float(avg_composure)
    else:
        composure_value = await asyncio.to_thread(sample_composure, transcript or " ")

    records = get_turns(session_id)
    scores = pending_turn_scores(composure_value)
    decision = {
        "action": "speaking_complete",
        "rationale": "Public speaking delivery recorded.",
        "input_snapshot": {"composure": composure_value, "ended_by": body.ended_by},
        "mock": True,
    }
    next_question = {"role": "interviewer", "text": "", "end_session": True}

    record = {
        "turn": len(records) + 1,
        "question": teleprompter_text,
        "answer": transcript,
        "scores": scores,
        "composure": composure_value,
        "decision": decision,
        "next_question": next_question,
    }

    delivery_stats = {
        "summary": summary,
        "samples": [s.model_dump() for s in body.samples[:120]],
        "elapsed_sec": body.elapsed_sec,
        "ended_by": body.ended_by,
    }
    set_session_setting(session_id, "delivery_stats", delivery_stats)
    set_session_setting(session_id, "finished_in_time", body.finished_in_time)
    duration_mode = settings.get("duration_mode")
    if isinstance(duration_mode, str) and duration_mode.strip():
        set_session_setting(session_id, "duration_mode", duration_mode.strip())
    set_session_setting(session_id, SETTINGS_SESSION_REPORT_KEY, None)
    append_turn(session_id, record)

    return SpeakingCompleteResponse(ok=True, end_session=True)


@app.post("/sessions/{session_id}/thesis/prepare", response_model=ThesisPrepareResponse)
def post_thesis_prepare(session_id: str, body: ThesisPrepareRequest):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")

    settings = get_session_settings(session_id)
    if settings.get("scenario_id") != "thesis":
        raise HTTPException(status_code=400, detail="not_thesis_session")

    try:
        payload = thesis_prepare(session_id, body.thesis_pack)
    except ThesisValidationError as exc:
        _raise_thesis_validation(exc)

    return ThesisPrepareResponse(**payload)


@app.post(
    "/sessions/{session_id}/thesis/presentation/complete",
    response_model=ThesisPresentationCompleteResponse,
)
async def post_thesis_presentation_complete(
    session_id: str, body: ThesisPresentationCompleteRequest
):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")

    settings = get_session_settings(session_id)
    if settings.get("scenario_id") != "thesis":
        raise HTTPException(status_code=400, detail="not_thesis_session")

    transcript = body.transcript.strip()
    summary = body.summary.model_dump() if body.summary else {}
    avg_composure = summary.get("avg_composure")
    if isinstance(avg_composure, (int, float)):
        composure_value = float(avg_composure)
    else:
        composure_value = await asyncio.to_thread(sample_composure, transcript or " ")

    scores = pending_turn_scores(composure_value)
    try:
        result = thesis_presentation_complete(
            session_id,
            transcript=transcript,
            elapsed_sec=body.elapsed_sec,
            finished_in_time=body.finished_in_time,
            ended_by=body.ended_by,
            samples=[s.model_dump() for s in body.samples],
            summary=summary,
            composure_value=composure_value,
            skip_qa=body.skip_qa,
            scores=scores,
        )
    except ThesisValidationError as exc:
        _raise_thesis_validation(exc)

    if not result.get("skip_qa") and not result.get("end_session"):
        handoff = await asyncio.to_thread(gemini_handoff_line, session_id, transcript)
        result = {**result, "handoff_line": handoff}

    return ThesisPresentationCompleteResponse(**result)


@app.post("/sessions/{session_id}/thesis/qa/start", response_model=ThesisQaStartResponse)
def post_thesis_qa_start(session_id: str):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")
    settings = get_session_settings(session_id)
    if settings.get("scenario_id") != "thesis":
        raise HTTPException(status_code=400, detail="not_thesis_session")
    try:
        payload = thesis_qa_start(session_id)
    except ThesisValidationError as exc:
        _raise_thesis_validation(exc)
    return ThesisQaStartResponse(**payload)


def _report_cache_valid(cached: dict[str, Any], turn_count: int) -> bool:
    if not isinstance(cached.get("rubric"), dict):
        return False
    if turn_count == 0:
        return True
    per_turn = cached.get("per_turn")
    if not isinstance(per_turn, list):
        return False
    if len(per_turn) >= turn_count:
        return True
    if cached.get("mock") or cached.get("fallback"):
        return len(per_turn) >= turn_count
    return False


def _get_or_build_session_report(session_id: str) -> dict[str, Any]:
    settings = get_session_settings(session_id)
    turn_count = len(get_turns(session_id))
    cached = settings.get(SETTINGS_SESSION_REPORT_KEY)
    if isinstance(cached, dict) and cached.get("rubric") and _report_cache_valid(cached, turn_count):
        return cached
    report = score_session(session_id)
    if not _report_cache_valid(report, turn_count) and turn_count > 0:
        if settings.get("scenario_id") == "speaking":
            from speaking import score_speaking_session

            report = score_speaking_session(session_id)
            report = {**report, "fallback": True, "source": "presage_fallback"}
        elif settings.get("scenario_id") == "thesis":
            from thesis import score_thesis_session

            report = score_thesis_session(session_id)
            report = {**report, "fallback": True, "source": "presage_fallback"}
        else:
            report = presage_session_report(get_turns(session_id), fallback=True)
    set_session_setting(session_id, SETTINGS_SESSION_REPORT_KEY, report)
    return report


@app.get("/sessions/{session_id}/report")
def get_session_report(session_id: str):
    payload = _session_payload(session_id)
    report = _get_or_build_session_report(session_id)
    payload["session_report"] = report
    payload["turns"] = apply_session_report_to_turns(payload["turns"], report)
    schedule_nemotron_session_log(session_id)
    return payload


@app.get("/sessions/{session_id}/vitals")
def get_session_vitals(session_id: str):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")
    return session_vitals_payload(session_id)





@app.post("/sessions/{session_id}/documents")

async def post_session_document(session_id: str, file: UploadFile = File(...)):

    if not session_exists(session_id):

        raise HTTPException(status_code=404, detail="session_not_found")



    filename = (file.filename or "upload").strip()

    content = await file.read()

    mime = file.content_type or ""



    try:

        validate_upload(filename, mime or None, len(content), MAX_UPLOAD_BYTES)

        text = extract_text(filename, content, mime or None)

    except ValueError as exc:

        code = str(exc)

        status = 413 if code == "file_too_large" else 400

        raise HTTPException(status_code=status, detail=code) from exc



    meta = add_document(session_id, filename, mime or "application/octet-stream", content, text)

    return meta





async def _execute_turn(session_id: str, body: TurnRequest) -> dict[str, Any]:

    if not session_exists(session_id):

        raise HTTPException(status_code=404, detail="session_not_found")



    answer = body.answer.strip()

    records = get_turns(session_id)

    history = _history_from_turns(records)

    question = _current_question(session_id)

    turn_history: History = history + [

        {"role": "interviewer", "text": question["text"]},

        {"role": "candidate", "text": answer},

    ]



    composure_value = await asyncio.to_thread(sample_composure, answer)
    decision = decide(composure_value, turn_history)
    settings = get_session_settings(session_id)
    qa_time_up = bool(body.qa_expired) or (
        body.qa_time_remaining_sec is not None and body.qa_time_remaining_sec <= 0
    )
    if settings.get("scenario_id") == "thesis" and qa_time_up:
        closing = generate_session_closing(
            session_id,
            elapsed_sec=body.qa_time_remaining_sec,
            duration_sec=settings.get("qa_duration_sec"),
        )
        closing_text = str(closing.get("text", "")).strip() or (
            "Thank you — that concludes our questions. You can review your report when you're ready."
        )
        next_question = {
            "role": "interviewer",
            "text": closing_text,
            "end_session": True,
        }
        set_session_setting(session_id, "qa_ended_by", "timer")
    else:
        next_question = await asyncio.to_thread(
            next_turn,
            turn_history,
            session_id,
            delivery_context={
                "composure": composure_value,
                "director_action": decision.get("action"),
                "director_rationale": decision.get("rationale"),
            },
        )
    composure = composure_value
    scores = pending_turn_scores(composure_value)



    record = {

        "turn": len(records) + 1,

        "question": question["text"],

        "answer": answer,

        "scores": scores,

        "composure": composure,

        "decision": decision,

        "next_question": next_question,

    }

    set_session_setting(session_id, SETTINGS_SESSION_REPORT_KEY, None)

    append_turn(session_id, record)



    return {

        "scores": scores,

        "decision": decision,

        "next_question": next_question,

        "end_session": bool(next_question.get("end_session")),

    }





@app.post("/sessions/{session_id}/turn")

async def post_session_turn(session_id: str, body: TurnRequest):

    return await _execute_turn(session_id, body)


@app.post("/sessions/{session_id}/interject", response_model=InterjectResponse)
def post_session_interject(session_id: str, body: InterjectRequest):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")

    trigger = body.trigger.strip()
    if trigger not in ALLOWED_INTERJECT_TRIGGERS:
        raise HTTPException(status_code=400, detail="invalid_trigger")

    settings = get_session_settings(session_id)
    count_raw = settings.get(SETTINGS_INTERJECT_COUNT, 0)
    try:
        interject_count = int(count_raw)
    except (TypeError, ValueError):
        interject_count = 0

    if interject_count >= INTERJECT_MAX_PER_SESSION:
        raise HTTPException(status_code=429, detail="interject_limit_reached")

    last_raw = settings.get(SETTINGS_LAST_INTERJECT_AT_MS)
    try:
        last_ms = int(last_raw)
    except (TypeError, ValueError):
        last_ms = 0

    now_ms = int(time.time() * 1000)
    if last_ms and now_ms - last_ms < INTERJECT_COOLDOWN_MS:
        raise HTTPException(status_code=429, detail="interject_cooldown")

    result = generate_interjection(session_id, trigger, body.snapshot)
    set_session_setting(session_id, SETTINGS_INTERJECT_COUNT, interject_count + 1)
    set_session_setting(session_id, SETTINGS_LAST_INTERJECT_AT_MS, now_ms)

    return InterjectResponse(text=result["text"], resume=bool(result.get("resume", True)))


@app.post("/sessions/{session_id}/close", response_model=SessionCloseResponse)
def post_session_close(session_id: str, body: SessionCloseRequest = SessionCloseRequest()):
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="session_not_found")

    settings = get_session_settings(session_id)
    cached = settings.get("session_closing_text")
    if isinstance(cached, str) and cached.strip():
        return SessionCloseResponse(text=cached.strip())

    result = generate_session_closing(
        session_id,
        elapsed_sec=body.elapsed_sec,
        duration_sec=body.duration_sec,
    )
    text = str(result.get("text", "")).strip() or "Thanks for your time today — we'll wrap up here."
    set_session_setting(session_id, "session_closing_text", text)
    return SessionCloseResponse(text=text)





@app.get("/session")

def get_session_legacy():

    """Legacy default session — prefer GET /sessions/{id}."""

    session_id = get_or_create_legacy_session()

    return _session_payload(session_id)





@app.post("/turn")

async def post_turn_legacy(body: TurnRequest):

    session_id = get_or_create_legacy_session()

    return await _execute_turn(session_id, body)





@app.get("/debug/presage")

def debug_presage():

    """Step 5 — Presage smoke status, sidecar probe, fallback preview (mock still default)."""

    return composure_seam_status()





@app.get("/debug")

def debug_seams():

    """Exercise all mock seams — verify structure before /turn is wired."""

    session_id = get_or_create_legacy_session()

    clear_session(session_id)



    sample_history = [

        {

            "role": "interviewer",

            "text": "Tell me about a project you're proud of.",

        },

        {

            "role": "candidate",

            "text": "I led a migration that cut deploy time in half.",

        },

    ]

    sample_answer = sample_history[-1]["text"]



    composure_value = sample_composure()

    decision = decide(composure_value, sample_history)

    rubric = score(sample_answer)

    question = next_turn(sample_history, session_id=session_id)



    record = {

        "turn": 1,

        "question": sample_history[0]["text"],

        "answer": sample_answer,

        "scores": rubric,

        "composure": composure_value,

        "decision": decision,

        "next_question": question,

    }

    append_turn(session_id, record)

    stored = get_turns(session_id)



    return {

        "interviewer_next_turn": question,

        "judge_score": rubric,

        "director_decide": decision,

        "sample_composure": composure_value,

        "store_after_save": stored,

    }


