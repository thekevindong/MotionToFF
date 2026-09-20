"""Run: cd backend && python -m presage_sidecar"""

from __future__ import annotations

import os

import uvicorn

if __name__ == "__main__":
    host = os.getenv("PRESAGE_SIDECAR_HOST", "127.0.0.1")
    port = int(os.getenv("PRESAGE_SIDECAR_PORT", "8100"))
    uvicorn.run("presage_sidecar.main:app", host=host, port=port, reload=False)
