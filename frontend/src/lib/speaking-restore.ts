import type { SessionPersonaSettings, SpeakingPrepareResponse } from './api-types'

/** Rebuild teleprompter prep from persisted session settings (refresh on /start/live). */
export function speakingPrepFromSettings(
  settings: SessionPersonaSettings | undefined,
): SpeakingPrepareResponse | null {
  if (settings?.scenario_id !== 'speaking') return null
  const lines = settings.teleprompter_lines
  if (!lines?.length) return null
  const speechId = settings.speech_id?.trim()
  if (!speechId) return null
  return {
    speech_id: speechId,
    speech_title: settings.speech_title?.trim() || 'Speech',
    speaker: settings.speaker?.trim() || 'Speaker',
    duration_mode: settings.duration_mode?.trim() || '30',
    target_sec: settings.target_duration_sec ?? 0,
    lines,
    teleprompter_prepared_at: settings.teleprompter_prepared_at?.trim() || new Date().toISOString(),
    source: 'session',
  }
}
