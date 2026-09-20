import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

import type { Navigate } from '../App'

import { MODES, SALARY_CHARACTERS } from '../config/modes'

import type { CharacterId } from '../config/character-expressions'

import { useBrowserSpeechCapture } from '../hooks/use-browser-speech-capture'

import { useComposureSampler } from '../hooks/use-composure-sampler'

import { stageOpponentSrc, useCharacterExpression } from '../hooks/use-character-expression'

import { useFaceComposure } from '../hooks/use-face-composure'

import { useInterviewMachine } from '../hooks/use-interview-machine'

import { useMediaStream } from '../hooks/use-media-stream'

import { usePresageMetrics, type PresageMetricRow } from '../hooks/use-presage-metrics'

import {
  createSession,
  getHealth,
  getSession,
  getVoiceStatus,
  postTurn,
  uploadDocument,
} from '../lib/api'

import type { TurnState } from '../lib/contracts'

import { getStoredSessionId, setStoredSessionId } from '../lib/session-storage'

import { setSession } from '../session'

import { transcribeAudio } from '../voice/stt'

import './Setup.css'



type Option = { value: string; label: string; sub?: string; disabled?: boolean }

const CONTEXT_FILE_ACCEPT = '.pdf,.docx,.txt'

const CONTEXT_FILE_EXT = new Set(['.pdf', '.docx', '.txt'])



function Dropdown({

  label,

  placeholder,

  value,

  options,

  onSelect,

  disabled,

}: {

  label: string

  placeholder: string

  value: string | null

  options: Option[]

  onSelect: (v: string) => void

  disabled?: boolean

}) {

  const [open, setOpen] = useState(false)

  const ref = useRef<HTMLDivElement>(null)



  useEffect(() => {

    if (!open) return

    const onDoc = (e: MouseEvent) => {

      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)

    }

    document.addEventListener('mousedown', onDoc)

    return () => document.removeEventListener('mousedown', onDoc)

  }, [open])



  const selected = options.find((o) => o.value === value)



  return (

    <div className={`dd ${disabled ? 'is-disabled' : ''}`} ref={ref}>

      <span className="dd-label">{label}</span>

      <button

        type="button"

        className={`dd-trigger ${open ? 'is-open' : ''}`}

        onClick={() => !disabled && setOpen((o) => !o)}

        disabled={disabled}

        aria-haspopup="listbox"

        aria-expanded={open}

      >

        <span className={`dd-value ${selected ? '' : 'is-placeholder'}`}>

          {selected ? selected.label : placeholder}

        </span>

        <svg className="dd-arrow" viewBox="0 0 24 24" aria-hidden="true">

          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />

        </svg>

      </button>

      {open && (

        <ul className="dd-menu" role="listbox">

          {options.map((o) => (

            <li key={o.value} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}>

              <button

                type="button"

                className={`dd-item ${o.value === value ? 'is-active' : ''} ${o.disabled ? 'is-locked' : ''}`}

                onClick={() => {

                  if (o.disabled) return

                  onSelect(o.value)

                  setOpen(false)

                }}

                onKeyDown={(e) => {

                  if (o.disabled && (e.key === 'Enter' || e.key === ' ')) {

                    e.preventDefault()

                  }

                }}

                disabled={o.disabled}

                tabIndex={o.disabled ? -1 : undefined}

              >

                <span className="dd-item-main">{o.label}</span>

                {o.sub && <span className="dd-item-sub">{o.sub}</span>}

              </button>

            </li>

          ))}

        </ul>

      )}

    </div>

  )

}



const STATE_LABELS: Record<TurnState, string> = {

  IDLE: 'Ready',

  ASKING: 'Interviewer speaking',

  LISTENING: 'Your turn — speak, then submit',

  THINKING: 'Processing…',

  REPORT: 'Session ended',

}



