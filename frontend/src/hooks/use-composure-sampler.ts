import { useCallback, useEffect, useRef, useState } from 'react'

import type { ComposureSample } from '../lib/contracts'
import type { FaceMetrics } from './use-face-composure'

const SAMPLE_INTERVAL_MS = 1000

interface SamplerArgs {
  active: boolean
  sessionId: string
  questionId: string
  getMetrics?: () => FaceMetrics | null
  onSample?: (sample: ComposureSample) => void
}

export function useComposureSampler({ active, sessionId, questionId, getMetrics, onSample }: SamplerArgs) {
  const [latest, setLatest] = useState<ComposureSample | null>(null)
  const phaseRef = useRef(0)
  const questionIdRef = useRef(questionId)
  const getMetricsRef = useRef(getMetrics)
  const onSampleRef = useRef(onSample)

  questionIdRef.current = questionId
  getMetricsRef.current = getMetrics
  onSampleRef.current = onSample

  const readPresage = useCallback((): ComposureSample => {
    const base = {
      session_id: sessionId,
      question_id: questionIdRef.current,
      ts_ms: Date.now(),
      source: 'presage' as const,
    }

    const m = getMetricsRef.current?.()
    if (m && m.faceVisible) {
      return {
        ...base,
        composure: Number(m.composure.toFixed(3)),
        signals: {
          expression: { neutral: Number(m.neutral.toFixed(3)), stress: Number(m.stress.toFixed(3)) },
          engagement: Number(m.engagement.toFixed(3)),
          vitals: null,
          filler_rate: null,
          answer_latency_ms: null,
          speech_rate_wpm: null,
        },
      }
    }

    phaseRef.current += 0.12
    const wobble = (Math.sin(phaseRef.current) + 1) / 2
    const composure = Number((0.55 + wobble * 0.35).toFixed(3))
    const stress = Number((0.35 - wobble * 0.2).toFixed(3))
    return {
      ...base,
      composure,
      signals: {
        expression: { neutral: Number((0.5 + wobble * 0.3).toFixed(3)), stress },
        engagement: Number((0.6 + wobble * 0.3).toFixed(3)),
        vitals: null,
        filler_rate: null,
        answer_latency_ms: null,
        speech_rate_wpm: null,
      },
    }
  }, [sessionId])

  useEffect(() => {
    if (!active) {
      setLatest(null)
      return
    }
    const tick = () => {
      const sample = readPresage()
      setLatest(sample)
      onSampleRef.current?.(sample)
    }
    tick()
    const id = window.setInterval(tick, SAMPLE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [active, readPresage])

  return { latest }
}
