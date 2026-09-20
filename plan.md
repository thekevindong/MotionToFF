# SpeakUp — Studio UX & conversation plan

**Goal:** Fix interview-stage polish, restore a dedicated prep flow before the live call, and evolve turn-taking from explicit “Stop & submit” into natural back-and-forth — including optional Presage-driven interviewer reactions.

**Runtime truth:** [handoff.md](handoff.md)  
**Presage / sidecar:** [docs/presage-step5.md](docs/presage-step5.md)

**Primary surfaces today**

| Area | Location |
|------|----------|
| Live studio (interview UI) | `frontend/src/pages/Setup.tsx`, `Setup.css` |
| Turn + voice | `frontend/src/hooks/use-interview-machine.ts`, `voice/stt.ts` |
| Interviewer expressions | `frontend/src/hooks/use-character-expression.ts` |
| Presage pane data | `frontend/src/hooks/use-presage-metrics.ts`, `use-composure-sampler.ts`, `use-face-composure.ts` |
| Backend turn loop | `backend/main.py` (`POST /sessions/{id}/turn`), `interviewer.py`, `director.py`, `composure.py` |

**Reference UI (prep wizard):** commit `c45be82` had a three-step flow (`mode` → `character` → `launch`) with `.stepper`, `.mode-grid`, `.launch-*` in `Setup.tsx` / `Setup.css`. Reuse that interaction pattern with the **current** light studio visual language (paper/night tokens, typography), not a pixel-perfect revert.

---

## Success criteria (demo-ready)

1. Self-view webcam defaults to **top-right** of the stage (still draggable/resizable).
2. Interviewer captions are **readable width** (not full-bleed over the character).
3. **Two-line caption stack:** AI line + user line with slide/fade animation; user text updates live while they speak.
4. Presage pane shows **all metrics** the product promises (face-derived + speech + vitals when available), with honest “unavailable” states — not silent omission.
5. Opponent sprite shows **full head + top margin**; scaling is **height-only** (`object-fit: contain` / max-height), independent of stage width.
6. Talking mouth animation starts only when **audio is actually playing** (ElevenLabs `HTMLAudioElement` or `speechSynthesis` start).
7. **Continuous conversation:** user can talk without pressing Stop; end-of-turn is detected by silence; user can **barge in** while the AI speaks.
8. **Prep screen** between Home “Get started” and the live black stage: scenario, opponent, and context — header dropdowns removed or disabled until prep is complete.
9. **Presage reactions:** when stress / composure crosses thresholds, the interviewer can interject (short, in-character) without breaking the session.

---

## Phase 1 — Quick UI fixes (1–2 days)

### 1.1 Camera tile → top-right

**Problem:** `.camtile` is `position: fixed; left: 28px; bottom: 88px` (`Setup.css` ~658–661). Reads as bottom-left over the footer.

**Implementation**

1. Change default anchor to **top-right inside the stage** (preferred) or top-right viewport with stage-aware inset:
   - Option A (recommended): `position: absolute` on `.camtile` within `.stage` so the tile scrolls with the stage and respects `overflow: hidden` clipping policy — if clipping is undesirable, use `overflow: visible` on `.stage` only for the tile layer.
   - Default CSS: `top: 16px; right: 16px; left: auto; bottom: auto`.
2. Update `CameraTile` in `Setup.tsx`:
   - On first mount, if `pos === null`, do not rely on bottom-left CSS; optional `useLayoutEffect` to set initial `pos` from `getBoundingClientRect()` of `.stage` (top-right inset).
   - Persist last position in `sessionStorage` key `speakup_camtile_pos` (optional, nice for repeat visits).
3. Update responsive rules at bottom of `Setup.css` (media query ~875) so mobile keeps min touch target and does not cover Presage toggle.

**Acceptance:** Fresh load places “You” tile top-right; drag still works; resize unchanged.

---

### 1.2 Caption layout (interviewer + user stack)

**Problem:** `.stage-caption` uses `inset: auto 16px 72px` with no `max-width`, so long questions span nearly the full stage (`Setup.css` ~463–475).

**Implementation**

1. Add `frontend/src/components/StageCaptionStack.tsx` (or colocated in `Setup.tsx` if you want zero new files — component is still recommended for animation state).
2. Structure:
   ```text
   .caption-stack (absolute, bottom: 72px, left: 50%, transform: translateX(-50%))
     .caption-line.caption-line--ai
     .caption-line.caption-line--user
   ```
3. CSS constraints:
   - `max-width: min(42rem, calc(100% - 32px))` (tune in QA).
   - `text-align: left` for readability; optional `text-wrap: balance` where supported.
   - Do **not** cover the opponent tag pill at bottom center; keep `bottom` offset ≥ height of `.opponent-tag`.
