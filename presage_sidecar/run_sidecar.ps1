# Start demo Presage HTTP sidecar on 127.0.0.1:8100 (uses backend venv).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root "backend"
$venvPython = Join-Path $backend ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Error "Create backend venv first: cd backend; python -m venv .venv; pip install -r requirements.txt"
}
Push-Location $backend
try {
    & $venvPython -m presage_sidecar
} finally {
    Pop-Location
}
