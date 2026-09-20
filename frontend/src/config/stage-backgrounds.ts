import type { Character } from './modes'

export type CharacterId = Character['id']

/** Static stage backdrops served from /public/backgrounds */
export function stageBackgroundUrl(modeId: string, characterId: CharacterId | null): string {
  switch (modeId) {
    case 'thesis':
      return '/backgrounds/auditorium/aud_empty.png'
    case 'speaking':
      return '/backgrounds/auditorium/aud_filled.png'
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
