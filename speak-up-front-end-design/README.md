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

### Frontend (port 5173)

```powershell
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173, or **5174** if 5173 is already in use). You should see **backend ok** when the API is running.

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
