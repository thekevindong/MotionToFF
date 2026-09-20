import { useCallback, useEffect, useRef, useState } from 'react'

import type { ComposureSample } from '../lib/contracts'
import { postSessionClose, postSpeakingComplete } from '../lib/api'
import type { SpeakingPrepareResponse } from '../lib/api-types'
import { getStoredSessionId } from '../lib/session-storage'
import { setSession } from '../session'
import { transcribeAudio } from '../voice/stt'

export type SpeakingFlowState = 'READY' | 'DELIVERING' | 'SUBMITTING' | 'DONE'
export type SpeakingEndedBy = 'timer' | 'user' | 'early_exit'

const MAX_DELIVERY_SAMPLES = 120

export type DeliverySamplePayload = {
  ts_ms: number
  composure: number
  stress: number
  engagement: number
}

export type DeliverySummaryPayload = {
  avg_composure: number
  min_composure: number
  max_stress: number
  avg_wpm: number | null
  filler_count: number
  presage_degraded?: boolean
}

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

export function useSpeakingSession({
  prep,
  sessionDurationSec,
  modeTitle,
  speakerLabel,
  onNavigateResults,
  getTranscript,
  getDeliveryExtras,
  cloudSttConfigured,
}: {
  prep: SpeakingPrepareResponse
  sessionDurationSec: number
  modeTitle: string
  speakerLabel: string
  onNavigateResults: () => void
  getTranscript: () => string
  getDeliveryExtras: () => { avg_wpm: number | null; filler_count: number; presage_degraded?: boolean }
  cloudSttConfigured: boolean
}) {
  const [flow, setFlow] = useState<SpeakingFlowState>('READY')
  const [started, setStarted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [generatingReport, setGeneratingReport] = useState(false)

  const startedAtRef = useRef<number | null>(null)
  const deliverySamplesRef = useRef<DeliverySamplePayload[]>([])
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerHandledRef = useRef(false)
  const completeInFlightRef = useRef(false)
  const secondsRef = useRef(0)
  const cloudSttConfiguredRef = useRef(cloudSttConfigured)
  cloudSttConfiguredRef.current = cloudSttConfigured

  const pushSample = useCallback((sample: ComposureSample) => {
    if (flow !== 'DELIVERING') return
    const row: DeliverySamplePayload = {
      ts_ms: sample.ts_ms,
      composure: sample.composure,
      stress: stressFromSample(sample),
      engagement: engagementFromSample(sample),
    }
    const list = deliverySamplesRef.current
    list.push(row)
    if (list.length > MAX_DELIVERY_SAMPLES) {
      deliverySamplesRef.current = list.slice(-MAX_DELIVERY_SAMPLES)
    }
  }, [flow])

  const attachRecorder = useCallback((stream: MediaStream) => {
    streamRef.current = stream
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

  const resolveTranscript = useCallback(
    async (cloudSttConfigured: boolean): Promise<string> => {
      let text = getTranscript().trim()
      const blob = await stopRecorder()
      if (blob && cloudSttConfigured) {
        try {
          const result = await transcribeAudio(blob)
          if (result.transcript.trim()) text = result.transcript.trim()
        } catch {
          /* keep browser transcript */
        }
      }
      return text
    },
    [getTranscript, stopRecorder],
  )

  const completeDelivery = useCallback(
    async (endedBy: SpeakingEndedBy, cloudSttConfigured: boolean) => {
      if (completeInFlightRef.current || flow === 'SUBMITTING' || flow === 'DONE') return
      completeInFlightRef.current = true
      setFlow('SUBMITTING')
      setSubmitError(null)
      setGeneratingReport(true)

      const sessionId = getStoredSessionId()
      const elapsed = secondsRef.current
      const transcript = await resolveTranscript(cloudSttConfigured)
      const timed = sessionDurationSec > 0
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
      if (extras.presage_degraded) {
        summary.presage_degraded = true
      }

      try {
        if (sessionId) {
          await postSpeakingComplete(sessionId, {
            transcript,
            elapsedSec: elapsed,
            finishedInTime,
            endedBy,
            samples,
            summary,
          })
          await postSessionClose(sessionId, {
            elapsedSec: elapsed,
            durationSec: sessionDurationSec,
          }).catch(() => {})
        }
        setSession({
          sessionId: sessionId ?? undefined,
          mode: modeTitle,
          opponent: speakerLabel,
          opponentRole: 'Speaker',
          tone: prep.speech_title,
          opponentImg: '/brand/speakup-icon-white.png',
          durationSec: elapsed,
        })
        setFlow('DONE')
        onNavigateResults()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not save your speech'
        setSubmitError(message)
        setGeneratingReport(false)
        completeInFlightRef.current = false
        setFlow('DELIVERING')
      }
    },
    [flow, getDeliveryExtras, modeTitle, onNavigateResults, prep.speech_title, resolveTranscript, sessionDurationSec, speakerLabel],
  )

  const startDelivery = useCallback(() => {
    if (flow !== 'READY') return
    startedAtRef.current = Date.now()
    deliverySamplesRef.current = []
    timerHandledRef.current = false
    setStarted(true)
    setSeconds(0)
    setFlow('DELIVERING')
  }, [flow])

  useEffect(() => {
    secondsRef.current = seconds
  }, [seconds])

  useEffect(() => {
    if (!started || flow !== 'DELIVERING') return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [flow, started])

  useEffect(() => {
    if (!started || sessionDurationSec <= 0 || flow !== 'DELIVERING') return
    if (seconds < sessionDurationSec) return
    if (timerHandledRef.current) return
    timerHandledRef.current = true
    void completeDelivery('timer', cloudSttConfiguredRef.current)
  }, [completeDelivery, flow, seconds, sessionDurationSec, started])

  return {
    flow,
    started,
    seconds,
    submitError,
    generatingReport,
    startDelivery,
    completeDelivery,
    attachRecorder,
    pushSample,
    setSubmitError,
  }
}
