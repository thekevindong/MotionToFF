import type { Character } from './modes'

export type CharacterId = Character['id']
export type ExpressionMood = 'neutral' | 'stern'

export function expressionImageUrl(charId: CharacterId, mood: ExpressionMood, frameIndex: number): string {
  const frame = Math.max(0, Math.min(3, frameIndex))
  const prefix = mood === 'neutral' ? 'neutral' : 'stern'
  return `/images/${charId}/${prefix}-${frame}.png`
}

/** Default smiling cartoon portrait (prep cards, results, idle stage). */
export function characterPortraitUrl(charId: CharacterId): string {
  return expressionImageUrl(charId, 'neutral', 0)
}

export function isHardDirectorAction(action: string | undefined): boolean {
  // curveball is a topic shift, not hostility — only press_harder should read as "stern"
  return action === 'press_harder'
}

export function isSoftDirectorAction(action: string | undefined): boolean {
  return action === 'ease_off' || action === 'follow_up' || action === 'move_on'
}
