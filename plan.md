# SpeakUp frontend integration plan

**Goal:** Replace the outdated Next.js app in `frontend/` with the SpeakUp design in `speak-up-front-end-design/frontend/`, wired to the **current** FastAPI backend at `backend/` (SQLite sessions, `/turn` loop, Gemini/Nemotron/Presage seams, document upload). The new UI becomes the only user-facing frontend; the old Next pages and styling are removed after cutover.

**Authoritative runtime docs after merge:** update [handoff.md](handoff.md) (paths, ports, env vars). This file is the **integration checklist** until cutover is done.

**Date context:** SteelHacks XIII — integration should preserve the demo path that works with **zero API keys**, then improve when keys are set.

---

## 1. Current vs target (summary)

| Area | Current `frontend/` (Next.js 16) | Target `speak-up-front-end-design/frontend/` (Vite + React 19) |
|------|-----------------------------------|----------------------------------------------------------------|
| Stack | Next App Router, Tailwind, shadcn, MediaPipe | Vite 8, plain CSS modules per page, no router package |
| Routes | `/`, `/setup`, `/interview`, `/report` | `/`, `/start` (studio), `/results`; legacy entrypoints `/diag`, `/report` (old chart UI in `main.tsx`) |
| Backend | `NEXT_PUBLIC_API_URL` → `:8000` | Not wired — mock timer + in-memory `session.ts` |
| Voice | `useInterviewMachine` + `/api/stt` + `/api/tts` (ElevenLabs) | Mic toggle is **visual only**; no STT/TTS loop |
| Composure | MediaPipe + sampler hooks on interview page | Presage pane uses **static** `PRESAGE_METRICS` |
| Report | Live `GET /sessions/{id}` + composure canvas + rubrics | `Results.tsx` uses **static** copy; only meta from `setSession()` |
| Setup / context | Job title + PDF/DOCX/TXT upload → `POST /sessions` | No upload; scenario + opponent only |
| Personas | Single interviewer image (`Maya Chen` in code) | Three salary opponents + locked scenario modes |
| Static assets | `frontend/public/interviewer.png` (single frame) | **Posters:** `speak-up-front-end-design/frontend/public/brand/` + `characters/` (3 thumbnails). **Live interview:** repo-root [`images/`](images/) — 24 expression PNGs (see §8) |
| Opponent visuals | One static photo | Thumbnail in dropdown + **dynamic expression** on stage during session |

**Backend to keep:** `backend/` at repo root (not the slimmer copy inside `speak-up-front-end-design/backend/`). CORS already lists Vite ports `5173–5175` and Next `3000`.

---

## 2. Recommended integration strategy

### Decision: adopt Vite SpeakUp as the new `frontend/`

**Why not port CSS into Next?**

- The design is already a cohesive Vite app (pathname routing in `App.tsx` + `main.tsx`, large page-specific CSS files).
- Duplicating into Next would mean re-homing hundreds of lines of CSS and re-implementing draggable camera tile behavior inside Tailwind.
- “Fully replace” is cleaner as **delete Next app → promote Vite tree → fix tooling/docs**.

**Voice proxy:** Today ElevenLabs keys live in `frontend/.env.local` and are used only by Next route handlers (`app/api/stt`, `app/api/tts`). After cutover, either:

1. **Preferred:** Add `POST /api/stt` and `POST /api/tts` on FastAPI (same logic as current Next routes), key in `backend/.env`, frontend calls `VITE_API_URL` only.
2. **Alternative:** Vite dev server proxy + small Node handler — avoid for production unless you also deploy that handler.

Document the chosen approach in `backend/.env.example` and remove “frontend only” ElevenLabs note when backend owns voice.

### Cutover mechanics (high level)

1. Archive or delete current `frontend/` (keep a git branch/tag `pre-speakup-ui` before force-replace if the team wants rollback).
2. Copy `speak-up-front-end-design/frontend/*` → `frontend/`.
3. Copy `speak-up-front-end-design/frontend/public/` (`brand/`, `characters/`) into `frontend/public/`, and **normalize** repo-root [`images/`](images/) into URL-safe paths under `frontend/public/images/` (see §8).
4. Port integration code from old Next tree into Vite `src/` (§5–§7).
5. Unify routes and remove duplicate legacy pages (§4).
6. Update root README, handoff, scripts, CI, and CORS if deploy origin changes.
7. Remove or repurpose `speak-up-front-end-design/` once merged (optional: keep as design archive folder until sprint end).

