import { useCallback, useEffect, useRef, useState } from 'react'
import type { Navigate } from '../App'
import { setSession } from '../session'
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

/* ---------- Reusable dropdown ---------- */
type Option = { value: string; label: string; sub?: string; disabled?: boolean }

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
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                className={`dd-item ${o.value === value ? 'is-active' : ''} ${o.disabled ? 'is-locked' : ''}`}
                onClick={() => {
                  if (o.disabled) return
                  onSelect(o.value)
                  setOpen(false)
                }}
                disabled={o.disabled}
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

/* ---------- Draggable + resizable self-view ---------- */
function CameraTile() {
  const tileRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const drag = useRef({ active: false, offX: 0, offY: 0 })
  const resize = useRef({ active: false, startX: 0, startW: 0 })
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [width, setWidth] = useState(320)
  const [camOn, setCamOn] = useState(false)
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
            <span className="camtile-off-label">Camera off</span>
          </div>
        )}
        <button
          type="button"
          className={`camtile-toggle ${camOn ? 'is-active' : ''}`}
          onClick={toggleCam}
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

/* ---------- Presage live-stats pane ---------- */
const PRESAGE_METRICS = [
  { label: 'Composure', value: 82, unit: '' },
  { label: 'Eye contact', value: 74, unit: '%' },
  { label: 'Vocal steadiness', value: 68, unit: '%' },
  { label: 'Pace', value: 128, unit: ' wpm', display: 71 },
  { label: 'Filler words', value: 6, unit: '', display: 40, invert: true },
]

function PresagePane({ open, onClose }: { open: boolean; onClose: () => void }) {
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
      <p className="presage-caption">Live read on your delivery</p>
      <ul className="presage-list">
        {PRESAGE_METRICS.map((m) => (
          <li key={m.label} className="presage-row">
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
                style={{ width: `${m.display ?? m.value}%` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </aside>
  )
}

/* ---------- Meeting controls ---------- */
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

  const mode = MODES.find((m) => m.id === modeId) ?? null
  const character = SALARY_CHARACTERS.find((c) => c.id === charId) ?? null

  useEffect(() => {
    if (!started) return
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [started])

  const startSession = () => {
    if (!mode || !character) return
    setSeconds(0)
    setStarted(true)
  }

  const endSession = () => {
    if (mode && character) {
      setSession({
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

  return (
    <div className="studio">
      {/* Light tan top bar */}
      <header className="studio-top">
        <button type="button" className="studio-brand" onClick={() => navigate('/')} aria-label="SpeakUp home">
          <img src="/brand/speakup-logo-horizontal.png" alt="SpeakUp" height={26} />
        </button>

        <div className="studio-selectors">
          <Dropdown
            label="Scenario"
            placeholder="Choose a scenario"
            value={modeId}
            onSelect={(v) => {
              setModeId(v)
              setCharId(null)
              setStarted(false)
            }}
            options={MODES.map((m) => ({
              value: m.id,
              label: m.title,
              sub: m.ready ? m.desc : 'Coming soon',
              disabled: !m.ready,
            }))}
          />
          <Dropdown
            label="Opponent"
            placeholder="Choose who you face"
            value={charId}
            disabled={!mode}
            onSelect={(v) => {
              setCharId(v)
              setStarted(false)
            }}
            options={SALARY_CHARACTERS.map((c) => ({
              value: c.id,
              label: c.name,
              sub: `${c.tone} · ${c.role}`,
            }))}
          />
        </div>

        <div className="studio-top-right">
          <span className="studio-timer" data-live={started}>
            {started ? fmt(seconds) : 'Ready'}
          </span>
        </div>
      </header>

      {/* Black zoom stage */}
      <div className="stage-wrap">
        <div className="stage">
          <img className="stage-watermark" src="/brand/speakup-icon-white.png" alt="" aria-hidden="true" />

          {/* toggle for the presage pane, top-left */}
          {!statsOpen && (
            <button type="button" className="presage-toggle" onClick={() => setStatsOpen(true)}>
              <span className="presage-live-dot" />
              Show stats
            </button>
          )}
          <PresagePane open={statsOpen} onClose={() => setStatsOpen(false)} />

          {/* opponent "video" */}
          {character ? (
            <div className="opponent">
              <img className="opponent-video" src={character.img || '/placeholder.svg'} alt={character.name} />
              <span className="opponent-tag">
                <span className={`opponent-dot opponent-dot--${character.id}`} />
                {character.name} · {character.tone}
              </span>
            </div>
          ) : (
            <div className="stage-empty">
              <p className="stage-empty-title">Your room is ready</p>
              <p className="stage-empty-sub">Pick a scenario and an opponent above to begin.</p>
            </div>
          )}

          {/* pre-start overlay */}
          {character && !started && (
            <div className="stage-cta">
              <button type="button" className="stage-start" onClick={startSession}>
                Start session
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />
                </svg>
              </button>
            </div>
          )}

          <CameraTile />
        </div>
      </div>

      {/* Light tan controls */}
      <footer className="studio-controls" role="toolbar" aria-label="Session controls">
        <div className="controls-group">
          <button
            type="button"
            className={`ctrl ${micOn ? '' : 'is-off'}`}
            onClick={() => setMicOn((m) => !m)}
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
            aria-pressed={statsOpen}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 19V9M12 19V5M19 19v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
            <span>Stats</span>
          </button>
        </div>

        <div className="controls-center">
          {started ? (
            <button type="button" className="end-btn" onClick={endSession}>
              End &amp; get report
            </button>
          ) : (
            <button type="button" className="end-btn end-btn--ghost" onClick={startSession} disabled={!character}>
              {character ? 'Start session' : 'Select an opponent'}
            </button>
          )}
        </div>

        <div className="controls-group controls-group--right">
          <button type="button" className="ctrl ctrl--leave" onClick={() => navigate('/')}>
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
