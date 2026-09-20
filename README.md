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

### Frontend (Vite + React, port 5173)

```powershell
cd frontend
npm install
npm run dev
```

Or from repo root: `npm run dev` (after `npm install` in `frontend/` once).

Copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL` if the API is not on `http://localhost:8000`.

Open http://localhost:5173 — **Enter studio** (`/start`). Legacy URLs `/setup`, `/interview`, and `/report` still work as aliases. Rollback UI: branch `legacy-next-frontend` (Next.js on port 3000).

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
