export type ThesisPackId = 'short' | 'long'

export const THESIS_PACK_OPTIONS = [
  {
    id: 'short',
    presentationSec: 30,
    qaQuestions: 3,
    qaEstimateSec: 90,
    label: '30s talk · 3 committee questions',
  },
  {
    id: 'long',
    presentationSec: 60,
    qaQuestions: 5,
    qaEstimateSec: 150,
    label: '1 min talk · 5 committee questions',
  },
] as const

export function thesisPackById(id: ThesisPackId) {
  return THESIS_PACK_OPTIONS.find((p) => p.id === id)
}
