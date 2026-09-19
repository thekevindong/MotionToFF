"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft } from "lucide-react"
import type { SessionTurn } from "@/lib/api-types"
import { getSession } from "@/lib/api"
import { drawComposureChart } from "@/lib/draw-composure-chart"

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; turns: SessionTurn[] }

export default function ReportPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<LoadState>({ status: "loading" })

  useEffect(() => {
    let cancelled = false
    getSession()
      .then((data) => {
        if (!cancelled) {
          setState({ status: "ready", turns: data.turns ?? [] })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : "Load failed"
          setState({ status: "error", message })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (state.status !== "ready" || state.turns.length === 0) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    drawComposureChart(canvas, state.turns, true)
  }, [state])

  useEffect(() => {
    if (state.status !== "ready" || state.turns.length === 0) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const onResize = () => drawComposureChart(canvas, state.turns, true)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [state])

  const turns = state.status === "ready" ? state.turns : []
  const avgComposure =
    turns.length > 0
      ? turns.reduce((sum, t) => sum + t.composure, 0) / turns.length
      : null

  return (
    <main className="min-h-svh bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <header className="mb-8">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Link
              href="/"
              className="text-neutral-400 transition-colors hover:text-neutral-100"
            >
              Home
            </Link>
            <Link
              href="/interview"
              className="inline-flex items-center gap-2 text-neutral-400 transition-colors hover:text-neutral-100"
            >
              <ArrowLeft className="size-4" />
              Back to interview
            </Link>
          </div>
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Session report</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Backend composure curve and Nemotron rubric per turn.
          </p>
        </header>

        {state.status === "loading" && (
          <p className="text-sm text-neutral-400">Loading session…</p>
        )}
        {state.status === "error" && (
          <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            Could not load report: {state.message}
          </p>
        )}

        {state.status === "ready" && turns.length === 0 && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
            <p className="text-sm text-neutral-400">
              No turns recorded yet. Join a call, answer at least one question, then return here.
            </p>
          </section>
        )}

        {state.status === "ready" && turns.length > 0 && (
          <>
            <section className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
              <h2 className="text-lg font-medium">Composure curve</h2>
              {avgComposure !== null && (
                <p className="mt-2 text-sm text-neutral-300">
                  Average composure:{" "}
                  <strong className="text-white">{avgComposure.toFixed(2)}</strong> · {turns.length}{" "}
                  turn{turns.length === 1 ? "" : "s"}
                </p>
              )}
              <canvas
                ref={canvasRef}
                className="mt-4 h-56 w-full rounded-xl border border-neutral-800"
                role="img"
                aria-label="Line chart of composure score per interview turn"
              />
            </section>

            <section className="rounded-2xl border border-neutral-800 bg-neutral-900/50 p-6">
              <h2 className="text-lg font-medium">Rubric scores</h2>
              <ul className="mt-4 space-y-6">
                {turns.map((turn) => (
                  <li
                    key={turn.turn}
                    className="border-b border-neutral-800 pb-6 last:border-0 last:pb-0"
                  >
                    <p className="text-sm text-neutral-400">
                      Turn {turn.turn} · decision:{" "}
                      <strong className="text-emerald-400">{turn.decision.action}</strong> · composure{" "}
                      {turn.composure.toFixed(2)}
                    </p>
                    <p className="mt-2 text-sm font-medium text-neutral-200">{turn.question}</p>
                    <p className="mt-1 text-xs text-neutral-500">You: {turn.answer}</p>
                    <p className="mt-2 text-sm tabular-nums text-neutral-300">
                      overall {turn.scores.overall.toFixed(2)} · structure{" "}
                      {turn.scores.structure.toFixed(2)} · specificity{" "}
                      {turn.scores.specificity.toFixed(2)} · confidence{" "}
                      {turn.scores.confidence.toFixed(2)}
                      {turn.scores.mock ? (
                        <span className="ml-2 text-neutral-500">(mock rubric)</span>
                      ) : null}
                    </p>
                    {turn.decision.rationale && (
                      <p className="mt-2 text-sm text-neutral-400">{turn.decision.rationale}</p>
                    )}
                    {turn.scores.evidence.length > 0 && (
                      <ul className="mt-2 list-inside list-disc text-sm text-neutral-400">
                        {turn.scores.evidence.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {turn.scores.red_flags.length > 0 && (
                      <p className="mt-2 text-sm text-rose-300">
                        Red flags: {turn.scores.red_flags.join(", ")}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
