import { useEffect, useRef, useState } from 'react'
import './Report.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type RubricScores = {
  structure: number
  specificity: number
  confidence: number
  evidence: string[]
  red_flags: string[]
  overall: number
}

type DirectorDecision = {
  action: string
  rationale: string
}

type SessionTurn = {
  turn: number
  question: string
  answer: string
  scores: RubricScores
  composure: number
  decision: DirectorDecision
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; turns: SessionTurn[] }

function drawComposureChart(
  canvas: HTMLCanvasElement,
  turns: SessionTurn[],
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx || turns.length === 0) {
    return
  }

  const dpr = window.devicePixelRatio || 1
  const cssWidth = canvas.clientWidth
  const cssHeight = canvas.clientHeight
  canvas.width = Math.floor(cssWidth * dpr)
  canvas.height = Math.floor(cssHeight * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  const pad = { top: 16, right: 16, bottom: 32, left: 44 }
  const plotW = cssWidth - pad.left - pad.right
  const plotH = cssHeight - pad.top - pad.bottom

  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, cssWidth, cssHeight)

  ctx.strokeStyle = '#e2e2e6'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (plotH * i) / 4
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(pad.left + plotW, y)
    ctx.stroke()
    const value = 1 - i / 4
    ctx.fillStyle = '#888'
    ctx.font = '11px system-ui, sans-serif'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'middle'
    ctx.fillText(value.toFixed(2), pad.left - 6, y)
  }

  const values = turns.map((t) => t.composure)
  const n = values.length

  const xAt = (index: number) =>
    n === 1
      ? pad.left + plotW / 2
      : pad.left + (plotW * index) / (n - 1)

  ctx.strokeStyle = '#1a5cff'
  ctx.lineWidth = 2
  ctx.beginPath()
  values.forEach((v, i) => {
    const x = xAt(i)
    const y = pad.top + plotH * (1 - Math.min(1, Math.max(0, v)))
    if (i === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.stroke()

  ctx.fillStyle = '#1a5cff'
  values.forEach((v, i) => {
    const x = xAt(i)
    const y = pad.top + plotH * (1 - Math.min(1, Math.max(0, v)))
    ctx.beginPath()
    ctx.arc(x, y, 4, 0, Math.PI * 2)
    ctx.fill()
  })

  ctx.fillStyle = '#555'
  ctx.font = '11px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  turns.forEach((t, i) => {
    ctx.fillText(String(t.turn), xAt(i), pad.top + plotH + 8)
  })

  ctx.fillStyle = '#333'
  ctx.font = '600 12px system-ui, sans-serif'
  ctx.textAlign = 'left'
  ctx.fillText('Composure by turn', pad.left, 4)
}

export default function Report() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      try {
        const res = await fetch(`${API_BASE}/session`)
        if (!res.ok) {
          throw new Error(`Session HTTP ${res.status}`)
        }
        const data: { turns: SessionTurn[] } = await res.json()
        if (!cancelled) {
          setState({ status: 'ready', turns: data.turns ?? [] })
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Load failed'
          setState({ status: 'error', message })
        }
      }
    }

    loadSession()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (state.status !== 'ready' || state.turns.length === 0) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    drawComposureChart(canvas, state.turns)
  }, [state])

  useEffect(() => {
    if (state.status !== 'ready' || state.turns.length === 0) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    const onResize = () => drawComposureChart(canvas, state.turns)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [state])

  const turns = state.status === 'ready' ? state.turns : []
  const avgComposure =
    turns.length > 0
      ? turns.reduce((sum, t) => sum + t.composure, 0) / turns.length
      : null

  return (
    <main className="report">
      <header className="report-header">
        <h1>Session report</h1>
        <p className="muted">
          <a href="/">← Back to interview</a>
        </p>
      </header>

      {state.status === 'loading' && <p className="muted">Loading session…</p>}
      {state.status === 'error' && (
        <p className="status-error">Could not load report: {state.message}</p>
      )}

      {state.status === 'ready' && turns.length === 0 && (
        <section className="report-panel">
          <p className="muted">
            No turns recorded yet. Complete at least one answer on the home page,
            then return here.
          </p>
        </section>
      )}

      {state.status === 'ready' && turns.length > 0 && (
        <>
          <section className="report-panel">
            <h2>Composure curve</h2>
            {avgComposure !== null && (
              <p className="report-summary">
                Average composure: <strong>{avgComposure.toFixed(2)}</strong> ·{' '}
                {turns.length} turn{turns.length === 1 ? '' : 's'}
              </p>
            )}
            <canvas
              ref={canvasRef}
              className="composure-chart"
              role="img"
              aria-label="Line chart of composure score per interview turn"
            />
          </section>

          <section className="report-panel">
            <h2>Rubric scores</h2>
            <ul className="rubric-list">
              {turns.map((turn) => (
                <li key={turn.turn}>
                  <p className="rubric-meta">
                    Turn {turn.turn} · decision:{' '}
                    <strong>{turn.decision.action}</strong> · composure{' '}
                    {turn.composure.toFixed(2)}
                  </p>
                  <p className="rubric-question">{turn.question}</p>
                  <p className="rubric-scores">
                    overall {turn.scores.overall.toFixed(2)} · structure{' '}
                    {turn.scores.structure.toFixed(2)} · specificity{' '}
                    {turn.scores.specificity.toFixed(2)} · confidence{' '}
                    {turn.scores.confidence.toFixed(2)}
                  </p>
                  {turn.scores.evidence.length > 0 && (
                    <ul className="evidence-list">
                      {turn.scores.evidence.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  {turn.scores.red_flags.length > 0 && (
                    <p className="red-flags">
                      Red flags: {turn.scores.red_flags.join(', ')}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  )
}
