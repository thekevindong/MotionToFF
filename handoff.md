# Handoff — MotionToFF / Practice Interview

Use this file when starting a **new chat** or onboarding a teammate. SteelHacks XIII: practice interviews with **composure-aware** feedback (Presage + Nemotron judge/director + Gemini interviewer + ElevenLabs voice).

**Remote:** [github.com/thekevindong/MotionToFF](https://github.com/thekevindong/MotionToFF.git)  
**Remaining work:** [plan.md](plan.md) · **Presage:** [docs/presage-step5.md](docs/presage-step5.md)

---

## Current state

**Hackathon-ready demo.** Full loop works **without API keys**: `/` → `/setup` (optional) → `/interview` → `/report`. Mocks cover interviewer, Nemotron, and backend composure; MediaPipe on `/interview` is UX-only.

| Area | Status |
|------|--------|
| UI + spine | **Done** — Next.js `frontend/`, FastAPI `:8000`, CORS `:3000` |
| Persistence | **Done** — SQLite `backend/data/motiontoff.db`, uploads in `backend/data/uploads/` (`repository.py`) |
| Documents + Gemini context | **Done** — PDF/DOCX/TXT upload; `build_interviewer_context()` in `interviewer.py` (8k cap) when `GEMINI_API_KEY` set |
| Voice (ElevenLabs) | **Done** — `/api/stt` + `/api/tts`; needs `ELEVENLABS_API_KEY` in `frontend/.env.local` |
| Gemini / Nemotron / Presage seams | **Key-gated** — no key → mock; key → live with mock fallback on failure |
| Presage sidecar `:8100` | **Not built** — smoke deferred; with Presage key, `auto` uses speech fallback until sidecar exists |
| Deploy | **Not started** — hosted API + Vercel + `CORS_EXTRA_ORIGINS` |

**Sessions:** Prefer `/setup` → creates `POST /sessions`, uploads docs, stores `session_id` in `sessionStorage` (`motiontoff_session_id`). Legacy `GET /session` + `POST /turn` use a fixed default session id for quick skips.

**Keys:** Add to env and restart the relevant process. Presage camera vitals need the **sidecar** (not built); until then, Presage key → speech-based composure, not fixed `0.72`.

---

## Copy-paste prompt for the next agent

```
You are continuing MotionToFF. Read handoff.md (runtime truth) and plan.md (what's left).

Stack: FastAPI :8000, Next.js :3000 in frontend/. Demo works on zero keys.

Done: SQLite sessions + document upload + /setup; /turn orchestration; /interview + /report; env-gated Gemini, Nemotron, Presage composure; ElevenLabs proxy.

Next: Presage sidecar :8100 (optional), Phase 6 deploy, optional eval polish (plan.md).

Gemini prompts: backend/interviewer.py only. Do not grep node_modules or .venv. Never commit .env or backend/data/.
```

---

## Repository layout

```text
backend/
  main.py            Routes, CORS, /turn orchestration, session + document APIs
  repository.py      SQLite sessions, turns, documents
  documents.py       PDF/DOCX/TXT text extraction
  interviewer.py     Gemini + build_interviewer_context(session_id)
  judge.py           Nemotron rubric
  director.py        Nemotron session control
  nemotron_client.py Shared NIM client
  composure.py       Presage seam → sample_composure()
  store.py           Shim to legacy default session (prefer repository)
  data/              motiontoff.db + uploads/ (gitignored)
  .env               See .env.example

frontend/
  app/setup/         Job title + resume upload → session_id
  app/interview/     Voice loop, MediaPipe, scoped session API
  app/report/        Composure chart + rubrics
  app/api/stt|tts    ElevenLabs proxy
  lib/api.ts         createSession, uploadDocument, getSession, postTurn
  lib/session-storage.ts  sessionStorage key for session_id

presage_smoke/       hello_vitals + run_smoke.ps1
docs/presage-step5.md
plan.md              Short backlog only
handoff.md           This file
```

---

## Model roles (do not blur)

| Role | Module | Speaks? |
|------|--------|---------|
| Interviewer | `interviewer.py` | Yes — Gemini if keyed; else mock rotation |
| Judge | `judge.py` | No — Nemotron rubric only |
| Director | `director.py` | No — Nemotron decisions only |
| Composure | `composure.py` | N/A — mock `0.72` without Presage key; else auto path |
| Voice | `app/api/tts`, interview UI | ElevenLabs + `speechSynthesis` fallback |
| STT | `app/api/stt` | ElevenLabs; no key → visible error on interview |

Nemotron never returns user-facing dialogue. Gemini does not own rubric or director logic.

---

## API keys

| Key | File | Effect |
|-----|------|--------|
| `ELEVENLABS_API_KEY` | `frontend/.env.local` | Live STT/TTS |
| `GEMINI_API_KEY` | `backend/.env` | Live questions + resume-grounded prompts (`GEMINI_MODEL` optional) |
| `NEMOTRON_API_KEY` | `backend/.env` | Live judge + director |
| `PRESAGE_API_KEY` / `SMARTSPECTRA_API_KEY` | `backend/.env` | Auto composure (sidecar → speech) |
| `NEXT_PUBLIC_API_URL` | `frontend/.env.local` | Default `http://localhost:8000` |
| `CORS_EXTRA_ORIGINS` | `backend/.env` | Production UI origin(s) |
| `MAX_UPLOAD_BYTES` | `backend/.env` | Optional; default 10 MB |

---

## HTTP API (backend)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{ "ok": true }` |
| POST | `/sessions` | Create session; body `{ "job_title": "..." }` optional |
| GET | `/sessions/{id}` | `{ session_id, job_title, current_question, turns, documents }` |
| POST | `/sessions/{id}/documents` | Multipart `file` (pdf, docx, txt) |
| POST | `/sessions/{id}/turn` | Body `{ "answer" }` → scores, decision, next_question |
| GET | `/sessions/{id}/report` | Same payload as GET session |
| GET | `/session` | Legacy default session |
| POST | `/turn` | Legacy default session turn |
| GET | `/debug` | Exercise seams; clears/seeds one turn on default session |
| GET | `/debug/presage` | Composure seam + sidecar probe |

### One turn

1. History from stored turns + current question + new answer.  
2. **Parallel:** `score(answer)`, `sample_composure(answer)`.  
3. **Director:** `decide(rubric, composure, history)`.  
4. `next_turn(history, session_id)` → append turn in SQLite.  
5. Return `scores`, `decision`, `next_question`.

Turn record fields: `turn`, `question`, `answer`, `scores`, `composure`, `decision`, `next_question`.

---

## Frontend routes

| URL | Purpose |
|-----|---------|
| `/` | Landing |
| `/setup` | Role + document upload; sets `session_id` |
| `/interview` | Voice interview (uses stored `session_id` if set) |
| `/report` | Session report for stored `session_id` or legacy session |

---

## Composure

| Signal | Source | Used for |
|--------|--------|----------|
| Signal panel / badge on `/interview` | Browser MediaPipe | UX only |
| Director + `/report` | `sample_composure()` on each turn | Authoritative scalar in DB |

`COMPOSURE_MODE`: `mock` \| `auto` \| `sidecar` \| `fallback` — see `composure.py`. Browser does not call the sidecar.

---

## Run locally

```powershell
# Terminal 1
cd backend
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend
pnpm install
pnpm dev
```

1. `frontend/.env.example` → `.env.local`  
2. `backend/.env.example` → `.env`  
3. http://localhost:3000 → **Start a mock interview** → setup (optional) → interview → report  

Checks: `GET /health`, `GET /debug/presage`.

---

## Git / secrets

Never commit `backend/.env`, `frontend/.env.local`, `backend/data/`, `node_modules/`, `.next/`, `.venv/`, `presage_smoke/.sdk/`.
