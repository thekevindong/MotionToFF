"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { ComposureSample } from "@/lib/contracts"
import type { FaceMetrics } from "@/hooks/use-face-composure"

/**
 * Emits a unified ComposureSample on a fixed cadence for the ENTIRE session,
 * regardless of turn state. The real composure signal comes from MediaPipe
 * webcam analysis via `getMetrics` (the concrete implementation behind the
 * Presage "vitals" seam). Before the model is ready, or if no face is visible,
 * it emits a gentle synthetic signal so the curve and report stay populated.
 *
 * The fallback signal (filler rate / latency / speech rate) will fill the
 * other half of `signals` and map to the same `composure` 0-1 — the report
 * never branches on `source`.
 */

const SAMPLE_INTERVAL_MS = 1000

interface SamplerArgs {
  active: boolean
  sessionId: string
  questionId: string
  /** Real webcam-derived metrics; null until the model is ready. */
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
      source: "presage" as const,
    }

    // Real webcam analysis (MediaPipe) when the model is up and a face is seen.
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

    // Synthetic drift until the model is ready / a face appears.
    phaseRef.current += 0.12
    const wobble = (Math.sin(phaseRef.current) + 1) / 2 // 0..1
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
    if (!active) return
    const tick = () => {
      const sample = readPresage()
      setLatest(sample)
      onSampleRef.current?.(sample)
      console.log("[v0] composure sample", sample.composure, sample.question_id)
    }
    tick()
    const id = window.setInterval(tick, SAMPLE_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [active, readPresage])

  return { latest }
}
