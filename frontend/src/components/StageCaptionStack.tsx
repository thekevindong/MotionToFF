import { useEffect, useRef, useState } from 'react'

type Props = {
  aiLine: string | null
  userLine: string
  visible: boolean
  /** When false (AI TTS playing), hide user line immediately. */
  userCaptionsEnabled?: boolean
  /** Barge-in / answer: user wins. Main question + coach overlay: AI wins. */
  captionPriority?: 'user' | 'ai'
  reserveRightPx?: number
  aiInterjection?: boolean
}

const LIVE_DEBOUNCE_MS = 800
const USER_PRIORITY_HOLD_MS = 60

export function StageCaptionStack({
  aiLine,
  userLine,
  visible,
  userCaptionsEnabled = true,
  captionPriority = 'ai',
  reserveRightPx = 0,
  aiInterjection = false,
}: Props) {
  const [displayAi, setDisplayAi] = useState<string | null>(null)
  const [displayUser, setDisplayUser] = useState('')
  const [aiPhase, setAiPhase] = useState<'in' | 'out'>('in')
  const [userPhase, setUserPhase] = useState<'in' | 'out'>('in')
  const genRef = useRef(0)
  const liveAnnouncedRef = useRef('')
  const debounceRef = useRef<number | null>(null)
  const [userCaptionLive, setUserCaptionLive] = useState(false)

  const userLineTrimmed = userLine.trim()
  const userInputActive =
    captionPriority === 'user' && userCaptionsEnabled && userLineTrimmed.length > 0

  useEffect(() => {
    if (!userCaptionsEnabled || captionPriority === 'ai') {
      setUserCaptionLive(false)
      setDisplayUser('')
      setUserPhase('in')
      if (captionPriority === 'ai') setAiPhase('in')
    }
  }, [userCaptionsEnabled, captionPriority])

  useEffect(() => {
    if (!userCaptionsEnabled || captionPriority !== 'user') return
    if (!userInputActive) {
      setUserCaptionLive(false)
      return
    }
    const holdMs = USER_PRIORITY_HOLD_MS
    const t = window.setTimeout(() => setUserCaptionLive(true), holdMs)
    return () => window.clearTimeout(t)
  }, [userInputActive, userCaptionsEnabled, captionPriority])

  useEffect(() => {
    if (!visible) {
      setDisplayAi(null)
      setDisplayUser('')
      setAiPhase('in')
      setUserPhase('in')
      setUserCaptionLive(false)
      return
    }

    const aiWinsStack = captionPriority === 'ai'
    const mayRefreshAi = aiLine && aiLine !== displayAi && (aiWinsStack || !userCaptionLive)
    if (mayRefreshAi) {
      genRef.current += 1
      setDisplayAi(aiLine)
      setAiPhase('in')
    }
  }, [aiLine, visible, userCaptionLive, captionPriority, displayAi])

  useEffect(() => {
    if (!visible || captionPriority !== 'user' || !userCaptionsEnabled) return

    if (userCaptionLive) {
      if (displayUser !== userLine) {
        if (!displayUser.trim() && displayAi) setAiPhase('out')
        genRef.current += 1
        setDisplayUser(userLine)
        setUserPhase('in')
      }
    } else if (displayUser) {
      setUserPhase('out')
      const t = window.setTimeout(() => setDisplayUser(''), 320)
      return () => window.clearTimeout(t)
    }
  }, [userLine, userCaptionLive, visible, displayUser, displayAi, captionPriority, userCaptionsEnabled])

  const ariaText =
    captionPriority === 'user' && userCaptionLive ? userLine : displayAi ?? ''

  useEffect(() => {
    if (!visible || !userCaptionLive || captionPriority !== 'user') {
      liveAnnouncedRef.current = ''
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      return
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      const phrase = userLine.trim()
      if (phrase && phrase !== liveAnnouncedRef.current) {
        liveAnnouncedRef.current = phrase
      }
    }, LIVE_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [userLine, userCaptionLive, visible, captionPriority])

  if (!visible) return null

  const showUser =
    captionPriority === 'user' && userCaptionsEnabled && userCaptionLive && Boolean(displayUser.trim())

  const showAi =
    Boolean(displayAi) &&
    (captionPriority === 'ai' ? aiPhase !== 'out' : !userCaptionLive || aiPhase === 'out')

  return (
    <div
      className={`caption-stack caption-stack--priority-${captionPriority}`}
      style={reserveRightPx > 0 ? { marginRight: reserveRightPx } : undefined}
      aria-live="polite"
      aria-atomic="true"
    >
      {showAi && displayAi && (
        <p
          key={`ai-${genRef.current}`}
          className={`caption-line caption-line--ai${aiInterjection ? ' caption-line--interjection' : ''} caption-line--${aiPhase}`}
        >
          {displayAi}
        </p>
      )}
      {showUser && (
        <p
          key={`user-${genRef.current}`}
          className={`caption-line caption-line--user caption-line--${userPhase}`}
        >
          {displayUser}
        </p>
      )}
      <span className="sr-only">{liveAnnouncedRef.current || ariaText}</span>
    </div>
  )
}