---

## 3. Route and navigation map

| User-facing URL (target) | Page component | Replaces (old Next) | Notes |
|--------------------------|----------------|---------------------|--------|
| `/` | `pages/Home.tsx` | `/` | Marketing + demo video modal |
| `/start` | `pages/Setup.tsx` | `/setup` + `/interview` | Studio: config + live session |
| `/results` | `pages/Results.tsx` | `/report` | Post-session report (wire to API) |
| `/diag` | `Diag.tsx` | *(none)* | Keep for mic/webcam/TTS debugging |

**Redirects (optional but nice):**

- `/setup` → `/start`
- `/interview` → `/start` (session state is in-studio, not a separate route)
- `/report` → `/results`

Implement via Vite `historyApiFallback` + small redirect in `main.tsx` or hosting config (Vercel/Netlify redirects).

**Remove after merge:** duplicate `Report.tsx` at `src/Report.tsx` once `Results.tsx` renders backend data (or keep `/report` as alias that renders the same component as `/results`).

---

## 4. Button and control inventory (must all behave correctly)

Every control in the new UI should have an explicit **intended behavior** after integration. Locked controls stay locked until product enables more modes.

### 4.1 `Home.tsx`

| Control | Current behavior | Target behavior |
|---------|------------------|-----------------|
| Nav **Modes** | `navigate('/start')` | Unchanged |
| Nav **Demo** | Opens YouTube modal | Unchanged; update `DEMO_VIDEO_ID` when real demo exists |
| **Enter studio** | `navigate('/start')` | Unchanged |
| **Get a demo** | Opens modal | Unchanged |
| **Get started** | `navigate('/start')` | Unchanged |
| Hero showcase click | Opens modal | Unchanged |
| Modal scrim / close / Escape | Closes modal | Unchanged |
| Footer | Static | Unchanged |

### 4.2 `Setup.tsx` — scenario dropdown (locked items)

| Option | `ready` | UI today | Target behavior |
|--------|---------|----------|-----------------|
| Salary Negotiation | `true` | Selectable | **Primary mode** — drives session + interviewer persona (§6) |
| Mock Interview | `false` | `disabled`, sub “Coming soon” | Stay locked; `aria-disabled`, no navigation; optional toast on click attempt |
| Public Speaking | `false` | locked | Same |
| Thesis Defense | `false` | locked | Same |

**Do not** enable locked modes until backend has scenario-specific prompts and QA; flipping `ready: true` without backend work is a regression.

### 4.3 `Setup.tsx` — opponent dropdown (salary only)

| Character | Target behavior |
|-----------|-----------------|
| University Recruiter | Selectable; sets persona metadata sent to session (§6) |
| Senior Manager | Selectable |
| HR Lead | Selectable |

**Stage image:** During an active session, the opponent tile must use the **expression set** from §8 (not the static `/characters/*.png` poster). Posters stay for Home hero, dropdown previews, and Results avatars.

When scenario is locked modes in the future, opponent list should be **mode-specific** (empty or hidden until mode selected).

### 4.4 `Setup.tsx` — session lifecycle

| Control | Current | Target |
|---------|---------|--------|
| Logo / brand home | `navigate('/')` | Unchanged |
| **Start session** (overlay + footer) | Local `started` + timer | **On first start:** `POST /sessions` (optional job context), store `session_id` in `sessionStorage`; request mic+camera; `getSession` + TTS opening question via interview machine |
| **End & get report** | `setSession` + `navigate('/results')` | Stop media/tracks; persist duration; `navigate('/results')`; report page loads `GET /sessions/{id}` |
| **Select an opponent** (disabled start) | `disabled={!character}` | Unchanged until character chosen |
| Timer | Local seconds | Start on successful session start; pause/stop on end |

