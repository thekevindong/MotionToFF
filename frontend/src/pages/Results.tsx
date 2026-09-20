import { useEffect, useState } from 'react'
import type { Navigate } from '../App'
import { getSession as fetchSessionApi, getSessionReport } from '../lib/api'
import type { SessionTurn } from '../lib/api-types'
import {
  buildImprovements,
  buildMetrics,
  buildStrengths,
  buildTranscript,
  computeOverallScore,
} from '../lib/report-data'
import { clearStoredSessionId, getStoredSessionId } from '../lib/session-storage'
import { clearSessionSummary, getSession } from '../session'
import './Results.css'

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; turns: SessionTurn[]; jobTitle: string | null }

export default function Results({ navigate }: { navigate: Navigate }) {
  const summary = getSession()
  const mode = summary?.mode ?? 'Salary Negotiation'
  const opponent = summary?.opponent ?? 'HR Lead'
  const tone = summary?.tone ?? 'Strict & Harsh'
  const img = summary?.opponentImg ?? '/characters/hr-lead.png'
  const duration = summary ? fmtDuration(summary.durationSec) : '—'

  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const sessionId = summary?.sessionId ?? getStoredSessionId()
    const load = sessionId
      ? getSessionReport(sessionId)
      : fetchSessionApi(undefined)
    load
      .then((data) => {
        if (!cancelled) {
          setState({
            status: 'ready',
            turns: data.turns ?? [],
            jobTitle: data.job_title ?? null,
          })
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Load failed'
          setState({ status: 'error', message })
        }
      })
    return () => {
      cancelled = true
    }
  }, [summary?.sessionId])

  const turns = state.status === 'ready' ? state.turns : []
  const overall = computeOverallScore(turns)
  const metrics = buildMetrics(turns)
  const strengths = buildStrengths(turns)
  const improvements = buildImprovements(turns)
  const transcript = buildTranscript(turns)
  const ringScore = overall ?? 0

  const practiceAgain = () => {
    clearSessionSummary()
    clearStoredSessionId()
    navigate('/start')
  }

  return (
    <div className="report">
      <header className="report-top">
        <button type="button" className="report-brand" onClick={() => navigate('/')} aria-label="SpeakUp home">
          <img src="/brand/speakup-logo-horizontal.png" alt="SpeakUp" height={26} />
        </button>
        <span className="report-badge">Session report</span>
      </header>

      <main className="report-main">
        {state.status === 'loading' && <p className="report-status">Loading session…</p>}
        {state.status === 'error' && (
          <p className="report-status report-status--error" role="alert">
            Could not load report: {state.message}
          </p>
        )}

        <section className="report-hero">
          <div className="report-hero-text">
            <p className="report-eyebrow">Practice complete</p>
            <h1 className="report-title">
              {turns.length > 0 ? (
                <>
                  You held your <span className="report-hl">composure</span>.
                </>
              ) : (
                <>
                  Session <span className="report-hl">saved</span>.
                </>
              )}
            </h1>
            <p className="report-lead">
              {turns.length > 0
                ? `Here is the full breakdown of your ${mode.toLowerCase()} session against ${opponent}. Review the read, then run it back.`
                : `Your studio session is on the server${state.status === 'ready' && state.jobTitle ? ` (${state.jobTitle})` : ''}. Answer questions in the studio to fill this report.`}
            </p>
            <div className="report-meta">
              <span className="report-meta-item">
                <span className="report-meta-k">Scenario</span>
                <span className="report-meta-v">{mode}</span>
              </span>
              <span className="report-meta-item">
                <span className="report-meta-k">Opponent</span>
                <span className="report-meta-v">
                  {opponent} · {tone}
                </span>
              </span>
              <span className="report-meta-item">
                <span className="report-meta-k">Duration</span>
                <span className="report-meta-v">{duration}</span>
              </span>
            </div>
          </div>
          <div className="report-score">
            <svg className="report-ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle className="report-ring-track" cx="60" cy="60" r="52" />
              <circle
                className="report-ring-fill"
                cx="60"
                cy="60"
                r="52"
                style={{ strokeDashoffset: 327 - (327 * ringScore) / 100 }}
              />
            </svg>
            <span className="report-score-num">{overall !== null ? overall : '—'}</span>
            <span className="report-score-label">Overall</span>
          </div>
        </section>

        {state.status === 'ready' && turns.length === 0 && (
          <section className="report-block report-empty">
            <h2 className="report-h2">No turns yet</h2>
            <p className="report-empty-text">
              Ending early still created a session. Return to the studio, start a session, and submit answers to see
              rubric scores and transcript highlights here.
            </p>
            <button type="button" className="report-btn report-btn--dark" onClick={() => navigate('/start')}>
              Back to studio
            </button>
          </section>
        )}

        {turns.length > 0 && (
          <>
            <section className="report-block">
              <h2 className="report-h2">Delivery breakdown</h2>
              <div className="metric-grid">
                {metrics.map((m) => (
                  <div className="metric" key={m.label}>
                    <div className="metric-top">
                      <span className="metric-label">{m.label}</span>
                      <span className="metric-value">{m.value}</span>
                    </div>
                    <span className="metric-bar">
                      <span className={`metric-fill ${m.invert ? 'is-warn' : ''}`} style={{ width: `${m.value}%` }} />
                    </span>
                    <p className="metric-note">{m.note}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="report-columns">
              <div className="report-card report-card--good">
                <h3 className="report-h3">What worked</h3>
                <ul className="report-list">
                  {strengths.map((s) => (
                    <li key={s}>
                      <span className="report-ic report-ic--good" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path
                            d="M5 12.5l4.5 4.5L19 7"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            fill="none"
                          />
                        </svg>
                      </span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="report-card report-card--work">
                <h3 className="report-h3">Work on this</h3>
                <ul className="report-list">
                  {improvements.map((s) => (
                    <li key={s}>
                      <span className="report-ic report-ic--work" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                          <path
                            d="M12 8v5m0 3h.01"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            fill="none"
                          />
                        </svg>
                      </span>
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </section>

            <section className="report-block">
              <h2 className="report-h2">Transcript highlights</h2>
              <div className="transcript">
                {transcript.map((line, i) => (
                  <div key={i} className={`bubble bubble--${line.who}`}>
                    <span className="bubble-who">
                      {line.who === 'you' ? (
                        'You'
                      ) : (
                        <img src={img || '/placeholder.svg'} alt={opponent} className="bubble-avatar" />
                      )}
                    </span>
                    <p className="bubble-text">{line.text}</p>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        <section className="report-cta">
          <button type="button" className="report-btn report-btn--dark" onClick={practiceAgain}>
            Practice again
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 12h14m-6-6 6 6-6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
          <button type="button" className="report-btn report-btn--ghost" onClick={() => navigate('/')}>
            Back to home
          </button>
        </section>
      </main>
    </div>
  )
}