4. **AI caption:** bind to `currentQuestion` while `state === 'ASKING'` or hold last interviewer line until user speaks (product choice: **hold AI line until user caption appears**).
5. **User caption:** bind to `browserSpeech.getTranscript()` (already wired in `Setup.tsx`) whenever `sessionLive && micOn`, not only after submit.

**Acceptance:** Long Gemini strings wrap in a centered card; stage character remains visible; no overlap with camera tile (adjust `right` padding on stack when cam tile is on the right — e.g. `max-width` + `margin-right` when tile intersects).

---

### 1.3 Caption animations (user slides up, AI fades out)

**Implementation**

1. Track `captionGeneration` ref incremented on each AI question change and each finalized user utterance.
2. CSS keyframes (prefer CSS over JS):
   - **Enter (user):** `translateY(12px) → 0`, `opacity: 0 → 1`, ~280ms ease-out.
   - **Exit (previous AI):** `translateY(0) → -8px`, `opacity: 1 → 0`, ~320ms; run when user line becomes non-empty or on `speech-start` from VAD (Phase 3).
3. Use `prefers-reduced-motion: reduce` → cross-fade only, no translation.
4. `aria-live="polite"` on the stack container; avoid announcing every partial STT token — announce on phrase boundaries (debounce 800ms) or on end-of-turn only.

**Acceptance:** Visually matches “previous slides up and fades; new slides in from below” in user testing.

---

### 1.4 Opponent sprite scale (height-only, full head visible)

**Problem:** `.opponent-video` is `width/height: 100%; object-fit: cover` (`Setup.css` ~385–389), which crops the head on tall expression PNGs.

**Implementation**

1. Replace cover with **contain** on height:
   ```css
   .opponent-video {
     width: auto;
     height: min(78vh, 100%);
     max-height: calc(100% - 48px); /* top breathing room */
     margin: 24px auto 0;
     object-fit: contain;
     object-position: top center;
   }
   ```
2. Keep `.opponent` as positioning context; center horizontally with flex on a wrapper `.opponent-frame` if needed.
3. **Do not** tie sprite width to stage width — only `max-height` and `object-position: top center`.
4. QA all three characters × talking frames (`public/images/{recruiter,manager,hr}/`).

**Acceptance:** Top of hair/head always visible with ≥24px padding; feet may letterbox — that is OK.

---

### 1.5 Sync talking animation to audible TTS

**Problem:** `useCharacterExpression` alternates frames 1↔2 whenever `turnState === 'ASKING'` (`use-character-expression.ts` ~92–101), but `useInterviewMachine.ask()` sets `ASKING` **before** `audio.play()` resolves (`use-interview-machine.ts` ~123–131).

**Implementation**

1. Extend `useInterviewMachine.speak()`:
   - Add optional callbacks: `onAudibleStart?: () => void` (fire on `audio.onplaying` or first `speechSynthesis` `onstart`).
   - Keep `ASKING` for “interviewer turn” but add **`isSpeakingAudible: boolean`** state, or split into `ASKING_LOADING` | `ASKING_SPEAKING`.
2. Prefer minimal API:
   - `return { state, speakingPhase: 'idle' | 'loading' | 'audible' }` derived inside the hook.
3. Update `useCharacterExpression` to animate mouth only when `speakingPhase === 'audible'` (or `ASKING_SPEAKING`).
4. Optional: show a subtle “…” caption or neutral face during `loading` (no mouth flap).

**Acceptance:** No mouth movement during TTS network latency; movement starts in sync with heard audio within one animation frame.

---

### 1.6 Presage pane — restore full metric set

**Problem:** `usePresageMetrics` exposes five rows (Composure, Eye contact, Vocal steadiness, Pace, Filler words) but `ComposureSample.signals.vitals` is always `null` in `use-composure-sampler.ts`, and `FaceMetrics.raw` (blinks, look-away, instability) is never surfaced.

**Target rows (show row with “—” if unavailable)**

| Label | Source (priority order) |
|-------|-------------------------|
| Composure | Backend turn snapshot when `ASKING`; else live `sample.composure` |
| Heart rate | Sidecar `pulse` / `hr_bpm`; else `signals.vitals.hr_bpm` |
| Breathing rate | Sidecar `breathing` field (when sidecar exists) |
| Eye contact | `signals.engagement` |
| Expression stress | `signals.expression.stress` (rename “Vocal steadiness” if it was a proxy) |
| Head stability | `FaceMetrics.raw.instability` inverted |
| Gaze / look-away | `FaceMetrics.raw.lookAway` |
| Blink rate | `FaceMetrics.raw.blinksPerMin` |
| Pace (WPM) | existing speech hook |
| Filler words | existing speech hook |
| Signal source | Footer chip: `MediaPipe` / `Sidecar` / `Speech fallback` |

