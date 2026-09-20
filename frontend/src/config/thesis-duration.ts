export type ThesisPackId = 'short' | 'long'

/** `qaDurationSec` is legacy session metadata (API allows 90 / 180 totals only — not a Q&A timer). */
export const THESIS_PACK_OPTIONS = [
  {
    id: 'short',
    presentationSec: 30,
    qaQuestions: 3,
    qaDurationSec: 60,
    label: '30s talk · 3 committee questions',
  },
  {
    id: 'long',
    presentationSec: 60,
    qaQuestions: 5,
    qaDurationSec: 120,
    label: '1 min talk · 5 committee questions',
  },
] as const

export function thesisSessionDurationSec(pack: (typeof THESIS_PACK_OPTIONS)[number]): number {
  return pack.presentationSec + pack.qaDurationSec
}

export function thesisPackById(id: ThesisPackId) {
  return THESIS_PACK_OPTIONS.find((p) => p.id === id)
}
