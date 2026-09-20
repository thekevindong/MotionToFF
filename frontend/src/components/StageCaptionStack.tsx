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
  const aiBurstKeyRef = useRef(0)
  const userBurstKeyRef = useRef(0)
  const userBurstActiveRef = useRef(false)
  const liveAnnouncedRef = useRef('')
  const debounceRef = useRef<number | null>(null)
  const heldUserRef = useRef('')

  const userPriority = captionPriority === 'user' && userCaptionsEnabled
  const userLineTrimmed = userLine.trim()

  const resetUserBurst = () => {
    userBurstActiveRef.current = false
    heldUserRef.current = ''
    setDisplayUser('')
    setUserPhase('in')
  }

  useEffect(() => {
    if (!userCaptionsEnabled) {
      resetUserBurst()
      return
    }
    if (captionPriority === 'ai') {
      resetUserBurst()
      setAiPhase('in')
    }
  }, [userCaptionsEnabled, captionPriority])

  useEffect(() => {
    if (!visible) {
      setDisplayAi(null)
      resetUserBurst()
      setAiPhase('in')
      return
    }

    if (userPriority) return

    const mayRefreshAi = aiLine && aiLine !== displayAi
    if (mayRefreshAi) {
      aiBurstKeyRef.current += 1
      setDisplayAi(aiLine)
      setAiPhase('in')
    }
  }, [aiLine, visible, captionPriority, displayAi, userPriority])

  useEffect(() => {
    if (!visible || !userPriority) return

    if (userLineTrimmed) {
      heldUserRef.current = userLineTrimmed
      if (!userBurstActiveRef.current) {
        userBurstActiveRef.current = true
        userBurstKeyRef.current += 1
        setUserPhase('in')
      }
      setDisplayUser(userLine)
      return
    }

    if (!heldUserRef.current) {
      userBurstActiveRef.current = false
      setDisplayUser('')
    }
  }, [userLine, userLineTrimmed, visible, userPriority])

  const ariaText = userPriority ? heldUserRef.current || userLineTrimmed : displayAi ?? ''

  useEffect(() => {
    if (!visible || !userPriority) {
      liveAnnouncedRef.current = ''
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      return
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      const phrase = (heldUserRef.current || userLineTrimmed).trim()
      if (phrase && phrase !== liveAnnouncedRef.current) {
        liveAnnouncedRef.current = phrase
      }
    }, LIVE_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [userLineTrimmed, visible, userPriority])

  if (!visible) return null

  const userText = userLineTrimmed || heldUserRef.current || displayUser
  const showUser = userPriority && Boolean(userText.trim())
  const showAi = !userPriority && Boolean(displayAi) && aiPhase !== 'out'

  return (
    <div
      className={`caption-stack caption-stack--priority-${captionPriority}`}
      style={reserveRightPx > 0 ? { marginRight: reserveRightPx } : undefined}
      aria-live="polite"
      aria-atomic="true"
    >
      {showAi && displayAi && (
        <p
          key={`ai-${aiBurstKeyRef.current}`}
          className={`caption-line caption-line--ai${aiInterjection ? ' caption-line--interjection' : ''} caption-line--${aiPhase}`}
        >
          {displayAi}
        </p>
      )}
      {showUser && (
        <p
          key={`user-${userBurstKeyRef.current}`}
          className={`caption-line caption-line--user caption-line--${userPhase}`}
        >
          {userText}
        </p>
      )}
      <span className="sr-only">{liveAnnouncedRef.current || ariaText}</span>
    </div>
  )
}
