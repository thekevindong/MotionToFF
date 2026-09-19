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

export type SessionResponse = {
  current_question: InterviewerLine
  turns: SessionTurn[]
}

export type TurnResponse = {
  scores: RubricScores
  decision: DirectorDecision
  next_question: InterviewerLine
}

export type HealthResponse = { ok: boolean }
