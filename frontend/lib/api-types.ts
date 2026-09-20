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

export type SessionResponse = {
  session_id?: string
  job_title?: string | null
  current_question: InterviewerLine
  turns: SessionTurn[]
  documents?: SessionDocument[]
}

export type CreateSessionResponse = {
  session_id: string
  job_title: string | null
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

export type HealthResponse = { ok: boolean }