**Implementation**

1. **Frontend plumbing**
   - Extend `useComposureSampler` / `readPresage()` to pass through `getMetrics()?.raw` into `signals` (add optional fields to `ComposureSignals` in `contracts.ts` — keep backward compatible).
   - Add `usePresageVitals.ts` polling `GET ${VITE_API_URL}/debug/presage` every 2s while stats pane open **or** new lightweight `GET /sessions/{id}/vitals` (preferred for production; see Phase 4).
2. **Map sidecar JSON** using fields already assumed in `backend/composure.py` (`pulse`, `breathing`, `expression`, `confidence`, `talking`). Parse `composure_seam_status().sidecar_latest` shape into UI rows when `sidecar_reachable`.
3. Update `PresagePane` list rendering if row count exceeds viewport — `max-height` + `overflow-y: auto` on `.presage-list`.
4. Update `presageStatus` string in `Setup.tsx` to mention sidecar vs MediaPipe explicitly.

**Acceptance:** With only MediaPipe, user sees face + speech metrics. With sidecar on `:8100`, heart rate and breathing appear within 2s. No row silently disappears.

---

## Phase 2 — Prep screen before live call (1 day)

### 2.1 Flow

```text
Home “Get started” → /start (prep) → user completes steps → /start/call or in-page `studioPhase: 'live'`
```

**Do not** start `getUserMedia`, `POST /sessions`, or the turn machine until prep is done.

### 2.2 Step model (from `c45be82`, updated)

| Step | ID | Content |
|------|-----|---------|
| 1 | `scenario` | `MODES` grid (locked modes disabled) |
| 2 | `opponent` | `SALARY_CHARACTERS` cards with poster + tone |
| 3 | `context` | Job title + document upload (move **Add context** drawer here as inline panel) |
| 4 | `ready` | Summary card: scenario, opponent, files count → **Enter studio** |

Reuse CSS class names from old commit where possible: `.stepper`, `.mode-grid`, `.mode-card`, `.launch-*` → rename launch to `.prep-enter` to avoid implying auto-connect.

### 2.3 Studio header after prep

- While `studioPhase === 'prep'`: hide black stage / footer controls; show wizard full-page in SpeakUp chrome.
- While `studioPhase === 'live'`: hide scenario/opponent dropdowns from `studio-top` (read-only summary chip: “Salary · HR Lead”); **Back** ends session with confirm dialog.
- `App.tsx`: optional path `/start` vs `/start/live` — if staying single route, use `sessionStorage` `speakup_prep_complete` + query `?live=1` for bookmarking.

### 2.4 Migration from current `Setup.tsx`

1. Extract `StudioPrep.tsx` + `StudioLive.tsx` from `Setup.tsx` to keep file size manageable.
2. Move `MODES` / `SALARY_CHARACTERS` to `frontend/src/config/modes.ts` (already partially there).
3. `startSession()` only called from prep step **Enter studio** (not from overlay on stage).

**Acceptance:** Clicking Get started never shows the black stage until scenario + opponent (+ context acknowledged) are chosen; matches old wizard UX with current design tokens.

---

## Phase 3 — Continuous conversation (2–4 days)

### 3.1 Product behavior

| Situation | Behavior |
|-----------|----------|
| AI speaking | User can **barge in** — duck/stop TTS, switch to listening |
| User speaking | Show live user caption; do not call `/turn` yet |
| User silent ≥ hangover | Finalize utterance → `THINKING` → STT → `/turn` → AI responds |
| User never spoke | Do not submit empty turns (`TurnRequest` min_length=1) — stay in listen |
| AI thinking | Mic can stay open but ignore VAD for turn submit (or mute graph) |
| Manual fallback | Keep a small “Send now” text button in footer for noisy rooms / accessibility |

### 3.2 State machine changes

Extend `TurnState` in `contracts.ts`:

```text
IDLE → ASKING → LISTENING ⇄ THINKING → ASKING → … → REPORT
         ↑          |
         └─ INTERRUPTED (optional explicit state) or LISTENING with cancelToken on TTS
```

Implement in `use-interview-machine.ts`:

- `stopSpeaking()` on barge-in (already exists).
- `finalizeUserTurn(): void` — stop recorder, flush STT, transition to `THINKING`.
- `armListenMode(): void` — called when AI finishes or barge-in completes.