### 4.5 `Setup.tsx` — toolbar

| Control | Current | Target |
|---------|---------|--------|
| **Mute / Unmute** | Toggles `micOn` only | Tie to interview machine: mute = disable MediaRecorder track / ignore STT; unmute = re-enable for LISTENING state |
| **Stats** | Toggles Presage pane | Toggle live composure panel (§7) |
| **Leave** | `navigate('/')` | Confirm if session active; stop streams; optional `clearStoredSessionId` only if abandoning |

### 4.6 `Setup.tsx` — Presage pane

| Control | Current | Target |
|---------|---------|--------|
| **Show stats** | Opens pane | Unchanged |
| Close pane | Hides pane | Unchanged |
| Metric rows | Static numbers | Bind to `useFaceComposure` + `useComposureSampler` and/or latest turn composure from backend sample during THINKING |

### 4.7 `Setup.tsx` — `CameraTile`

| Control | Current | Target |
|---------|---------|--------|
| Turn on / off camera | Local `getUserMedia` video only | Prefer **single** `useMediaStream` shared with interview machine (audio+video) to avoid double permission prompts |
| Drag / resize | Local UI | Keep UX; ensure PiP does not cover opponent CTA on small screens (CSS already partly handles) |

### 4.8 `Results.tsx`

| Control | Current | Target |
|---------|---------|--------|
| Brand home | `/` | Unchanged |
| **Practice again** | `/start` | Unchanged; clear in-memory session summary or start fresh `session_id` on next start |
| **Back to home** | `/` | Unchanged |
| Metrics / strengths / transcript | Static arrays | Derive from API turns (§7) with design-appropriate copy |

### 4.9 `Diag.tsx` (retain)

Keep for hackathon debugging (mic + webcam + TTS coexistence). Link from footer or dev-only query `?diag=1` if you want it hidden from demo users.

### 4.10 Interview loop controls (from old Next — must exist in studio)

The new studio footer does **not** yet expose the full turn state machine. Port behavior from `frontend/hooks/use-interview-machine.ts` and old `interview/page.tsx`:

| State | Old control | Studio integration |
|-------|-------------|-------------------|
| IDLE | Join call | Covered by **Start session** |
| ASKING | Answer now | Auto-advance to listen after TTS **or** show subtle “Your turn” chip (design may use auto-listen after `onended`) |
| LISTENING | Stop & submit | Map to long-press mic or add **Submit answer** when design allows; minimum: end-of-utterance via stop recording |
| THINKING | Processing | Disable mute/stats; show processing on stage |
| End | End call | **End & get report** |

Preserve invariant: **one audio direction at a time** (TTS vs recording).

---

## 5. Code migration map (old Next → new Vite)

Copy/adapt these into `frontend/src/` (suggested layout):

```text
frontend/src/
  lib/
    api.ts              # from old lib/api.ts — use import.meta.env.VITE_API_URL
    api-types.ts
    session-storage.ts  # motiontoff_session_id key unchanged
    contracts.ts
    draw-composure-chart.ts   # if chart kept inside Results or subpanel
  hooks/
    use-interview-machine.ts
    use-media-stream.ts
    use-face-composure.ts
    use-composure-sampler.ts
    use-character-expression.ts  # stage src from turn machine + last decision (§8.3)
  voice/
    stt.ts              # fetch(`${API}/api/stt`, ...) after backend move
    tts.ts              # or inline in machine
  config/
    modes.ts            # MODES + SALARY_CHARACTERS from Setup.tsx
    personas.ts         # map character id → prompt hints / display
    character-expressions.ts  # image paths + director/state → frame (§8.2)
  pages/
    Home.tsx, Setup.tsx, Results.tsx  # design files
  App.tsx, main.tsx
```

**Delete from new tree after port:**

- `src/session.ts` in-memory summary → extend to store `session_id`, `mode`, `opponent`, `durationSec`, plus optional display fields for Results hero.
- Duplicate `Report.tsx` / `Report.css` once Results is API-backed (or make Report a thin wrapper).

**Environment:**

