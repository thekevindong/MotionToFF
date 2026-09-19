# MotionToFF — merge plan (v0 UI + existing backend)

SteelHacks XIII (Sept 19–20, 2026). Practice app for high-stakes conversations: speech in, AI interviewer out, **Nemotron** scores + directs, **Presage** composure (backend seam), post-session **report**.

**Handoff for agents:** [handoff.md](handoff.md). **Merge Phases 1–3 complete**; next work is Phase 4 (API keys) and Phase 5–6 (Presage + deploy).

---

## Feasibility (answer first)

**Yes — a working frontend/backend prototype with API keys is possible** with what is already in the repo.

| Layer | Status |
| ----- | ------ |
| Backend spine | **Working** — `GET /health`, `GET /session`, `POST /turn`, mocks in `interviewer` / `judge` / `director` / `composure`, in-memory `store`; CORS includes Next `:3000` |
| Next frontend (`frontend/`) | **Working** — `/interview` → `/session` + `/turn`, `/report`, ElevenLabs `/api/stt` + `/api/tts`, MediaPipe live composure UX |
| Legacy Vite UI | **Removed** from tree (git history only); old `/diag` harness not ported — interview path supersedes it |
| Presage (`presage_smoke/`, `docs/`) | Smoke **not verified** on dev machine; backend composure stays **mock** |

**Prototype definition of done:** User joins call → hears question (TTS) → speaks → STT → `POST /turn` → next question until end → **report** from `GET /session` with composure curve + rubrics. With keys: Gemini questions, Nemotron judge/director, ElevenLabs voice; without keys: same flow on mocks + browser TTS fallback.

---

## What each folder owns (do not blur)

```text
backend/              FastAPI :8000 — session, /turn orchestration, model seams, composure sampling
frontend/             Next.js 16 — product UI (:3000), lib/api.ts, interview + report, ElevenLabs proxy routes
presage_smoke/        C++ hello_vitals mirror + run_smoke.ps1
docs/presage-step5.md Presage smoke status + sidecar decision (:8100)
```

### Model roles (strict — same as before)

- **Gemini** → `backend/interviewer.py` — dialogue only (`next_turn`)
- **Nemotron** → `backend/judge.py`, `backend/director.py` — rubric + `action`, never user-facing speech
- **Presage** → `backend/composure.py` — scalar for director + store during `/turn` (not browser → sidecar)
- **ElevenLabs** → `frontend/app/api/stt`, `frontend/app/api/tts` — keys in **Next** env (server-side); browser never sees the key

---

## Integration gaps (must be explicit)

### 1. UI stack mismatch — **resolved**

Single **Next.js** app at `frontend/`: voice interview wired to FastAPI, report at `/report`, landing links to both. No second frontend package in the repo.

### 2. JSON contract mismatch (types vs backend today)

`frontend/lib/contracts.ts` describes the **target** Nemotron + composure shapes (Likert 0–4, `DirectorRecord.decision`, rich `ComposureSample`).

Backend mocks today return:

- `scores`: floats 0–1, `evidence` as `string[]`, plus `mock: true`
- `decision`: `{ action, rationale, input_snapshot, mock }` where `action` ∈ `press_harder | follow_up | move_on | curveball | ease_off`
- `composure`: bare `float` on each store row

**Resolution (implemented):**

1. **`frontend/lib/api-types.ts`** + **`frontend/lib/api.ts`** match FastAPI responses for `/health`, `/session`, `/turn`.
2. **`contracts.ts`** remains UI-only for MediaPipe / debug panel (`ComposureSample`).
3. When wiring real Nemotron, evolve **backend** JSON toward `contracts.ts` in one PR — do not fork two director schemas long-term.

### 3. Two composure signals (by design for now)

| Signal | Source | Used for |
| ------ | ------ | -------- |
| Live badge / debug panel | Browser MediaPipe (`use-face-composure`, `use-composure-sampler`) | UX only during call |
| Director + report curve | `sample_composure()` inside `POST /turn` | Session truth in `store` |

They will **not** match numerically until Presage sidecar (step 7) or until we add an optional `composure` field on `TurnRequest` to pass the latest client sample. For the hackathon prototype, **backend scalar is authoritative** for director/report; live badge is the differentiator demo in the call UI.

