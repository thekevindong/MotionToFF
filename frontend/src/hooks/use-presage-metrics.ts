import { useEffect, useMemo, useRef, useState } from 'react'

import type { ComposureSample, TurnState } from '../lib/contracts'
import type { PresageVitalsSnapshot } from './use-presage-vitals'

const FILLER_RE = /\b(um|uh|uhm|erm|like|you know|sort of|kind of)\b/gi

export type PresageMetricRow = {
  label: string
  value: number | string
  unit: string
  barPct: number
  invert?: boolean
  hint?: string
  showBar?: boolean
}

function countFillers(text: string): number {
  return text.match(FILLER_RE)?.length ?? 0
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

function unavailableRow(label: string, hint?: string): PresageMetricRow {
  return { label, value: '—', unit: '', barPct: 0, showBar: false, hint }
}

/** Map sampler + optional backend turn composure into Presage pane rows. */
export function usePresageMetrics({
  sample,
  turnState,
  backendComposure,
  faceReady,
  getTranscript,
  listening,
  vitals,
}: {
  sample: ComposureSample | null
  turnState: TurnState
  backendComposure: number | null
  faceReady: boolean
  getTranscript: () => string
  listening: boolean
  vitals: PresageVitalsSnapshot
}) {
  const listenStartRef = useRef<number | null>(null)
  const [speechWpm, setSpeechWpm] = useState<number | null>(null)
  const [fillerCount, setFillerCount] = useState(0)

  useEffect(() => {
    if (listening) {
      if (listenStartRef.current === null) listenStartRef.current = Date.now()
    } else {
      listenStartRef.current = null
    }
  }, [listening])

  useEffect(() => {
    if (!listening) return
    const id = window.setInterval(() => {
      const text = getTranscript()
      const fillers = countFillers(text)
      setFillerCount(fillers)
      const started = listenStartRef.current
      if (!started) return
      const minutes = (Date.now() - started) / 60_000
      const words = wordCount(text)
      if (minutes > 0.05 && words >= 3) {
        setSpeechWpm(Math.round(words / minutes))
      }
    }, 400)
    return () => window.clearInterval(id)
  }, [listening, getTranscript])

  return useMemo((): { metrics: PresageMetricRow[]; speechWpm: number | null } => {
    const liveComposure = sample?.composure ?? 0.7
    const engagement = sample?.signals.engagement ?? null
    const stress = sample?.signals.expression?.stress ?? null
    const faceRaw = sample?.signals.faceRaw ?? null

    const showBackend = backendComposure !== null && turnState === 'ASKING'
    const composure01 = showBackend ? backendComposure : liveComposure
    const composurePct = Math.round(composure01 * 100)

    const hr =
      vitals.pulse ??
      sample?.signals.vitals?.hr_bpm ??
      null
    const breathing =
      vitals.breathing ??
      sample?.signals.vitals?.breathing_rate ??
      null

    const eyePct = engagement !== null ? Math.round(engagement * 100) : null
    const stressPct = stress !== null ? Math.round(stress * 100) : null
    const headStability =
      faceRaw !== null ? Math.round((1 - faceRaw.instability) * 100) : null
    const lookAwayPct = faceRaw !== null ? Math.round(faceRaw.lookAway * 100) : null
    const blinkRate = faceRaw !== null ? faceRaw.blinksPerMin : null

    const paceWpm = speechWpm ?? 0
    const paceBar = paceWpm > 0 ? Math.min(100, Math.round((paceWpm / 180) * 100)) : 50

    const fillerBar = Math.min(100, fillerCount * 12)

    const calibrating = !faceReady && !showBackend
    const hasFace = faceReady && sample?.source === 'presage' && faceRaw !== null

    const rows: PresageMetricRow[] = [
      {
        label: 'Composure',
        value: composurePct,
        unit: '',
        barPct: composurePct,
        hint: showBackend ? 'From last answer (server)' : calibrating ? 'Calibrating…' : 'Live (camera)',
      },
      hr !== null
        ? {
            label: 'Heart rate',
            value: Math.round(hr),
            unit: ' bpm',
            barPct: Math.min(100, Math.round((hr / 120) * 100)),
            hint: vitals.sidecarReachable ? 'Sidecar pulse' : undefined,
          }
        : unavailableRow('Heart rate', vitals.sidecarReachable ? 'Waiting for sidecar…' : 'Sidecar offline'),
      breathing !== null
        ? {
            label: 'Breathing rate',
            value: Math.round(breathing),
            unit: ' /min',
            barPct: Math.min(100, Math.round((breathing / 24) * 100)),
            hint: vitals.sidecarReachable ? 'Sidecar breathing' : undefined,
          }
        : unavailableRow('Breathing rate', 'Sidecar offline'),
      eyePct !== null
        ? {
            label: 'Eye contact',
            value: eyePct,
            unit: '%',
            barPct: eyePct,
            hint: hasFace ? 'Gaze + head stability' : undefined,
          }
        : unavailableRow('Eye contact', calibrating ? 'Calibrating…' : 'No face signal'),
      stressPct !== null
        ? {
            label: 'Expression stress',
            value: stressPct,
            unit: '%',
            barPct: stressPct,
            invert: true,
          }
        : unavailableRow('Expression stress'),
      headStability !== null
        ? {
            label: 'Head stability',
            value: headStability,
            unit: '%',
            barPct: headStability,
          }
        : unavailableRow('Head stability'),
      lookAwayPct !== null
        ? {
            label: 'Gaze / look-away',
            value: lookAwayPct,
            unit: '%',
            barPct: lookAwayPct,
            invert: true,
          }
        : unavailableRow('Gaze / look-away'),
      blinkRate !== null
        ? {
            label: 'Blink rate',
            value: Math.round(blinkRate),
            unit: ' /min',
            barPct: Math.min(100, Math.round((blinkRate / 30) * 100)),
          }
        : unavailableRow('Blink rate'),
      {
        label: 'Pace',
        value: paceWpm > 0 ? paceWpm : '—',
        unit: paceWpm > 0 ? ' wpm' : '',
        barPct: paceWpm > 0 ? paceBar : 0,
        showBar: paceWpm > 0,
      },
      {
        label: 'Filler words',
        value: fillerCount,
        unit: '',
        barPct: fillerBar,
        invert: true,
      },
    ]

    return { metrics: rows, speechWpm: speechWpm ?? null }
  }, [
    sample,
    turnState,
    backendComposure,
    faceReady,
    speechWpm,
    fillerCount,
    listening,
    vitals,
  ])
}

export function presageStatusLabel({
  sessionLive,
  faceReady,
  sample,
  vitals,
}: {
  sessionLive: boolean
  faceReady: boolean
  sample: ComposureSample | null
  vitals: PresageVitalsSnapshot
}): string {
  if (!sessionLive) return 'idle'
  if (vitals.sidecarReachable) return 'live · sidecar vitals'
  if (!faceReady) return 'calibrating camera'
  if (sample?.source === 'presage' && sample.signals.faceRaw) return 'live · face tracking'
  return 'speech fallback'
}
