import type { Navigate } from '../App'
import { getSession } from '../session'
import './Results.css'

function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

const METRICS = [
  { label: 'Composure', value: 82, note: 'Held steady through pushback.' },
  { label: 'Eye contact', value: 74, note: 'Strong, dipped when challenged.' },
  { label: 'Vocal steadiness', value: 68, note: 'Some wavering on the ask.' },
  { label: 'Clarity of ask', value: 79, note: 'Number stated, reasoning light.' },
  { label: 'Filler words', value: 60, note: '6 detected — trim "um" and "like".', invert: true },
]

const STRENGTHS = [
  'Opened with a confident, specific number instead of a range.',
  'Stayed calm when the opponent pushed back on budget.',
  'Backed your ask with a concrete market comparison.',
]

const IMPROVEMENTS = [
  'Reduce filler words when buying time — pause instead.',
  'Hold eye contact through the hardest question.',
  'Close the loop: restate the ask after handling an objection.',
]

const TRANSCRIPT = [
  { who: 'them', text: "Let's talk numbers. What are you expecting for this role?" },
  { who: 'you', text: 'Based on my research and impact, I\u2019m targeting $118,000.' },
  { who: 'them', text: 'That\u2019s above our band for this level. We were thinking $102,000.' },
  { who: 'you', text: 'I understand the band. Given the scope here, $118k reflects the market for this work.' },
  { who: 'them', text: 'I can go to $108,000, but that\u2019s a stretch.' },
]

export default function Results({ navigate }: { navigate: Navigate }) {
  const session = getSession()
  const mode = session?.mode ?? 'Salary Negotiation'
  const opponent = session?.opponent ?? 'HR Lead'
  const tone = session?.tone ?? 'Strict & Harsh'
  const img = session?.opponentImg ?? '/characters/hr-lead.png'
  const duration = session ? fmtDuration(session.durationSec) : '4m 12s'
  const overall = 76

  return (
    <div className="report">
      <header className="report-top">
        <button type="button" className="report-brand" onClick={() => navigate('/')} aria-label="SpeakUp home">
          <img src="/brand/speakup-logo-horizontal.png" alt="SpeakUp" height={26} />
        </button>
        <span className="report-badge">Session report</span>
      </header>

      <main className="report-main">
        {/* Hero summary */}
        <section className="report-hero">
          <div className="report-hero-text">
            <p className="report-eyebrow">Practice complete</p>
            <h1 className="report-title">
              You held your <span className="report-hl">composure</span>.
            </h1>
            <p className="report-lead">
              Here is the full breakdown of your {mode.toLowerCase()} session against {opponent}. Review the read,
              then run it back.
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
                style={{ strokeDashoffset: 327 - (327 * overall) / 100 }}
              />
            </svg>
            <span className="report-score-num">{overall}</span>
            <span className="report-score-label">Overall</span>
          </div>
        </section>

        {/* Metrics */}
        <section className="report-block">
          <h2 className="report-h2">Delivery breakdown</h2>
          <div className="metric-grid">
            {METRICS.map((m) => (
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

        {/* Feedback columns */}
        <section className="report-columns">
          <div className="report-card report-card--good">
            <h3 className="report-h3">What worked</h3>
            <ul className="report-list">
              {STRENGTHS.map((s) => (
                <li key={s}>
                  <span className="report-ic report-ic--good" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
              {IMPROVEMENTS.map((s) => (
                <li key={s}>
                  <span className="report-ic report-ic--work" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M12 8v5m0 3h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none" />
                    </svg>
                  </span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Transcript */}
        <section className="report-block">
          <h2 className="report-h2">Transcript highlights</h2>
          <div className="transcript">
            {TRANSCRIPT.map((line, i) => (
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

        {/* CTA */}
        <section className="report-cta">
          <button type="button" className="report-btn report-btn--dark" onClick={() => navigate('/start')}>
            Practice again
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
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
