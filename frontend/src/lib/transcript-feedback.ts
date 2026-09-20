import type { SessionTurn } from './api-types'

/** Signals derived from the session transcript — keep predicates simple and testable. */
export type TranscriptSignals = {
  turnCount: number
  avgComposure: number
  minComposure: number
  avgAnswerWords: number
  maxAnswerWords: number
  anyVeryBrief: boolean
  anyEmpty: boolean
  hasNumbers: boolean
  hasSalaryTopic: boolean
  hasAnchorLanguage: boolean
  hasTradeoffLanguage: boolean
  askedClarifyingQuestion: boolean
}

export type FeedbackCatalogEntry = {
  id: string
  text: string
  /** Higher runs first when multiple lines match. */
  priority: number
  when: (signals: TranscriptSignals) => boolean
}

const SALARY_TOPIC = /\b(salary|compensation|offer|range|base pay|equity|bonus|sign[- ]?on|total comp)\b/i
const ANCHOR_LANGUAGE =
  /\b(market|benchmark|research|survey|level|band|justify|worth|based on|according to|data)\b/i
const TRADEOFF_LANGUAGE =
  /\b(flexible|willing|if you can|in exchange|trade[- ]?off|instead|alternatively|open to)\b/i
const CLARIFYING_QUESTION = /\?\s*$|^(what|how|can you|could you|which)\b/i

export function analyzeTranscript(turns: SessionTurn[]): TranscriptSignals {
  const answers = turns.map((t) => t.answer?.trim() ?? '')
  const wordCounts = answers.map((a) => (a ? a.split(/\s+/).length : 0))
  const allText = answers.join(' ')
  const composure = turns.map((t) => t.composure).filter((c) => Number.isFinite(c))
  const avgComposure =
    composure.length > 0 ? composure.reduce((a, b) => a + b, 0) / composure.length : 0.5
  const minComposure = composure.length > 0 ? Math.min(...composure) : 0.5
  const totalWords = wordCounts.reduce((a, b) => a + b, 0)

  return {
    turnCount: turns.length,
    avgComposure,
    minComposure,
    avgAnswerWords: turns.length > 0 ? totalWords / turns.length : 0,
    maxAnswerWords: wordCounts.length > 0 ? Math.max(...wordCounts) : 0,
    anyVeryBrief: wordCounts.some((w) => w > 0 && w < 12),
    anyEmpty: answers.some((a) => !a),
    hasNumbers: /\d/.test(allText) || /\$[\d,]+/.test(allText),
    hasSalaryTopic: SALARY_TOPIC.test(allText),
    hasAnchorLanguage: ANCHOR_LANGUAGE.test(allText),
    hasTradeoffLanguage: TRADEOFF_LANGUAGE.test(allText),
    askedClarifyingQuestion: answers.some((a) => CLARIFYING_QUESTION.test(a)),
  }
}

/** Rule-based report copy (Claude-generated catalog, wired to TranscriptSignals). */
export const STRENGTH_CATALOG: FeedbackCatalogEntry[] = [
  {
    id: 'specific_comp_numbers',
    priority: 9,
    text: 'You cited specific dollar figures when discussing compensation, which gives your ask weight and clarity.',
    when: (s) => s.hasNumbers && s.hasSalaryTopic,
  },
  {
    id: 'anchored_with_data',
    priority: 9,
    text: 'You grounded your ask in market data or research, making it harder for the other side to dismiss.',
    when: (s) => s.hasAnchorLanguage && s.hasSalaryTopic,
  },
  {
    id: 'proposed_tradeoffs',
    priority: 8,
    text: 'You offered tradeoffs and showed flexibility, which keeps the conversation collaborative rather than adversarial.',
    when: (s) => s.hasTradeoffLanguage && s.hasSalaryTopic,
  },
  {
    id: 'steady_composure',
    priority: 7,
    text: 'You stayed visibly composed throughout the conversation, projecting confidence even under pressure.',
    when: (s) => s.avgComposure >= 0.75,
  },
  {
    id: 'asked_smart_questions',
    priority: 7,
    text: "You asked clarifying questions instead of accepting terms at face value — that's a strong negotiation habit.",
    when: (s) => s.askedClarifyingQuestion && s.hasSalaryTopic,
  },
  {
    id: 'substantive_responses',
    priority: 6,
    text: 'Your answers had real depth, giving you room to justify your position and build your case.',
    when: (s) => s.avgAnswerWords >= 35 && s.hasSalaryTopic,
  },
]

