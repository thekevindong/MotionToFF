# MotionToFF — what's left

Runtime truth: [handoff.md](handoff.md). Presage notes: [docs/presage-step5.md](docs/presage-step5.md).

**Done:** Interview loop, report, env-gated AI seams, ElevenLabs, SQLite persistence, `/setup` + document upload, Gemini grounded on resume/job text (`repository.py`, `interviewer.py`).

---

## Backlog (priority order)

### 1. Deploy (Phase 6)

- Host API: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- DB: SQLite volume **or** Postgres via `DATABASE_URL` (not wired yet — today is SQLite only)
- Uploads: mounted volume or object storage on cloud
- Vercel `frontend/`: `NEXT_PUBLIC_API_URL`, `ELEVENLABS_API_KEY`
- API: `CORS_EXTRA_ORIGINS` + all backend keys as needed
- Smoke: health → `/setup` or `/sessions` → optional upload → one turn → `/report`
- Presage: sidecar stays **local Windows demo**; cloud uses speech fallback + MediaPipe badge

### 2. Presage sidecar (Phase 7)

- Thin HTTP on `:8100`: `GET /health`, `GET /composure` for `composure.py` (`PRESAGE_SIDECAR_URL`)
- Package under `presage_sidecar/` or extend `presage_smoke/`
- Frontend: when sidecar is source of truth, avoid dual camera (disable MediaPipe or read-only vitals copy)
- Verify: `/debug/presage` → `sidecar_reachable: true`; composure ≠ `0.72` when live

### 3. Presage smoke (Phase 5, optional)

- `presage_smoke/run_smoke.ps1 -DownloadSdk` on a Windows box with VS 2022 + CMake
- Record pass/fail in `docs/presage-step5.md`

### 4. Polish (Phase 9, optional)

- JSONL export of turns + `director.input_snapshot` (Beyond the Chatbot)
- Report “top 3 fixes” from rubric/red_flags (not in `interviewer.py`)
- Director ablation script; `NEMOTRON_MODEL` / latency notes

---

## Quick verify (local)

```powershell
cd backend; .\.venv\Scripts\Activate.ps1; uvicorn main:app --reload --port 8000
cd frontend; pnpm dev
```

- [ ] `/setup` → interview → `/report`
- [ ] Restart API → same `session_id` in browser → report still loads
- [ ] With `GEMINI_API_KEY`, questions reference uploaded resume

---

## Risks

| Risk | Mitigation |
|------|------------|
| Presage Windows-only | Presenter laptop sidecar; cloud speech fallback |
| Upload PII | `backend/data/` gitignored; delete policy on deploy |
| `/turn` latency | Judge ∥ composure already; context capped at 8k chars |
