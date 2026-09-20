const PREP_COMPLETE_KEY = 'speakup_prep_complete'
const PREP_DEFAULTS_KEY = 'speakup_prep_defaults'

export type PrepDefaults = {
  modeId: string
  characterId: string
}

export function readPrepDefaults(): Partial<PrepDefaults> {
  try {
    const raw = localStorage.getItem(PREP_DEFAULTS_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Partial<PrepDefaults>
  } catch {
    return {}
  }
}

export function writePrepDefaults(partial: Partial<PrepDefaults>) {
  const prev = readPrepDefaults()
  localStorage.setItem(PREP_DEFAULTS_KEY, JSON.stringify({ ...prev, ...partial }))
}

export function markPrepComplete() {
  sessionStorage.setItem(PREP_COMPLETE_KEY, '1')
}

export function clearPrepComplete() {
  sessionStorage.removeItem(PREP_COMPLETE_KEY)
}

export function isPrepCompleteInSession(): boolean {
  return sessionStorage.getItem(PREP_COMPLETE_KEY) === '1'
}

export function isLiveStudioPath(pathname: string): boolean {
  const clean = pathname.replace(/\/$/, '') || '/'
  if (clean === '/start/live' || clean === '/start/call') return true
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('live') === '1'
}
