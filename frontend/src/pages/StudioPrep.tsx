import { useState } from 'react'

import { ContextPanel } from '../components/ContextPanel'
import { MODES, SALARY_CHARACTERS, type Character, type Mode } from '../config/modes'

export type PrepStep = 'scenario' | 'opponent' | 'context' | 'ready'

const STEPS: { id: PrepStep; label: string }[] = [
  { id: 'scenario', label: 'Scenario' },
  { id: 'opponent', label: 'Opponent' },
  { id: 'context', label: 'Context' },
  { id: 'ready', label: 'Ready' },
]

function stepIndex(step: PrepStep): number {
  return STEPS.findIndex((s) => s.id === step)
}

export function StudioPrep({
  modeId,
  charId,
  onModeChange,
  onCharChange,
  contextJobTitle,
  onContextJobTitleChange,
  pendingContextFiles,
  onAddContextFiles,
  onRemoveContextFile,
  contextError,
  entering,
  enterError,
  onEnterStudio,
}: {
  modeId: string | null
  charId: string | null
  onModeChange: (mode: Mode) => void
  onCharChange: (character: Character) => void
  contextJobTitle: string
  onContextJobTitleChange: (value: string) => void
  pendingContextFiles: File[]
  onAddContextFiles: (picked: FileList | null) => void
  onRemoveContextFile: (index: number) => void
  contextError: string | null
  entering: boolean
  enterError: string | null
  onEnterStudio: () => void
}) {
  const [step, setStep] = useState<PrepStep>('scenario')

  const mode = MODES.find((m) => m.id === modeId) ?? null
  const character = SALARY_CHARACTERS.find((c) => c.id === charId) ?? null
  const activeIdx = stepIndex(step)

  const goNext = () => {
    if (step === 'scenario' && mode) setStep('opponent')
    else if (step === 'opponent' && character) setStep('context')
    else if (step === 'context') setStep('ready')
  }

  const goBack = () => {
    if (step === 'opponent') setStep('scenario')
    else if (step === 'context') setStep('opponent')
    else if (step === 'ready') setStep('context')
  }

  const pickMode = (m: Mode) => {
    if (!m.ready) return
    onModeChange(m)
    setStep('opponent')
  }

  return (
    <main className="prep-main">
      <nav className="stepper" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <span key={s.id} className="stepper-group">
            {i > 0 && <span className="stepper-line" aria-hidden="true" />}
            <span
              className={`stepper-item ${i === activeIdx ? 'is-active' : ''} ${i < activeIdx ? 'is-done' : ''}`}
            >
              {i + 1} · {s.label}
            </span>
          </span>
        ))}
      </nav>

      {step === 'scenario' && (
        <section className="prep-panel" key="scenario">
          <h1 className="prep-panel-title">What do you want to practice?</h1>
          <p className="prep-panel-sub">
            Pick a scenario. More modes open as we add prompts. Salary negotiation is live now.
          </p>
          <div className="mode-grid">
            {MODES.map((m, i) => (
              <button
                type="button"
                key={m.id}
                className={`mode-card ${m.ready ? '' : 'is-locked'} ${modeId === m.id ? 'is-selected' : ''}`}
                style={{ animationDelay: `${i * 70}ms` }}
                onClick={() => pickMode(m)}
                disabled={!m.ready}
              >
                <span className="mode-index">0{i + 1}</span>
                <span className="mode-name">{m.title}</span>
                <span className="mode-desc">{m.desc}</span>
                <span className="mode-flag">{m.ready ? 'Available' : 'Coming soon'}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 'opponent' && mode && (
        <section className="prep-panel" key="opponent">
          <button type="button" className="prep-panel-back" onClick={() => setStep('scenario')}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15 6l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            {mode.title}
          </button>
          <h1 className="prep-panel-title">Choose who you are up against</h1>
          <p className="prep-panel-sub">Each opponent negotiates with a different temperament. Pick your challenge.</p>
          <div className="char-grid">
            {SALARY_CHARACTERS.map((c, i) => (
              <button
                type="button"
                key={c.id}
                className={`char-card ${charId === c.id ? 'is-selected' : ''}`}
                style={{ animationDelay: `${i * 80}ms` }}
                onClick={() => onCharChange(c)}
                aria-pressed={charId === c.id}
              >
                <span className="char-photo">
                  <img src={c.img} alt="" />
                  <span className={`char-tone char-tone--${c.id}`}>{c.tone}</span>
                </span>
                <span className="char-body">
                  <span className="char-role">{c.role}</span>
                  <span className="char-name">{c.name}</span>
                  <span className="char-desc">{c.desc}</span>
                </span>
                <span className="char-check" aria-hidden="true">
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
              </button>
            ))}
          </div>
          <div className="prep-panel-cta">
            <button type="button" className="prep-btn prep-btn--primary" onClick={goNext} disabled={!character}>
              Continue
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
          </div>
        </section>
      )}

      {step === 'context' && mode && character && (
        <section className="prep-panel prep-panel--wide" key="context">
          <button type="button" className="prep-panel-back" onClick={goBack}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M15 6l-6 6 6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            {character.name}
          </button>
          <h1 className="prep-panel-title">Add context for sharper questions</h1>
          <p className="prep-panel-sub">Ground the interviewer in your role and materials — or continue with defaults.</p>
          {contextError && (
            <p className="prep-error" role="alert">
              {contextError}
            </p>
          )}
          <ContextPanel
            jobTitle={contextJobTitle}
            onJobTitleChange={onContextJobTitleChange}
            files={pendingContextFiles}
            onAddFiles={onAddContextFiles}
            onRemoveFile={onRemoveContextFile}
          />
          <div className="prep-panel-cta">
            <button type="button" className="prep-btn prep-btn--ghost" onClick={goBack}>
              Back
            </button>
            <button type="button" className="prep-btn prep-btn--primary" onClick={goNext}>
              Continue
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
          </div>
        </section>
      )}

      {step === 'ready' && mode && character && (
        <section className="prep-panel prep-panel--ready" key="ready">
          <h1 className="prep-panel-title">You are ready for the studio</h1>
          <p className="prep-panel-sub">We will ask for camera and microphone access when you enter the live room.</p>
          {enterError && (
            <p className="prep-error" role="alert">
              {enterError}
            </p>
          )}
          <div className="prep-summary">
            <div className="prep-summary-row">
              <span className="prep-summary-label">Scenario</span>
              <span className="prep-summary-value">{mode.title}</span>
            </div>
            <div className="prep-summary-row">
              <span className="prep-summary-label">Opponent</span>
              <span className="prep-summary-value">
                {character.name} · {character.tone}
              </span>
            </div>
            <div className="prep-summary-row">
              <span className="prep-summary-label">Context</span>
              <span className="prep-summary-value">
                {contextJobTitle.trim()
                  ? contextJobTitle.trim()
                  : pendingContextFiles.length > 0
                    ? `${pendingContextFiles.length} document${pendingContextFiles.length === 1 ? '' : 's'}`
                    : 'Default job framing'}
              </span>
            </div>
          </div>
          <div className="prep-enter">
            <button type="button" className="prep-enter-btn" onClick={onEnterStudio} disabled={entering}>
              {entering ? 'Connecting…' : 'Enter studio'}
              {!entering && (
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
              )}
            </button>
            <button type="button" className="prep-enter-back" onClick={goBack} disabled={entering}>
              Adjust setup
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
