import type { RubricScores, SessionPersonaSettings, SessionReportPayload, SessionTurn } from './api-types'
import { pickTranscriptImprovements, pickTranscriptStrengths, REPORT_FEEDBACK_CAP } from './transcript-feedback'

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
  empty_delivery: 'No spoken delivery captured',
  missed_time_budget: 'Did not finish within the timed window',
  low_teleprompter_coverage: 'Low teleprompter coverage',
  high_filler_rate: 'High filler word rate',
  low_composure_delivery: 'Composure dropped during delivery',
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

function speakingDurationLabel(mode: string | undefined): string {
  if (mode === '30') return '30 second timed'
  if (mode === '45') return '45 second timed'
  if (mode === 'full') return 'Full length'
  return mode?.trim() || 'Practice'
}

export function buildSpeakingMetrics(
  turns: SessionTurn[],
  sessionReport?: SessionReportPayload,
  settings?: SessionPersonaSettings,
): ReportMetric[] {
  if (turns.length === 0) return []
  const rubric = sessionReport?.rubric
  const composurePct = toPercent(avg(turns, (t) => t.composure))
  const presencePct = toPercent(rubric?.presence ?? turns[0]?.scores.presence ?? rubric?.confidence ?? 0.5)
  const messagePct = toPercent(rubric?.message_fit ?? turns[0]?.scores.message_fit ?? rubric?.specificity ?? 0.5)
  const coveragePct = toPercent(
    rubric?.teleprompter_coverage ?? turns[0]?.scores.teleprompter_coverage ?? 0.5,
  )
  const summary = settings?.delivery_stats?.summary
  const wpm = summary?.avg_wpm
  const fillers = summary?.filler_count ?? 0
  const presageDegraded = Boolean(summary?.presage_degraded)
  const paceValue =
    typeof wpm === 'number' && wpm > 0 ? Math.min(100, Math.round((wpm / 160) * 100)) : 55
  const paceNote =
    typeof wpm === 'number' && wpm > 0
      ? `Average pace ~${Math.round(wpm)} WPM${fillers ? ` · ${fillers} filler${fillers === 1 ? '' : 's'}` : ''}.`
      : fillers
        ? `${fillers} filler word${fillers === 1 ? '' : 's'} noted — pause instead of um/uh.`
        : 'Pace data will sharpen when Presage speech metrics are available.'
  const timingNote = rubric?.timing?.notes?.trim()
  const durationLabel = speakingDurationLabel(settings?.duration_mode ?? rubric?.timing?.mode)

  return [
    {
      label: 'Composure',
      value: composurePct,
      note: presageDegraded
        ? 'Camera was off — scores used degraded face heuristics; turn video on next run for sharper Presage.'
        : composurePct >= 70
          ? 'Held steady on camera through the speech.'
          : 'Composure wavered — slow your first sentence after transitions.',
    },
    {
      label: 'Presence',
      value: presencePct,
      note: presencePct >= 70 ? 'Stage presence read as confident.' : 'Practice eye line and stillness between phrases.',
    },
    {
      label: 'Message fit',
      value: messagePct,
      note: messagePct >= 70 ? 'Delivery matched the teleprompter intent.' : 'Stay closer to the scripted lines for iconic beats.',
    },
    {
      label: 'Teleprompter coverage',
      value: coveragePct,
      note:
        coveragePct >= 65
          ? 'You covered most of the teleprompter material.'
          : 'Re-run with the scroll visible — hit more of the scripted lines.',
    },
    {
      label: 'Pace & fillers',
      value: paceValue,
      note: timingNote ? `${durationLabel}. ${timingNote}` : `${durationLabel}. ${paceNote}`,
      invert: Boolean(settings?.finished_in_time === false),
    },
  ]
}

export function buildMetrics(
  turns: SessionTurn[],
  options?: { scenarioId?: string; sessionReport?: SessionReportPayload; settings?: SessionPersonaSettings },
): ReportMetric[] {
  if (options?.scenarioId === 'speaking') {
    return buildSpeakingMetrics(turns, options.sessionReport, options.settings)
  }
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
  cap = REPORT_FEEDBACK_CAP,
  options?: { scenarioId?: string; settings?: SessionPersonaSettings; sessionReport?: SessionReportPayload },
): string[] {
  const fromRubric = options?.sessionReport?.rubric?.evidence?.filter((line) => line.trim()) ?? []
  const fromCatalog = pickTranscriptStrengths(turns, cap, options)
  const merged: string[] = []
  const seen = new Set<string>()
  for (const line of [...fromRubric, ...fromCatalog]) {
    const trimmed = line.trim()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    merged.push(trimmed)
    if (merged.length >= cap) break
  }
  return merged.length ? merged : fromCatalog
}

export function buildReportImprovements(
  turns: SessionTurn[],
  cap = REPORT_FEEDBACK_CAP,
  options?: { scenarioId?: string; settings?: SessionPersonaSettings; sessionReport?: SessionReportPayload },
): string[] {
  const flags = options?.sessionReport?.rubric?.red_flags ?? []
  const fromFlags = flags.map((f) => formatRedFlag(f)).filter(Boolean)
  const fromCatalog = pickTranscriptImprovements(turns, cap, options)
  const merged: string[] = []
  const seen = new Set<string>()
  for (const line of [...fromFlags, ...fromCatalog]) {
    if (!line || seen.has(line)) continue
    seen.add(line)
    merged.push(line)
    if (merged.length >= cap) break
  }
  return merged.length ? merged : fromCatalog
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
