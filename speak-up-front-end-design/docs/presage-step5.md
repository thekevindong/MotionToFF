# Step 5 — Presage smoke test (time-boxed)

## Goal

Run the official SmartSpectra **hello vitals** sample on the demo machine and get **one** cardio or breathing metric line printed. Decide how `sample_composure()` will integrate later while keeping the **mock** as the default so `/turn` stays green.

## Official reference

- Windows quickstart: [SmartSpectra `cpp/docs/windows/index.md`](https://github.com/Presage-Security/SmartSpectra/blob/main/cpp/docs/windows/index.md)
- SDK release (Windows x64 ZIP): [v3.3.0 `smartspectra-sdk-3.3.0-windows-x64.zip`](https://github.com/Presage-Security/SmartSpectra/releases/download/v3.3.0/smartspectra-sdk-3.3.0-windows-x64.zip)
- API key: [physiology.presagetech.com](https://physiology.presagetech.com/auth/login)

This repo mirrors the quickstart under `presage_smoke/` (`hello_vitals.cpp`, `CMakeLists.txt`).

## How to run

1. Add `PRESAGE_API_KEY=...` (or `SMARTSPECTRA_API_KEY`) to `backend/.env`.
2. Install **Visual Studio 2022** (or Build Tools) with **Desktop development with C++** and **CMake tools for Windows**.
3. From an **x64 Native Tools** prompt (or use the script, which locates `VsDevCmd.bat`):

```powershell
cd presage_smoke
.\run_smoke.ps1 -DownloadSdk
```

Success = log contains `Cardio metrics:` or `Breathing metrics:` (see upstream docs).

## Smoke attempt on this dev machine (2026-09-19)

| Check | Result |
| ----- | ------ |
| `PRESAGE_API_KEY` in `backend/.env` | Not set |
| `SMARTSPECTRA_SDK_PATH` / `C:\SmartSpectra` | Not present |
| `cmake` / MSVC `cl` on PATH | Not found |
| Vitals line printed | **No** (blocked before build) |

**Hard-stop decision:** treat Presage as **unverified** for now. The interview spine keeps using the **mock** composure scalar (`0.72`). Speech-derived fallback is implemented behind the same module and exposed on `GET /debug/presage` for manual checks.

## Sidecar vs REST (integration choice for step 7)

| Approach | Pros | Cons |
| -------- | ---- | ---- |
| **REST-only from Python** | Fewer moving parts | No first-class Python SDK in the hackathon bundle; still need native runtime for camera on Windows |
| **Sidecar (recommended)** | Webcam owned by one process; main API stays Python; crash isolation on `:8100`; matches plan.md step 7 | Requires C++ hello_vitals → JSON stdout → thin FastAPI sidecar |

**Chosen path:** **sidecar on `localhost:8100`** (`GET /composure`, `GET /health`). The C++ sample already uses continuous camera + REST API key; the sidecar wraps that binary and the backend pulls the latest sample.

`sample_composure()` (step 7, not enabled by default):

```text
COMPOSURE_MODE=auto  →  GET http://localhost:8100/composure  →  to_composure(json)
                      →  on failure: fallback_composure_from_speech(...)
COMPOSURE_MODE=mock   →  fixed 0.72 (current default for the spine)
```

The browser **does not** call the sidecar; it only talks to the main backend (per plan.md).

## Camera conflict note

`/diag` opens the webcam in the browser. When the Presage sidecar is running, **do not** also open the camera in the browser — use the composure gauge from the backend instead.
