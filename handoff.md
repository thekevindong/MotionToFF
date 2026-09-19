# Handoff — MotionToFF / Practice Interview

Use this file when starting a **new chat** or onboarding a teammate. The repo is a SteelHacks XIII project: practice high-stakes conversations with **composure-aware** AI feedback (Presage webcam + Nemotron judge/director + Gemini interviewer).

**Remote:** [github.com/thekevindong/MotionToFF](https://github.com/thekevindong/MotionToFF.git)

**Merge status:** Phases 1–3 done — one Next.js `frontend/`, interview + report wired to FastAPI. See [plan.md](plan.md) for Phase 4+ (keys, Presage, deploy).

---

## Copy-paste prompt for the next agent

```
You are continuing MotionToFF (practice interview app). Read handoff.md and plan.md first.

Stack: FastAPI backend (:8000), Next.js frontend (:3000) in frontend/. Model seams in backend/ are mocks unless keys are set.

Done: health + /turn spine; Next /interview → GET /session + POST /turn; /report; lib/api.ts + lib/api-types.ts; CORS :3000; ElevenLabs routes /api/stt + /api/tts (need ELEVENLABS_API_KEY in frontend/.env.local). Presage smoke (step 5) not verified; sidecar (step 7) not built.

Next: plan.md Phase 4 — wire Gemini, Nemotron (backend/.env), confirm ElevenLabs; then Presage + deploy.

Do not grep frontend/node_modules or backend/.venv. Never commit .env files. Old Vite /diag page was not ported — use /interview for media; recover Diag from git only if debugging.
```

---

## Repository layout

```text
backend/           FastAPI app — single process, in-memory session store
  main.py          Routes, CORS (incl. :3000), /turn orchestration
  interviewer.py   GEMINI seam — dialogue only → next_turn(history)
  judge.py         NEMOTRON seam — rubric only → score(answer)
  director.py      NEMOTRON seam — session control → decide(...)
  composure.py     PRESAGE seam → sample_composure(); mock default
  store.py         In-process list save/load (later: Tiger Data)
  .env             Secrets (gitignored); see .env.example

frontend/          Next.js 16 — sole UI package
  app/interview/   Voice loop, MediaPipe badge, FastAPI /session + /turn
  app/report/      GET /session → composure chart + rubrics
  app/api/stt|tts  ElevenLabs proxy (server-side key)
  lib/api.ts       getHealth, getSession, postTurn
  lib/api-types.ts FastAPI JSON shapes (report + /turn client)
  lib/contracts.ts Target Nemotron/composure types (UI debug only today)
  .env.local       NEXT_PUBLIC_API_URL, ELEVENLABS_API_KEY (see .env.example)

presage_smoke/     Official hello_vitals mirror + run_smoke.ps1 (step 5)
docs/              presage-step5.md — smoke status, sidecar decision

plan.md            Build checklist + merge phases
handoff.md         This file
```

**Removed from tree:** `temp_ui_stuff/` (merged into `frontend/`), Vite `frontend/` (git history). No `app/diag` route.

---

## Model-role split (do not blur)

| Role | Module | Speaks? | Today |
|------|--------|---------|--------|
| Interviewer | `interviewer.py` | Yes (questions) | Rotating mock questions |
| Judge | `judge.py` | No | Fixed rubric JSON |
| Director | `director.py` | No | Always `follow_up` mock |
| Composure | `composure.py` | N/A | Default `0.72` mock; sidecar/fallback wired but off |
| Voice | `frontend/app/api/tts`, interview machine | TTS out | ElevenLabs route + browser `speechSynthesis` fallback |
| STT | `frontend/app/api/stt` | N/A | ElevenLabs; empty/failed → user-visible error on interview page |

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

There is **no** backend `/diag`. The old Vite `/diag` was a frontend-only media harness (Web Speech + browser TTS); it is **not** required for the demo path.

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

## Frontend routes (Next.js)

| URL | Page |
|-----|------|
| `/` | Landing |
| `/interview` | Voice interview → FastAPI `/session`, `/turn`; **API ok** banner when backend reachable |
| `/report` | Session report from `GET /session` |

Env:

- `NEXT_PUBLIC_API_URL` — FastAPI base (default `http://localhost:8000`)
- `ELEVENLABS_API_KEY` — server-only for `/api/stt` and `/api/tts`

---

## Composure (two signals)

| Signal | Source | Used for |
|--------|--------|----------|
| Live badge / **Signal** panel on `/interview` | Browser MediaPipe | UX during call only |
| Director + `/report` curve | `sample_composure()` in `POST /turn` | Session truth in `store` |

Backend module notes:

- **`COMPOSURE_MODE`**: `mock` (default) | `auto` | `sidecar` | `fallback` — see `composure.py` and [docs/presage-step5.md](docs/presage-step5.md).
- Browser should **not** call the Presage sidecar; only the backend samples during `/turn`.
- When sidecar `:8100` owns the camera, disable browser webcam path — see presage doc.

---

## CORS and deploy

- Local Next: `http://localhost:3000` and `http://127.0.0.1:3000` are in `main.py`.
- Vite ports `5173–5175` remain listed for legacy; no Vite app in repo.
- Production UI: set **`CORS_EXTRA_ORIGINS`** on the API (e.g. `https://….vercel.app`).
- Vercel UI: `NEXT_PUBLIC_API_URL` + `ELEVENLABS_API_KEY` in project env.

---

## Run locally

```powershell
# Terminal 1
cd backend
.\.venv\Scripts\Activate.ps1   # or create venv + pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend
pnpm install   # or: npx pnpm@12.3.4 install
pnpm dev
```

Open http://localhost:3000 → **Start a mock interview** → join call (needs **API ok**) → speak → **End** or continue → `/report`.

Presage smoke (optional): [docs/presage-step5.md](docs/presage-step5.md). Backend probe: `GET http://localhost:8000/debug/presage`.

---

## Scaffold checklist (current)

| Step | Status |
|------|--------|
| 1 Health + CORS | Done (incl. Next :3000) |
| 2 Mock seams + `/debug` | Done |
| 3 `/turn` loop + UI | Done (Next `/interview`) |
| 4 Media mic/webcam/TTS | **Superseded** by interview + Signal panel; Vite `/diag` not ported |
| 5 Presage smoke | **Postponed** — not verified on this machine |
| 6 `/report` | Done (Next `/report`) |
| 7 Presage sidecar `:8100` | **Not started** |
| Merge M1–M3 (single frontend, wire API, CORS) | **Done** |
| Phase 4 API keys (Gemini, Nemotron, ElevenLabs live) | **Not started** |
| Phase 6 Deploy | **Not started** |

---

## Integration guidelines (next work — Phase 4)

1. **ElevenLabs** — `frontend/.env.local`; verify `/api/tts` and `/api/stt` on a full turn.
2. **Gemini** — replace body of `interviewer.next_turn()` only; keep `{ role, text }`.
3. **Nemotron judge** — replace `judge.score()`; preserve rubric keys for director + report UI.
4. **Nemotron director** — replace `director.decide()`; keep `action` enum + `input_snapshot` for eval.
5. **Presage** — step 5 smoke, then step 7 sidecar; `COMPOSURE_MODE=auto` without changing `/turn` contract.
6. **Persistence** — replace `store.py` with Tiger Data when ready.

Optional: port Vite `/diag` to `app/diag/page.tsx` only for isolated Web Speech vs TTS debugging (not on critical path).

---

## Git / secrets

- Never commit `backend/.env`, `frontend/.env.local`, `node_modules/`, `frontend/.next/`, `backend/.venv/`, `presage_smoke/.sdk/`.
- Backend keys: `backend/.env`. ElevenLabs: `frontend/.env.local` only.
