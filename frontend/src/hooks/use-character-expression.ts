import { useEffect, useRef, useState } from 'react'
import type { DeliveryMood, InterjectTrigger } from '../config/composure-thresholds'
import type { SpeakingPhase } from './use-interview-machine'
import type { TurnState } from '../lib/contracts'
import {
  expressionImageUrl,
  isHardDirectorAction,
  type CharacterId,
  type ExpressionMood,
} from '../config/character-expressions'

type DirectorSignal = { action?: string; overall?: number }

function frameFromScore(overall: number | undefined): number {
  if (overall === undefined) return 1
  if (overall < 45) return 2
  if (overall < 65) return 1
  return 0
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
  const [frame, setFrame] = useState(0)
  const sternHoldRef = useRef(0)
  const softStreakRef = useRef(0)

  useEffect(() => {
    sternHoldRef.current = 0
    softStreakRef.current = 0
    setMood('neutral')
    setFrame(0)
  }, [charId])

  useEffect(() => {
    if (!lastInterjection) return
    setMood('stern')
    setFrame(2)
    sternHoldRef.current = 3
    softStreakRef.current = 0
  }, [lastInterjection])

  useEffect(() => {
    if (sternHoldRef.current > 0 || lastInterjection) return
    if (deliveryMood === 'pleased' && sessionActive) {
      setMood('neutral')
      setFrame(0)
    }
  }, [deliveryMood, lastInterjection, sessionActive])

  useEffect(() => {
    if (!lastDirector?.action) return
    const action = lastDirector.action
    if (isHardDirectorAction(action)) {
      setMood('stern')
      setFrame(frameFromScore(lastDirector.overall))
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
      setFrame(3)
      softStreakRef.current = 0
      return
    }
    if (action === 'follow_up' || action === 'move_on') {
      softStreakRef.current += 1
      if (softStreakRef.current >= 2 || action === 'move_on') {
        setMood('neutral')
        setFrame(action === 'move_on' ? 0 : 3)
        softStreakRef.current = 0
      } else {
        setMood('neutral')
        setFrame(2)
      }
    }
  }, [lastDirector])

  useEffect(() => {
    if (!sessionActive || !charId) {
      setFrame(0)
      return
    }

    if (turnState === 'IDLE') {
      setMood('neutral')
      setFrame(0)
      return
    }

    if (turnState === 'LISTENING') {
      setFrame(mood === 'neutral' ? 2 : frameFromScore(lastDirector?.overall))
      return
    }

    if (turnState === 'THINKING') {
      setFrame(0)
    }
  }, [charId, sessionActive, turnState, mood, lastDirector?.overall])

  useEffect(() => {
    if (!sessionActive || !charId || turnState !== 'ASKING' || speakingPhase !== 'audible') return
    let alt = 1
    setFrame(1)
    const id = window.setInterval(() => {
      alt = alt === 1 ? 2 : 1
      setFrame(alt)
    }, 400)
    return () => window.clearInterval(id)
  }, [charId, sessionActive, turnState, speakingPhase])

  const src = charId
    ? expressionImageUrl(charId, sessionActive ? mood : 'neutral', sessionActive ? frame : 0)
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