**Presage sidecar note:** When `:8100` owns the camera, browser webcam must not fight it — see [docs/presage-step5.md](docs/presage-step5.md). Until sidecar works, browser MediaPipe + backend mock is consistent.

### 4. CORS and ports

Backend allows Vite ports `5173–5175` (legacy list) **and** `http://localhost:3000` / `http://127.0.0.1:3000` in `main.py`. Production origins via **`CORS_EXTRA_ORIGINS`** in `backend/.env`.

### 5. Secrets layout

| Secret | Where |
| ------ | ----- |
| `GEMINI_API_KEY`, `NEMOTRON_API_KEY`, Presage | `backend/.env` |
| `ELEVENLABS_API_KEY` | `frontend/.env.local` — used only by Next API routes |
| Deploy | Backend URL public; Next on Vercel with `NEXT_PUBLIC_API_URL` + `CORS_EXTRA_ORIGINS` on API |

---

## Target architecture (current)

```text
┌─────────────────────────────────────┐
│  Next.js (frontend/)  :3000       │
│  - /, /interview, /report           │
│  - /api/stt, /api/tts  (ElevenLabs) │
└──────────────┬──────────────────────┘
               │ fetch NEXT_PUBLIC_API_URL
               ▼
┌─────────────────────────────────────┐
│  FastAPI (backend/)  :8000          │
│  /session, /turn, /health, /debug*  │
│  Gemini / Nemotron / composure      │
└──────────────┬──────────────────────┘
               │ optional later
               ▼
┌─────────────────────────────────────┐
│  Presage sidecar  :8100  (step 7)   │
└─────────────────────────────────────┘
```

---

## Merge phases (execution order)

### Phase 0 — Inventory freeze (no code)

- [x] Confirm backend routes and store shape (`handoff.md`).
- [x] v0 promoted; interview no longer uses placeholder question list (FastAPI session drives copy).
- [x] Agent rule: **never search `frontend/node_modules`** — Vite reference removed; use git history if needed.

### Phase 1 — Promote v0 into `frontend/` (filesystem) — **Done**

- [x] One frontend at repo root `frontend/` (Next.js); `temp_ui_stuff/` absorbed; Vite tree removed (recover from git if needed).
- [x] `frontend/.env.example` with `NEXT_PUBLIC_API_URL`, `ELEVENLABS_API_KEY`.
- [x] Root README: uvicorn + `pnpm dev`.

**Do not** commit `.env` / `.env.local` with real keys.

### Phase 2 — Wire interview to FastAPI — **Done**

- [x] `lib/api.ts`: `getHealth()`, `getSession()`, `postTurn()`.
- [x] Join call → `/health` + `/session` → TTS first question from `current_question.text`.
- [x] STT transcript → `/turn`; empty transcript → error + back to `LISTENING`; failure → error strip + retry via re-record.
- [x] Success → `ask(next_question.text)`; session end via **End** → `REPORT` + link to `/report`.
- [x] CORS for `:3000`; `useInterviewMachine` one-audio-direction invariant preserved.

### Phase 3 — Report page in Next — **Done**

- [x] `app/report/page.tsx` — `GET /session`, composure canvas (`lib/draw-composure-chart.ts`), rubric list.
- [x] Dark Tailwind styling; landing + interview link to `/report`.

**Not ported (intentional):** old Vite `/diag` page (Web Speech + browser TTS coexistence test). The production interview path uses MediaRecorder + `/api/stt`, ElevenLabs/browser TTS, and the on-call **Signal** debug panel instead. Re-port from git only if isolating media bugs.

### Phase 4 — API keys → live models (prototype with keys)

Order (one seam at a time; run `GET /debug` or one manual turn after each):

1. **ElevenLabs** — set `ELEVENLABS_API_KEY` in `frontend/.env.local`; verify `/api/tts` and `/api/stt` (already implemented).
2. **Gemini** — `interviewer.next_turn()`; preserve `{ role, text }`.
3. **Nemotron judge** — `judge.score()`; keep keys used by `director` and report UI (`structure`, `specificity`, `confidence`, `evidence`, `red_flags`, `overall`).
4. **Nemotron director** — `director.decide()`; keep `action` + `input_snapshot` logging for eval.

