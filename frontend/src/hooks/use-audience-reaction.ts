import { useEffect, useRef, useState } from 'react'

import {
  AUDIENCE_CLAP_COMPOSURE,
  AUDIENCE_CLAP_ENGAGEMENT,
  AUDIENCE_CLAP_MAX_STRESS,
  AUDIENCE_REACT_COOLDOWN_MS,
  AUDIENCE_REACT_HOLD_MS,
  AUDIENCE_SAD_CONSECUTIVE,
  AUDIENCE_SAD_STRESS,
} from '../config/speaking-audience-thresholds'
import {
  audienceStageUrl,
  type AudiencePhase,
  type AudienceReaction,
} from '../config/stage-backgrounds'
import type { ComposureSample } from '../lib/contracts'

/** Parent-controlled: empty (pre-start) or house (delivering). */
export type AudienceBasePhase = 'empty' | 'house'

function stressFromSample(sample: ComposureSample): number {
  const fromExpr = sample.signals.expression?.stress
  if (typeof fromExpr === 'number') return fromExpr
  return Math.max(0, Math.min(1, 1 - sample.composure))
}

function engagementFromSample(sample: ComposureSample): number {
  const e = sample.signals.engagement
  return typeof e === 'number' ? e : sample.composure
}

function pickReaction(sample: ComposureSample, stressStreak: number): AudienceReaction | null {
  const stress = stressFromSample(sample)
  const engagement = engagementFromSample(sample)
  const composure = sample.composure

  if (stressStreak >= AUDIENCE_SAD_CONSECUTIVE && stress >= AUDIENCE_SAD_STRESS) {
    return 'sad'
  }
  if (
    composure >= AUDIENCE_CLAP_COMPOSURE &&
    engagement >= AUDIENCE_CLAP_ENGAGEMENT &&
    stress < AUDIENCE_CLAP_MAX_STRESS
  ) {
    return 'clap'
  }
  return null
}

export function useAudienceReaction({
  sample,
  basePhase,
  enabled,
}: {
  sample: ComposureSample | null
  basePhase: AudienceBasePhase
  enabled: boolean
}) {
  const [overlay, setOverlay] = useState<AudienceReaction | null>(null)
  const stressStreakRef = useRef(0)
  const lastReactAtRef = useRef(0)
  const holdTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null)

  useEffect(() => {
    if (basePhase === 'empty') {
      setOverlay(null)
      stressStreakRef.current = 0
    }
  }, [basePhase])

  useEffect(() => {
    if (!enabled || basePhase !== 'house' || !sample || overlay) return

    const stress = stressFromSample(sample)
    if (stress >= AUDIENCE_SAD_STRESS) {
      stressStreakRef.current += 1
    } else {
      stressStreakRef.current = 0
    }

    const now = Date.now()
    if (now - lastReactAtRef.current < AUDIENCE_REACT_COOLDOWN_MS) return

    const next = pickReaction(sample, stressStreakRef.current)
    if (!next) return

    lastReactAtRef.current = now
    stressStreakRef.current = 0
    setOverlay(next)

    if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null
      setOverlay(null)
    }, AUDIENCE_REACT_HOLD_MS)
  }, [basePhase, enabled, overlay, sample])

  useEffect(
    () => () => {
      if (holdTimerRef.current !== null) window.clearTimeout(holdTimerRef.current)
    },
    [],
  )

  const phase: AudiencePhase = overlay ? 'reacting' : basePhase
  const backdrop = audienceStageUrl(phase, overlay)

  return { backdrop, reaction: overlay, phase }
}
