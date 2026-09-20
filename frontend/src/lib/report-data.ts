import type { RubricScores, SessionTurn } from './api-types'
import {
  pickTranscriptImprovements,
  pickTranscriptStrengths,
  useTranscriptFeedbackCatalog,
} from './transcript-feedback'

export type ReportMetric = {
  label: string
  value: number
  note: string
  invert?: boolean
}

export type TranscriptLine = { who: 'you' | 'them'; text: string }

function toPercent(score01: number): number {
  return Math.round(Math.min(1, Math.max(0, score01)) * 100)
}

function avg(turns: SessionTurn[], pick: (t: SessionTurn) => number): number {
  if (turns.length === 0) return 0
  const sum = turns.reduce((acc, t) => acc + pick(t), 0)
  return sum / turns.length
}

function clamp01(value: number, fallback = 0.5): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0, value))
}

const RED_FLAG_LABELS: Record<string, string> = {
  very_brief_answer: 'Very brief answer',
  low_composure_on_turn: 'Low composure on this turn',
  empty_or_too_short: 'Answer was empty or too short',
}

/** Presage / Nemotron red_flags are often snake_case — show readable copy in the report UI. */
export function formatRedFlag(flag: string): string {
  const trimmed = flag.trim()
  if (!trimmed) return trimmed
  const known = RED_FLAG_LABELS[trimmed.toLowerCase()]
  if (known) return known
  if (!trimmed.includes('_')) return trimmed
  return trimmed
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
}

/** Client-side Presage baseline when /report fails or scores are still pending. */
export function scoreTurnPresage(answer: string, composure: number): RubricScores {
  const trimmed = answer.trim()
  const words = trimmed ? trimmed.split(/\s+/).length : 0
  const comp = clamp01(composure)

  if (!trimmed) {
    return {
      structure: 0.2,
      specificity: 0.15,
      confidence: comp * 0.5,
      evidence: [],
      red_flags: ['empty_or_too_short'],
      overall: 0.18,
      mock: true,
    }
  }

  const hasNumber = /\d/.test(trimmed)
  const structure = clamp01(0.42 + Math.min(words, 100) / 140 + comp * 0.22)
  const specificity = clamp01(0.38 + Math.min(words, 90) / 110 + (hasNumber ? 0.12 : 0))
  const confidence = clamp01(comp * 0.85 + Math.min(words, 60) / 200)

  const evidence: string[] = []
  if (words >= 35) evidence.push('Answer had enough depth to follow your reasoning')
  if (comp >= 0.72) evidence.push('Composure read as steady on this turn')
  if (hasNumber) evidence.push('Used concrete figures or metrics')

  const red_flags: string[] = []
  if (words < 12) red_flags.push('very_brief_answer')
  if (comp < 0.4) red_flags.push('low_composure_on_turn')

  const overall = clamp01((structure + specificity + confidence) / 3)
  return {
    structure,
    specificity,
    confidence,
    evidence: evidence.slice(0, 3),
    red_flags,
    overall,
    mock: true,
  }
}

function turnNeedsPresageScores(turn: SessionTurn): boolean {
  const pending = (turn.scores as RubricScores & { pending?: boolean }).pending
  return Boolean(pending)
}

export function applyPresageScoresToTurns(turns: SessionTurn[]): SessionTurn[] {
  return turns.map((turn) => {
    if (!turnNeedsPresageScores(turn)) return turn
    return {
      ...turn,
      scores: scoreTurnPresage(turn.answer, turn.composure),
    }
  })
}

export function computeOverallScore(turns: SessionTurn[]): number | null {
  if (turns.length === 0) return null
  return toPercent(avg(turns, (t) => t.scores.overall))
}

export function buildMetrics(turns: SessionTurn[]): ReportMetric[] {
  if (turns.length === 0) return []

  const composurePct = toPercent(avg(turns, (t) => t.composure))
  const structurePct = toPercent(avg(turns, (t) => t.scores.structure))
  const specificityPct = toPercent(avg(turns, (t) => t.scores.specificity))
  const confidencePct = toPercent(avg(turns, (t) => t.scores.confidence))

  const redFlagCount = turns.reduce((n, t) => n + t.scores.red_flags.length, 0)
  const fillerValue = Math.max(35, 100 - redFlagCount * 12)
  const fillerNote =
    redFlagCount > 0
      ? `${redFlagCount} flag${redFlagCount === 1 ? '' : 's'} noted across answers — tighten wording.`
      : 'No major red flags flagged by the rubric.'

  return [
    {
      label: 'Composure',
      value: composurePct,
      note: composurePct >= 70 ? 'Held steady through the session.' : 'Composure dipped on harder turns.',
    },
    {
      label: 'Structure',
      value: structurePct,
      note: structurePct >= 70 ? 'Answers stayed organized.' : 'Work on clear opening and close per answer.',
    },
    {
      label: 'Specificity',
      value: specificityPct,
      note: specificityPct >= 70 ? 'Concrete details showed up in your responses.' : 'Add numbers, examples, and scope.',
    },
    {
      label: 'Confidence',
      value: confidencePct,
      note: confidencePct >= 70 ? 'Tone read as assured.' : 'Some hesitation — pause instead of filling space.',
    },
    {
      label: 'Delivery flags',
      value: fillerValue,
      note: fillerNote,
      invert: redFlagCount > 0,
    },
  ]
}

export function buildStrengths(turns: SessionTurn[], cap = 3): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const turn of turns) {
    for (const line of turn.scores.evidence) {
      const trimmed = line.trim()
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      items.push(trimmed)
      if (items.length >= cap) return items
    }
  }
  if (items.length === 0) {
    return ['Complete a full answer loop in the studio to collect rubric evidence.']
  }
  return items
}

export function buildReportStrengths(
  turns: SessionTurn[],
  reportSource: string | null,
  cap = 3,
): string[] {
  if (useTranscriptFeedbackCatalog(reportSource)) {
    return pickTranscriptStrengths(turns, cap)
  }
  return buildStrengths(turns, cap)
}

export function buildReportImprovements(
  turns: SessionTurn[],
  reportSource: string | null,
  cap = 3,
): string[] {
  if (useTranscriptFeedbackCatalog(reportSource)) {
    return pickTranscriptImprovements(turns, cap)
  }
  return buildImprovements(turns, cap)
}

export function buildImprovements(turns: SessionTurn[], cap = 3): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const turn of turns) {
    for (const line of turn.scores.red_flags) {
      const trimmed = formatRedFlag(line)
      if (!trimmed || seen.has(trimmed)) continue
      seen.add(trimmed)
      items.push(trimmed)
      if (items.length >= cap) return items
    }
  }
  if (items.length === 0) {
    return ['Keep practicing — finish more turns to collect rubric feedback on your answers.']
  }
  return items
}

export function buildTranscript(turns: SessionTurn[], maxTurns = 8): TranscriptLine[] {
  const slice = turns.slice(-maxTurns)
  const lines: TranscriptLine[] = []
  for (const turn of slice) {
    if (turn.question?.trim()) {
      lines.push({ who: 'them', text: turn.question.trim() })
    }
    if (turn.answer?.trim()) {
      lines.push({ who: 'you', text: turn.answer.trim() })
    }
  }
  return lines
}