function CameraTile({

  stream,

  mediaStatus,

  videoEnabled,

  onToggleVideo,

  videoRef,

}: {

  stream: MediaStream | null

  mediaStatus: string

  videoEnabled: boolean

  onToggleVideo: () => void

  videoRef: RefObject<HTMLVideoElement | null>

}) {

  const tileRef = useRef<HTMLDivElement>(null)

  const drag = useRef({ active: false, offX: 0, offY: 0 })

  const resize = useRef({ active: false, startX: 0, startW: 0 })

  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const [width, setWidth] = useState(320)

  const [dragging, setDragging] = useState(false)



  const clamp = useCallback(

    (x: number, y: number) => {

      const el = tileRef.current

      const w = el?.offsetWidth ?? width

      const h = el?.offsetHeight ?? width * 0.72

      const maxX = window.innerWidth - w - 16

      const maxY = window.innerHeight - h - 16

      return { x: Math.max(16, Math.min(x, maxX)), y: Math.max(16, Math.min(y, maxY)) }

    },

    [width],

  )



  useEffect(() => {

    if (videoRef.current && stream) {

      videoRef.current.srcObject = stream

    }

  }, [stream])



  const onGripDown = (e: React.PointerEvent) => {

    const el = tileRef.current

    if (!el) return

    const rect = el.getBoundingClientRect()

    drag.current = { active: true, offX: e.clientX - rect.left, offY: e.clientY - rect.top }

    setDragging(true)

    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

  }



  const onResizeDown = (e: React.PointerEvent) => {

    e.stopPropagation()

    resize.current = { active: true, startX: e.clientX, startW: width }

    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)

  }



  useEffect(() => {

    const onMove = (e: PointerEvent) => {

      if (drag.current.active) {

        setPos(clamp(e.clientX - drag.current.offX, e.clientY - drag.current.offY))

      } else if (resize.current.active) {

        const next = resize.current.startW + (e.clientX - resize.current.startX)

        setWidth(Math.max(240, Math.min(next, 560)))

      }

    }

    const onUp = () => {

      drag.current.active = false

      resize.current.active = false

      setDragging(false)

    }

    window.addEventListener('pointermove', onMove)

    window.addEventListener('pointerup', onUp)

    return () => {

      window.removeEventListener('pointermove', onMove)

      window.removeEventListener('pointerup', onUp)

    }

  }, [clamp])



  const camOn = videoEnabled && mediaStatus === 'ready' && !!stream



  return (

    <div

      ref={tileRef}

      className={`camtile ${dragging ? 'is-dragging' : ''}`}

      style={{ width, ...(pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : {}) }}

    >

      <div className="camtile-grip" onPointerDown={onGripDown} role="presentation">

        <span className="camtile-grip-dots" aria-hidden="true">

          <i /> <i /> <i /> <i /> <i /> <i />

        </span>

        <span className="camtile-name">You</span>

        <span className="camtile-drag-hint">drag</span>

      </div>

      <div className="camtile-screen">

        <video ref={videoRef} className={`camtile-video ${camOn ? 'is-on' : ''}`} autoPlay muted playsInline />

        {!camOn && (

          <div className="camtile-off">

            <span className="camtile-avatar">You</span>

            <span className="camtile-off-label">

              {mediaStatus === 'denied' ? 'Camera blocked' : mediaStatus === 'requesting' ? 'Starting…' : 'Camera off'}

            </span>

          </div>

        )}

        <button

          type="button"

          className={`camtile-toggle ${camOn ? 'is-active' : ''}`}

          onClick={onToggleVideo}

          disabled={!stream || mediaStatus !== 'ready'}

          aria-pressed={camOn}

        >

          {camOn ? 'Turn off' : 'Turn on'}

        </button>

        <span className="camtile-resize" onPointerDown={onResizeDown} role="presentation" aria-label="Resize camera">

          <svg viewBox="0 0 16 16" aria-hidden="true">

            <path d="M14 6v8H6M14 14 6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />

          </svg>

        </span>

      </div>

    </div>

  )

}



