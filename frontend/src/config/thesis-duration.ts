export type ThesisPackId = 'short' | 'long'

export const THESIS_PACK_OPTIONS = [
  { id: 'short', presentationSec: 30, qaSec: 60, label: '30s talk · 1 min Q&A' },
  { id: 'long', presentationSec: 60, qaSec: 120, label: '1 min talk · 2 min Q&A' },
] as const

export function thesisPackById(id: ThesisPackId) {
  return THESIS_PACK_OPTIONS.find((p) => p.id === id)
}
