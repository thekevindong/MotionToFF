/** Presage-driven interviewer interjections (mirror backend/composure_thresholds.py). */

export const INTERJECT = {
  stressHigh: 0.72,
  composureLow: 0.38,
  hrElevated: 100,
  cooldownMs: 45_000,
  maxInterjectsPerSession: 4,
  /** Samples at 1 Hz — sustained breach required */
  sustainedSec: 3,
} as const

export type InterjectTrigger = 'high_stress' | 'composure_low' | 'hr_elevated'

export function interjectDevMode(): boolean {
  if (!import.meta.env.DEV) return false
  try {
    if (new URLSearchParams(window.location.search).get('interject_dev') === '1') return true
    return localStorage.getItem('speakup_dev_interject') === '1'
  } catch {
    return false
  }
}

export function interjectThresholdsForSession() {
  if (!interjectDevMode()) return INTERJECT
  return {
    ...INTERJECT,
    stressHigh: 0.55,
    composureLow: 0.5,
    sustainedSec: 2,
  }
}