function PresagePane({

  open,

  onClose,

  metrics,

  statusLabel,

}: {

  open: boolean

  onClose: () => void

  metrics: PresageMetricRow[]

  statusLabel: string

}) {

  if (!open) return null

  return (

    <aside className="presage" aria-label="Presage live statistics">

      <header className="presage-head">

        <span className="presage-live">

          <span className="presage-live-dot" />

          Presage

        </span>

        <button type="button" className="presage-close" onClick={onClose} aria-label="Hide statistics">

          <svg viewBox="0 0 24 24" aria-hidden="true">

            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />

          </svg>

        </button>

      </header>

      <p className="presage-caption">

        Live read on your delivery

        <span className="presage-status"> · {statusLabel}</span>

      </p>

      <ul className="presage-list">

        {metrics.map((m) => (

          <li key={m.label} className="presage-row" title={m.hint}>

            <span className="presage-row-top">

              <span className="presage-row-label">{m.label}</span>

              <span className="presage-row-value">

                {m.value}

                {m.unit}

              </span>

            </span>

            <span className="presage-bar">

              <span

                className={`presage-bar-fill ${m.invert ? 'is-warn' : ''}`}

                style={{ width: `${m.barPct}%` }}

              />

            </span>

          </li>

        ))}

      </ul>

    </aside>

  )

}



function ContextDrawer({

  jobTitle,

  onJobTitleChange,

  files,

  onAddFiles,

  onRemoveFile,

  onClose,

  disabled,

}: {

  jobTitle: string

  onJobTitleChange: (value: string) => void

  files: File[]

  onAddFiles: (picked: FileList | null) => void

  onRemoveFile: (index: number) => void

  onClose: () => void

  disabled?: boolean

}) {

  const fileInputRef = useRef<HTMLInputElement>(null)



  return (

      <div className="context-drawer" role="dialog" aria-label="Session context">

        <header className="context-head">

          <h2 className="context-title">Add context</h2>

          <button type="button" className="context-close" onClick={onClose} aria-label="Close context panel">

            <svg viewBox="0 0 24 24" aria-hidden="true">

              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />

            </svg>

          </button>

        </header>

        <p className="context-caption">

          Optional role title and resume or job description for sharper questions.

        </p>

        <label className="context-field">

          <span className="context-field-label">Target role</span>

          <input

            type="text"

            className="context-input"

            placeholder="e.g. Software engineer, new grad"

            value={jobTitle}

            onChange={(e) => onJobTitleChange(e.target.value)}

            disabled={disabled}

          />

        </label>

        <div className="context-files">

          <span className="context-field-label">Documents</span>

          <button

            type="button"

            className="context-upload-btn"

            onClick={() => fileInputRef.current?.click()}

            disabled={disabled}

          >

            Upload PDF, DOCX, or TXT

          </button>

          <input

            ref={fileInputRef}

            type="file"

            className="context-file-input"

            accept={CONTEXT_FILE_ACCEPT}

            multiple

            onChange={(e) => {

              onAddFiles(e.target.files)

              e.target.value = ''

            }}

          />

          {files.length > 0 && (

            <ul className="context-file-list">

              {files.map((file, index) => (

                <li key={`${file.name}-${file.size}-${index}`}>

                  <span className="context-file-name">{file.name}</span>

                  <button

                    type="button"

                    className="context-file-remove"

                    onClick={() => onRemoveFile(index)}

                    disabled={disabled}

                    aria-label={`Remove ${file.name}`}

                  >

                    Remove

                  </button>

                </li>

              ))}

            </ul>

          )}

        </div>

      </div>

  )

}



function fmt(sec: number) {

  const m = Math.floor(sec / 60)

  const s = sec % 60

  return `${m}:${s.toString().padStart(2, '0')}`

}



