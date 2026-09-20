import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

import { StageCaptionStack } from '../components/StageCaptionStack'
import type { PresageMetricRow } from '../hooks/use-presage-metrics'
import type { TurnState } from '../lib/contracts'
import type { Character, Mode } from '../config/modes'

const STATE_LABELS: Record<TurnState, string> = {
  IDLE: 'Ready',
  ASKING: 'Interviewer speaking',
  LISTENING: 'Listening…',
  THINKING: 'Processing…',
  REPORT: 'Session ended',
}

const CAM_TILE_POS_KEY = 'speakup_camtile_pos'

function fmt(sec: number) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function CameraTile({
  stream,
  mediaStatus,
  videoEnabled,
  onToggleVideo,
  videoRef,
  stageRef,
}: {
  stream: MediaStream | null
  mediaStatus: string
  videoEnabled: boolean
  onToggleVideo: () => void
  videoRef: RefObject<HTMLVideoElement | null>
  stageRef: RefObject<HTMLDivElement | null>
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
      const stage = stageRef.current
      const w = el?.offsetWidth ?? width
      const h = el?.offsetHeight ?? width * 0.72
      const maxX = (stage?.clientWidth ?? window.innerWidth) - w - 16
      const maxY = (stage?.clientHeight ?? window.innerHeight) - h - 16
      return { x: Math.max(16, Math.min(x, maxX)), y: Math.max(16, Math.min(y, maxY)) }
    },
    [width, stageRef],
  )

  useLayoutEffect(() => {
    if (pos !== null) return
    const stage = stageRef.current
    const el = tileRef.current
    if (!stage || !el) return
    try {
      const raw = sessionStorage.getItem(CAM_TILE_POS_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as { x: number; y: number }
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          setPos(clamp(parsed.x, parsed.y))
          return
        }
      }
    } catch {
      /* ignore */
    }
    const w = el.offsetWidth || width
    setPos(clamp(stage.clientWidth - w - 16, 16))
  }, [pos, clamp, width, stageRef])

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream, videoRef])

  const onGripDown = (e: React.PointerEvent) => {
    const el = tileRef.current
    const stage = stageRef.current
    if (!el || !stage) return
    const stageRect = stage.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    drag.current = { active: true, offX: e.clientX - rect.left, offY: e.clientY - rect.top }
    if (!pos) {
      setPos(clamp(rect.left - stageRect.left, rect.top - stageRect.top))
    }
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
        const stageRect = stageRef.current?.getBoundingClientRect()
        if (!stageRect) return
        setPos(
          clamp(e.clientX - stageRect.left - drag.current.offX, e.clientY - stageRect.top - drag.current.offY),
        )
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
  }, [clamp, stageRef])

  useEffect(() => {
    if (!pos || dragging) return
    try {
      sessionStorage.setItem(CAM_TILE_POS_KEY, JSON.stringify(pos))
    } catch {
      /* ignore */
    }
  }, [pos, dragging])

  const camOn = videoEnabled && mediaStatus === 'ready' && !!stream

  return (
    <div
      ref={tileRef}
      className={`camtile ${dragging ? 'is-dragging' : ''}`}
      style={{
        width,
        ...(pos
          ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
          : { right: 16, top: 16, left: 'auto', bottom: 'auto' }),
      }}
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
            {m.showBar !== false && (
              <span className="presage-bar">
                <span className={`presage-bar-fill ${m.invert ? 'is-warn' : ''}`} style={{ width: `${m.barPct}%` }} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}

export type StudioLiveProps = {
  onLeaveStudio: () => void
  mode: Mode
  character: Character
  sessionLive: boolean
  started: boolean
  seconds: number
  state: TurnState
  statsOpen: boolean
  onToggleStats: () => void
  presageMetrics: PresageMetricRow[]
  presageStatus: string
  opponentImg: string
  aiCaptionLine: string | null
  aiCaptionInterjection?: boolean
  userCaption: string
  userCaptionsEnabled?: boolean
  captionPriority?: 'user' | 'ai'
  displayError: string | null
  voiceHint: string | null
  stream: MediaStream | null
  mediaStatus: string
  videoOn: boolean
  onToggleVideo: () => void
  videoRef: RefObject<HTMLVideoElement | null>
  stageRef: RefObject<HTMLDivElement | null>
  micOn: boolean
  onToggleMic: () => void
  controlsBusy: boolean
  onSubmitAnswer: () => void
  onAnswerNow: () => void
  onEndSession: () => void
  transcribing: boolean
}

export function StudioLive({
  onLeaveStudio,
  mode,
  character,
  sessionLive,
  started,
  seconds,
  state,
  statsOpen,
  onToggleStats,
  presageMetrics,
  presageStatus,
  opponentImg,
  aiCaptionLine,
  aiCaptionInterjection = false,
  userCaption,
  userCaptionsEnabled = true,
  captionPriority = 'ai',
  displayError,
  voiceHint,
  stream,
  mediaStatus,
  videoOn,
  onToggleVideo,
  videoRef,
  stageRef,
  micOn,
  onToggleMic,
  controlsBusy,
  onSubmitAnswer,
  onAnswerNow,
  onEndSession,
  transcribing,
}: StudioLiveProps) {
  return (
    <>
      <header className="studio-top">
        <button type="button" className="studio-brand" onClick={onLeaveStudio} aria-label="Leave studio">
          <img src="/brand/speakup-logo-horizontal.png" alt="SpeakUp" height={26} />
        </button>
        <div className="studio-summary" aria-label="Session setup">
          <span className="studio-summary-chip">
            {mode.title} · {character.name}
          </span>
        </div>
        <div className="studio-top-right">
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
        <div className="stage" ref={stageRef}>
          <img className="stage-watermark" src="/brand/speakup-icon-white.png" alt="" aria-hidden="true" />

          {!statsOpen && (
            <button type="button" className="presage-toggle" onClick={() => onToggleStats()}>
              <span className="presage-live-dot" />
              Show stats
            </button>
          )}
          <PresagePane
            open={statsOpen}
            onClose={() => onToggleStats()}
            metrics={presageMetrics}
            statusLabel={presageStatus}
          />

          <div className="opponent">
            <div className="opponent-frame">
              <img className="opponent-video" src={opponentImg} alt={`${character.name}, ${character.tone}`} />
            </div>
            <span className="opponent-tag">
              <span className={`opponent-dot opponent-dot--${character.id}`} />
              {character.name} · {character.tone}
            </span>
            <StageCaptionStack
              visible={sessionLive}
              aiLine={aiCaptionLine}
              userLine={userCaption}
              userCaptionsEnabled={userCaptionsEnabled}
              captionPriority={captionPriority}
              aiInterjection={aiCaptionInterjection}
            />
          </div>

          {voiceHint && !displayError && (
            <p className="stage-hint stage-hint--float" role="status">
              {voiceHint}
            </p>
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
            onToggleVideo={onToggleVideo}
            videoRef={videoRef}
            stageRef={stageRef}
          />
        </div>
      </div>

      <footer className="studio-controls" role="toolbar" aria-label="Session controls">
        <div className="controls-group">
          <button
            type="button"
            className={`ctrl ${micOn ? '' : 'is-off'}`}
            onClick={onToggleMic}
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
            onClick={onToggleStats}
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
          {sessionLive && state === 'LISTENING' && (
            <button
              type="button"
              className="end-btn end-btn--ghost"
              onClick={onSubmitAnswer}
              disabled={!micOn}
            >
              Send now
            </button>
          )}
          {sessionLive && state === 'ASKING' && (
            <button type="button" className="end-btn end-btn--ghost" onClick={onAnswerNow}>
              Answer now
            </button>
          )}
          {sessionLive && (state === 'THINKING' || transcribing) && (
            <span className="end-btn end-btn--ghost end-btn--static" aria-live="polite">
              {transcribing ? 'Transcribing…' : 'Processing…'}
            </span>
          )}
          {sessionLive && state !== 'LISTENING' && state !== 'ASKING' && state !== 'THINKING' && !transcribing && (
            <button type="button" className="end-btn" onClick={onEndSession}>
              End &amp; get report
            </button>
          )}
          {sessionLive && (state === 'LISTENING' || state === 'ASKING') && (
            <button type="button" className="end-btn end-btn--ghost" onClick={onEndSession}>
              End &amp; get report
            </button>
          )}
        </div>

        <div className="controls-group controls-group--right">
          <button type="button" className="ctrl ctrl--leave" onClick={onLeaveStudio}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 5v14M9 12h11m0 0-3.5-3.5M20 12l-3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
            <span>Leave</span>
          </button>
        </div>
      </footer>
    </>
  )
}
