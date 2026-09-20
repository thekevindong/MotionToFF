import asyncio

import os

from contextlib import asynccontextmanager

from typing import Any



from dotenv import load_dotenv

from fastapi import FastAPI, File, HTTPException, UploadFile

from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel, Field



from composure import composure_seam_status, sample_composure

from director import decide

from documents import extract_text, validate_upload

from interviewer import next_turn

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

    session_exists,

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

        return next_turn([], session_id=session_id)

    return records[-1]["next_question"]





def _session_payload(session_id: str) -> dict[str, Any]:

    row = get_session_row(session_id)

    if not row:

        raise HTTPException(status_code=404, detail="session_not_found")

    return {

        "session_id": session_id,

        "job_title": row.get("job_title"),

        "current_question": _current_question(session_id),

        "turns": get_turns(session_id),

        "documents": list_documents(session_id),

    }





class CreateSessionRequest(BaseModel):

    job_title: str | None = None





class TurnRequest(BaseModel):

    answer: str = Field(..., min_length=1)





@app.post("/sessions")

def post_sessions(body: CreateSessionRequest = CreateSessionRequest()):
    job_title = body.job_title.strip() if body.job_title else None
    session_id = create_session(job_title=job_title or None)
    return {"session_id": session_id, "job_title": job_title}





@app.get("/sessions/{session_id}")

def get_session_by_id(session_id: str):

    return _session_payload(session_id)





@app.get("/sessions/{session_id}/report")

def get_session_report(session_id: str):

    return _session_payload(session_id)





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


