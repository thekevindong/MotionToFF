"use client"

import Link from "next/link"
import Image from "next/image"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Mic, Loader2, Video, VideoOff, Square, PhoneOff, Volume2 } from "lucide-react"
import type { TurnState, ComposureSample } from "@/lib/contracts"
import { useMediaStream } from "@/hooks/use-media-stream"
import { useComposureSampler } from "@/hooks/use-composure-sampler"
import { useFaceComposure, type FaceMetrics } from "@/hooks/use-face-composure"
import { useInterviewMachine } from "@/hooks/use-interview-machine"

const STATE_LABELS: Record<TurnState, string> = {
  IDLE: "Ready to join",
  ASKING: "Interviewer speaking",
  LISTENING: "Your turn — speak now",
  THINKING: "Thinking",
  REPORT: "Call ended",
}

const INTERVIEWER_NAME = "Maya Chen"

// Placeholder questions until Gemini drives the loop. Audio plumbing only.
const PLACEHOLDER_QUESTIONS = [
  "Tell me about a project you're proud of. What was your specific role?",
  "What was the hardest technical decision you made, and why?",
  "Walk me through a time something you shipped broke in production.",
]

export default function InterviewPage() {
  const sessionId = useMemo(() => `s_${Date.now().toString(36)}`, [])
  const [questionIndex, setQuestionIndex] = useState(0)
  const [transcript, setTranscript] = useState("")
  const [transcribing, setTranscribing] = useState(false)
  const questionId = `q_${String(questionIndex + 1).padStart(3, "0")}`

  const { stream, status, error, request, stop } = useMediaStream()
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const { state, ask, listen, think, finish, reset } = useInterviewMachine({
    stream,
    onAnswerRecorded: async (blob) => {
      think()
      setTranscribing(true)
      setTranscript("")
      try {
        const form = new FormData()
        form.append("audio", blob, "answer.webm")
        const res = await fetch("/api/stt", { method: "POST", body: form })
        if (res.ok) {
          const data = await res.json()
          setTranscript(data.transcript || "(no speech detected)")
        } else {
          setTranscript("(transcription unavailable)")
        }
      } catch {
        setTranscript("(transcription failed)")
      } finally {
        setTranscribing(false)
      }
      // Next step (H3–5): the transcript + composure feed Nemotron, which drives
      // Gemini. For now, advance placeholder questions so the loop is observable.
      const next = questionIndex + 1
      if (next >= PLACEHOLDER_QUESTIONS.length) {
        finish()
      } else {
        setQuestionIndex(next)
      }
    },
  })

  const sessionActive = state !== "IDLE" && state !== "REPORT"
  const { ready: faceReady, getMetrics } = useFaceComposure(videoRef, sessionActive)
  const { latest } = useComposureSampler({
    active: sessionActive,
    sessionId,
    questionId,
    getMetrics,
  })

  // Live debug: poll the raw webcam metrics a few times a second so we can
  // watch the Presage/composure signal update in real time.
  const [showDebug, setShowDebug] = useState(true)
  const [rawMetrics, setRawMetrics] = useState<FaceMetrics | null>(null)
  useEffect(() => {
    if (!sessionActive) {
      setRawMetrics(null)
      return
    }
    const id = window.setInterval(() => setRawMetrics(getMetrics()), 300)
    return () => window.clearInterval(id)
  }, [sessionActive, getMetrics])

  // Bind the live stream to the self-view <video> element.
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const currentQuestion = PLACEHOLDER_QUESTIONS[questionIndex]
  const speaking = state === "ASKING"

  async function handleStart() {
    const media = await request()
    if (!media) return
    setTranscript("")
    ask(PLACEHOLDER_QUESTIONS[0])
  }

  // When a new question index is set after THINKING, ask it out loud.
  useEffect(() => {
    if (questionIndex > 0 && state === "THINKING") {
      ask(PLACEHOLDER_QUESTIONS[questionIndex])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionIndex])

  function handleEnd() {
    finish()
    stop()
  }

  function handleReset() {
    reset()
    setQuestionIndex(0)
    setTranscript("")
  }

  const caption =
    state === "IDLE"
      ? "Join the call when you're ready. Your interviewer will ask the first question out loud."
      : state === "REPORT"
        ? "The call has ended. Your report will render here."
        : currentQuestion

  return (
    <main className="flex h-svh flex-col bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex items-center justify-between px-4 py-3 sm:px-6">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-neutral-400 transition-colors hover:text-neutral-100"
        >
          <ArrowLeft className="size-4" />
          Leave
        </Link>
        <div className="flex items-center gap-3">
          {sessionActive && (
            <span className="text-xs text-neutral-500">
              Question {questionIndex + 1} of {PLACEHOLDER_QUESTIONS.length}
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowDebug((v) => !v)}
            className={`rounded-full border px-3 py-1 text-xs transition-colors ${
              showDebug
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-neutral-700 text-neutral-400 hover:text-neutral-100"
            }`}
          >
            Signal
          </button>
          <StatePill state={state} />
        </div>
      </header>

      {/* Stage */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-4 sm:px-6">
        {/* Interviewer tile — the person you look at */}
        <div
          className={`relative aspect-video h-full max-h-full w-full max-w-5xl overflow-hidden rounded-3xl border bg-neutral-900 transition-shadow duration-300 ${
            speaking ? "border-emerald-400/70 shadow-[0_0_0_3px_rgba(52,211,153,0.25)]" : "border-neutral-800"
          }`}
        >
          <Image
            src="/interviewer.png"
            alt={`${INTERVIEWER_NAME}, your interviewer`}
            fill
            priority
            sizes="(max-width: 1024px) 100vw, 1024px"
            className="object-cover"
          />
          {/* Gradient for legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />

          {/* Speaking indicator */}
          <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium backdrop-blur">
            {speaking ? (
              <span className="flex items-end gap-0.5" aria-hidden>
                <span className="h-2 w-0.5 animate-pulse bg-emerald-400 [animation-delay:0ms]" />
                <span className="h-3 w-0.5 animate-pulse bg-emerald-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-0.5 animate-pulse bg-emerald-400 [animation-delay:300ms]" />
              </span>
            ) : (
              <span className="inline-block size-2 rounded-full bg-neutral-400" />
            )}
            {INTERVIEWER_NAME}
          </div>

          {/* Caption */}
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
            <div className="mx-auto max-w-3xl rounded-2xl bg-black/55 px-5 py-4 backdrop-blur">
              <p className="text-pretty text-base leading-relaxed sm:text-lg">{caption}</p>
            </div>
          </div>

          {/* Live signal debug panel */}
          {showDebug && sessionActive && (
            <ComposureDebugPanel sample={latest} metrics={rawMetrics} faceReady={faceReady} />
          )}

          {/* Self-view PiP */}
          <div className="absolute bottom-4 right-4 aspect-video w-36 overflow-hidden rounded-xl border border-neutral-700 bg-neutral-950 shadow-lg sm:w-52">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="size-full object-cover [transform:scaleX(-1)]"
            />
            {status !== "ready" && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-neutral-400">
                {status === "denied" ? (
                  <>
                    <VideoOff className="size-4" />
                    <span>Camera off</span>
                  </>
                ) : status === "requesting" ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    <span>Starting…</span>
                  </>
                ) : (
                  <>
                    <Video className="size-4" />
                    <span>You</span>
                  </>
                )}
              </div>
            )}
            {status === "ready" && (
              <span className="absolute bottom-1 left-1.5 text-[10px] font-medium text-white/90 drop-shadow">You</span>
            )}
            {sessionActive && <ComposureBadge sample={latest} live={faceReady && !!latest} />}
          </div>
        </div>
      </div>

      {/* Transcript strip */}
      {(transcribing || transcript) && (
        <div className="px-4 pb-2 sm:px-6">
          <div className="mx-auto flex max-w-3xl items-start gap-2 rounded-xl border border-neutral-800 bg-neutral-900/70 px-4 py-2.5">
            {transcribing ? (
              <Loader2 className="mt-0.5 size-3.5 animate-spin text-neutral-400" />
            ) : (
              <Mic className="mt-0.5 size-3.5 text-neutral-400" />
            )}
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500">
                {transcribing ? "Transcribing your answer…" : "You said"}
              </p>
              {transcript && <p className="mt-0.5 text-sm leading-relaxed text-neutral-200">{transcript}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Control bar */}
      <footer className="flex items-center justify-center gap-3 border-t border-neutral-800 bg-neutral-950 px-4 py-4">
        {state === "IDLE" && (
          <button
            type="button"
            onClick={handleStart}
            className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-7 py-3 text-sm font-semibold text-neutral-950 transition-colors hover:bg-emerald-400"
          >
            <Volume2 className="size-4" />
            Join call
          </button>
        )}

        {state === "ASKING" && (
          <button
            type="button"
            onClick={listen}
            className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-neutral-950 transition-opacity hover:opacity-90"
          >
            <Mic className="size-4" />
            Answer now
          </button>
        )}

        {state === "LISTENING" && (
          <button
            type="button"
            onClick={() => think()}
            className="inline-flex items-center gap-2 rounded-full bg-red-500 px-7 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            <Square className="size-4 fill-current" />
            Stop &amp; submit
          </button>
        )}

        {state === "THINKING" && (
          <span className="inline-flex items-center gap-2 rounded-full border border-neutral-700 px-7 py-3 text-sm font-medium text-neutral-400">
            <Loader2 className="size-4 animate-spin" />
            Processing…
          </span>
        )}

        {state === "REPORT" && (
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-neutral-950 transition-opacity hover:opacity-90"
          >
            Start over
          </button>
        )}

        {sessionActive && (
          <button
            type="button"
            onClick={handleEnd}
            className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-500"
          >
            <PhoneOff className="size-4" />
            End
          </button>
        )}
      </footer>
    </main>
  )
}

function ComposureBadge({ sample, live }: { sample: ComposureSample | null; live: boolean }) {
  const pct = sample ? Math.round(sample.composure * 100) : null
  const dot = !live
    ? "bg-amber-400 animate-pulse"
    : pct !== null && pct >= 70
      ? "bg-emerald-400"
      : pct !== null && pct >= 45
        ? "bg-yellow-400"
        : "bg-rose-400"
  return (
    <div
      className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[10px] font-medium text-white backdrop-blur"
      title={live ? "Live composure (webcam analysis)" : "Calibrating…"}
    >
      <span className={`inline-block size-1.5 rounded-full ${dot}`} />
      {!live ? "cal…" : pct === null ? "—" : `${pct}%`}
    </div>
  )
}

function Meter({ label, value, invert = false }: { label: string; value: number; invert?: boolean }) {
  const pct = Math.round(value * 100)
  // For "good is high" metrics, green when high; for "good is low" (invert), green when low.
  const good = invert ? value <= 0.35 : value >= 0.65
  const mid = invert ? value <= 0.6 : value >= 0.4
  const color = good ? "bg-emerald-400" : mid ? "bg-yellow-400" : "bg-rose-400"
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-neutral-400">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div className={`h-full rounded-full ${color} transition-all duration-300`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right tabular-nums text-neutral-200">{pct}%</span>
    </div>
  )
}

function ComposureDebugPanel({
  sample,
  metrics,
  faceReady,
}: {
  sample: ComposureSample | null
  metrics: FaceMetrics | null
  faceReady: boolean
}) {
  const source = sample?.source ?? "—"
  const faceVisible = metrics?.faceVisible ?? false
  const status = !faceReady ? "loading model" : faceVisible ? "live · face detected" : "no face — synthetic"
  const statusColor = !faceReady ? "text-amber-300" : faceVisible ? "text-emerald-300" : "text-rose-300"

  return (
    <div className="absolute left-3 top-3 w-72 max-w-[70vw] rounded-2xl border border-neutral-700/80 bg-black/80 p-3.5 text-[11px] leading-tight backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wider text-neutral-300">Composure signal</span>
        <span className={`font-medium ${statusColor}`}>{status}</span>
      </div>

      {/* Headline composure */}
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums text-white">
          {sample ? Math.round(sample.composure * 100) : "—"}
          <span className="text-base text-neutral-500">%</span>
        </span>
        <span className="text-neutral-500">composure</span>
      </div>

      <div className="space-y-1.5">
        <Meter label="engagement" value={metrics?.engagement ?? sample?.signals.engagement ?? 0} />
        <Meter label="stress" value={metrics?.stress ?? sample?.signals.expression?.stress ?? 0} invert />
        <Meter label="neutral" value={metrics?.neutral ?? sample?.signals.expression?.neutral ?? 0} />
      </div>

      {/* Raw diagnostics */}
      <div className="mt-2.5 border-t border-neutral-800 pt-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Raw signals</span>
        <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums text-neutral-300">
          <Stat label="look-away" value={metrics ? metrics.raw.lookAway.toFixed(2) : "—"} />
          <Stat label="head motion" value={metrics ? metrics.raw.instability.toFixed(2) : "—"} />
          <Stat label="blinks/min" value={metrics ? metrics.raw.blinksPerMin.toFixed(0) : "—"} />
          <Stat label="expr stress" value={metrics ? metrics.raw.exprStress.toFixed(2) : "—"} />
          <Stat label="blink stress" value={metrics ? metrics.raw.blinkStress.toFixed(2) : "—"} />
          <Stat label="source" value={source} />
        </div>
      </div>

      {/* Sample provenance */}
      <div className="mt-2 border-t border-neutral-800 pt-2 text-[10px] text-neutral-500">
        {sample ? (
          <>
            <div>
              q: <span className="text-neutral-400">{sample.question_id}</span> · sampled{" "}
              <span className="text-neutral-400">{new Date(sample.ts_ms).toLocaleTimeString()}</span>
            </div>
          </>
        ) : (
          <div>waiting for first sample…</div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-200">{value}</span>
    </div>
  )
}

function StatePill({ state }: { state: TurnState }) {
  const isThinking = state === "THINKING"
  const isLive = state === "ASKING" || state === "LISTENING"
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium">
      {isThinking ? (
        <Loader2 className="size-3 animate-spin text-emerald-400" />
      ) : (
        <span
          className={`inline-block size-2 rounded-full ${isLive ? "bg-emerald-400" : "bg-neutral-500"}`}
        />
      )}
      {STATE_LABELS[state]}
    </span>
  )
}