export const IMPROVEMENT_CATALOG: FeedbackCatalogEntry[] = [
  {
    id: 'skipped_question',
    priority: 10,
    text: 'You left at least one question unanswered — silence in a negotiation can be read as uncertainty, so practice having a ready response.',
    when: (s) => s.anyEmpty,
  },
  {
    id: 'no_specific_numbers',
    priority: 9,
    text: 'Try stating a concrete number or range next time — vague asks are easier for the other side to deflect.',
    when: (s) => !s.hasNumbers && s.hasSalaryTopic,
  },
  {
    id: 'composure_dip',
    priority: 9,
    text: 'Your composure dropped noticeably on at least one turn — practice pausing and breathing before responding to tough pushback.',
    when: (s) => s.minComposure < 0.4,
  },
  {
    id: 'no_anchor',
    priority: 8,
    text: 'You discussed comp without referencing market data or benchmarks — anchoring your ask to external research makes it much harder to counter.',
    when: (s) => !s.hasAnchorLanguage && s.hasSalaryTopic,
  },
  {
    id: 'too_brief',
    priority: 8,
    text: "Some of your responses were very short — a brief answer can signal you haven't thought through your position.",
    when: (s) => s.anyVeryBrief && s.hasSalaryTopic,
  },
  {
    id: 'no_tradeoffs_offered',
    priority: 7,
    text: 'Consider proposing alternatives or tradeoffs (e.g., equity vs. base, start date vs. sign-on) to unlock value beyond a single number.',
    when: (s) => !s.hasTradeoffLanguage && s.turnCount >= 4,
  },
]

const STRENGTH_FALLBACK = 'You completed the practice loop — keep iterating on clarity and calm under pushback.'
const IMPROVEMENT_FALLBACK =
  'Run another session and focus on one skill: either a clear anchor, a trade, or steadier pacing on hard questions.'

export function pickFromCatalog(
  catalog: FeedbackCatalogEntry[],
  signals: TranscriptSignals,
  cap = 3,
): string[] {
  const matched = catalog
    .filter((entry) => entry.when(signals))
    .sort((a, b) => b.priority - a.priority)
  const seen = new Set<string>()
  const out: string[] = []
  for (const entry of matched) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    out.push(entry.text)
    if (out.length >= cap) break
  }
  return out
}

export function pickTranscriptStrengths(turns: SessionTurn[], cap = 3): string[] {
  if (turns.length === 0) {
    return ['Complete a full answer loop in the studio to collect feedback.']
  }
  const items = pickFromCatalog(STRENGTH_CATALOG, analyzeTranscript(turns), cap)
  return items.length > 0 ? items : [STRENGTH_FALLBACK]
}

export function pickTranscriptImprovements(turns: SessionTurn[], cap = 3): string[] {
  if (turns.length === 0) {
    return ['Finish more turns to unlock tailored improvement tips.']
  }
  const items = pickFromCatalog(IMPROVEMENT_CATALOG, analyzeTranscript(turns), cap)
  return items.length > 0 ? items : [IMPROVEMENT_FALLBACK]
}

/** Rule-based copy when no LLM judge (or judge timed out / failed). */
export function useTranscriptFeedbackCatalog(reportSource: string | null): boolean {
  return reportSource !== 'nemotron' && reportSource !== 'gemini'
}

/**
 * Paste into Claude (no API key needed) to generate more catalog rows.
 * Ask for JSON: { "strengths": [...], "improvements": [...] }
 * Each item: { "id", "text", "priority", "when": "<signal expression>" }
 *
 * Allowed when expressions (copy exactly into `when` as TypeScript):
 * - s.turnCount >= N
 * - s.avgComposure >= 0.7 / s.minComposure < 0.45
 * - s.avgAnswerWords >= 35 / s.maxAnswerWords < 15
 * - s.anyVeryBrief / s.anyEmpty
 * - s.hasNumbers / s.hasSalaryTopic / s.hasAnchorLanguage / s.hasTradeoffLanguage
 * - s.askedClarifyingQuestion
 * Combine with && only. Then hand-translate each `when` string into a function in STRENGTH_CATALOG / IMPROVEMENT_CATALOG.
 */
export const TRANSCRIPT_FEEDBACK_CLAUDE_PROMPT = `You are helping build a rule-based interview feedback library for a salary-negotiation practice app.

We detect signals from the user's spoken answers (no LLM at runtime). Each feedback line is shown only when a boolean predicate on these signals is true:

- turnCount (number of Q/A turns)
- avgComposure, minComposure (0–1, higher = steadier on camera)
- avgAnswerWords, maxAnswerWords
- anyVeryBrief (any answer under 12 words)
- anyEmpty
- hasNumbers (digits or dollar amounts in answers)
- hasSalaryTopic (salary, offer, range, equity, bonus, etc.)
- hasAnchorLanguage (market, benchmark, justify, research, level, band…)
- hasTradeoffLanguage (flexible, willing, in exchange, trade-off…)
- askedClarifyingQuestion (answer ends with ? or starts with what/how/can you)

Write 12 strength lines and 12 improvement lines for NEGOTIATION practice (not generic behavioral interview fluff).

Output ONLY JSON:
{
  "strengths": [
    { "id": "snake_case", "text": "Second person, one sentence, actionable tone", "priority": 1-10, "when": "s.hasNumbers && s.hasSalaryTopic" }
  ],
  "improvements": [ same shape ]
}

Rules:
- "when" must use only the signal names above, comparisons (>=, <, ===), &&, and literals.
- No quotes inside "when" except string literals are forbidden — use only booleans and numbers.
- priority 10 = show first when multiple match.
- text must not mention AI, rubric, or Nemotron.`
