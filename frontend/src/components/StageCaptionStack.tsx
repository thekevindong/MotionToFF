import { useEffect, useRef, useState } from 'react'

type Props = {
  aiLine: string | null
  userLine: string
  visible: boolean
  /** Extra right inset when self-view tile is anchored top-right */
  reserveRightPx?: number
  aiInterjection?: boolean
}

const LIVE_DEBOUNCE_MS = 800

export function StageCaptionStack({
  aiLine,
  userLine,
  visible,
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

  const userActive = userLine.trim().length > 0

  useEffect(() => {
    if (!visible) {
      setDisplayAi(null)
      setDisplayUser('')
      setAiPhase('in')
      setUserPhase('in')
      return
    }

    if (aiLine && aiLine !== displayAi && !userActive) {
      genRef.current += 1
      setDisplayAi(aiLine)
      setAiPhase('in')
    }
  }, [aiLine, visible, userActive, displayAi])

  useEffect(() => {
    if (!visible) return

    if (userActive) {
      if (displayUser !== userLine) {
        if (!displayUser.trim() && displayAi) {
          setAiPhase('out')
        }
        genRef.current += 1
        setDisplayUser(userLine)
        setUserPhase('in')
      }
    } else if (displayUser) {
      setUserPhase('out')
      const t = window.setTimeout(() => setDisplayUser(''), 320)
      return () => window.clearTimeout(t)
    }
  }, [userLine, userActive, visible, displayUser, displayAi])

  const ariaText = userActive ? userLine : displayAi ?? ''

  useEffect(() => {
    if (!visible || !userActive) {
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
  }, [userLine, userActive, visible])

  if (!visible) return null

  const showAi = Boolean(displayAi) && (!userActive || aiPhase === 'out')
  const showUser = Boolean(displayUser.trim())

  return (
    <div
      className="caption-stack"
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
