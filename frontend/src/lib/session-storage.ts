export const SESSION_STORAGE_KEY = 'motiontoff_session_id'

export function getStoredSessionId(): string | null {
  if (typeof window === 'undefined') {
    return null
  }
  return sessionStorage.getItem(SESSION_STORAGE_KEY)
}

export function setStoredSessionId(sessionId: string): void {
  sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId)
}

export function clearStoredSessionId(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
}