| Variable | Purpose |
|----------|---------|
| `VITE_API_URL` | Default `http://localhost:8000` |
| `ELEVENLABS_API_KEY` | Backend only if STT/TTS moved to FastAPI |

Remove `NEXT_PUBLIC_*` from docs.

---

## 6. Backend and persona alignment

Today the backend has **no** `character_id` or `scenario` fields — only `job_title`, documents, and turns. The UI promises salary negotiation with three tones.

### Phase A — UI-only persona (fastest demo)

- On `POST /sessions`, continue sending `{ job_title }` only; set `job_title` from opponent name or `"Salary negotiation — {character.name}"`.
- Extend `interviewer.py` **client-side** is insufficient — for Gemini, add optional session settings:

**Phase B — minimal backend extension (recommended before demo)**

1. Extend `POST /sessions` body: `{ job_title?, scenario_id?, character_id? }`.
2. Persist in `sessions.settings_json` (already exists).
3. In `build_interviewer_context()` or `SYSTEM_INSTRUCTION`, branch on `character_id`:

   | `character_id` | Prompt flavor |
   |----------------|---------------|
   | `recruiter` | Warm, encouraging salary conversation |
   | `manager` | Formal, structure-focused |
   | `hr` | Strict, budget pushback |

4. Optionally swap `MOCK_QUESTIONS` / opening for salary-themed lines when `scenario_id === 'salary'`.

No change to `/turn` response shape.

### Document upload (old `/setup` feature)

The new design has no upload UI. Pick one:

1. **Collapsed “Add context” drawer** on `/start` before first Start (job title + file list) — reuses existing APIs.
2. **Defer** — document in handoff as post-MVP; risk: weaker Gemini grounding vs old flow.

Recommendation: **(1)** small drawer so backend document path is not orphaned.

---

## 7. Results page — data binding spec

Load `GET /sessions/{session_id}` (same as old report page).

| UI block | Source |
|----------|--------|
| Scenario / opponent / duration | `sessionStorage` summary + API `job_title` / settings |
| Overall score ring | Average of `turns[].scores.overall` (0–100) or composure-weighted formula — document choice |
| Delivery breakdown | Map rubric dimensions: structure, specificity, confidence; add composure average; derive “filler” from `red_flags` or placeholder until STT analytics exist |
| What worked / Work on this | Top `evidence[]` / `red_flags[]` across turns; cap at 3 bullets each |
| Transcript highlights | Last N turns: `question` → them, `answer` → you |
| Composure curve | Optional section below hero: canvas chart from `draw-composure-chart.ts` (design may need a light-theme variant to match Results.css) |

Handle empty turns: show friendly empty state + link to `/start` (session ended before any answer).

---

## 8. Static assets

### 8.1 Brand + character posters (ready to copy)

Already in `speak-up-front-end-design/frontend/public/`:

| Path | Use |
|------|-----|
| `brand/speakup-logo-horizontal.png`, `speakup-icon-white.png`, `speakup-app-icon.png`, … | Nav, favicon, stage watermark |
| `characters/university-recruiter.png` | Poster / dropdown / Results avatar for **recruiter** |
| `characters/senior-manager.png` | Poster for **manager** |
| `characters/hr-lead.png` | Poster for **hr**; Home hero showcase |

On cutover, copy the whole `public/` tree into `frontend/public/`. Retire Next `frontend/public/interviewer.png` after the studio uses expression art.

### 8.2 Interview expression sets — repo [`images/`](images/)

**Purpose:** Background-removed character art that changes **during the live session** on the studio stage (`Setup.tsx` opponent tile), driven by interview state and (optionally) Nemotron director actions.

**Inventory (24 PNGs):** six folders × four frames each.

| Source folder (repo root) | Maps to `character_id` | Mood prefix | Frames |
|---------------------------|------------------------|-------------|--------|
| `images/uni n rb/` | `recruiter` | `n` — neutral / engaged | 4 (`IMG_8967` … `8970`) |
| `images/uni m rb/` | `recruiter` | `m` — stern / pushback | 4 (`IMG_8971` … `8974`) |
| `images/senior n rb/` | `manager` | `n` | 4 (`IMG_8975` … `8978`) |
| `images/senior m rb/` | `manager` | `m` | 4 (`IMG_8979` … `8982`) |
| `images/hr n rb/` | `hr` | `n` | 4 (`IMG_8983` … `8986`) |
| `images/hr m rb/` | `hr` | `m` | 4 (`IMG_8987` … `8990`) |

