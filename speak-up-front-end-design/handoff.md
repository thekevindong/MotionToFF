# Handoff — MotionToFF / Practice Interview

Use this file when starting a **new chat** or onboarding a teammate. The repo is a SteelHacks XIII project: practice high-stakes conversations with **composure-aware** AI feedback (Presage webcam + Nemotron judge/director + Gemini interviewer).

**Remote:** [github.com/thekevindong/MotionToFF](https://github.com/thekevindong/MotionToFF.git) (after first push).

---

## Copy-paste prompt for the next agent

```
You are continuing MotionToFF (practice interview app). Read handoff.md and plan.md first.

Stack: FastAPI backend (:8000), Vite+React frontend (:5173). All model roles are separate Python modules with mocks today.

Done: scaffold steps 1–6 (health, mock seams, /turn loop, /diag media test, report page). Step 5 Presage smoke is NOT verified — composure stays mock. Step 7 sidecar not built yet.

Next priorities (user order): git is on MotionToFF → wire API keys (Gemini, Nemotron, ElevenLabs) into interviewer.py / judge.py / director.py without breaking the /turn shape → optional v0/Vercel UI via VITE_API_URL + backend CORS_EXTRA_ORIGINS.

Do not grep node_modules or backend/.venv. Keys live in backend/.env only (never commit).
```

---

## Repository layout

```text
backend/           FastAPI app — single process, in-memory session store
  main.py          Routes, CORS, /turn orchestration (asyncio.gather)
  interviewer.py   GEMINI seam — dialogue only → next_turn(history)
  judge.py         NEMOTRON seam — rubric only → score(answer)
  director.py      NEMOTRON seam — session control → decide(scores, composure, history)
  composure.py     PRESAGE seam → sample_composure(); to_composure(); speech fallback
  store.py         In-process list save/load (later: Tiger Data)
  .env             Secrets (gitignored); see .env.example

frontend/          Vite + React 19, no react-router (pathname switch in main.tsx)
  src/App.tsx      Interview loop: GET /session, POST /turn
  src/Report.tsx   GET /session → composure canvas + rubric list (/report)
  src/Diag.tsx     Mic + webcam + TTS coexistence test (/diag)
  src/speechRecognition.ts  Web Speech API types/helpers
  .env             VITE_API_URL (default http://localhost:8000)

presage_smoke/     Official hello_vitals mirror + run_smoke.ps1 (step 5)
docs/              presage-step5.md — smoke status, sidecar decision

plan.md            Living build checklist + product notes (trimmed)
handoff.md         This file
```

---

## Model-role split (do not blur)

| Role | Module | Speaks? | Today |
|------|--------|---------|--------|
| Interviewer | `interviewer.py` | Yes (questions) | Rotating mock questions |
| Judge | `judge.py` | No | Fixed rubric JSON |
| Director | `director.py` | No | Always `follow_up` mock |
| Composure | `composure.py` | N/A | Default `0.72` mock; sidecar/fallback wired but off |
| Voice (future) | frontend or backend | TTS out | `/diag` uses browser SpeechSynthesis only |

Nemotron must **never** return user-facing dialogue. Gemini must **not** own rubric or director decisions.

---

## HTTP API (backend)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{ "ok": true }` |
| GET | `/session` | `{ current_question, turns }` — turns = full `store.load()` |
| POST | `/turn` | Body `{ "answer": "..." }` → `{ scores, decision, next_question }`; appends store record |
| GET | `/debug` | Runs all mock seams once; **clears and seeds** one turn in store |
| GET | `/debug/presage` | Composure seam status (mock vs sidecar probe) |

### One turn (`POST /turn`) flow

1. Build history from store + current question + new answer.
2. **Parallel:** `score(answer)` and `sample_composure()` (threads via `asyncio.to_thread`).
3. **Director** waits on rubric + composure, then `decide(...)`.
4. **Parallel finish:** scores + director (scores task shared).
5. `next_turn(history)` → save record with `question`, `answer`, `scores`, `composure`, `decision`, `next_question`.
6. Return scores, decision, next_question to client.

Store record shape (for report / future DB):

```json
{
  "turn": 1,
  "question": "...",
  "answer": "...",
  "scores": { "structure", "specificity", "confidence", "evidence", "red_flags", "overall", "mock" },
  "composure": 0.72,
  "decision": { "action", "rationale", "input_snapshot", "mock" },
  "next_question": { "role": "interviewer", "text": "..." }
}
```

---

## Frontend routes

Routing is **pathname-based** in `main.tsx` (Vite SPA — deploy needs rewrite for `/report` and `/diag`).

| URL | Component |
|-----|-----------|
| `/` | `App.tsx` — interview UI |
| `/report` | `Report.tsx` — composure line chart + rubric list |
| `/diag` | `Diag.tsx` — media diagnostic |

Env: `VITE_API_URL` → backend base (see `frontend/.env.example`).

---

## Composure (`composure.py`)

- **`COMPOSURE_MODE`**: `mock` (default) | `auto` | `sidecar` | `fallback` (see module + `docs/presage-step5.md`).
- **`PRESAGE_SIDECAR_URL`**: default `http://127.0.0.1:8100/composure` (step 7 — **not implemented** as a running sidecar yet).
- **`to_composure(raw)`**: maps sidecar JSON → single 0–1 scalar.
- **`fallback_composure_from_speech(answer)`**: filler/latency heuristics when Presage is down.

Browser should **not** call the sidecar; only the backend samples composure during `/turn`.

---

## CORS and external frontend (v0 / Vercel)

Backend allows local Vite origins plus comma-separated **`CORS_EXTRA_ORIGINS`** in `backend/.env` (e.g. `https://your-app.vercel.app`).

External UI sets `VITE_API_URL` (or equivalent) to the deployed API URL.

---

## Run locally

```powershell
# Terminal 1
cd backend
.\.venv\Scripts\Activate.ps1   # or create venv + pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend
npm install
npm run dev
```

Open Vite URL (usually http://localhost:5173). Confirm **backend ok**, submit answers, then http://localhost:5173/report.

Presage smoke (optional, blocked until key + MSVC): `docs/presage-step5.md`.

---

## Scaffold checklist (current)

| Step | Status |
|------|--------|
| 1 Health + CORS | Done |
| 2 Mock seams + `/debug` | Done |
| 3 `/turn` loop + UI | Done |
| 4 `/diag` mic/webcam/TTS | Done |
| 5 Presage smoke | **Postponed** — not verified on this machine |
| 6 `/report` on mock data | Done |
| 7 Presage sidecar `:8100` | **Not started** |
| API keys (Gemini, Nemotron, ElevenLabs) | **Not wired** — mocks only |
| v0/Vercel UI integration | **Not started** — env + CORS only prepared |

---

## Integration guidelines (next work)

1. **Gemini** — replace body of `interviewer.next_turn()` only; keep return type `{"role":"interviewer","text": str}`.
2. **Nemotron judge** — replace `judge.score()`; preserve rubric keys used by director and UI.
3. **Nemotron director** — replace `director.decide()`; `action` ∈ `press_harder | follow_up | move_on | curveball | ease_off`; log `input_snapshot` for eval.
4. **ElevenLabs** — add alongside interviewer output (frontend playback or backend audio URL); keep `/turn` JSON stable initially.
5. **Presage** — finish step 5 smoke, then step 7 sidecar; set `COMPOSURE_MODE=auto` without changing `/turn` contract.
6. **Persistence** — replace `store.py` with Tiger Data when ready; report already consumes `/session`.

---

## Git / secrets

- Never commit `backend/.env`, `node_modules/`, `frontend/dist/`, `backend/.venv/`, `presage_smoke/.sdk/`.
- `.gitignore` already covers these.
