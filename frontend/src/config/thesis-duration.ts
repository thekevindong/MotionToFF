export type ThesisPackId = 'short' | 'long'

export const THESIS_PACK_OPTIONS = [
  {
    id: 'short',
    presentationSec: 30,
    qaQuestions: 3,
    label: '30s talk · 3 committee questions',
  },
  {
    id: 'long',
    presentationSec: 60,
    qaQuestions: 5,
    label: '1 min talk · 5 committee questions',
  },
] as const

/** Presentation timer only — Q&A has no time cap (question count ends the committee round). */
export function thesisSessionDurationSec(pack: (typeof THESIS_PACK_OPTIONS)[number]): number {
  return pack.presentationSec
}

export function thesisPackById(id: ThesisPackId) {
  return THESIS_PACK_OPTIONS.find((p) => p.id === id)
}
