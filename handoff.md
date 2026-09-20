# Handoff — MotionToFF / SpeakUp

Use this file when starting a **new chat** or onboarding a teammate. SteelHacks XIII: practice interviews with **composure-aware** feedback (Presage + Nemotron judge/director + Gemini interviewer + ElevenLabs voice).

**Remote:** [github.com/thekevindong/MotionToFF](https://github.com/thekevindong/MotionToFF.git)  
**Integration checklist (done):** [plan.md](plan.md) · **Presage:** [docs/presage-step5.md](docs/presage-step5.md)

---

## Current state

**Hackathon-ready demo.** Full loop works **without API keys**: `/` → `/start` (studio) → `/results`. Mocks cover interviewer, Nemotron, and backend composure; MediaPipe on the studio page is UX-only (Presage pane).

| Area | Status |
|------|--------|
| UI + spine | **Done** — Vite + React 19 in `frontend/` (port **5173**), FastAPI `:8000`, CORS `5173–5175` (+ legacy `3000`) |
| Persistence | **Done** — SQLite `backend/data/motiontoff.db`, uploads in `backend/data/uploads/` (`repository.py`) |
| Documents + Gemini context | **Done** — PDF/DOCX/TXT via optional **Add context** drawer on `/start`; `build_interviewer_context()` in `interviewer.py` (8k cap) when `GEMINI_API_KEY` set |
| Voice (ElevenLabs) | **Done** — `POST /api/stt` + `POST /api/tts` on **backend**; needs `ELEVENLABS_API_KEY` in `backend/.env` |
| Gemini / Nemotron / Presage seams | **Key-gated** — no key → mock; key → live with mock fallback on failure |
| Personas | **Done** — `scenario_id` + `character_id` in `settings_json`; prompt branches in `interviewer.py` |
| Presage sidecar `:8100` | **Not built** — smoke deferred; with Presage key, `auto` uses speech fallback until sidecar exists |
| Deploy | **Not started** — hosted API + static UI + `CORS_EXTRA_ORIGINS` |

**Sessions:** `/start` → **Start session** runs `POST /sessions` (job title + optional `scenario_id` / `character_id`), uploads pending docs, stores `session_id` in `sessionStorage` (`motiontoff_session_id`). Legacy `GET /session` + `POST /turn` use a fixed default session id for quick API tests.

**Keys:** Add to `backend/.env` and restart uvicorn. Presage camera vitals need the **sidecar** (not built); until then, Presage key → speech-based composure, not fixed `0.72`.

---

## Copy-paste prompt for the next agent

```
You are continuing MotionToFF / SpeakUp. Read handoff.md (runtime truth) and plan.md (integration history).

Stack: FastAPI :8000, Vite frontend :5173 in frontend/. Demo works on zero keys.

Done: SpeakUp UI integrated; SQLite sessions + document upload; /turn orchestration; studio voice loop + expressions; live Presage pane; Results from API; STT/TTS on backend.

Next: Presage sidecar :8100 (optional), production deploy, enable locked scenario modes when prompts exist.

Gemini prompts: backend/interviewer.py only. Do not grep node_modules or .venv. Never commit .env or backend/data/.
```

---

## Repository layout

```text
backend/
  main.py            Routes, CORS, /turn orchestration, session + document APIs, /api/stt, /api/tts
  repository.py      SQLite sessions, turns, documents
  documents.py       PDF/DOCX/TXT text extraction
  interviewer.py     Gemini + build_interviewer_context(session_id); persona from settings_json
  judge.py           Nemotron rubric
  director.py        Nemotron session control
  nemotron_client.py Shared NIM client
  composure.py       Presage seam → sample_composure()
  store.py           Shim to legacy default session (prefer repository)
  data/              motiontoff.db + uploads/ (gitignored)
  .env               See .env.example

frontend/            Vite 8 + React 19 (SpeakUp design)
  src/pages/         Home.tsx, Setup.tsx (studio), Results.tsx
  src/hooks/         use-interview-machine, media, composure, character expression
  src/lib/           api.ts, report-data.ts, session-storage.ts
  src/config/        modes.ts, character-expressions.ts
  src/voice/         stt.ts (backend proxy)
  public/            brand/, characters/, images/{recruiter,manager,hr}/ (runtime expression frames)
  scripts/           normalize-expression-images.ps1 (optional; raw art in assets/expression-source/)
  .env               VITE_API_URL (see .env.example)

presage_smoke/       hello_vitals + run_smoke.ps1
docs/presage-step5.md
plan.md              Frontend integration checklist (Phases 0–6 complete)
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
| Voice | FastAPI `/api/tts`, studio UI | ElevenLabs + `speechSynthesis` fallback |
| STT | FastAPI `/api/stt` | ElevenLabs; no key → visible error in studio |

Nemotron never returns user-facing dialogue. Gemini does not own rubric or director logic.

---

## API keys

| Key | File | Effect |
|-----|------|--------|
| `ELEVENLABS_API_KEY` | `backend/.env` | Live STT/TTS via FastAPI |
| `GEMINI_API_KEY` | `backend/.env` | Live questions + resume-grounded prompts (`GEMINI_MODEL` optional) |
| `NEMOTRON_API_KEY` | `backend/.env` | Live judge + director |
| `PRESAGE_API_KEY` / `SMARTSPECTRA_API_KEY` | `backend/.env` | Auto composure (sidecar → speech) |
| `VITE_API_URL` | `frontend/.env` | Default `http://localhost:8000` |
| `CORS_EXTRA_ORIGINS` | `backend/.env` | Production UI origin(s) |
| `MAX_UPLOAD_BYTES` | `backend/.env` | Optional; default 10 MB |

---

## HTTP API (backend)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | `{ "ok": true }` |
| POST | `/sessions` | Create session; body `{ job_title?, scenario_id?, character_id? }` optional |
| GET | `/sessions/{id}` | `{ session_id, job_title, current_question, turns, documents, settings }` |
| POST | `/sessions/{id}/documents` | Multipart `file` (pdf, docx, txt) |
| POST | `/sessions/{id}/turn` | Body `{ "answer" }` → scores, decision, next_question |
| GET | `/sessions/{id}/report` | Same payload as GET session |
| POST | `/api/stt` | Speech-to-text (ElevenLabs) |
| POST | `/api/tts` | Text-to-speech (ElevenLabs) |
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
| `/` | Marketing landing (Home) |
| `/start` | Studio — scenario, opponent, context drawer, live session |
| `/results` | Post-session report (API-backed) |
| `/diag` | Mic / webcam / TTS debug (separate entry in `main.tsx`) |

**Aliases:** `/setup`, `/interview` → studio; `/report` → results.

Locked scenarios (Mock Interview, Public Speaking, Thesis Defense) stay disabled until backend prompts exist.

---

## Composure

| Signal | Source | Used for |
|--------|--------|----------|
| Presage pane on studio | Browser MediaPipe + optional turn sample | UX |
| Director + `/results` | `sample_composure()` on each turn | Authoritative scalar in DB |

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
npm install
npm run dev
```

Or from repo root: `npm run dev` (after `npm install` in `frontend/` once).

1. `frontend/.env.example` → `frontend/.env`  
2. `backend/.env.example` → `backend/.env`  
3. http://localhost:5173 → **Enter studio** → pick opponent → **Start session** → **End & get report**

Checks: `GET /health`, `GET /debug/presage`, `npm run build` in `frontend/`.

### Smoke checklist (manual)

1. Zero keys: full path; Results transcript from API turns (not static copy).  
2. Locked modes not selectable.  
3. **Leave** mid-session stops media tracks.  
4. Refresh on `/results` with same `session_id` reloads report.  
5. `/diag` TTS + mic test.  
6. No CORS errors from `:5173` → `:8000`.  
7. With keys: persona tone, ElevenLabs STT/TTS as expected.  
8. Brand, character posters, expression PNGs return 200 (under `frontend/public/`).

---

## Git / secrets

Never commit `backend/.env`, `frontend/.env`, `backend/data/`, `node_modules/`, `dist/`, `.venv/`, `presage_smoke/.sdk/`.
