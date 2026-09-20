export type SessionDurationOption = {
  seconds: number
  label: string
  shortLabel: string
}

/** Prep choices for how long the live interview runs (wall-clock). */
export const SESSION_DURATION_OPTIONS: SessionDurationOption[] = [
  { seconds: 60, label: '1 minute', shortLabel: '1 min' },
  { seconds: 180, label: '3 minutes', shortLabel: '3 min' },
  { seconds: 300, label: '5 minutes', shortLabel: '5 min' },
  { seconds: 600, label: '10 minutes', shortLabel: '10 min' },
  { seconds: 900, label: '15 minutes', shortLabel: '15 min' },
]

export const DEFAULT_SESSION_DURATION_SEC =
  SESSION_DURATION_OPTIONS.find((o) => o.seconds === 180)?.seconds ?? 180

export function formatSessionDuration(seconds: number): string {
  const match = SESSION_DURATION_OPTIONS.find((o) => o.seconds === seconds)
  if (match) return match.label
  if (seconds < 60) return `${seconds}s`
  const m = Math.round(seconds / 60)
  return `${m} minute${m === 1 ? '' : 's'}`
}

export function isAllowedSessionDuration(seconds: number): boolean {
  return SESSION_DURATION_OPTIONS.some((o) => o.seconds === seconds)
}
