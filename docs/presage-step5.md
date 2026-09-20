# Step 5 — Presage smoke test (time-boxed)

## Goal

On a **Windows** demo machine, build and run the official SmartSpectra **hello vitals** sample and get **one** `Cardio metrics:` or `Breathing metrics:` line in the log. Until that passes, treat camera vitals as unproven; the app still demos via mock composure (no key) or **speech fallback** (Presage key set, no sidecar).

## Official reference

- Windows quickstart: [SmartSpectra `cpp/docs/windows/index.md`](https://github.com/Presage-Security/SmartSpectra/blob/main/cpp/docs/windows/index.md)
- SDK (Windows x64 ZIP): [v3.3.0 release](https://github.com/Presage-Security/SmartSpectra/releases/download/v3.3.0/smartspectra-sdk-3.3.0-windows-x64.zip)
- API key: [physiology.presagetech.com](https://physiology.presagetech.com/auth/login)

This repo mirrors the quickstart under `presage_smoke/` (`hello_vitals.cpp`, `CMakeLists.txt`, `run_smoke.ps1`).

## How to run

1. Add `PRESAGE_API_KEY=...` (or `SMARTSPECTRA_API_KEY`) to `backend/.env`.  
   Use **`PRESAGE_API_KEY`** — `PRESALE_API_KEY` is a common typo and will not load.
2. Install **Visual Studio 2022** (or Build Tools) with **Desktop development with C++** and **CMake tools for Windows**.
3. MSVC **v143 14.38+** is required for SDK 3.3.0 (older toolsets fail at link). Update via Visual Studio Installer → modify C++ workload.
4. Optional: set `SMARTSPECTRA_SDK_PATH` if the SDK is not under `presage_smoke/.sdk/extracted`.

```powershell
cd presage_smoke
.\run_smoke.ps1 -DownloadSdk
```

- **Success:** `smoke_last_run.log` (or console) contains `Cardio metrics:` or `Breathing metrics:`.
- **Build only:** `.\run_smoke.ps1 -DownloadSdk -BuildOnly`
- Logs and SDK live under `presage_smoke/` and are **gitignored** (`build/`, `.sdk/`, `smoke_*.txt`, `smoke_last_run.log`).

The script reads the API key from `backend/.env` or the environment, locates VS `VsDevCmd.bat` / CMake under standard `Program Files` paths, and temporarily removes MinGW from `PATH` so CMake uses `cl`, not `g++`.

## Record your smoke run (fill in when tested)

| Check | Result |
| ----- | ------ |
| Date / machine | _e.g. 2026-09-20, laptop name_ |
| `PRESAGE_API_KEY` in `backend/.env` | _Set / missing_ |
| SDK extracted (`run_smoke.ps1 -DownloadSdk`) | _Yes / no_ |
| VS 2022 + CMake | _Yes / no_ |
| MSVC toolset version | _need **14.38+**_ |
| `hello_vitals.exe` built | _Yes / link failed_ |
| Vitals line printed (webcam) | _Yes / no_ |

**Team default until smoke passes:** backend composure = **mock `0.72`** without a Presage key; with key and no sidecar = **`auto`** → speech fallback.

**Demo sidecar (no camera):** `cd backend && python -m presage_sidecar` serves `GET /health`, `GET /composure`, `GET /vitals` on **`127.0.0.1:8100`** with synthetic pulse/breathing. The main API proxies to the browser via `GET /sessions/{id}/vitals`. Replace demo payloads with SmartSpectra SDK output after smoke passes.

Re-run after fixing MSVC or SDK:

```powershell
cd presage_smoke
.\run_smoke.ps1 -DownloadSdk
```

Backend probe (no camera): `GET http://localhost:8000/debug/presage` — shows mode, sidecar reachability, whether a key is configured.

## Step 7 integration (after smoke passes)

| Approach | Pros | Cons |
| -------- | ---- | ---- |
| **REST-only from Python** | Fewer processes | No bundled Python SDK; camera still needs native code on Windows |
| **Sidecar (recommended)** | One camera owner; Python API unchanged; isolate crashes on `:8100` | Wrap `hello_vitals` → HTTP (`GET /health`, `GET /composure`) |

**Planned path:** sidecar on **`127.0.0.1:8100`** (override with `PRESAGE_SIDECAR_URL` on the main API). Backend `composure.py` already probes that URL when mode is `auto` or `sidecar`.

```text
No Presage key     →  mock 0.72
Key + COMPOSURE_MODE unset  →  auto: sidecar GET /composure → else speech fallback
COMPOSURE_MODE=mock|sidecar|fallback  →  explicit override
```

The browser **does not** call the sidecar; only the main backend samples during `POST /turn`.

## Camera conflict

`/interview` uses the **browser webcam** (MediaPipe badge — UX only). When the Presage sidecar owns the camera, **do not** run both on the same device: disable or hide the interview self-view, or run sidecar on the machine that presents while judges use a read-only UI. **Report composure** always comes from the backend turn store, not MediaPipe.
