import { useCallback, useEffect, useRef } from 'react'

import type { InterjectTrigger } from '../config/composure-thresholds'
import { interjectThresholdsForSession } from '../config/composure-thresholds'
import type { ComposureSample } from '../lib/contracts'
import type { PresageVitalsSnapshot } from './use-presage-vitals'
import type { SpeakingPhase } from './use-interview-machine'
import type { TurnState } from '../lib/contracts'
import { postInterject } from '../lib/api'

type Snapshot = {
  composure: number
  stress: number
  hr_bpm?: number | null
  source: string
}

type Pending = {
  trigger: InterjectTrigger
  snapshot: Snapshot
}

function pickTrigger(
  sample: ComposureSample,
  vitals: PresageVitalsSnapshot,
  devForce: boolean,
): InterjectTrigger | null {
  const thresholds = interjectThresholdsForSession()
  const stress = sample.signals?.expression?.stress ?? 0
  const composure = sample.composure

  if (devForce) return 'high_stress'
  if (stress >= thresholds.stressHigh) return 'high_stress'
  if (composure <= thresholds.composureLow) return 'composure_low'
  if (vitals.pulse != null && vitals.pulse >= thresholds.hrElevated) return 'hr_elevated'
  return null
}

function buildSnapshot(sample: ComposureSample, vitals: PresageVitalsSnapshot): Snapshot {
  const stress = sample.signals?.expression?.stress ?? 0
  let source = 'mediapipe'
  if (vitals.sidecarReachable) source = 'sidecar'
  else if (!sample.signals?.faceRaw) source = 'speech_fallback'
  return {
    composure: sample.composure,
    stress,
    hr_bpm: vitals.pulse,
    source,
  }
}

interface Args {
  active: boolean
  sessionId: string | null
  sample: ComposureSample | null
  vitals: PresageVitalsSnapshot
  turnState: TurnState
  speakingPhase: SpeakingPhase
  devForceStress: boolean
  onInterjection: (text: string, trigger: InterjectTrigger) => void
  onInterjectionError?: (message: string) => void
}

export function useComposureReactions({
  active,
  sessionId,
  sample,
  vitals,
  turnState,
  speakingPhase,
  devForceStress,
  onInterjection,
  onInterjectionError,
}: Args) {
  const sustainedRef = useRef<{ trigger: InterjectTrigger | null; count: number }>({
    trigger: null,
    count: 0,
  })
  const inFlightRef = useRef(false)
  const pendingRef = useRef<Pending | null>(null)
  const lastLocalFireRef = useRef(0)

  const thresholds = interjectThresholdsForSession()

  const fireInterjection = useCallback(
    async (pending: Pending) => {
      if (!sessionId || inFlightRef.current) return
      const now = Date.now()
      if (now - lastLocalFireRef.current < thresholds.cooldownMs) return

      inFlightRef.current = true
      try {
        const res = await postInterject(sessionId, {
          trigger: pending.trigger,
          snapshot: pending.snapshot,
        })
        lastLocalFireRef.current = Date.now()
        sustainedRef.current = { trigger: null, count: 0 }
        onInterjection(res.text, pending.trigger)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Interjection failed'
        if (!message.includes('429')) {
          onInterjectionError?.(message)
        }
      } finally {
        inFlightRef.current = false
      }
    },
    [onInterjection, onInterjectionError, sessionId, thresholds.cooldownMs],
  )

  const trySchedule = useCallback(
    (pending: Pending) => {
      if (turnState === 'THINKING' || turnState === 'REPORT' || turnState === 'IDLE') return

      if (turnState === 'ASKING' && speakingPhase !== 'idle') {
        pendingRef.current = pending
        return
      }

      void fireInterjection(pending)
    },
    [fireInterjection, speakingPhase, turnState],
  )

  useEffect(() => {
    if (!active || !sample || !sessionId) {
      sustainedRef.current = { trigger: null, count: 0 }
      pendingRef.current = null
      return
    }

    if (turnState === 'THINKING' || turnState === 'REPORT') return

    const trigger = pickTrigger(sample, vitals, devForceStress)
    if (!trigger) {
      sustainedRef.current = { trigger: null, count: 0 }
      return
    }

    const sustained = sustainedRef.current
    if (sustained.trigger === trigger) {
      sustained.count += 1
    } else {
      sustainedRef.current = { trigger, count: 1 }
    }

    if (sustainedRef.current.count !== thresholds.sustainedSec) return

    const snapshot = buildSnapshot(sample, vitals)
    sustainedRef.current = { trigger: null, count: 0 }
    trySchedule({ trigger, snapshot })
  }, [
    active,
    devForceStress,
    sample,
    sessionId,
    thresholds.sustainedSec,
    trySchedule,
    turnState,
    vitals,
  ])

  useEffect(() => {
    const pending = pendingRef.current
    if (!pending || !active) return
    if (turnState === 'ASKING' && speakingPhase !== 'idle') return
    if (turnState === 'THINKING') return

    pendingRef.current = null
    void fireInterjection(pending)
  }, [active, fireInterjection, speakingPhase, turnState])

  return null
}

/** Dev helper: toggle forced stress sampling via Ctrl+Shift+I */
export function useInterjectDevShortcut(onToggle: () => void) {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        onToggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onToggle])
}
