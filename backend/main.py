import asyncio
import os
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from composure import composure_seam_status, sample_composure
from director import decide
from interviewer import next_turn
from judge import score
from store import clear, load, save

load_dotenv()

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


app = FastAPI(title="Practice Interview API")

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


def _history_from_store() -> History:
    history: History = []
    for record in load():
        history.append({"role": "interviewer", "text": record["question"]})
        history.append({"role": "candidate", "text": record["answer"]})
    return history


def _current_question() -> dict[str, str]:
    records = load()
    if not records:
        return next_turn([])
    return records[-1]["next_question"]


class TurnRequest(BaseModel):
    answer: str = Field(..., min_length=1)


@app.get("/session")
def get_session():
    """Opening question and prior turns for the interview loop."""
    return {
        "current_question": _current_question(),
        "turns": load(),
    }


@app.post("/turn")
async def post_turn(body: TurnRequest):
    """
    One interview turn: judge scoring and director decision run concurrently
    (director waits on rubric + composure); then the interviewer produces the next line.
    """
    answer = body.answer.strip()
    history = _history_from_store()
    question = _current_question()
    turn_history: History = history + [
        {"role": "interviewer", "text": question["text"]},
        {"role": "candidate", "text": answer},
    ]

    score_task = asyncio.create_task(asyncio.to_thread(score, answer))
    composure_task = asyncio.create_task(asyncio.to_thread(sample_composure))

    async def director_task() -> dict[str, Any]:
        rubric, composure_value = await asyncio.gather(score_task, composure_task)
        return await asyncio.to_thread(decide, rubric, composure_value, turn_history)

    scores, decision = await asyncio.gather(score_task, director_task())
    composure = decision["input_snapshot"]["composure"]

    next_question = await asyncio.to_thread(next_turn, turn_history)

    record = {
        "turn": len(load()) + 1,
        "question": question["text"],
        "answer": answer,
        "scores": scores,
        "composure": composure,
        "decision": decision,
        "next_question": next_question,
    }
    save(record)

    return {
        "scores": scores,
        "decision": decision,
        "next_question": next_question,
    }


@app.get("/debug/presage")
def debug_presage():
    """Step 5 — Presage smoke status, sidecar probe, fallback preview (mock still default)."""
    return composure_seam_status()


@app.get("/debug")
def debug_seams():
    """Exercise all mock seams — verify structure before /turn is wired."""
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
    question = next_turn(sample_history)

    clear()
    record = {
        "turn": 1,
        "question": sample_history[0]["text"],
        "answer": sample_answer,
        "scores": rubric,
        "composure": composure_value,
        "decision": decision,
        "next_question": question,
    }
    save(record)
    stored = load()

    return {
        "interviewer_next_turn": question,
        "judge_score": rubric,
        "director_decide": decision,
        "sample_composure": composure_value,
        "store_after_save": stored,
    }
