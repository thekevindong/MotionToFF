/** Shapes matching FastAPI responses (see handoff.md). */

export type InterviewerLine = { role: string; text: string }

export type RubricScores = {
  structure: number
  specificity: number
  confidence: number
  evidence: string[]
  red_flags: string[]
  overall: number
  mock?: boolean
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
}

export type SessionResponse = {
  session_id?: string
  job_title?: string | null
  settings?: SessionPersonaSettings
  current_question: InterviewerLine
  turns: SessionTurn[]
  documents?: SessionDocument[]
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
}

export type InterjectTrigger = 'high_stress' | 'composure_low' | 'hr_elevated'

export type InterjectRequest = {
  trigger: InterjectTrigger
  snapshot: {
    composure: number
    stress: number
    hr_bpm?: number | null
    source: string
  }
}

export type InterjectResponse = {
  text: string
  resume: boolean
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
