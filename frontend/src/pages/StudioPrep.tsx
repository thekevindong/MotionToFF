import { useEffect, useRef, useState } from 'react'

import { ContextPanel } from '../components/ContextPanel'
import { MODES, SALARY_CHARACTERS, type Character, type Mode } from '../config/modes'
import {
  SPEAKING_DURATION_OPTIONS,
  type SpeakingDurationId,
} from '../config/speaking-duration'
import {
  THESIS_PACK_OPTIONS,
  thesisPackById,
  type ThesisPackId,
} from '../config/thesis-duration'
import {
  SESSION_DURATION_OPTIONS,
  formatSessionDuration,
} from '../config/session-duration'
import { CUSTOM_SPEECH_ID } from '../config/custom-speech'
import { getSpeeches } from '../lib/api'
import type { SpeechCatalogItem } from '../lib/api-types'

export type PrepStep = 'scenario' | 'opponent' | 'context' | 'ready'

const STEPS: { id: PrepStep; label: string; speakingLabel?: string; thesisLabel?: string }[] = [
  { id: 'scenario', label: 'Scenario' },
  { id: 'opponent', label: 'Opponent', speakingLabel: 'Speech', thesisLabel: 'Duration' },
  { id: 'context', label: 'Context', speakingLabel: 'Duration' },
  { id: 'ready', label: 'Ready' },
]

function stepIndex(step: PrepStep): number {
  return STEPS.findIndex((s) => s.id === step)
}

function stepLabel(step: PrepStep, speaking: boolean, thesis: boolean): string {
  const row = STEPS.find((s) => s.id === step)
  if (!row) return step
  if (thesis && row.thesisLabel) return row.thesisLabel
  return speaking && row.speakingLabel ? row.speakingLabel : row.label
}

function formatSpeakingDuration(id: SpeakingDurationId): string {
  const opt = SPEAKING_DURATION_OPTIONS.find((o) => o.id === id)
  return opt?.label ?? id
}

