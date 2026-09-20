export type SpeakingDurationId = '30' | '45' | 'full'

export type SpeakingDurationOption = {
  id: SpeakingDurationId
  /** 0 = count-up until user finishes */
  seconds: 30 | 45 | 0
  label: string
}

export const SPEAKING_DURATION_OPTIONS: SpeakingDurationOption[] = [
  { id: '30', seconds: 30, label: '30 seconds' },
  { id: '45', seconds: 45, label: '45 seconds' },
  { id: 'full', seconds: 0, label: 'Full length' },
]

export function speakingDurationSeconds(id: SpeakingDurationId): 30 | 45 | 0 {
  const opt = SPEAKING_DURATION_OPTIONS.find((o) => o.id === id)
  return opt?.seconds ?? 30
}
