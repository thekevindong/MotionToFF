import type { Character } from './modes'

export type CharacterId = Character['id']

export type AudiencePhase = 'empty' | 'house' | 'reacting'
/** Pegasus-driven audience plates (served from public/backgrounds/auditorium). */
export type AudienceReaction = 'clap' | 'sad'

const AUDITORIUM_BASE = '/backgrounds/auditorium'

/** Auditorium backdrop for public speaking / thesis (face-driven reactions in Phase 5). */
export function audienceStageUrl(
  phase: AudiencePhase,
  reaction: AudienceReaction | null,
): string {
  if (phase === 'empty') {
    return `${AUDITORIUM_BASE}/aud_empty.png`
  }
  if (phase === 'reacting' && reaction) {
    const reactionFile: Record<AudienceReaction, string> = {
      clap: 'aud_filled_clap.png',
      sad: 'aud_filled_sad.png',
    }
    return `${AUDITORIUM_BASE}/${reactionFile[reaction]}`
  }
  return `${AUDITORIUM_BASE}/aud_filled.png`
}

/** Static stage backdrops served from /public/backgrounds */
export function stageBackgroundUrl(
  modeId: string,
  characterId: CharacterId | null,
  _options?: { thesisPhase?: 'presentation' | 'qa' },
): string {
  switch (modeId) {
    case 'thesis':
      return audienceStageUrl('house', null)
    case 'speaking':
      return audienceStageUrl('house', null)
    case 'salary':
    case 'interview':
    default: {
      const officeByCharacter: Record<CharacterId, string> = {
        recruiter: '/backgrounds/office/home1.png',
        manager: '/backgrounds/office/home2.png',
        hr: '/backgrounds/office/home3.png',
      }
      const interviewByCharacter: Record<CharacterId, string> = {
        recruiter: '/backgrounds/home/of1.png',
        manager: '/backgrounds/home/of2.png',
        hr: '/backgrounds/home/of3.png',
      }
      const map = modeId === 'interview' ? interviewByCharacter : officeByCharacter
      if (characterId && map[characterId]) return map[characterId]
      return modeId === 'interview' ? '/backgrounds/home/of1.png' : '/backgrounds/office/home1.png'
    }
  }
}
