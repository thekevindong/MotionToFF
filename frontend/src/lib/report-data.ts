import type { SessionTurn } from './api-types'

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

export function buildImprovements(turns: SessionTurn[], cap = 3): string[] {
  const seen = new Set<string>()
  const items: string[] = []
  for (const turn of turns) {
    for (const line of turn.scores.red_flags) {
      const trimmed = line.trim()
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
