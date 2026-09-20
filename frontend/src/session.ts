export type SessionSummary = {
  mode: string
  opponent: string
  opponentRole: string
  tone: string
  opponentImg: string
  durationSec: number
}

let current: SessionSummary | null = null

export function setSession(s: SessionSummary) {
  current = s
}

export function getSession(): SessionSummary | null {
  return current
}
