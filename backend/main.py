import asyncio

import os

import time

from contextlib import asynccontextmanager

from typing import Any



from dotenv import load_dotenv

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
from interviewer import generate_interjection, next_turn, opening_question

from judge import score

from repository import (

    add_document,

    append_turn,

    clear_session,

    create_session,

    get_or_create_legacy_session,

    get_session_row,

    get_turns,

    init_db,

    list_documents,

    get_session_settings,

    session_exists,

    set_session_setting,

)



load_dotenv()



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
        for key in ("scenario_id", "character_id")
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


class CreateSessionRequest(BaseModel):

    job_title: str | None = None

    scenario_id: str | None = None

    character_id: str | None = None





class TurnRequest(BaseModel):

    answer: str = Field(..., min_length=1)


class InterjectRequest(BaseModel):

    trigger: str = Field(..., min_length=1)

    snapshot: dict[str, Any] = Field(default_factory=dict)


class InterjectResponse(BaseModel):

    text: str

    resume: bool = True





@app.post("/sessions")

def post_sessions(body: CreateSessionRequest = CreateSessionRequest()):
    job_title = body.job_title.strip() if body.job_title else None
    scenario_id = body.scenario_id.strip() if body.scenario_id else None
    character_id = body.character_id.strip() if body.character_id else None

    if scenario_id and scenario_id not in ALLOWED_SCENARIO_IDS:
        raise HTTPException(status_code=400, detail="invalid_scenario_id")
    if character_id and character_id not in ALLOWED_CHARACTER_IDS:
        raise HTTPException(status_code=400, detail="invalid_character_id")

    settings: dict[str, str] = {}
    if scenario_id:
        settings["scenario_id"] = scenario_id
    if character_id:
        settings["character_id"] = character_id

    session_id = create_session(job_title=job_title or None, settings=settings if settings else None)
    return {
        "session_id": session_id,
        "job_title": job_title,
        "settings": settings,
    }





@app.get("/sessions/{session_id}")

def get_session_by_id(session_id: str):

    return _session_payload(session_id)





@app.get("/sessions/{session_id}/report")

def get_session_report(session_id: str):

    return _session_payload(session_id)


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





async def _execute_turn(session_id: str, answer: str) -> dict[str, Any]:

    if not session_exists(session_id):

        raise HTTPException(status_code=404, detail="session_not_found")



    answer = answer.strip()

    records = get_turns(session_id)

    history = _history_from_turns(records)

    question = _current_question(session_id)

    turn_history: History = history + [

        {"role": "interviewer", "text": question["text"]},

        {"role": "candidate", "text": answer},

    ]



    score_task = asyncio.create_task(asyncio.to_thread(score, answer))

    composure_task = asyncio.create_task(asyncio.to_thread(sample_composure, answer))



    async def director_task() -> dict[str, Any]:

        rubric, composure_value = await asyncio.gather(score_task, composure_task)

        return await asyncio.to_thread(decide, rubric, composure_value, turn_history)



    scores, decision = await asyncio.gather(score_task, director_task())

    composure = decision["input_snapshot"]["composure"]



    next_question = await asyncio.to_thread(next_turn, turn_history, session_id)



    record = {

        "turn": len(records) + 1,

        "question": question["text"],

        "answer": answer,

        "scores": scores,

        "composure": composure,

        "decision": decision,

        "next_question": next_question,

    }

    append_turn(session_id, record)



    return {

        "scores": scores,

        "decision": decision,

        "next_question": next_question,

    }





@app.post("/sessions/{session_id}/turn")

async def post_session_turn(session_id: str, body: TurnRequest):

    return await _execute_turn(session_id, body.answer)


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





@app.get("/session")

def get_session_legacy():

    """Legacy default session — prefer GET /sessions/{id}."""

    session_id = get_or_create_legacy_session()

    return _session_payload(session_id)





@app.post("/turn")

async def post_turn_legacy(body: TurnRequest):

    session_id = get_or_create_legacy_session()

    return await _execute_turn(session_id, body.answer)





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



    rubric = score(sample_answer)

    composure_value = sample_composure()

    decision = decide(rubric, composure_value, sample_history)

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


