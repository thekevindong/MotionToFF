/** Where a composure signal originated. Report code does not branch on this. */
export type ComposureSource = 'presage' | 'fallback'

export interface ComposureSignals {
  expression: { neutral: number; stress: number } | null
  engagement: number | null
  vitals: { hr_bpm: number } | null
  filler_rate: number | null
  answer_latency_ms: number | null
  speech_rate_wpm: number | null
}

/** Unified composure sample (MediaPipe webcam or synthetic until face is visible). */
export interface ComposureSample {
  session_id: string
  question_id: string
  ts_ms: number
  source: ComposureSource
  /** 0–1 composure score. */
  composure: number
  signals: ComposureSignals
}

/** Turn state machine — one audio direction active at a time. */
export type TurnState =
  | 'IDLE'
  | 'ASKING'
  | 'LISTENING'
  | 'THINKING'
  | 'REPORT'
