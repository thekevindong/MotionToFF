import { useEffect, useState } from 'react'

import { getSessionVitals } from '../lib/api'

export type PresageVitalsSnapshot = {
  sidecarReachable: boolean
  pulse: number | null
  breathing: number | null
  composureMode: string | null
}

const EMPTY: PresageVitalsSnapshot = {
  sidecarReachable: false,
  pulse: null,
  breathing: null,
  composureMode: null,
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Poll session vitals via main API (proxies sidecar :8100). */
export function usePresageVitals(active: boolean, sessionId: string | null): PresageVitalsSnapshot {
  const [snap, setSnap] = useState<PresageVitalsSnapshot>(EMPTY)

  useEffect(() => {
    if (!active || !sessionId) {
      setSnap(EMPTY)
      return
    }

    let cancelled = false

    const poll = async () => {
      try {
        const data = await getSessionVitals(sessionId)
        if (cancelled) return
        setSnap({
          sidecarReachable: Boolean(data.sidecar_reachable),
          pulse: toNumber(data.pulse),
          breathing: toNumber(data.breathing),
          composureMode: data.composure_mode ?? null,
        })
      } catch {
        /* offline / CORS — keep last snapshot */
      }
    }

    void poll()
    const id = window.setInterval(() => void poll(), 2000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [active, sessionId])

  return snap
}
