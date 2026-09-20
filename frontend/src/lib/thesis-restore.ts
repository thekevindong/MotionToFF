import type { SessionPersonaSettings, ThesisPrepareResponse } from './api-types'
import type { ThesisPackId } from '../config/thesis-duration'

/** Rebuild thesis prep from persisted session settings (refresh on /start/live). */
export function thesisPrepFromSettings(
  settings: SessionPersonaSettings | undefined,
): ThesisPrepareResponse | null {
  if (settings?.scenario_id !== 'thesis') return null
  const pack = settings.thesis_pack?.trim()
  if (pack !== 'short' && pack !== 'long') return null
  const defenseId = settings.defense_document_id?.trim()
  if (!defenseId) return null
  const presentationSec = settings.presentation_duration_sec
  const qaSec = settings.qa_duration_sec
  if (typeof presentationSec !== 'number' || typeof qaSec !== 'number') return null
  const characterId = settings.character_id?.trim()
  if (!characterId) return null
  return {
    thesis_pack: pack as ThesisPackId,
    presentation_duration_sec: presentationSec,
    qa_duration_sec: qaSec,
    character_id: characterId,
    defense_document_id: defenseId,
    defense_filename: settings.defense_filename?.trim() || 'defense.txt',
    defense_text_preview: settings.defense_text_preview?.trim() || '',
    thesis_phase: settings.thesis_phase === 'qa' || settings.thesis_phase === 'done'
      ? settings.thesis_phase
      : 'presentation',
    source: 'session',
  }
}