Composure: stay `COMPOSURE_MODE=mock` until Presage smoke passes.

### Phase 5 — Presage (parallel, post-prototype)

Unchanged from [docs/presage-step5.md](docs/presage-step5.md):

1. Run `presage_smoke/run_smoke.ps1` with API key + MSVC.
2. Build sidecar `:8100` → `COMPOSURE_MODE=auto`.
3. Revisit browser webcam vs sidecar (may disable MediaPipe when sidecar is live).

### Phase 6 — Deploy

- **API:** Railway/Fly/Render or teammate host — `uvicorn`, env from `backend/.env.example`.
- **UI:** Vercel from `frontend/`; set `NEXT_PUBLIC_API_URL`, `ELEVENLABS_API_KEY`; backend `CORS_EXTRA_ORIGINS=https://….vercel.app`.
- Smoke: health → join call → one full turn → report.

---

## Scaffold progress (updated)

| # | Item | Status |
|---|------|--------|
| 1 | Backend `/health` + CORS | Done |
| 2 | Mock seams + `GET /debug` | Done |
| 3 | `POST /turn` + interview UI | **Done** (Next interview) |
| 4 | Media mic/webcam/TTS check | **Superseded** — `/interview` + Signal panel; old Vite `/diag` not in Next (optional) |
| 5 | Presage hello vitals smoke | **Postponed** — [docs/presage-step5.md](docs/presage-step5.md) |
| 6 | Report UI (composure + rubrics) | **Done** (Next `/report`) |
| 7 | Presage sidecar `:8100` + `COMPOSURE_MODE=auto` | Not started |
| **M1** | Promote `temp_ui_stuff` → `frontend/` | **Done** |
| **M2** | Interview page → `/session` + `/turn` | **Done** |
| **M3** | CORS for Next `:3000` | **Done** |
| **M4** | API keys wired (Gemini, Nemotron, ElevenLabs) | Not started |

---

## Verification checklist (Phases 1–3 — run before Phase 4)

**Local (mocks, no paid keys):**

```powershell
# Terminal 1
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn main:app --reload --port 8000

# Terminal 2
cd frontend
pnpm install
pnpm dev
```

- [ ] `http://localhost:3000` loads landing.
- [ ] Join call → first question matches `GET /session` `current_question.text` (mock rotation).
- [ ] Submit spoken answer (or type path if STT missing key: browser fallback message) → `POST /turn` returns `next_question`.
- [ ] `http://localhost:3000/report` shows ≥1 turn, composure line, rubric fields.
- [ ] Backend still green: `GET /health`, `GET /debug/presage`.

**With keys:**

- [ ] ElevenLabs TTS plays interviewer line; STT returns accurate transcript.
- [ ] Gemini changes question wording; Nemotron changes scores/decisions (remove or set `mock: false` when real).

---

## Risks

| Risk | Mitigation |
| ---- | ---------- |
| Contract drift (`contracts.ts` vs backend) | Phase 2 uses `api-types.ts` matching FastAPI; single Nemotron alignment PR later |
| STT/TTS fail without ElevenLabs key | `useInterviewMachine` already falls back to `speechSynthesis`; show clear STT error + optional typed fallback field |
| CORS / wrong API URL | `NEXT_PUBLIC_API_URL` + port 3000 in CORS; health banner on interview page |
| Dual composure confusing judges | Document: report uses backend `turns[].composure`; badge is live UX until sidecar/client upload |
| Presage blocked | Mock composure keeps `/turn` and report working |
| Camera conflict with sidecar | Follow docs; disable browser vitals path when sidecar runs |

---

## Eval (NVIDIA Beyond the Chatbot)

Unchanged — log `director.input_snapshot`, labeled answer set vs rubric, director-on vs fixed script. Next interview now hits real `/turn`.

---

## Next agent prompt (after reading this file)

```
MotionToFF — Phases 1–3 are done (single Next frontend/, interview + report wired to FastAPI).

Next: plan.md Phase 4 — wire API keys one seam at a time (ElevenLabs in frontend/.env.local, then Gemini/Nemotron in backend/.env). Then Phase 5 Presage smoke + sidecar, Phase 6 deploy.

Do not grep frontend/node_modules or backend/.venv. Do not port Vite /diag unless explicitly asked.
```