export default function Setup({ navigate }: { navigate: Navigate }) {

  const [modeId, setModeId] = useState<string | null>('salary')

  const [charId, setCharId] = useState<string | null>(null)

  const [started, setStarted] = useState(false)

  const [seconds, setSeconds] = useState(0)

  const [statsOpen, setStatsOpen] = useState(true)

  const [micOn, setMicOn] = useState(true)

  const [videoOn, setVideoOn] = useState(true)

  const [starting, setStarting] = useState(false)

  const [startError, setStartError] = useState<string | null>(null)

  const [turnError, setTurnError] = useState<string | null>(null)

  const [transcribing, setTranscribing] = useState(false)

  const [serverSttAvailable, setServerSttAvailable] = useState(true)

  const [voiceHint, setVoiceHint] = useState<string | null>(null)

  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null)

  const [lastDirector, setLastDirector] = useState<{ action?: string; overall?: number } | null>(null)

  const [turnCount, setTurnCount] = useState(0)

  const [backendComposure, setBackendComposure] = useState<number | null>(null)

  const [contextOpen, setContextOpen] = useState(false)

  const [contextJobTitle, setContextJobTitle] = useState('')

  const [pendingContextFiles, setPendingContextFiles] = useState<File[]>([])

  const selfVideoRef = useRef<HTMLVideoElement>(null)

  const contextAnchorRef = useRef<HTMLDivElement>(null)



  const mode = MODES.find((m) => m.id === modeId) ?? null

  const character = SALARY_CHARACTERS.find((c) => c.id === charId) ?? null

  const characterId = character?.id ?? null



  const { stream, status: mediaStatus, error: mediaError, request, stop, setMicEnabled, setVideoEnabled } =

    useMediaStream()



  const askRef = useRef<(q: string) => void>(() => {})

  const listenRef = useRef<() => void>(() => {})



  const processTurnAnswer = useCallback(

    async (rawText: string) => {

      const text = rawText.trim()

      const sessionId = getStoredSessionId() ?? undefined

      if (!text) {

        setTurnError(

          serverSttAvailable

            ? 'No speech detected — try again.'

            : 'No speech detected. Allow the mic and speak clearly, or set ELEVENLABS_API_KEY on the backend for cloud STT.',

        )

        listenRef.current()

        return

      }

      setTurnError(null)

      try {

        const data = await postTurn(text, sessionId)

        const snapshot = data.decision.input_snapshot as { composure?: number } | undefined

        if (typeof snapshot?.composure === 'number') {

          setBackendComposure(snapshot.composure)

        }

        setTurnCount((n) => n + 1)

        setLastDirector({ action: data.decision.action, overall: data.scores.overall })

        setCurrentQuestion(data.next_question.text)

        askRef.current(data.next_question.text)

      } catch (err) {

        const message = err instanceof Error ? err.message : 'Submit failed'

        setTurnError(message)

        listenRef.current()

      }

    },

    [serverSttAvailable],

  )



  const processTurnAnswerRef = useRef(processTurnAnswer)

  processTurnAnswerRef.current = processTurnAnswer



  const { state, ask, listen, think, finish, reset } = useInterviewMachine({

    stream,

    micEnabled: micOn,

    recordAnswers: serverSttAvailable,

    onAnswerRecorded: async (blob) => {

      setTranscribing(true)

      setTurnError(null)

      let text = ''

      try {

        const result = await transcribeAudio(blob)

        text = result.transcript

      } catch (err) {

        const message = err instanceof Error ? err.message : 'Transcription failed'

        if (message.includes('ELEVENLABS')) {

          setVoiceHint('Cloud STT is off — using browser speech recognition when you submit.')

          setServerSttAvailable(false)

        }

        setTurnError(message)

      } finally {

        setTranscribing(false)

      }

      await processTurnAnswerRef.current(text)

    },

  })



  askRef.current = ask

  listenRef.current = listen



  const sessionLive = started && state !== 'IDLE' && state !== 'REPORT'

  const composureSessionId = getStoredSessionId() ?? 'studio'

  const questionId = `q_${String(turnCount + 1).padStart(3, '0')}`

  const faceAnalysisActive = sessionLive && videoOn && mediaStatus === 'ready'

  const { ready: faceReady, getMetrics } = useFaceComposure(selfVideoRef, faceAnalysisActive)

  const { latest: composureSample } = useComposureSampler({

    active: sessionLive,

    sessionId: composureSessionId,

    questionId,

    getMetrics,

  })

  const browserListenActive = sessionLive && state === 'LISTENING' && !serverSttAvailable

  const browserSpeech = useBrowserSpeechCapture(browserListenActive)

  const presageMetrics = usePresageMetrics({

    sample: composureSample,

    turnState: state,

    backendComposure,

    faceReady,

    getTranscript: browserSpeech.getTranscript,

    listening: sessionLive && state === 'LISTENING',

  })

  const presageStatus =

    !sessionLive

      ? 'idle'

      : !faceReady

        ? 'loading camera model'

        : composureSample?.source === 'presage'

          ? 'live · face detected'

          : 'no face — estimating'



  const { src: expressionSrc } = useCharacterExpression(

    characterId as CharacterId | null,

    sessionLive,

    state,

    lastDirector,

  )



  useEffect(() => {

    if (!started) return

    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)

    return () => window.clearInterval(id)

  }, [started])



  useEffect(() => {

    if (!contextOpen) return

    const onDoc = (e: MouseEvent) => {

      if (contextAnchorRef.current && !contextAnchorRef.current.contains(e.target as Node)) {

        setContextOpen(false)

      }

    }

    document.addEventListener('mousedown', onDoc)

    return () => document.removeEventListener('mousedown', onDoc)

  }, [contextOpen])



  useEffect(() => {

    setMicEnabled(micOn)

  }, [micOn, setMicEnabled])



  useEffect(() => {

    setVideoEnabled(videoOn)

  }, [videoOn, setVideoEnabled])



  const resetStudio = useCallback(() => {

    finish()

    reset()

    stop()

    browserSpeech.stop()

    setStarted(false)

    setSeconds(0)

    setCurrentQuestion(null)

    setLastDirector(null)

    setTurnCount(0)

    setBackendComposure(null)

    setTurnError(null)

    setStartError(null)

    setTranscribing(false)

  }, [browserSpeech, finish, reset, stop])



  const startSession = async () => {

    if (!mode || !character || !mode.ready || starting) return

    setStartError(null)

    setTurnError(null)

    setVoiceHint(null)

    setStarting(true)

    try {

      await getHealth()

      const voice = await getVoiceStatus()

      setServerSttAvailable(voice.stt)

      if (!voice.tts) {

        setVoiceHint('Interviewer voice uses your browser until ELEVENLABS_API_KEY is set on the backend.')

      }

      if (!voice.stt) {

        setVoiceHint(

          (prev) =>

            prev ??

            'Answers use browser speech recognition until ELEVENLABS_API_KEY is set on the backend.',

        )

      }

      const media = await request()

      if (!media) {

        setStartError(mediaError ?? 'Microphone and camera access are required to start.')

        return

      }

      setVideoOn(true)

      const jobTitle =

        contextJobTitle.trim() ||

        (mode.id === 'salary' ? `Salary negotiation — ${character.name}` : character.name)

      const { session_id } = await createSession({

        jobTitle,

        scenarioId: mode.id,

        characterId: character.id,

      })

      for (const file of pendingContextFiles) {

        await uploadDocument(session_id, file)

      }

      setStoredSessionId(session_id)

      const session = await getSession(session_id)

      setSeconds(0)

      setStarted(true)

      setCurrentQuestion(session.current_question.text)

      ask(session.current_question.text)

    } catch (err) {

      const message = err instanceof Error ? err.message : 'Could not start session'

      setStartError(message.includes('fetch') ? 'API offline — start the backend on port 8000.' : message)

      resetStudio()

    } finally {

      setStarting(false)

    }

  }



  const submitAnswer = () => {

    if (state !== 'LISTENING') return

    think()

    if (serverSttAvailable) return

    browserSpeech.stop()

    const text = browserSpeech.getTranscript()

    browserSpeech.reset()

    void processTurnAnswerRef.current(text)

  }



  const endSession = () => {

    finish()

    stop()

    browserSpeech.stop()

    if (mode && character) {

      setSession({

        sessionId: getStoredSessionId() ?? undefined,

        mode: mode.title,

        opponent: character.name,

        opponentRole: character.role,

        tone: character.tone,

        opponentImg: character.img,

        durationSec: seconds,

      })

    }

    navigate('/results')

  }



  const leaveStudio = () => {

    if (sessionLive) {

      const ok = window.confirm('Leave the session? Your progress is saved on the server.')

      if (!ok) return

    }

    resetStudio()

    navigate('/')

  }



  const hasContext = contextJobTitle.trim().length > 0 || pendingContextFiles.length > 0

  const addContextFiles = (picked: FileList | null) => {

    if (!picked?.length) return

    const next: File[] = []

    for (const file of Array.from(picked)) {

      const dot = file.name.lastIndexOf('.')

      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''

      if (!CONTEXT_FILE_EXT.has(ext)) {

        setStartError('Only PDF, DOCX, and TXT files are supported.')

        continue

      }

      next.push(file)

    }

    if (next.length) {

      setStartError(null)

      setPendingContextFiles((prev) => [...prev, ...next])

    }

  }

  const opponentImg = stageOpponentSrc(

    characterId as CharacterId | null,

    character?.img,

    sessionLive,

    expressionSrc,

  )



  const stageCaption =

    sessionLive && currentQuestion

      ? currentQuestion

      : character

        ? character.desc

        : 'Pick a scenario and an opponent above to begin.'



  const controlsBusy = state === 'THINKING' || transcribing

  const displayError = startError ?? turnError ?? (mediaStatus === 'denied' ? mediaError : null)



  return (

    <div className="studio">

      <header className="studio-top">

        <button type="button" className="studio-brand" onClick={() => leaveStudio()} aria-label="SpeakUp home">

          <img src="/brand/speakup-logo-horizontal.png" alt="SpeakUp" height={26} />

        </button>



        <div className="studio-selectors">

          <Dropdown

            label="Scenario"

            placeholder="Choose a scenario"

            value={modeId}

            onSelect={(v) => {

              const picked = MODES.find((m) => m.id === v)

              if (!picked?.ready) return

              setModeId(v)

              setCharId(null)

              resetStudio()

            }}

            options={MODES.map((m) => ({

              value: m.id,

              label: m.title,

              sub: m.ready ? m.desc : 'Coming soon',

              disabled: !m.ready,

            }))}

            disabled={sessionLive}

          />

          <Dropdown

            label="Opponent"

            placeholder="Choose who you face"

            value={charId}

            disabled={!mode || sessionLive}

            onSelect={(v) => {

              setCharId(v)

              resetStudio()

            }}

            options={SALARY_CHARACTERS.map((c) => ({

              value: c.id,

              label: c.name,

              sub: `${c.tone} · ${c.role}`,

            }))}

          />

        </div>



        <div className="studio-top-right">

          {!sessionLive && (

            <div className="context-anchor" ref={contextAnchorRef}>

              <button

                type="button"

                className={`context-toggle ${contextOpen ? 'is-open' : ''}`}

                onClick={() => setContextOpen((o) => !o)}

                aria-expanded={contextOpen}

                aria-haspopup="dialog"

              >

                Add context

                {hasContext && <span className="context-dot" aria-label="Context added" />}

              </button>

              {contextOpen && (

                <ContextDrawer

                  onClose={() => setContextOpen(false)}

                  jobTitle={contextJobTitle}

                  onJobTitleChange={setContextJobTitle}

                  files={pendingContextFiles}

                  onAddFiles={addContextFiles}

                  onRemoveFile={(index) =>

                    setPendingContextFiles((prev) => prev.filter((_, i) => i !== index))

                  }

                />

              )}

            </div>

          )}

          {sessionLive && (

            <span className="studio-state-pill" data-state={state}>

              {STATE_LABELS[state]}

            </span>

          )}

          <span className="studio-timer" data-live={started}>

            {started ? fmt(seconds) : 'Ready'}

          </span>

        </div>

      </header>



      <div className="stage-wrap">

        <div className="stage">

          <img className="stage-watermark" src="/brand/speakup-icon-white.png" alt="" aria-hidden="true" />



          {!statsOpen && (

            <button type="button" className="presage-toggle" onClick={() => setStatsOpen(true)}>

              <span className="presage-live-dot" />

              Show stats

            </button>

          )}

          <PresagePane

            open={statsOpen}

            onClose={() => setStatsOpen(false)}

            metrics={presageMetrics}

            statusLabel={presageStatus}

          />



          {character ? (

            <div className="opponent">

              <img className="opponent-video" src={opponentImg} alt={`${character.name}, ${character.tone}`} />

              <span className="opponent-tag">

                <span className={`opponent-dot opponent-dot--${character.id}`} />

                {character.name} · {character.tone}

              </span>

              {sessionLive && (

                <p className="stage-caption" aria-live="polite">

                  {stageCaption}

                </p>

              )}

            </div>

          ) : (

            <div className="stage-empty">

              <p className="stage-empty-title">Your room is ready</p>

              <p className="stage-empty-sub">Pick a scenario and an opponent above to begin.</p>

            </div>

          )}



          {character && !started && (

            <div className="stage-cta">

              {displayError && (

                <p className="stage-error" role="alert">

                  {displayError}

                </p>

              )}

              {voiceHint && !displayError && (

                <p className="stage-hint" role="status">

                  {voiceHint}

                </p>

              )}

              <button

                type="button"

                className="stage-start"

                onClick={() => void startSession()}

                disabled={starting}

              >

                {starting ? 'Connecting…' : 'Start session'}

                <svg viewBox="0 0 24 24" aria-hidden="true">

                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />

                </svg>

              </button>

            </div>

          )}



          {sessionLive && displayError && (

            <p className="stage-error stage-error--float" role="alert">

              {displayError}

            </p>

          )}



          <CameraTile

            stream={stream}

            mediaStatus={mediaStatus}

            videoEnabled={videoOn}

            onToggleVideo={() => setVideoOn((v) => !v)}

            videoRef={selfVideoRef}

          />

        </div>

      </div>



      <footer className="studio-controls" role="toolbar" aria-label="Session controls">

        <div className="controls-group">

          <button

            type="button"

            className={`ctrl ${micOn ? '' : 'is-off'}`}

            onClick={() => setMicOn((m) => !m)}

            disabled={controlsBusy || !sessionLive}

            aria-pressed={micOn}

          >

            <svg viewBox="0 0 24 24" aria-hidden="true">

              <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />

              <path d="M6 11a6 6 0 0 0 12 0M12 17v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />

            </svg>

            <span>{micOn ? 'Mute' : 'Unmute'}</span>

          </button>

          <button

            type="button"

            className={`ctrl ${statsOpen ? 'is-active' : ''}`}

            onClick={() => setStatsOpen((s) => !s)}

            disabled={controlsBusy}

            aria-pressed={statsOpen}

          >

            <svg viewBox="0 0 24 24" aria-hidden="true">

              <path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />

            </svg>

            <span>Stats</span>

          </button>

        </div>



        <div className="controls-center">

          {!started && (

            <button

              type="button"

              className="end-btn end-btn--ghost"

              onClick={() => void startSession()}

              disabled={!character || starting}

            >

              {starting ? 'Connecting…' : character ? 'Start session' : 'Select an opponent'}

            </button>

          )}

          {sessionLive && state === 'LISTENING' && (

            <button type="button" className="end-btn" onClick={submitAnswer} disabled={!micOn}>

              Stop &amp; submit

            </button>

          )}

          {sessionLive && state === 'ASKING' && (

            <button type="button" className="end-btn end-btn--ghost" onClick={() => listen()}>

              Answer now

            </button>

          )}

          {sessionLive && (state === 'THINKING' || transcribing) && (

            <span className="end-btn end-btn--ghost end-btn--static" aria-live="polite">

              {transcribing ? 'Transcribing…' : 'Processing…'}

            </span>

          )}

          {sessionLive && state !== 'LISTENING' && state !== 'ASKING' && state !== 'THINKING' && !transcribing && (

            <button type="button" className="end-btn" onClick={endSession}>

              End &amp; get report

            </button>

          )}

          {sessionLive && (state === 'LISTENING' || state === 'ASKING') && (

            <button type="button" className="end-btn end-btn--ghost" onClick={endSession}>

              End &amp; get report

            </button>

          )}

        </div>



        <div className="controls-group controls-group--right">

          <button type="button" className="ctrl ctrl--leave" onClick={() => leaveStudio()}>

            <svg viewBox="0 0 24 24" aria-hidden="true">

              <path d="M5 5v14M9 12h11m0 0-3.5-3.5M20 12l-3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />

            </svg>

            <span>Leave</span>

          </button>

        </div>

      </footer>

    </div>

  )

}


