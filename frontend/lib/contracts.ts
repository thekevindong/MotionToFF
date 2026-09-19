/**
 * Frozen data contracts for the interview coach.
 *
 * Two things are locked before any feature code:
 *   1. The combined Nemotron output  -> { rubric, director }
 *   2. The unified composure sample   -> ComposureSample
 *
 * The director and the report code are written against these shapes and must
 * never branch on where a signal came from (Presage vs. fallback).
 */

// ---------------------------------------------------------------------------
// Enums (fixed vocabularies — keep these scoreable for the eval)
// ---------------------------------------------------------------------------

/** The four rubric dimensions, each scored as an integer 0-4 (Likert). */
export const RUBRIC_DIMENSIONS = [
  "structure",
  "specificity",
  "confidence",
  "evidence",
] as const
export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number]

/** Fixed red-flag enum. Add to this deliberately — the eval scores against it. */
export const RED_FLAGS = [
  "vague_ownership",
  "no_metrics",
  "rambling",
  "off_topic",
  "contradiction",
  "overclaiming",
  "excessive_hedging",
  "memorized_script",
  "blaming_others",
  "no_result",
  "jargon_without_substance",
  "unclear_role",
  "defensive",
  "too_short",
] as const
export type RedFlag = (typeof RED_FLAGS)[number]

/** Director decisions that steer the next question. */
export const DIRECTOR_DECISIONS = [
  "press_harder",
  "follow_up",
  "move_on",
  "curveball",
  "ease_off",
] as const
export type DirectorDecision = (typeof DIRECTOR_DECISIONS)[number]

/** Composure trend as summarized for the director. */
export type ComposureTrend = "rising" | "stable" | "falling"

/** Where a composure signal originated. Downstream code never branches on this. */
export type ComposureSource = "presage" | "fallback"

// ---------------------------------------------------------------------------
// Contract 1 — Nemotron combined output (one call, logged as two records)
// ---------------------------------------------------------------------------

export type RubricScores = Record<RubricDimension, number>
export type RubricRationale = Record<RubricDimension, string>

export interface RubricRecord {
  question_id: string
  answer_id: string
  /** ISO-8601 timestamp. */
  ts: string
  scores: RubricScores
  red_flags: RedFlag[]
  /** Normalized 0-100 so it can be plotted. */
  overall: number
  rationale: RubricRationale
  evidence_quotes: string[]
}

export interface DirectorInputsSnapshot {
  rubric_overall: number
  composure: {
    score: number
    trend: ComposureTrend
    source: ComposureSource
  }
  history: {
    asked: number
    avg_overall: number
    consecutive_low: number
  }
}

export interface DirectorRecord {
  decision: DirectorDecision
  target_dimension: RubricDimension
  /** Integer in the range -2..+2. */
  difficulty_delta: number
  rationale: string
  /** The exact inputs the director saw — the eval deliverable. Persist every one. */
  inputs_snapshot: DirectorInputsSnapshot
}

/** The single JSON object Nemotron returns per turn. */
export interface NemotronTurnOutput {
  rubric: RubricRecord
  director: DirectorRecord
}

// ---------------------------------------------------------------------------
// Contract 2 — Unified composure sample (Presage OR fallback)
// ---------------------------------------------------------------------------

export interface ComposureSignals {
  // Populated when source === "presage"
  expression: { neutral: number; stress: number } | null
  engagement: number | null
  vitals: { hr_bpm: number } | null
  // Populated when source === "fallback"
  filler_rate: number | null
  answer_latency_ms: number | null
  speech_rate_wpm: number | null
}

export interface ComposureSample {
  session_id: string
  question_id: string
  ts_ms: number
  source: ComposureSource
  /** Unified 0-1 composure score, whatever the source. */
  composure: number
  signals: ComposureSignals
}

// ---------------------------------------------------------------------------
// Turn state machine — exactly one audio direction active at a time.
// Webcam + Presage run across all states; audio never overlaps.
// ---------------------------------------------------------------------------

export type TurnState =
  | "IDLE" // pre-session
  | "ASKING" // TTS playing, mic closed
  | "LISTENING" // MediaRecorder capturing, TTS stopped
  | "THINKING" // both model calls running
  | "REPORT" // session over, showing the report

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

export function isRedFlag(value: string): value is RedFlag {
  return (RED_FLAGS as readonly string[]).includes(value)
}

export function isDirectorDecision(value: string): value is DirectorDecision {
  return (DIRECTOR_DECISIONS as readonly string[]).includes(value)
}