### 3.3 End-of-utterance detection (recommended architecture)

**Tier 1 — Ship first (no new deps)**

- `AnalyserNode` RMS on mic track from existing `MediaStream`.
- Parameters (tune in `frontend/src/voice/vad-config.ts`):
  - `speakThresholdDb`: ~−45 dBFS (calibrate noise floor for 300ms on listen start).
  - `silenceHangoverMs`: **900–1200** (negotiation pacing; user may pause to think).
  - `minSpeechMs`: **400** (ignore coughs).
  - `maxUtteranceMs`: **120000** (force finalize).
- Pre-speech ring buffer **300ms** when starting MediaRecorder segment (concatenate chunks) to avoid clipped first syllable.

**Tier 2 — Optional upgrade**

- `@ricky0123/vad-web` (Silero in WASM) in a Web Worker for noisy environments — same `speech-end` → `finalizeUserTurn` contract.

**References:** hysteresis + hangover patterns (Silero VAD configs: `minSilenceDurationMs`, `speechPadMs`); RMS kit patterns (`silenceDetectionDelayMs`).

### 3.4 STT strategy during continuous mode

| `serverSttAvailable` | Behavior |
|---------------------|----------|
| `true` | MediaRecorder collects segment between `speech-start` and `speech-end`; POST blob to `/api/stt` on finalize |
| `false` | Keep `useBrowserSpeechCapture` running; on finalize, `stop()` + `getTranscript()` (current path) |

Partial transcripts drive **user caption only**; `/turn` uses finalized text once.

### 3.5 Barge-in

1. While `speakingPhase === 'audible'`, run lightweight VAD on mic.
2. If speech detected for ≥ `bargeInMinMs` (200–300ms):
   - `stopSpeaking()` + increment speak token.
   - `listen()` / `armListenMode()`.
   - Set character expression to listening frame (`useCharacterExpression` already handles `LISTENING`).
3. Ducking: optional `audio.volume = 0.2` for 150ms before stop — polish only.

### 3.6 UI changes

- Remove primary **Stop & submit** (`Setup.tsx` ~1754) or demote to secondary “Send now”.
- Footer mic stays toggle; state pill text: “Listening…” / “Interviewer speaking” / “Processing…”.
- Disable scenario dropdowns during live session (already partially done).

### 3.7 Backend

No schema change required for basic continuous mode if finalized text still posts to `POST /turn`.

Optional: accept `answer: ""` with `meta.skip: true` — **avoid** unless needed; prefer frontend gate.

**Acceptance:** User completes a full exchange without clicking Stop; barge-in stops AI mid-sentence; silence triggers next question; empty silence does not 400 the API.

---

## Phase 4 — Presage-driven interviewer reactions (2–3 days)

### 4.1 Goals

When live signals show elevated stress, anger proxy, or collapsing composure, the interviewer may **interject** briefly (“Let’s take a breath”, “I notice this is tense — walk me through your reasoning”) without advancing the main rubric turn.

### 4.2 Signal sources

| Source | When | Fields |
|--------|------|--------|
| MediaPipe | Always in browser | `stress`, `engagement`, `raw.exprStress` |
| Sidecar | When `:8100` reachable | `pulse`, `expression`, `confidence` |
| Turn composure | After each answer | `decision.input_snapshot.composure` |

Define thresholds in `frontend/src/config/composure-thresholds.ts` (and mirror constants server-side):

```ts
export const INTERJECT = {
  stressHigh: 0.72,        // sustained 3s
  composureLow: 0.38,      // sustained 3s
  hrElevated: 100,         // sidecar pulse
  cooldownMs: 45000,       // per session
  maxInterjectsPerSession: 4,
}
```

Use **sustained** breach (≥3s at 1Hz sampler) to avoid flicker.

### 4.3 API design

**New endpoint** (recommended):

`POST /sessions/{session_id}/interject`

Request:

```json
{
  "trigger": "high_stress",
  "snapshot": {
    "composure": 0.41,
    "stress": 0.78,
    "hr_bpm": 104,
    "source": "mediapipe"
  }
}
```

Response:

```json
{
  "text": "Short in-character interjection.",
  "resume": true
}
```

Implementation:

1. `interviewer.py`: `generate_interjection(session_id, trigger, snapshot)` — Gemini when keyed; mock lines when not.
2. `main.py`: rate-limit per session in SQLite (`interject_count`, `last_interject_at` in settings_json or new columns).
3. **Does not** append a full turn to history unless you want it in report — decision:
   - **Option A (simpler):** interjections are audio-only overlays, not stored.
   - **Option B (richer report):** store as `turn_type: "interjection"` in repository — more work.

