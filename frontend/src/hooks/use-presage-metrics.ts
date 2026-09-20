import { useEffect, useMemo, useRef, useState } from 'react'

import type { ComposureSample, TurnState } from '../lib/contracts'

const FILLER_RE = /\b(um|uh|uhm|erm|like|you know|sort of|kind of)\b/gi

export type PresageMetricRow = {
  label: string
  value: number | string
  unit: string
  barPct: number
  invert?: boolean
  hint?: string
}

function countFillers(text: string): number {
  return text.match(FILLER_RE)?.length ?? 0
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) return 0
  return trimmed.split(/\s+/).length
}

/** Map sampler + optional backend turn composure into Presage pane rows. */
export function usePresageMetrics({
  sample,
  turnState,
  backendComposure,
  faceReady,
  getTranscript,
  listening,
}: {
  sample: ComposureSample | null
  turnState: TurnState
  backendComposure: number | null
  faceReady: boolean
  getTranscript: () => string
  listening: boolean
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

  return useMemo((): PresageMetricRow[] => {
    const liveComposure = sample?.composure ?? 0.7
    const engagement = sample?.signals.engagement ?? 0.7
    const stress = sample?.signals.expression?.stress ?? 0.25
    const neutral = sample?.signals.expression?.neutral ?? 1 - stress

    const showBackend = backendComposure !== null && turnState === 'ASKING'
    const composure01 = showBackend ? backendComposure : liveComposure
    const composurePct = Math.round(composure01 * 100)

    const eyePct = Math.round(engagement * 100)
    const vocalPct = Math.round(neutral * 100)

    const paceWpm = speechWpm ?? 0
    const paceBar = paceWpm > 0 ? Math.min(100, Math.round((paceWpm / 180) * 100)) : 50

    const fillerBar = Math.min(100, fillerCount * 12)
    const fillerDisplay = listening ? fillerCount : fillerCount

    const calibrating = !faceReady && !showBackend

    return [
      {
        label: 'Composure',
        value: composurePct,
        unit: '',
        barPct: composurePct,
        hint: showBackend ? 'From last answer (server)' : calibrating ? 'Calibrating…' : 'Live (camera)',
      },
      {
        label: 'Eye contact',
        value: eyePct,
        unit: '%',
        barPct: eyePct,
        hint: sample?.source === 'presage' ? 'Gaze + head stability' : undefined,
      },
      {
        label: 'Vocal steadiness',
        value: vocalPct,
        unit: '%',
        barPct: vocalPct,
      },
      {
        label: 'Pace',
        value: paceWpm > 0 ? paceWpm : '—',
        unit: paceWpm > 0 ? ' wpm' : '',
        barPct: paceBar,
      },
      {
        label: 'Filler words',
        value: fillerDisplay,
        unit: '',
        barPct: fillerBar,
        invert: true,
      },
    ]
  }, [sample, turnState, backendComposure, faceReady, speechWpm, fillerCount, listening])
}
