import type { CharacterId } from './character-expressions'

export type CharacterGender = 'female' | 'male'

/** Visual + voice gender for each opponent (matches cartoon sprites). */
export const CHARACTER_GENDER: Record<CharacterId, CharacterGender> = {
  recruiter: 'female',
  manager: 'male',
  hr: 'female',
}

/** ElevenLabs premade voices — female / male pairs. */
const ELEVENLABS_VOICE_ID: Record<CharacterGender, string> = {
  female: '21m00Tcm4TlvDq8ikWAM', // Rachel
  male: 'pNInz6obpgDQGcFmaJgB', // Adam
}

export function elevenLabsVoiceIdForCharacter(charId: CharacterId): string {
  return ELEVENLABS_VOICE_ID[CHARACTER_GENDER[charId]]
}