### 4.4 Frontend orchestration

1. `useComposureReactions.ts` watches `composureSample` + optional vitals poll.
2. On trigger + cooldown OK:
   - If AI speaking → queue interjection after TTS ends **or** merge barge-in policy (product: allow interjection to interrupt user only when stress critical).
   - Call `/interject`, then `ask(text)` with flag `isInterjection: true` (shorter caption styling).
3. Pass `lastInterjection` into `useCharacterExpression` for stern vs neutral.

### 4.5 Director / Nemotron

Keep Nemotron director on full `/turn` only. Interjections are **interviewer-only** copy to avoid doubling control planes.

**Acceptance:** Simulated high stress (or sidecar test data) produces at most one interjection per cooldown; session continues; report still makes sense.

---

## Phase 5 — Sidecar & vitals plumbing (parallel / optional)

Until `presage_smoke` succeeds, browser-only metrics still satisfy Phase 1.6 labels with “Sidecar offline”.

1. Implement minimal HTTP sidecar on `127.0.0.1:8100`:
   - `GET /health`
   - `GET /composure` → JSON matching `to_composure()` in `composure.py`
2. Add `GET /vitals` returning raw cardio/breathing for the UI pane (even if composure stays scalar).
3. Proxy from FastAPI: `GET /sessions/{id}/vitals` reads sidecar once, adds CORS safety — frontend should not call `:8100` directly in production.

Document in `handoff.md` when done.

---

## Implementation order (recommended)

```text
Phase 1.1–1.5  (camera, captions, sprite, TTS sync)     ← same PR OK
Phase 1.6        (Presage metrics completeness)
Phase 2          (prep wizard)
Phase 3          (continuous conversation + VAD)
Phase 4          (interjections) — depends on 1.6 signals
Phase 5          (sidecar) — parallel if Windows box available
```

---

## Testing checklist

### Manual (localhost)

- [ ] `npm run dev` + uvicorn; `/start` prep → live session.
- [ ] Camera default top-right; drag/resize; no overlap with stats toggle.
- [ ] Long interviewer question wraps; user caption animates on speak.
- [ ] All three characters: head visible, talking sync with audio.
- [ ] Continuous mode: silence ends turn; barge-in stops AI.
- [ ] Without `ELEVENLABS_API_KEY`: browser TTS still syncs animation via `onstart`.
- [ ] With mock keys only: interjection mock path fires on forced threshold in dev toggle.
- [ ] `npm run build` clean.

### Automated (add as you go)

- Unit test: VAD hangover state machine (pure TS).
- Unit test: `speakingPhase` transitions with mocked `Audio` events.

---

## Files to touch (summary)

| Change | Files |
|--------|--------|
| Camera / captions / sprite CSS | `frontend/src/pages/Setup.css` |
| Studio layout & prep split | `frontend/src/pages/Setup.tsx` → `StudioPrep.tsx`, `StudioLive.tsx` |
| Caption component | `frontend/src/components/StageCaptionStack.tsx` |
| TTS audible phase | `frontend/src/hooks/use-interview-machine.ts`, `use-character-expression.ts` |
| Metrics | `use-presage-metrics.ts`, `use-composure-sampler.ts`, `contracts.ts` |
| VAD / continuous | `frontend/src/voice/vad.ts`, `vad-config.ts`, `use-interview-machine.ts` |
| Prep routing | `frontend/src/App.tsx`, `Home.tsx` |
| Interject API | `backend/main.py`, `interviewer.py`, `repository.py` (optional) |
| Vitals proxy | `backend/main.py`, `composure.py` |

---

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| VAD false positives in noisy hackathon rooms | Noise floor calibration + manual “Send now”; Tier 2 Silero |
| Double camera (MediaPipe + Presage sidecar) | Document mutual exclusion per `presage-step5.md`; disable self-view when sidecar owns camera |
| Interjections feel naggy | Cooldown + sustained thresholds + max per session |
| Prep wizard lengthens demo | Default selections remembered in `localStorage` |
| Large `Setup.tsx` refactor | Split prep/live first, then features |

---

## Out of scope (this plan)

- Production deploy / CORS (`handoff.md` backlog)
- Enabling locked scenario modes (`interview`, `speaking`, `thesis`) beyond UI placeholders
- Replacing MediaPipe with Presage for authoritative report composure (backend turn store remains source of truth for scoring)

---

*Replaces the previous SpeakUp **frontend integration** checklist (Phases 0–6 complete). Integration history remains in git; runtime docs stay in [handoff.md](handoff.md).*
