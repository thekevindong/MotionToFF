import { useCallback, useEffect, useRef, useState } from 'react'
import type { Navigate } from '../App'
import './Setup.css'

type Mode = {
  id: string
  title: string
  desc: string
  ready: boolean
}

type Character = {
  id: string
  name: string
  role: string
  tone: string
  desc: string
  img: string
}

const MODES: Mode[] = [
  { id: 'salary', title: 'Salary Negotiation', desc: 'Defend your number under pressure.', ready: true },
  { id: 'interview', title: 'Mock Interview', desc: 'Behavioral and role-fit questions.', ready: false },
  { id: 'speaking', title: 'Public Speaking', desc: 'Own the room, steady your nerves.', ready: false },
  { id: 'thesis', title: 'Thesis Defense', desc: 'Field hard questions on your work.', ready: false },
]

const SALARY_CHARACTERS: Character[] = [
  {
    id: 'recruiter',
    name: 'University Recruiter',
    role: 'Early-career hiring',
    tone: 'Polite',
    desc: 'Warm and encouraging. Eases you into the conversation and roots for you.',
    img: '/characters/university-recruiter.png',
  },
  {
    id: 'manager',
    name: 'Senior Manager',
    role: 'Hiring manager',
    tone: 'Formal',
    desc: 'Measured and professional. Expects structure and clear reasoning behind your number.',
    img: '/characters/senior-manager.png',
  },
  {
    id: 'hr',
    name: 'HR Lead',
    role: 'Compensation & policy',
    tone: 'Strict & Harsh',
    desc: 'Direct and demanding. Pushes back hard and holds the line on budget.',
    img: '/characters/hr-lead.png',
  },
]

type Step = 'mode' | 'character' | 'launch'

/* Draggable Zoom-style self-view camera. */
function CameraTile() {
  const tileRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const drag = useRef<{ active: boolean; offX: number; offY: number }>({
    active: false,
    offX: 0,
    offY: 0,
  })
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [camOn, setCamOn] = useState(false)
  const [dragging, setDragging] = useState(false)

  const clamp = useCallback((x: number, y: number) => {
    const el = tileRef.current
    const w = el?.offsetWidth ?? 230
    const h = el?.offsetHeight ?? 150
    const maxX = window.innerWidth - w - 16
    const maxY = window.innerHeight - h - 16
    return { x: Math.max(16, Math.min(x, maxX)), y: Math.max(16, Math.min(y, maxY)) }
  }, [])

  const onPointerDown = (e: React.PointerEvent) => {
    const el = tileRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    drag.current = { active: true, offX: e.clientX - rect.left, offY: e.clientY - rect.top }
    setDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!drag.current.active) return
      setPos(clamp(e.clientX - drag.current.offX, e.clientY - drag.current.offY))
    }
    const onUp = () => {
      drag.current.active = false
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [clamp])

  const toggleCam = async () => {
    if (camOn) {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      if (videoRef.current) videoRef.current.srcObject = null
      setCamOn(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
      setCamOn(true)
    } catch {
      setCamOn(false)
    }
  }

  useEffect(() => {
    return () => streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  return (
    <div
      ref={tileRef}
      className={`camtile ${dragging ? 'is-dragging' : ''}`}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
    >
      <div className="camtile-grip" onPointerDown={onPointerDown} role="presentation">
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
            <span className="camtile-off-label">Camera off</span>
          </div>
        )}
      </div>
      <div className="camtile-bar">
        <button
          type="button"
          className={`camtile-btn ${camOn ? 'is-active' : ''}`}
          onClick={toggleCam}
          aria-pressed={camOn}
        >
          {camOn ? 'Turn off camera' : 'Turn on camera'}
        </button>
      </div>
    </div>
  )
}

function MeetingControls({ onLeave }: { onLeave: () => void }) {
  return (
    <div className="controls" role="toolbar" aria-label="Meeting controls">
      <button type="button" className="ctrl" aria-label="Microphone">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.6" />
          <path d="M6 11a6 6 0 0 0 12 0M12 17v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>Mute</span>
      </button>
      <button type="button" className="ctrl" aria-label="Camera">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="6" width="12" height="12" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
          <path d="M15 10.5 21 7v10l-6-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        <span>Video</span>
      </button>
      <button type="button" className="ctrl ctrl--leave" onClick={onLeave}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M5 5v14M9 12h11m0 0-3.5-3.5M20 12l-3.5 3.5"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Leave</span>
      </button>
    </div>
  )
}

