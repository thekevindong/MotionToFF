import { useEffect, useRef, useState } from 'react'
import type { DeliveryMood, InterjectTrigger } from '../config/composure-thresholds'
import type { SpeakingPhase } from './use-interview-machine'
import type { TurnState } from '../lib/contracts'
import {
  EXPRESSION_FRAME,
  expressionImageUrl,
  isHardDirectorAction,
  type CharacterId,
  type ExpressionMood,
} from '../config/character-expressions'

type DirectorSignal = { action?: string; overall?: number }

/** Stern intensity — never use blink frame (eyes closed) for sustained poses. */
function sternPoseFrame(overall: number | undefined): number {
  if (overall === undefined) return EXPRESSION_FRAME.rest
  if (overall < 45) return EXPRESSION_FRAME.talk
  if (overall < 65) return EXPRESSION_FRAME.rest
  return EXPRESSION_FRAME.warm
}

export function useCharacterExpression(
  charId: CharacterId | null,
  sessionActive: boolean,
  turnState: TurnState,
  lastDirector: DirectorSignal | null,
  speakingPhase: SpeakingPhase = 'idle',
  lastInterjection: InterjectTrigger | null = null,
  deliveryMood: DeliveryMood = 'neutral',
) {
  const [mood, setMood] = useState<ExpressionMood>('neutral')
  const [baseFrame, setBaseFrame] = useState<number>(EXPRESSION_FRAME.rest)
  const [blinkFrame, setBlinkFrame] = useState<number | null>(null)
  const sternHoldRef = useRef(0)
  const softStreakRef = useRef(0)
  const baseFrameRef = useRef<number>(EXPRESSION_FRAME.rest)

  const setPoseFrame = (frame: number) => {
    baseFrameRef.current = frame
    setBaseFrame(frame)
  }

  useEffect(() => {
    sternHoldRef.current = 0
    softStreakRef.current = 0
    setMood('neutral')
    setPoseFrame(EXPRESSION_FRAME.rest)
    setBlinkFrame(null)
  }, [charId])

  useEffect(() => {
    if (!lastInterjection) return
    setMood('stern')
    setPoseFrame(EXPRESSION_FRAME.talk)
    sternHoldRef.current = 3
    softStreakRef.current = 0
  }, [lastInterjection])

  useEffect(() => {
    if (sternHoldRef.current > 0 || lastInterjection) return
    if (deliveryMood === 'pleased' && sessionActive) {
      setMood('neutral')
      setPoseFrame(EXPRESSION_FRAME.warm)
    }
  }, [deliveryMood, lastInterjection, sessionActive])

  useEffect(() => {
    if (!lastDirector?.action) return
    const action = lastDirector.action
    if (isHardDirectorAction(action)) {
      setMood('stern')
      setPoseFrame(sternPoseFrame(lastDirector.overall))
      sternHoldRef.current = 2
      softStreakRef.current = 0
      return
    }
    if (sternHoldRef.current > 0) {
      sternHoldRef.current -= 1
      if (sternHoldRef.current > 0) return
    }
    if (action === 'ease_off') {
      setMood('neutral')
      setPoseFrame(EXPRESSION_FRAME.warm)
      softStreakRef.current = 0
      return
    }
    if (action === 'follow_up' || action === 'move_on') {
      softStreakRef.current += 1
      if (softStreakRef.current >= 2 || action === 'move_on') {
        setMood('neutral')
        setPoseFrame(action === 'move_on' ? EXPRESSION_FRAME.rest : EXPRESSION_FRAME.warm)
        softStreakRef.current = 0
      } else {
        setMood('neutral')
        setPoseFrame(EXPRESSION_FRAME.rest)
      }
    }
  }, [lastDirector])

  useEffect(() => {
    if (!sessionActive || !charId) {
      setPoseFrame(EXPRESSION_FRAME.rest)
      return
    }

    if (turnState === 'IDLE') {
      setMood('neutral')
      setPoseFrame(EXPRESSION_FRAME.rest)
      return
    }

    if (turnState === 'LISTENING') {
      setPoseFrame(mood === 'neutral' ? EXPRESSION_FRAME.rest : sternPoseFrame(lastDirector?.overall))
      return
    }

    if (turnState === 'THINKING') {
      setPoseFrame(EXPRESSION_FRAME.rest)
    }
  }, [charId, sessionActive, turnState, mood, lastDirector?.overall])

  useEffect(() => {
    if (!sessionActive || !charId || turnState !== 'ASKING' || speakingPhase !== 'audible') return
    let mouthOpen = true
    setPoseFrame(EXPRESSION_FRAME.talk)
    const id = window.setInterval(() => {
      mouthOpen = !mouthOpen
      setPoseFrame(mouthOpen ? EXPRESSION_FRAME.talk : EXPRESSION_FRAME.rest)
    }, 400)
    return () => window.clearInterval(id)
  }, [charId, sessionActive, turnState, speakingPhase])

  useEffect(() => {
    if (!sessionActive || !charId) return
    if (turnState === 'ASKING' && speakingPhase === 'audible') return

    let blinkTimer = 0
    let closeTimer = 0

    const schedule = () => {
      const delay = 2800 + Math.random() * 2200
      blinkTimer = window.setTimeout(() => {
        setBlinkFrame(EXPRESSION_FRAME.blink)
        closeTimer = window.setTimeout(() => {
          setBlinkFrame(null)
          schedule()
        }, 130)
      }, delay)
    }

    schedule()
    return () => {
      window.clearTimeout(blinkTimer)
      window.clearTimeout(closeTimer)
      setBlinkFrame(null)
    }
  }, [charId, sessionActive, turnState, speakingPhase])

  const frame = blinkFrame ?? baseFrame
  const src = charId
    ? expressionImageUrl(charId, sessionActive ? mood : 'neutral', sessionActive ? frame : EXPRESSION_FRAME.rest)
    : null

  return { mood, frame, src }
}

export function stageOpponentSrc(
  charId: CharacterId | null,
  poster: string | undefined,
  sessionActive: boolean,
  expressionSrc: string | null,
): string {
  if (!charId) return '/placeholder.svg'
  if (!sessionActive) return poster || '/placeholder.svg'
  return expressionSrc || poster || '/placeholder.svg'
}
