# MotionToFF — build plan (living)

SteelHacks XIII (Sept 19–20, 2026). Practice app for high-stakes conversations: speech in, AI interviewer out, **Nemotron** scores + directs, **Presage** composure on webcam, post-session **report**.

**Handoff for agents:** see [handoff.md](handoff.md).

---

## Product (MUST HAVE for demo)

- One mode end-to-end (mock job interview)
- Voice out, speech in, session loop
- Nemotron scoring + director decisions, logged
- Report with composure curve

**Differentiator:** composure signal affects director + report, not just transcript quality.

---

## Architecture (model roles — strict)

- **Gemini** → `interviewer.py` — dialogue only
- **Nemotron** → `judge.py` (rubric JSON), `director.py` (one action, no speech)
- **Presage** → `composure.py` — 0–1 scalar into director + store
- **ElevenLabs** → not wired yet (TTS / optional Scribe STT)
- **Tiger Data** → not wired yet (replace `store.py`)

---

## Scaffold progress

| # | Item | Status |
|---|------|--------|
| 1 | Backend `/health` + frontend CORS | Done |
| 2 | Mock seams + `GET /debug` | Done |
| 3 | `POST /turn` + interview UI | Done |
| 4 | `GET /diag` mic/webcam/TTS | Done |
| 5 | Presage hello vitals smoke | **Postponed** — see [docs/presage-step5.md](docs/presage-step5.md) |
| 6 | `GET /report` UI (composure chart + rubrics) | Done |
| 7 | Presage sidecar `:8100` + `COMPOSURE_MODE=auto` | **Not started** (depends on step 5) |

Step 7 spec (C++ capture → JSON stdout → thin FastAPI on 8100 → `sample_composure()`) remains in `docs/presage-step5.md` and `handoff.md`; do not duplicate here until implementation starts.

---

## Next after repo push

1. Wire API keys in `backend/.env` (see `backend/.env.example`).
2. Swap mocks in `interviewer` / `judge` / `director` one at a time; keep `/turn` response shape.
3. Optional: v0/Vercel frontend → `VITE_API_URL` + `CORS_EXTRA_ORIGINS`.
4. When Presage unblocked: smoke → sidecar → `COMPOSURE_MODE=auto`.

---

## Risks (still relevant)

- Presage unverified on dev machine — mock + speech fallback keep spine green.
- Browser mic + TTS conflict — mitigations explored on `/diag` (pause recognition during TTS).
- Parallel judge/composure on `/turn` — already using `asyncio.gather` shape for real latency.

---

## Eval (NVIDIA Beyond the Chatbot — don’t skip)

- Labeled answer set vs Nemotron rubric separation
- Director-on vs fixed script A/B
- Log `(input_snapshot → decision)` from `director.decide`
- Document at least one failure case
