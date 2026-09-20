# Handoff — MotionToFF / SpeakUp

Use this file when starting a **new chat** or onboarding a teammate. SteelHacks XIII: practice interviews with **composure-aware** feedback (Presage + Nemotron judge/director + Gemini interviewer + ElevenLabs voice).

**Remote:** [github.com/thekevindong/MotionToFF](https://github.com/thekevindong/MotionToFF.git)  
**Integration checklist (done):** [plan.md](plan.md) (Phases 0–8, including thesis) · **Presage:** [docs/presage-step5.md](docs/presage-step5.md)

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
| Presage sidecar `:8100` | **Demo sidecar** — `cd backend && python -m presage_sidecar` or `npm run sidecar`; real SmartSpectra camera still via `presage_smoke/` |
| Deploy | **Not started** — hosted API + static UI + `CORS_EXTRA_ORIGINS` |

**Sessions:** `/start` → **Start session** runs `POST /sessions` (job title + optional `scenario_id` / `character_id`), uploads pending docs, stores `session_id` in `sessionStorage` (`motiontoff_session_id`). Legacy `GET /session` + `POST /turn` use a fixed default session id for quick API tests.

**Keys:** Add to `backend/.env` and restart uvicorn. With sidecar on `:8100`, `auto` composure uses live vitals; without sidecar, Presage key → speech fallback (not fixed `0.72`).

---

## Copy-paste prompt for the next agent

```
You are continuing MotionToFF / SpeakUp. Read handoff.md (runtime truth) and plan.md (integration history).

Stack: FastAPI :8000, Vite frontend :5173 in frontend/. Demo works on zero keys.

Done: SpeakUp UI integrated; SQLite sessions + document upload; /turn orchestration; studio voice loop + expressions; live Presage pane; Results from API; STT/TTS on backend.

Next: wire sidecar to real SmartSpectra SDK (after smoke), production deploy, enable Mock Interview when prompts exist.

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
  thesis.py          Thesis Defense prepare / presentation / Q&A / presage judge
  director.py        Nemotron session control
  nemotron_client.py Shared NIM client
  composure.py       Presage seam → sample_composure(); sidecar probe + vitals proxy
  presage_sidecar/   Optional :8100 demo HTTP (`python -m presage_sidecar`)
  store.py           Shim to legacy default session (prefer repository)
  data/              motiontoff.db + uploads/ (gitignored)
  .env               See .env.example

frontend/            Vite 8 + React 19 (SpeakUp design)
  src/pages/         Home.tsx, Setup.tsx (studio), ThesisLive.tsx, SpeakingLive.tsx, Results.tsx
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
| POST | `/sessions/{id}/turn` | Body `{ "answer" }` → scores, decision, next_question; thesis Q&A may send `qa_time_remaining_sec` / `qa_expired` |
| POST | `/sessions/{id}/thesis/prepare` | Body `{ "thesis_pack": "short" \| "long" }` — validates one `.txt` defense, picks committee character, stores pack timers |
| POST | `/sessions/{id}/thesis/presentation/complete` | Body transcript, timing, `skip_qa` — presentation turn + optional end session |
| POST | `/sessions/{id}/thesis/qa/start` | First committee question after presentation (`next_turn` seam) |
| POST | `/sessions/{id}/interject` | Body `{ "trigger", "snapshot" }` → short in-character line (rate-limited; not a full turn) |
| GET | `/sessions/{id}/report` | Same payload as GET session |
| POST | `/api/stt` | Speech-to-text (ElevenLabs) |
| POST | `/api/tts` | Text-to-speech (ElevenLabs) |
| GET | `/session` | Legacy default session |
| POST | `/turn` | Legacy default session turn |
| GET | `/debug` | Exercise seams; clears/seeds one turn on default session |
| GET | `/sessions/{id}/vitals` | Sidecar proxy — pulse, breathing, composure (browser polls this, not `:8100`) |
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

**Thesis Defense** and **Public Speaking** are selectable on `/start`. **Mock Interview** stays locked (`modes.ts` `ready: false`) until prompts exist.

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

# Terminal 2 (optional — demo vitals for Presage pane + auto composure)
cd backend
python -m presage_sidecar
# or from repo root: npm run sidecar

# Terminal 3
cd frontend
npm install
npm run dev
```

Or from repo root: `npm run dev` (after `npm install` in `frontend/` once).

1. `frontend/.env.example` → `frontend/.env`  
2. `backend/.env.example` → `backend/.env`  
3. http://localhost:5173 → **Enter studio** → pick opponent → **Start session** → **End & get report**

Checks: `GET /health`, `GET /debug/presage`, `npm run build` in `frontend/`.

**After `git pull`:** run `pip install -r requirements.txt` again in `backend/` (new deps include `httpx` for voice routes). If uvicorn fails with `ModuleNotFoundError: No module named 'httpx'`, that reinstall fixes it.

### Smoke checklist (manual)

1. Zero keys: full path; Results transcript from API turns (not static copy).  
2. Mock Interview locked; salary, speaking, and thesis selectable.  
3. **Leave** mid-session stops media tracks.  
4. Refresh on `/results` with same `session_id` reloads report.  
5. `/diag` TTS + mic test.  
6. No CORS errors from `:5173` → `:8000`.  
7. With keys: persona tone, ElevenLabs STT/TTS as expected.  
8. Brand, character posters, expression PNGs return 200 (under `frontend/public/`).  
9. Thesis Defense: one `.txt` → short pack → presentation (optional **Skip Q&A**) → Results shows presentation scores.

### Public Speaking QA matrix (Phase 8)

| Case | Expected behavior |
|------|-------------------|
| No `GEMINI_API_KEY` | `mock_teleprompter` + Presage speaking report (`source: presage`, `mock: true`); full prep → live → results |
| No mic / camera permission | Block **Start session** / **Start speech** with “Microphone and camera access are required to start.” (same as salary) |
| Timer expires with silence | Auto-complete with empty transcript; report `red_flags` includes `empty_delivery` |
| User taps **Finish speech** before timer | `finished_in_time: true` when transcript non-empty; timing notes mention early stop |
| **End session early** | `ended_by: early_exit`, `finished_in_time: false`, `missed_time_budget` on timed modes |
| Refresh on `/start/live` mid-speech | v1 **restart delivery** (no timer resume): teleprompter restored via `GET /sessions/{id}` settings; user taps **Start speech** again |
| Camera off during delivery | Wobble mock samples still drive auditorium reactions; Presage pane shows **degraded · camera off**; report notes degraded heuristics when flagged |

Automated checks: `cd backend && python -m pytest test_speaking_qa.py -q`.

### Thesis Defense QA matrix (Phase 8)

| Case | Expected behavior |
|------|-------------------|
| No `.txt` / empty defense text | `POST .../thesis/prepare` → `thesis_requires_txt` or `thesis_defense_text_empty`; **Start session** blocked until one valid `.txt` is chosen |
| PDF (or non-`.txt`) in thesis prep | UI rejects before upload; API prepare still requires exactly one `.txt` (`thesis_requires_txt` if bypassed) |
| No `GEMINI_API_KEY` | `mock_thesis_questions` + `presage_thesis_judge` report (`source: presage`, `mock: true`); full prep → live → results |
| No mic / camera permission | Block **Start presentation** / Q&A with “Microphone and camera access are required.” (same as salary) |
| **Skip Q&A** after presentation | Report presentation rubric only; `skipped_qa: true`; no Q&A section in Results |
| Presentation timer expires with silence | Empty transcript submitted; report `red_flags` includes `empty_presentation` |
| Q&A timer expires while **listening** | Auto-submit current browser transcript via `POST /turn` with `qa_expired: true`; server sets `qa_ended_by: timer` and closing question |
| Q&A timer expires while **ASKING** | Finish interviewer TTS, then navigate to results (no new turn) |
| Refresh on `/start/live` mid-presentation | v1 **restart presentation**: prep restored from `GET /sessions/{id}`; user taps **Start presentation** again (see `restartNote` in Setup) |
| Committee character | Server picks uniformly from `recruiter` / `manager` / `hr` at prepare; stable if prepare is called again on the same session |

Automated checks: `cd backend && python -m pytest test_thesis_qa.py -q`.

---

## Git / secrets

Never commit `backend/.env`, `frontend/.env`, `backend/data/`, `node_modules/`, `dist/`, `.venv/`, `presage_smoke/.sdk/`.
