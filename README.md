# MotionToFF — Practice Interview (SteelHacks XIII)

**Agent / teammate onboarding:** [handoff.md](handoff.md) · **Checklist:** [plan.md](plan.md)

## Run backend + frontend

### Backend (port 8000)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend (Next.js, port 3000)

```powershell
cd frontend
pnpm install   # or: npx pnpm@12.3.4 install
pnpm dev       # or: npx pnpm@12.3.4 dev
```

Copy `frontend/.env.example` to `frontend/.env.local` and set `ELEVENLABS_API_KEY` when using voice routes.

Open http://localhost:3000 — join a call, answer via voice (or browser STT fallback messaging), then http://localhost:3000/report for composure + rubrics.

## Step 5 — Presage smoke test

Official **hello vitals** sources live in `presage_smoke/`. Full notes and the sidecar decision are in [docs/presage-step5.md](docs/presage-step5.md).

```powershell
# After PRESAGE_API_KEY is in backend/.env and VS Build Tools are installed:
cd presage_smoke
.\run_smoke.ps1 -DownloadSdk
```

Backend diagnostic (mock composure still drives `/turn`):

```text
GET http://localhost:8000/debug/presage
```
