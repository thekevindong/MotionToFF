import { useCallback, useEffect, useRef, useState } from 'react'

import type { ComposureSample } from '../lib/contracts'
import { postThesisPresentationComplete } from '../lib/api'
import type { ThesisPrepareResponse, ThesisPresentationCompleteResponse } from '../lib/api-types'
import { getStoredSessionId } from '../lib/session-storage'
import { transcribeAudio } from '../voice/stt'
import type {
  DeliverySamplePayload,
  DeliverySummaryPayload,
  SpeakingEndedBy,
} from './use-speaking-session'

export type ThesisPresentationFlow = 'READY' | 'PRESENTING' | 'PRESENTATION_SUBMIT' | 'DONE'

function stressFromSample(sample: ComposureSample): number {
  const fromExpr = sample.signals.expression?.stress
  if (typeof fromExpr === 'number') return fromExpr
  return Math.max(0, Math.min(1, 1 - sample.composure))
}

function engagementFromSample(sample: ComposureSample): number {
  const e = sample.signals.engagement
  return typeof e === 'number' ? e : sample.composure
}

function aggregateSamples(samples: DeliverySamplePayload[]): DeliverySummaryPayload | null {
  if (!samples.length) return null
  let compSum = 0
  let minComp = 1
  let maxStress = 0
  for (const s of samples) {
    compSum += s.composure
    minComp = Math.min(minComp, s.composure)
    maxStress = Math.max(maxStress, s.stress)
  }
  return {
    avg_composure: Number((compSum / samples.length).toFixed(3)),
    min_composure: Number(minComp.toFixed(3)),
    max_stress: Number(maxStress.toFixed(3)),
    avg_wpm: null,
    filler_count: 0,
  }
}

export function useThesisPresentationSession({
  prep,
  onNavigateResults,
  onPresentationComplete,
  getTranscript,
  getDeliveryExtras,
  cloudSttConfigured,
}: {
  prep: ThesisPrepareResponse
  onNavigateResults: () => void | Promise<void>
  onPresentationComplete: (result: ThesisPresentationCompleteResponse, transcript: string) => void
  getTranscript: () => string
  getDeliveryExtras: () => { avg_wpm: number | null; filler_count: number; presage_degraded?: boolean }
  cloudSttConfigured: boolean
}) {
  const [flow, setFlow] = useState<ThesisPresentationFlow>('READY')
  const [started, setStarted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const durationSec = prep.presentation_duration_sec
  const deliverySamplesRef = useRef<DeliverySamplePayload[]>([])
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerHandledRef = useRef(false)
  const completeInFlightRef = useRef(false)
  const secondsRef = useRef(0)
  const cloudSttConfiguredRef = useRef(cloudSttConfigured)
  cloudSttConfiguredRef.current = cloudSttConfigured

  const pushSample = useCallback(
    (sample: ComposureSample) => {
      if (flow !== 'PRESENTING') return
      const row: DeliverySamplePayload = {
        ts_ms: sample.ts_ms,
        composure: sample.composure,
        stress: stressFromSample(sample),
        engagement: engagementFromSample(sample),
      }
      const list = deliverySamplesRef.current
      list.push(row)
      if (list.length > 120) {
        deliverySamplesRef.current = list.slice(-120)
      }
    },
    [flow],
  )

  const attachRecorder = useCallback((stream: MediaStream) => {
    chunksRef.current = []
    try {
      const rec = new MediaRecorder(stream)
      recorderRef.current = rec
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.start(1000)
    } catch {
      recorderRef.current = null
    }
  }, [])

  const stopRecorder = useCallback((): Promise<Blob | null> => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return Promise.resolve(null)
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = chunksRef.current.length
          ? new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
          : null
        chunksRef.current = []
        recorderRef.current = null
        resolve(blob)
      }
      rec.stop()
    })
  }, [])

  const resolveTranscript = useCallback(async (): Promise<string> => {
    let text = getTranscript().trim()
    const blob = await stopRecorder()
    if (blob && cloudSttConfiguredRef.current) {
      try {
        const result = await transcribeAudio(blob)
        if (result.transcript.trim()) text = result.transcript.trim()
      } catch {
        /* keep browser transcript */
      }
    }
    return text
  }, [getTranscript, stopRecorder])

  const completePresentation = useCallback(
    async (endedBy: SpeakingEndedBy, skipQa: boolean) => {
      if (completeInFlightRef.current || flow === 'PRESENTATION_SUBMIT' || flow === 'DONE') return
      completeInFlightRef.current = true
      setFlow('PRESENTATION_SUBMIT')
      setSubmitError(null)

      const sessionId = getStoredSessionId()
      const elapsed = secondsRef.current
      const transcript = await resolveTranscript()
      const timed = durationSec > 0
      const finishedInTime =
        timed
          ? endedBy !== 'early_exit' && (endedBy === 'timer' || endedBy === 'user') && transcript.length > 0
          : transcript.length > 0

      const samples = [...deliverySamplesRef.current]
      const extras = getDeliveryExtras()
      const summary =
        aggregateSamples(samples) ?? {
          avg_composure: 0,
          min_composure: 0,
          max_stress: 0,
          avg_wpm: extras.avg_wpm,
          filler_count: extras.filler_count,
        }
      summary.avg_wpm = extras.avg_wpm
      summary.filler_count = extras.filler_count
      if (extras.presage_degraded) summary.presage_degraded = true

      try {
        if (!sessionId) throw new Error('Missing session')
        const result = await postThesisPresentationComplete(sessionId, {
          transcript,
          elapsedSec: elapsed,
          finishedInTime,
          endedBy,
          samples,
          summary,
          skipQa,
        })
        setFlow('DONE')
        if (result.end_session || result.skip_qa) {
          await onNavigateResults()
          return
        }
        onPresentationComplete(result, transcript)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save presentation'
        setSubmitError(message)
        completeInFlightRef.current = false
        setFlow('PRESENTING')
      }
    },
    [durationSec, flow, getDeliveryExtras, onNavigateResults, onPresentationComplete, resolveTranscript],
  )

  const startPresentation = useCallback(() => {
    if (flow !== 'READY') return
    deliverySamplesRef.current = []
    timerHandledRef.current = false
    setStarted(true)
    setSeconds(0)
    setFlow('PRESENTING')
  }, [flow])

  useEffect(() => {
    secondsRef.current = seconds
  }, [seconds])

  useEffect(() => {
    if (!started || flow !== 'PRESENTING') return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [flow, started])

  useEffect(() => {
    if (!started || durationSec <= 0 || flow !== 'PRESENTING') return
    if (seconds < durationSec) return
    if (timerHandledRef.current) return
    timerHandledRef.current = true
    void completePresentation('timer', false)
  }, [completePresentation, durationSec, flow, seconds, started])

  return {
    flow,
    started,
    seconds,
    durationSec,
    submitError,
    startPresentation,
    completePresentation,
    attachRecorder,
    pushSample,
  }
}
