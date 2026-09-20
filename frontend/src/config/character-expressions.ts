import type { Character } from './modes'

export type CharacterId = Character['id']
export type ExpressionMood = 'neutral' | 'stern'

export function expressionImageUrl(charId: CharacterId, mood: ExpressionMood, frameIndex: number): string {
  const frame = Math.max(0, Math.min(3, frameIndex))
  const prefix = mood === 'neutral' ? 'neutral' : 'stern'
  return `/images/${charId}/${prefix}-${frame}.png`
}

export function isHardDirectorAction(action: string | undefined): boolean {
  return action === 'press_harder' || action === 'curveball'
}

export function isSoftDirectorAction(action: string | undefined): boolean {
  return action === 'ease_off' || action === 'follow_up' || action === 'move_on'
}