**Semantics (verified on university recruiter set):**

- **`n` (neutral):** approachable default — soft smile, listening, speaking with open mouth (positive/neutral reactions).
- **`m` (mood / pushback):** sterner face — furrowed brow, tight mouth (use when the director escalates or scores dip).
- **Four frames per mood:** subtle expression variants (idle, talking, pleased/surprised, etc.). Treat as ordered indices `0–3`, not separate filenames in UI code.

Folder names use spaces (`hr m rb`); **do not reference them directly in URLs**. Normalize on copy, e.g.:

```text
frontend/public/images/
  recruiter/
    neutral-0.png … neutral-3.png
    stern-0.png … stern-3.png
  manager/
    neutral-0.png …
  hr/
    neutral-0.png …
```

Add a one-time script or manual rename when promoting assets; commit the normalized tree under `frontend/public/images/`.

### 8.3 Expression selection (implementation spec)

Add `character-expressions.ts` + `useCharacterExpression()` used by the studio stage `<img className="opponent-video" />`.

**Inputs:**

| Signal | Source |
|--------|--------|
| Character | `charId` (`recruiter` \| `manager` \| `hr`) |
| Turn state | `useInterviewMachine` (`IDLE`, `ASKING`, `LISTENING`, `THINKING`) |
| Last director action | `turns[].decision.action` from last successful `POST …/turn` |

**Suggested mapping (tune in implementation):**

| Condition | Mood | Frame index |
|-----------|------|-------------|
| Pre-start / IDLE | `n` | `0` (default smile) |
| ASKING (TTS playing) | current mood | `1` or alternate `1↔2` on a ~400ms timer for “talking” |
| LISTENING | `n` | `0` or `2` (attentive) |
| THINKING | keep previous mood | `0` |
| After turn: `press_harder` or `curveball` | `m` | `0`–`2` by `scores.overall` (lower → higher index) |
| After turn: `ease_off` or `follow_up` | `n` | `2` or `3` (warmer) |
| After turn: `move_on` | `n` | `0` |

Hold the `m` mood for at least one turn after a hard action so the UI does not flicker; decay back to `n` on `ease_off` or after two consecutive `follow_up` / `move_on`.

**Pre-start:** Continue showing `SALARY_CHARACTERS[].img` (`/characters/…`) until **Start session**; then switch to `/images/{character}/…` expression paths.

**Accessibility:** Keep meaningful `alt` on the stage image (`{name}, {tone}`); expression changes are decorative unless you expose a live region for screen readers (optional).

### 8.4 Asset checks

- [x] All `brand/` and `characters/` files from design package present under `frontend/public/`
- [x] All 24 expression PNGs present under normalized `frontend/public/images/{recruiter,manager,hr}/`
- [x] No broken stage image when switching opponents mid-setup (reset expression state when `charId` changes)

---

## 9. Implementation phases (ordered)

### Phase 0 — Prep (0.5 day)

- [x] Tag current `main` or branch `legacy-next-frontend`
- [x] Copy design `public/` + normalize repo [`images/`](images/) → `frontend/public/images/` (§8.2)
- [x] Agree STT/TTS hosting (backend vs other) — **FastAPI** `POST /api/stt` + `POST /api/tts`, key in `backend/.env` (see `backend/.env.example`)

### Phase 1 — Structural replace (0.5 day)

- [x] Replace `frontend/` with Vite SpeakUp tree
- [x] Root `package.json` scripts or document `cd frontend && npm run dev`
- [x] Add `frontend/.env.example` with `VITE_API_URL`
- [x] Route aliases `/setup`, `/interview`, `/report`

### Phase 2 — Session + API shell (1 day)

