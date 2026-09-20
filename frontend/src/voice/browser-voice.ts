import type { CharacterId } from '../config/character-expressions'
import { CHARACTER_GENDER, type CharacterGender } from '../config/character-voices'

function voiceMatchesGender(voice: SpeechSynthesisVoice, gender: CharacterGender): boolean {
  const name = voice.name
  const lower = name.toLowerCase()
  if (gender === 'male') {
    if (/\bmale\b/i.test(name)) return true
    return /david|mark|guy|james|brian|eric|andrew|christopher|ryan|george|paul/i.test(lower)
  }
  if (/\bfemale\b/i.test(name)) return true
  return /zira|jenny|samantha|aria|susan|emma|linda|michelle|sara|hazel|natasha/i.test(lower)
}

export function browserVoiceForGender(gender: CharacterGender): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
  const matched = voices.find((v) => voiceMatchesGender(v, gender))
  return matched ?? voices[0] ?? null
}

export function browserVoiceForCharacter(charId: CharacterId | null | undefined): SpeechSynthesisVoice | null {
  const gender = charId ? CHARACTER_GENDER[charId] : 'female'
  return browserVoiceForGender(gender)
}
