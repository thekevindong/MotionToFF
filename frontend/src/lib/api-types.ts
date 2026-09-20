/** Shapes matching FastAPI responses (see handoff.md). */

export type InterviewerLine = { role: string; text: string; end_session?: boolean }

export type RubricScores = {
  structure: number
  specificity: number
  confidence: number
  evidence: string[]
  red_flags: string[]
  overall: number
  mock?: boolean
  presence?: number
  message_fit?: number
  teleprompter_coverage?: number
  timing?: {
    mode?: string
    finished_in_time?: boolean
    notes?: string
  }
}

export type DirectorDecision = {
  action: string
  rationale: string
  input_snapshot?: Record<string, unknown>
  mock?: boolean
}

export type SessionTurn = {
  turn: number
  question: string
  answer: string
  scores: RubricScores
  composure: number
  decision: DirectorDecision
  next_question?: InterviewerLine
}

export type SessionDocument = {
  id: string
  session_id: string
  filename: string
  mime: string
  extracted_text_length: number
  created_at: string
}

export type SessionPersonaSettings = {
  scenario_id?: string
  character_id?: string
  session_duration_sec?: number
  speech_id?: string
  speech_title?: string
  speaker?: string
  duration_mode?: string
  target_duration_sec?: number
  teleprompter_lines?: string[]
  teleprompter_prepared_at?: string
  finished_in_time?: boolean
  delivery_stats?: {
    elapsed_sec?: number
    ended_by?: string
    summary?: SpeakingDeliverySummary
  }
}

export type SpeechCatalogItem = {
  id: string
  slug: string
  speaker: string
  title: string
  teaser: string
  word_count: number
  est_full_duration_sec: number
}

export type SpeechesCatalogResponse = {
  speeches: SpeechCatalogItem[]
}

export type SpeakingPrepareResponse = {
  speech_id: string
  speech_title: string
  speaker: string
  duration_mode: string
  target_sec: number
  lines: string[]
  estimated_sec?: number | null
  rationale?: string | null
  source?: string | null
  teleprompter_prepared_at: string
}

export type SpeakingDeliverySample = {
  ts_ms: number
  composure: number
  stress: number
  engagement: number
}

export type SpeakingDeliverySummary = {
  avg_composure?: number
  min_composure?: number
  max_stress?: number
  avg_wpm?: number | null
  filler_count?: number
  presage_degraded?: boolean
}

export type SpeakingCompleteInput = {
  transcript: string
  elapsedSec: number
  finishedInTime: boolean
  endedBy: 'timer' | 'user' | 'early_exit'
  samples: SpeakingDeliverySample[]
  summary: SpeakingDeliverySummary | null
}

export type SpeakingCompleteResponse = {
  ok: boolean
  end_session: boolean
}

export type SessionReportPayload = {
  rubric?: RubricScores
  per_turn?: Array<{ turn: number } & RubricScores>
  mock?: boolean
  source?: 'nemotron' | 'gemini' | 'presage' | 'presage_fallback' | 'mock' | string
  fallback?: boolean
}

export type SessionResponse = {
  session_id?: string
  job_title?: string | null
  settings?: SessionPersonaSettings
  current_question: InterviewerLine
  turns: SessionTurn[]
  documents?: SessionDocument[]
  session_report?: SessionReportPayload
}

export type CreateSessionResponse = {
  session_id: string
  job_title: string | null
  settings?: SessionPersonaSettings
}

export type CreateSessionInput = {
  jobTitle?: string
  scenarioId?: string
  characterId?: string
  sessionDurationSec?: number
}

export type UploadDocumentResponse = {
  id: string
  session_id: string
  filename: string
  mime: string
  extracted_text_length: number
  created_at: string
}

export type TurnResponse = {
  scores: RubricScores
  decision: DirectorDecision
  next_question: InterviewerLine
  /** Gemini chose to end the practice (deal reached, natural wrap-up, etc.) */
  end_session?: boolean
}

export type InterjectTrigger =
  | 'high_stress'
  | 'composure_low'
  | 'hr_elevated'
  | 'pace_fast'
  | 'low_eye_contact'

export type InterjectRequest = {
  trigger: InterjectTrigger
  snapshot: {
    composure: number
    stress: number
    hr_bpm?: number | null
    eye_contact?: number | null
    pace_wpm?: number | null
    source: string
  }
}

export type InterjectResponse = {
  text: string
  resume: boolean
}

export type SessionCloseRequest = {
  elapsedSec?: number
  durationSec?: number
}

export type SessionCloseResponse = {
  text: string
}

export type SessionVitalsResponse = {
  session_id: string
  composure_mode: string
  sidecar_reachable: boolean
  sidecar_error: string | null
  sidecar_base?: string
  pulse: number | null
  breathing: number | null
  vitals_source: string | null
  composure_scalar: number | null
  composure_raw: Record<string, unknown> | null
}

export type HealthResponse = { ok: boolean }

export type VoiceStatusResponse = { stt: boolean; tts: boolean }