export default function Setup({ navigate }: { navigate: Navigate }) {
  const [step, setStep] = useState<Step>('mode')
  const [mode, setMode] = useState<Mode | null>(null)
  const [character, setCharacter] = useState<Character | null>(null)

  const pickMode = (m: Mode) => {
    if (!m.ready) return
    setMode(m)
    setCharacter(null)
    setStep('character')
  }

  const startSession = () => {
    if (!character) return
    setStep('launch')
  }

  return (
    <div className="room">
      <div className="room-glow" aria-hidden="true" />

      <header className="room-top">
        <button type="button" className="room-brand" onClick={() => navigate('/')} aria-label="SpeakUp home">
          <img src="/brand/speakup-logo-horizontal-white.png" alt="SpeakUp" height={30} />
        </button>
        <div className="room-quote">
          <span className="room-quote-mark">“</span>
          You cannot get what you never ask for. Practice the ask.
        </div>
        <span className="room-live">
          <span className="room-live-dot" />
          Studio
        </span>
      </header>

      <main className="room-main">
        {step !== 'launch' && (
          <div className="stepper" aria-hidden="true">
            <span className={`stepper-item ${step === 'mode' ? 'is-active' : 'is-done'}`}>1 · Mode</span>
            <span className="stepper-line" />
            <span className={`stepper-item ${step === 'character' ? 'is-active' : ''}`}>2 · Opponent</span>
          </div>
        )}

        {step === 'mode' && (
          <section className="panel" key="mode">
            <h1 className="panel-title">What do you want to practice?</h1>
            <p className="panel-sub">Pick a scenario. More open up as you go. Salary Negotiation is live now.</p>
            <div className="mode-grid">
              {MODES.map((m, i) => (
                <button
                  type="button"
                  key={m.id}
                  className={`mode-card ${m.ready ? '' : 'is-locked'}`}
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

        {step === 'character' && mode && (
          <section className="panel" key="character">
            <button type="button" className="panel-back" onClick={() => setStep('mode')}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {mode.title}
            </button>
            <h1 className="panel-title">Choose who you are up against</h1>
            <p className="panel-sub">Each opponent negotiates with a different temperament. Pick your challenge.</p>
            <div className="char-grid">
              {SALARY_CHARACTERS.map((c, i) => (
                <button
                  type="button"
                  key={c.id}
                  className={`char-card ${character?.id === c.id ? 'is-selected' : ''}`}
                  style={{ animationDelay: `${i * 80}ms` }}
                  onClick={() => setCharacter(c)}
                  aria-pressed={character?.id === c.id}
                >
                  <span className="char-photo">
                    <img src={c.img || '/placeholder.svg'} alt={c.name} />
                    <span className={`char-tone char-tone--${c.id}`}>{c.tone}</span>
                  </span>
                  <span className="char-body">
                    <span className="char-role">{c.role}</span>
                    <span className="char-name">{c.name}</span>
                    <span className="char-desc">{c.desc}</span>
                  </span>
                  <span className="char-check" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
            <div className="panel-cta">
              <button type="button" className="start-btn" onClick={startSession} disabled={!character}>
                {character ? `Start against ${character.name}` : 'Select an opponent to start'}
                {character && (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            </div>
          </section>
        )}

        {step === 'launch' && character && (
          <section className="launch" key="launch">
            <span className="launch-ring" aria-hidden="true" />
            <img className="launch-photo" src={character.img || '/placeholder.svg'} alt={character.name} />
            <h1 className="launch-title">Connecting you with {character.name}</h1>
            <p className="launch-sub">
              {mode?.title} · {character.tone} tone. Take a breath. The room opens in a moment.
            </p>
            <div className="launch-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <button type="button" className="launch-back" onClick={() => setStep('character')}>
              Choose a different opponent
            </button>
          </section>
        )}
      </main>

      <MeetingControls onLeave={() => navigate('/')} />
      <CameraTile />
    </div>
  )
}
