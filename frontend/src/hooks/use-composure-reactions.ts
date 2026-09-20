import { useCallback, useEffect, useRef } from 'react'

import type { DeliveryMood, InterjectTrigger } from '../config/composure-thresholds'
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
  eye_contact?: number | null
  pace_wpm?: number | null
  source: string
}

type Pending = {
  trigger: InterjectTrigger
  snapshot: Snapshot
}

function pickTrigger(
  sample: ComposureSample,
  vitals: PresageVitalsSnapshot,
  speechWpm: number | null,
  devForce: boolean,
): InterjectTrigger | null {
  const thresholds = interjectThresholdsForSession()
  const stress = sample.signals?.expression?.stress ?? 0
  const composure = sample.composure
  const engagement = sample.signals?.engagement ?? null

  if (devForce) return 'high_stress'
  if (speechWpm != null && speechWpm >= thresholds.paceFastWpm) return 'pace_fast'
  if (stress >= thresholds.stressHigh) return 'high_stress'
  if (composure <= thresholds.composureLow) return 'composure_low'
  if (engagement !== null && engagement < thresholds.eyeContactLow) return 'low_eye_contact'
  if (vitals.pulse != null && vitals.pulse >= thresholds.hrElevated) return 'hr_elevated'
  return null
}

function pickPleasedMood(sample: ComposureSample): boolean {
  const thresholds = interjectThresholdsForSession()
  const stress = sample.signals?.expression?.stress ?? 1
  const engagement = sample.signals?.engagement ?? 0
  return (
    sample.composure >= thresholds.composureStrong &&
    engagement >= thresholds.eyeContactHigh &&
    stress < 0.45
  )
}

function buildSnapshot(
  sample: ComposureSample,
  vitals: PresageVitalsSnapshot,
  speechWpm: number | null,
): Snapshot {
  const stress = sample.signals?.expression?.stress ?? 0
  const engagement = sample.signals?.engagement ?? null
  let source = 'camera'
  if (vitals.sidecarReachable) source = 'sidecar'
  else if (!sample.signals?.faceRaw) source = 'speech_fallback'
  return {
    composure: sample.composure,
    stress,
    hr_bpm: vitals.pulse,
    eye_contact: engagement,
    pace_wpm: speechWpm,
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
  speechWpm: number | null
  devForceStress: boolean
  onInterjection: (text: string, trigger: InterjectTrigger) => void
  /** Fires when a trigger is confirmed — before Gemini interjection returns. */
  onInterjectionArm?: (trigger: InterjectTrigger) => void
  onInterjectionError?: (message: string) => void
  onDeliveryMood?: (mood: DeliveryMood) => void
}

export function useComposureReactions({
  active,
  sessionId,
  sample,
  vitals,
  turnState,
  speakingPhase,
  speechWpm,
  devForceStress,
  onInterjection,
  onInterjectionArm,
  onInterjectionError,
  onDeliveryMood,
}: Args) {
  const sustainedRef = useRef<{ trigger: InterjectTrigger | null; count: number }>({
    trigger: null,
    count: 0,
  })
  const pleasedRef = useRef(0)
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
      pleasedRef.current = 0
      pendingRef.current = null
      onDeliveryMood?.('neutral')
      return
    }

    if (turnState === 'THINKING' || turnState === 'REPORT') return

    if (pickPleasedMood(sample)) {
      pleasedRef.current += 1
      if (pleasedRef.current >= thresholds.pleasedSustainedSec) {
        onDeliveryMood?.('pleased')
      }
    } else {
      pleasedRef.current = 0
      onDeliveryMood?.('neutral')
    }

    const trigger = pickTrigger(sample, vitals, speechWpm, devForceStress)
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

    const snapshot = buildSnapshot(sample, vitals, speechWpm)
    sustainedRef.current = { trigger: null, count: 0 }
    onInterjectionArm?.(trigger)
    trySchedule({ trigger, snapshot })
  }, [
    active,
    devForceStress,
    onDeliveryMood,
    onInterjectionArm,
    sample,
    sessionId,
    speechWpm,
    thresholds.pleasedSustainedSec,
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
