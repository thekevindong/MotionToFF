import { useEffect, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

type HealthState =
  | { status: 'loading' }
  | { status: 'ok' }
  | { status: 'error' }

function useBackendHealth(): HealthState {
  const [health, setHealth] = useState<HealthState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const res = await fetch(`${API_BASE}/health`)
        const data: { ok?: boolean } = await res.json()
        if (!cancelled) {
          setHealth({ status: res.ok && data.ok ? 'ok' : 'error' })
        }
      } catch {
        if (!cancelled) setHealth({ status: 'error' })
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [])

  return health
}

const COMPOSURE_SIGNALS = [
  { label: 'Pulse', unit: 'bpm', hint: 'Presage / SmartSpectra' },
  { label: 'Breathing', unit: 'rpm', hint: 'camera vitals' },
  { label: 'Expression', unit: '', hint: 'MediaPipe' },
]

const STEPS = [
  {
    n: '01',
    title: 'Speak your answer',
    body: 'One spoken question at a time, grounded in your role and resume. No typing, no chatbot back-and-forth.',
  },
  {
    n: '02',
    title: 'Get scored, silently',
    body: 'A judge rates structure, specificity, confidence, and evidence — and flags red flags — without ever talking to you.',
  },
  {
    n: '03',
    title: 'The interview adapts',
    body: 'A director reads your rubric scores and composure signal, then decides to press harder, follow up, or ease off.',
  },
]

function Header({ health }: { health: HealthState }) {
  return (
    <header className="nav">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">Composure</span>
      </div>
      <nav className="nav-links">
        <a href="/diag">Diagnostic</a>
        <a href="/report">Report</a>
        <span
          className={`status-dot status-dot--${health.status}`}
          title={
            health.status === 'ok'
              ? 'Backend connected'
              : health.status === 'error'
                ? 'Backend unreachable'
                : 'Checking backend'
          }
        >
          <span className="status-dot__led" aria-hidden="true" />
          {health.status === 'ok'
            ? 'Ready'
            : health.status === 'error'
              ? 'Offline'
              : 'Connecting'}
        </span>
      </nav>
    </header>
  )
}

function CameraStage() {
  return (
    <div className="stage">
      <div className="camera" role="img" aria-label="Camera preview, currently off">
        <div className="camera-frame">
          <svg
            className="camera-icon"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4 7.5A2.5 2.5 0 0 1 6.5 5h1.6a1 1 0 0 0 .82-.43l.76-1.14A1 1 0 0 1 10.5 3h3a1 1 0 0 1 .82.43l.76 1.14a1 1 0 0 0 .82.43h1.6A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"
              stroke="currentColor"
              strokeWidth="1.4"
            />
            <circle cx="12" cy="12" r="3.4" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          <p className="camera-title">Camera preview</p>
          <p className="camera-sub">
            Vitals read from your webcam. Nothing is recording yet.
          </p>
        </div>

        <div className="camera-badges" aria-hidden="true">
          <span className="pill pill--muted">
            <span className="pill-led" />
            Camera off
          </span>
          <span className="pill pill--muted">
            <span className="pill-led" />
            Mic off
          </span>
        </div>
      </div>

      <div className="stage-actions">
        <button type="button" className="btn btn-primary" disabled>
          Start session
        </button>
        <button type="button" className="btn btn-ghost" disabled>
          Enable camera &amp; mic
        </button>
      </div>
      <p className="stage-note">
        Grant camera and microphone access to begin. Controls activate once a
        session is configured.
      </p>
    </div>
  )
}

function SetupPanel() {
  return (
    <aside className="setup">
      <section className="card">
        <h2 className="card-title">Session setup</h2>
        <p className="card-sub">Optional context sharpens every question.</p>

        <label className="field">
          <span className="field-label">Job title</span>
          <input
            className="field-input"
            type="text"
            placeholder="e.g. Senior Product Manager"
            disabled
          />
        </label>

        <div className="field">
          <span className="field-label">Resume</span>
          <div className="dropzone" role="group" aria-label="Resume upload">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="drop-icon">
              <path
                d="M12 16V4m0 0 4 4m-4-4-4 4"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M4 15v2.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V15"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
              />
            </svg>
            <p className="drop-title">Drop your resume</p>
            <p className="drop-sub">PDF or DOCX · optional</p>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Composure</h2>
          <span className="pill pill--muted">
            <span className="pill-led" />
            Awaiting signal
          </span>
        </div>
        <ul className="signals">
          {COMPOSURE_SIGNALS.map((s) => (
            <li key={s.label} className="signal">
              <div className="signal-ring" aria-hidden="true">
                <span className="signal-value">—</span>
              </div>
              <div className="signal-meta">
                <span className="signal-label">{s.label}</span>
                <span className="signal-hint">
                  {s.unit ? `${s.unit} · ` : ''}
                  {s.hint}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <div className="composure-bar" aria-hidden="true">
          <div className="composure-bar__track" />
        </div>
        <p className="card-foot">
          A single 0–1 composure signal, timelined across the session.
        </p>
      </section>
    </aside>
  )
}

function App() {
  const health = useBackendHealth()

  return (
    <div className="page">
      <Header health={health} />

      <main className="shell">
        <section className="hero">
          <span className="eyebrow">AI interview coach</span>
          <h1 className="hero-title">
            Practice interviews that watch your composure, not just your answers.
          </h1>
          <p className="hero-lede">
            A directed mock interview: one spoken question at a time, scored on
            substance and steadied by camera vitals — so you can see exactly
            where you crack, and fix it.
          </p>
        </section>

        <section className="console">
          <CameraStage />
          <SetupPanel />
        </section>

        <section className="steps">
          {STEPS.map((step) => (
            <article key={step.n} className="step">
              <span className="step-n">{step.n}</span>
              <h3 className="step-title">{step.title}</h3>
              <p className="step-body">{step.body}</p>
            </article>
          ))}
        </section>
      </main>

      <footer className="foot">
        <span>Composure</span>
        <span className="foot-dim">SteelHacks XIII · practice that watches composure</span>
      </footer>
    </div>
  )
}

export default App