- [x] Port `lib/api*.ts`, `session-storage.ts`
- [x] Wire **Start session** → create session + health check
- [x] Wire **End & get report** → navigate with `session_id`
- [x] Results: load API; replace static transcript/metrics with computed data
- [x] Locked scenario modes: verify `disabled` + keyboard no-op

### Phase 3 — Voice + turn loop (1–1.5 days)

- [x] Move STT/TTS to backend (or interim proxy)
- [x] Port `use-interview-machine` + media hooks into Setup stage
- [x] Connect opponent name to stage; wire **expression sets** (§8.3) to turn state + director actions
- [x] Error surfaces (API offline, no speech, STT missing key)

### Phase 4 — Composure UX (0.5–1 day)

- [x] Port MediaPipe hooks; feed Presage pane live values
- [x] Align with backend composure on `/turn` (display last sample or live face metrics)
- [x] Remove static `PRESAGE_METRICS` constants

### Phase 5 — Persona + optional upload (0.5 day)

- [x] `settings_json` for `character_id` / `scenario_id`
- [x] Interviewer prompt variants
- [x] Optional context drawer for documents

### Phase 6 — Cleanup and docs (0.5 day)

- [x] Delete Next artifacts (`.next`, tailwind config if unused, `app/` tree)
- [x] Update [handoff.md](handoff.md): port `5173`, routes, env vars
- [x] Remove or archive `speak-up-front-end-design/` duplicate backend
- [x] Smoke test checklist (§10)

---

## 10. Acceptance / smoke tests

Run backend on `:8000`, frontend on `:5173`.

1. **Zero keys:** Home → Start → pick HR Lead → Start session → speak or mock path → End → Results shows turns from mock interviewer (not static TRANSCRIPT).
2. **Locked modes:** Mock Interview / Public Speaking / Thesis — not selectable; no session start when only locked mode would apply.
3. **Leave mid-session:** Streams stop; no orphaned mic icon in browser tab.
4. **Refresh on Results:** With same `session_id` in `sessionStorage`, report reloads from API.
5. **Diag:** `/diag` still runs TTS + mic test.
6. **CORS:** No browser errors from `localhost:5173` to `:8000`.
7. **With `GEMINI_API_KEY`:** Opponent tone noticeably shifts questions (after Phase 5).
8. **With `ELEVENLABS_API_KEY`:** TTS/STT path works through new proxy.
9. **Assets:** Brand, character posters, and all expression PNGs load (network 200).
10. **Expressions:** Start session as HR Lead → neutral face; complete a turn that returns `press_harder` (or mock) → stage switches to stern set; TTS playing uses a “talking” frame.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Expression flicker on every turn | Minimum hold time for `m` mood; debounce frame index |
| Spaces in `images/* rb/` folder names | Normalize paths in §8.2 before shipping |
| Double `getUserMedia` (CameraTile vs interview) | Single media hook shared |
| Salary UI vs mock-interview backend copy | Phase B settings + prompt branching |
| Results design vs dark composure chart | Themed chart or inset card |
| ElevenLabs key exposure if proxied wrong | Backend-only key, never `VITE_*` secret |
| Removing document upload | Context drawer or explicit “MVP without upload” in handoff |

---

## 12. Out of scope (track elsewhere)

- Enabling locked scenarios (Mock Interview, Public Speaking, Thesis) — product + backend prompts
- Presage sidecar `:8100` — see [docs/presage-step5.md](docs/presage-step5.md)
- Production deploy (Vercel/Netlify + `CORS_EXTRA_ORIGINS`)
- Deleting `speak-up-front-end-design/plan.md` (old backend checklist); this root `plan.md` supersedes for **frontend integration** only

---

## 13. Definition of done

- [x] `frontend/` is the Vite SpeakUp app; no Next.js dependency in root workflow
- [x] All controls in §4 have defined, implemented behavior (locked remain locked)
- [x] Full user path works against root `backend/` with mocks and with keys when set
- [x] Old Next `app/*` interview/setup/report pages are gone
- [x] handoff.md reflects new routes, ports, and env
- [x] `speak-up-front-end-design/` is either removed or clearly marked archived post-merge
- [x] Live studio uses [`images/`](images/) expression art; posters only for marketing / picker / report