export function StudioPrep({
  modeId,
  charId,
  speechId,
  speakingDurationId,
  onModeChange,
  onCharChange,
  onSpeechSelect,
  onCustomSpeech,
  customSpeechExcerpt,
  onSpeakingDurationChange,
  contextJobTitle,
  onContextJobTitleChange,
  pendingContextFiles,
  onAddContextFiles,
  onRemoveContextFile,
  contextError,
  entering,
  enterError,
  onEnterStudio,
  sessionDurationSec,
  onSessionDurationChange,
  thesisPackId,
  onThesisPackChange,
  thesisDefenseReady,
  thesisDefenseFilename,
  thesisDefensePreview,
  onThesisDefenseFilePicked,
  thesisDefenseFileError,
}: {
  modeId: string | null
  charId: string | null
  speechId: string | null
  speakingDurationId: SpeakingDurationId
  onModeChange: (mode: Mode) => void
  onCharChange: (character: Character) => void
  onSpeechSelect: (speech: SpeechCatalogItem) => void
  onCustomSpeech: (payload: { excerpt: string; title: string; speaker: string }) => void
  customSpeechExcerpt: string
  onSpeakingDurationChange: (id: SpeakingDurationId) => void
  contextJobTitle: string
  onContextJobTitleChange: (value: string) => void
  pendingContextFiles: File[]
  onAddContextFiles: (picked: FileList | null) => void
  onRemoveContextFile: (index: number) => void
  contextError: string | null
  sessionDurationSec: number
  onSessionDurationChange: (seconds: number) => void
  entering: boolean
  enterError: string | null
  onEnterStudio: () => void
  thesisPackId: ThesisPackId
  onThesisPackChange: (id: ThesisPackId) => void
  thesisDefenseReady: boolean
  thesisDefenseFilename: string | null
  thesisDefensePreview: string
  onThesisDefenseFilePicked: (picked: FileList | null) => void
  thesisDefenseFileError: string | null
}) {
  const thesisDefenseInputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<PrepStep>('scenario')
  const [speeches, setSpeeches] = useState<SpeechCatalogItem[]>([])
  const [speechesLoading, setSpeechesLoading] = useState(false)
  const [speechesError, setSpeechesError] = useState<string | null>(null)
  const [customFileName, setCustomFileName] = useState<string | null>(null)
  const [customFileError, setCustomFileError] = useState<string | null>(null)
  const speechTxtInputRef = useRef<HTMLInputElement>(null)

  const mode = MODES.find((m) => m.id === modeId) ?? null
  const isSpeaking = mode?.id === 'speaking'
  const isThesis = mode?.id === 'thesis'
  const thesisPack = thesisPackById(thesisPackId)
  const character = SALARY_CHARACTERS.find((c) => c.id === charId) ?? null
  const selectedSpeech = speeches.find((s) => s.id === speechId) ?? null
  const isCustomSpeech = speechId === CUSTOM_SPEECH_ID
  const customReady = isCustomSpeech && customSpeechExcerpt.trim().split(/\s+/).filter(Boolean).length >= 8
  const speechLabel = isCustomSpeech ? 'Your speech' : (selectedSpeech?.title ?? 'Speech')
  const speechSpeaker = isCustomSpeech ? 'You' : (selectedSpeech?.speaker ?? 'Speaker')
  const speechChosen = Boolean(selectedSpeech || customReady)

  const onSpeechTxtPicked = (files: FileList | null) => {
    setCustomFileError(null)
    const file = files?.[0]
    if (!file) return
    const lower = file.name.toLowerCase()
    const okType = lower.endsWith('.txt') || file.type === 'text/plain' || file.type === ''
    if (!okType) {
      setCustomFileError('Choose one plain-text file (.txt), not a folder or other format.')
      setCustomFileName(null)
      return
    }
    setCustomFileName(file.name)
    void file.text().then(
      (text) => {
        const title = file.name.replace(/\.txt$/i, '').trim() || 'Your speech'
        onCustomSpeech({ excerpt: text, title, speaker: 'You' })
      },
      () => {
        setCustomFileError('Could not read that file — try a UTF-8 .txt file.')
        setCustomFileName(null)
      },
    )
  }
  const activeIdx = stepIndex(step)

  useEffect(() => {
    if (!isSpeaking) return
    let cancelled = false
    setSpeechesLoading(true)
    setSpeechesError(null)
    void getSpeeches()
      .then((data) => {
        if (!cancelled) setSpeeches(data.speeches ?? [])
      })
      .catch((err) => {
        if (!cancelled) {
          setSpeechesError(err instanceof Error ? err.message : 'Could not load speeches')
        }
      })
      .finally(() => {
        if (!cancelled) setSpeechesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isSpeaking])

  useEffect(() => {
    if (speechId !== CUSTOM_SPEECH_ID) {
      setCustomFileName(null)
      setCustomFileError(null)
    }
  }, [speechId])

  const opponentReady = isSpeaking
    ? Boolean(speechId && (isCustomSpeech ? customReady : true))
    : isThesis
      ? Boolean(thesisPack)
      : Boolean(character)

  const goNext = () => {
    if (step === 'scenario' && mode) setStep('opponent')
    else if (step === 'opponent' && opponentReady) setStep('context')
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

  const readyToEnter = isSpeaking
    ? Boolean(mode && (isCustomSpeech ? customReady : selectedSpeech))
    : isThesis
      ? Boolean(mode && thesisDefenseReady && thesisPack)
      : Boolean(mode && character)

  return (
    <main className="prep-main">
      <nav className="stepper" aria-label="Setup progress">
        {STEPS.map((s, i) => (
          <span key={s.id} className="stepper-group">
            {i > 0 && <span className="stepper-line" aria-hidden="true" />}
            <span
              className={`stepper-item ${i === activeIdx ? 'is-active' : ''} ${i < activeIdx ? 'is-done' : ''}`}
            >
              {i + 1} · {stepLabel(s.id, isSpeaking, isThesis)}
            </span>
          </span>
        ))}
      </nav>

      {step === 'scenario' && (
        <section className="prep-panel" key="scenario">
          <h1 className="prep-panel-title">What do you want to practice?</h1>
          <p className="prep-panel-sub">
            Pick a scenario. Salary negotiation, public speaking, and thesis defense are available now.
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

      {step === 'opponent' && mode && isThesis && (
        <section className="prep-panel" key="thesis-duration">
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
          <h1 className="prep-panel-title">Choose your defense duration</h1>
          <p className="prep-panel-sub">
            Short or long pack — timed presentation plus a fixed number of committee questions.
          </p>
          <div className="prep-duration-block prep-duration-block--center">
            <div className="duration-grid" role="listbox" aria-label="Thesis duration pack">
              {THESIS_PACK_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={thesisPackId === opt.id}
                  className={`duration-chip ${thesisPackId === opt.id ? 'is-selected' : ''}`}
                  onClick={() => onThesisPackChange(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="prep-panel-cta">
            <button type="button" className="prep-btn prep-btn--primary" onClick={goNext} disabled={!thesisPack}>
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

      {step === 'opponent' && mode && !isSpeaking && !isThesis && (
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

      {step === 'opponent' && mode && isSpeaking && (
        <section className="prep-panel" key="speech">
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
          <h1 className="prep-panel-title">Pick a speech to practice</h1>
          <p className="prep-panel-sub">
            Famous excerpts for the teleprompter — choose one, then set how long you want to speak.
          </p>
          {speechesError && (
            <p className="prep-error" role="alert">
              {speechesError}
            </p>
          )}
          {speechesLoading && <p className="prep-panel-sub">Loading speeches…</p>}
          <div
            className={`mode-card mode-card--custom ${isCustomSpeech ? 'is-selected' : ''}`}
            style={{ marginBottom: 16 }}
          >
            <span className="mode-name">Your own speech</span>
            <span className="mode-desc">
              Pick one .txt file (single file, not a folder) or paste below.
            </span>
            <div className="prep-speech-file-row">
              <button
                type="button"
                className="context-upload-btn"
                onClick={() => speechTxtInputRef.current?.click()}
              >
                Choose .txt file
              </button>
              <input
                ref={speechTxtInputRef}
                type="file"
                className="context-file-input"
                accept=".txt,text/plain"
                onChange={(e) => {
                  onSpeechTxtPicked(e.target.files)
                  e.target.value = ''
                }}
              />
              {customFileName && isCustomSpeech && (
                <span className="prep-speech-file-name" title={customFileName}>
                  Loaded: {customFileName}
                </span>
              )}
            </div>
            {customFileError && (
              <p className="prep-error" role="alert" style={{ marginTop: 8 }}>
                {customFileError}
              </p>
            )}
            <textarea
              className="prep-custom-speech"
              placeholder="Or paste your speech here (at least 8 words)…"
              rows={5}
              value={isCustomSpeech ? customSpeechExcerpt : ''}
              onChange={(e) => {
                const excerpt = e.target.value
                onCustomSpeech({ excerpt, title: 'Your speech', speaker: 'You' })
              }}
              aria-label="Custom speech text"
            />
          </div>
          <div className="mode-grid">
            {speeches.map((s, i) => (
              <button
                type="button"
                key={s.id}
                className={`mode-card ${speechId === s.id ? 'is-selected' : ''}`}
                style={{ animationDelay: `${i * 70}ms` }}
                onClick={() => onSpeechSelect(s)}
                aria-pressed={speechId === s.id}
              >
                <span className="mode-name">{s.title}</span>
                <span className="mode-desc">{s.speaker}</span>
                <span className="mode-flag">
                  ~{Math.max(1, Math.round(s.est_full_duration_sec / 60))} min full read · {s.word_count} words
                </span>
                <span className="mode-desc">{s.teaser}</span>
              </button>
            ))}
          </div>
          <div className="prep-panel-cta">
            <button
              type="button"
              className="prep-btn prep-btn--primary"
              onClick={goNext}
              disabled={!opponentReady || speechesLoading}
            >
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

      {step === 'context' && mode && isThesis && (
        <section className="prep-panel prep-panel--wide" key="thesis-defense">
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
            {thesisPack?.label ?? 'Duration'}
          </button>
          <h1 className="prep-panel-title">Upload your defense text</h1>
          <p className="prep-panel-sub">
            Upload the text you will defend — your talk and Q&amp;A are about this file. Plain{' '}
            <strong>.txt</strong> only (abstract, outline, or short paper). A committee member is assigned
            randomly when you enter the studio.
          </p>
          {(contextError || thesisDefenseFileError) && (
            <p className="prep-error" role="alert">
              {thesisDefenseFileError ?? contextError}
            </p>
          )}
          <div className="context-panel" aria-label="Defense document">
            <div className="context-files">
              <span className="context-field-label">Defense file (required)</span>
              <button
                type="button"
                className="context-upload-btn"
                onClick={() => thesisDefenseInputRef.current?.click()}
              >
                Choose .txt file
              </button>
              <input
                ref={thesisDefenseInputRef}
                type="file"
                className="context-file-input"
                accept=".txt,text/plain"
                onChange={(e) => {
                  onThesisDefenseFilePicked(e.target.files)
                  e.target.value = ''
                }}
              />
              {thesisDefenseFilename && (
                <ul className="context-file-list">
                  <li>
                    <span className="context-file-name">{thesisDefenseFilename}</span>
                  </li>
                </ul>
              )}
            </div>
            {thesisDefensePreview && (
              <p className="context-caption" style={{ marginTop: 12 }}>
                Preview: {thesisDefensePreview}
              </p>
            )}
          </div>
          <div className="prep-panel-cta">
            <button type="button" className="prep-btn prep-btn--ghost" onClick={goBack}>
              Back
            </button>
            <button
              type="button"
              className="prep-btn prep-btn--primary"
              onClick={goNext}
              disabled={!thesisDefenseReady}
            >
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

      {step === 'context' && mode && !isSpeaking && !isThesis && character && (
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
          <div className="prep-duration-block">
            <h2 className="prep-duration-title">How long is this session?</h2>
            <p className="prep-duration-sub">
              When time is up, you will be taken to your report automatically.
            </p>
            <div className="duration-grid" role="listbox" aria-label="Session length">
              {SESSION_DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.seconds}
                  type="button"
                  role="option"
                  aria-selected={sessionDurationSec === opt.seconds}
                  className={`duration-chip ${sessionDurationSec === opt.seconds ? 'is-selected' : ''}`}
                  onClick={() => onSessionDurationChange(opt.seconds)}
                >
                  {opt.shortLabel}
                </button>
              ))}
            </div>
          </div>
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

      {step === 'context' && mode && isSpeaking && speechChosen && (
        <section className="prep-panel prep-panel--wide" key="speaking-duration">
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
            {speechLabel}
          </button>
          <h1 className="prep-panel-title">How long do you want to speak?</h1>
          <p className="prep-panel-sub">
            Timed modes count down; full length runs until you tap Finish speech in the studio.
          </p>
          <div className="prep-duration-block">
            <div className="duration-grid" role="listbox" aria-label="Speech length">
              {SPEAKING_DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={speakingDurationId === opt.id}
                  className={`duration-chip ${speakingDurationId === opt.id ? 'is-selected' : ''}`}
                  onClick={() => onSpeakingDurationChange(opt.id)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
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

      {step === 'ready' && mode && readyToEnter && (
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
            {isThesis && thesisPack && thesisDefenseReady ? (
              <>
                <div className="prep-summary-row">
                  <span className="prep-summary-label">Duration</span>
                  <span className="prep-summary-value">{thesisPack.label}</span>
                </div>
                <div className="prep-summary-row">
                  <span className="prep-summary-label">Defense file</span>
                  <span className="prep-summary-value">{thesisDefenseFilename ?? 'defense.txt'}</span>
                </div>
                {thesisDefensePreview && (
                  <div className="prep-summary-row">
                    <span className="prep-summary-label">Preview</span>
                    <span className="prep-summary-value">{thesisDefensePreview}</span>
                  </div>
                )}
                <div className="prep-summary-row">
                  <span className="prep-summary-label">Committee</span>
                  <span className="prep-summary-value">Assigned at random when you enter</span>
                </div>
              </>
            ) : isSpeaking && speechChosen ? (
              <>
                <div className="prep-summary-row">
                  <span className="prep-summary-label">Speech</span>
                  <span className="prep-summary-value">{speechLabel}</span>
                </div>
                <div className="prep-summary-row">
                  <span className="prep-summary-label">Speaker</span>
                  <span className="prep-summary-value">{speechSpeaker}</span>
                </div>
                <div className="prep-summary-row">
                  <span className="prep-summary-label">Duration</span>
                  <span className="prep-summary-value">{formatSpeakingDuration(speakingDurationId)}</span>
                </div>
              </>
            ) : (
              character && (
                <>
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
                  <div className="prep-summary-row">
                    <span className="prep-summary-label">Length</span>
                    <span className="prep-summary-value">{formatSessionDuration(sessionDurationSec)}</span>
                  </div>
                </>
              )
            )}
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
