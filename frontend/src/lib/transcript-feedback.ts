import type { SessionTurn } from './api-types'

/** Signals derived from the session transcript — keep predicates simple and testable. */
export type TranscriptSignals = {
  turnCount: number
  answeredTurnCount: number
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
  priority: number
  when: (signals: TranscriptSignals) => boolean
}

export const REPORT_FEEDBACK_CAP = 5

const SALARY_TOPIC =
  /\b(salary|compensation|comp|pay|package|offer|range|base|equity|bonus|sign[- ]?on|total comp|benefits|pto|vacation|raise|counter|negotiat)/i
const ANCHOR_LANGUAGE =
  /\b(market|benchmark|research|survey|level|band|justify|worth|based on|according to|data|experience|impact|role|title|skills|years)\b/i
const TRADEOFF_LANGUAGE =
  /\b(flexible|willing|if you can|in exchange|trade[- ]?off|instead|alternatively|open to|remote|start date|signing)\b/i
const CLARIFYING_QUESTION = /\?\s*$|^(what|how|can you|could you|which|is there)\b/i

export function analyzeTranscript(turns: SessionTurn[]): TranscriptSignals {
  const answers = turns.map((t) => t.answer?.trim() ?? '')
  const wordCounts = answers.map((a) => (a ? a.split(/\s+/).length : 0))
  const allText = answers.join(' ')
  const composure = turns.map((t) => t.composure).filter((c) => Number.isFinite(c))
  const avgComposure =
    composure.length > 0 ? composure.reduce((a, b) => a + b, 0) / composure.length : 0.5
  const minComposure = composure.length > 0 ? Math.min(...composure) : 0.5
  const totalWords = wordCounts.reduce((a, b) => a + b, 0)
  const answeredTurnCount = answers.filter((a) => a.length > 0).length

  return {
    turnCount: turns.length,
    answeredTurnCount,
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

export const STRENGTH_CATALOG: FeedbackCatalogEntry[] = [
  {
    id: 'specific_comp_numbers',
    priority: 9,
    text: 'You cited specific dollar figures when discussing compensation, which gives your ask weight and clarity.',
    when: (s) => s.hasNumbers,
  },
  {
    id: 'anchored_with_data',
    priority: 9,
    text: 'You grounded your ask in market data or research, making it harder for the other side to dismiss.',
    when: (s) => s.hasAnchorLanguage,
  },
  {
    id: 'proposed_tradeoffs',
    priority: 8,
    text: 'You offered tradeoffs and showed flexibility, which keeps the conversation collaborative rather than adversarial.',
    when: (s) => s.hasTradeoffLanguage,
  },
  {
    id: 'steady_composure',
    priority: 8,
    text: 'You stayed visibly composed throughout the conversation, projecting confidence even under pressure.',
    when: (s) => s.avgComposure >= 0.65,
  },
  {
    id: 'asked_smart_questions',
    priority: 7,
    text: "You asked clarifying questions instead of accepting terms at face value — that's a strong negotiation habit.",
    when: (s) => s.askedClarifyingQuestion,
  },
  {
    id: 'substantive_responses',
    priority: 7,
    text: 'Your answers had real depth, giving you room to justify your position and build your case.',
    when: (s) => s.avgAnswerWords >= 25,
  },
  {
    id: 'strong_single_answer',
    priority: 6,
    text: 'At least one answer was substantial — that gives you a clear anchor to expand on in the next round.',
    when: (s) => s.maxAnswerWords >= 22,
  },
  {
    id: 'comp_focus_vocab',
    priority: 6,
    text: 'You kept language tied to the offer and compensation levers, which stays on-scenario for salary practice.',
    when: (s) => s.hasSalaryTopic,
  },
  {
    id: 'answered_every_turn',
    priority: 6,
    text: 'You responded on every question — showing up with words (even brief ones) beats freezing in a real negotiation.',
    when: (s) => s.turnCount > 0 && !s.anyEmpty,
  },
  {
    id: 'multi_turn_stamina',
    priority: 5,
    text: 'You stayed engaged across multiple back-and-forth turns, which mirrors how real negotiations unfold.',
    when: (s) => s.turnCount >= 2,
  },
  {
    id: 'moderate_composure',
    priority: 4,
    text: 'Your overall delivery stayed in a workable composure range — a solid base to refine under tougher pushback.',
    when: (s) => s.avgComposure >= 0.48 && s.turnCount >= 1,
  },
  {
    id: 'used_any_numbers',
    priority: 4,
    text: 'You brought numbers into the conversation, which helps move from vague intent to a concrete discussion.',
    when: (s) => s.hasNumbers && s.avgAnswerWords >= 10,
  },
  {
    id: 'completed_practice',
    priority: 2,
    text: 'You completed a live practice round — repetition here builds the reflexes you will use in the real conversation.',
    when: (s) => s.turnCount >= 1,
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
    priority: 8,
    text: 'Try stating a concrete number or range next time — vague asks are easier for the other side to deflect.',
    when: (s) => !s.hasNumbers && s.answeredTurnCount >= 1,
  },
  {
    id: 'composure_dip',
    priority: 8,
    text: 'Your composure dropped noticeably on at least one turn — practice pausing and breathing before responding to tough pushback.',
    when: (s) => s.minComposure < 0.5,
  },
  {
    id: 'no_anchor',
    priority: 7,
    text: 'Anchor your ask to market data, role scope, or impact — external justification is harder to brush off than preference alone.',
    when: (s) => !s.hasAnchorLanguage && s.answeredTurnCount >= 1,
  },
  {
    id: 'too_brief',
    priority: 7,
    text: "Some of your responses were very short — a brief answer can signal you haven't thought through your position.",
    when: (s) => s.anyVeryBrief,
  },
  {
    id: 'thin_on_average',
    priority: 6,
    text: 'Aim for a bit more length on key turns — state your point, then one reason or example.',
    when: (s) => s.answeredTurnCount >= 1 && s.avgAnswerWords < 28,
  },
  {
    id: 'no_tradeoffs_offered',
    priority: 6,
    text: 'Consider proposing alternatives or tradeoffs (equity vs. base, start date vs. sign-on) to unlock value beyond one number.',
    when: (s) => !s.hasTradeoffLanguage && s.turnCount >= 2,
  },
  {
    id: 'no_clarifying_questions',
    priority: 5,
    text: 'When terms are vague, ask what band or level they are using — it buys time and surfaces useful information.',
    when: (s) => !s.askedClarifyingQuestion && s.turnCount >= 2,
  },
  {
    id: 'light_comp_vocab',
    priority: 5,
    text: 'Name compensation levers explicitly (base, bonus, equity, benefits) so your practice maps to a real offer conversation.',
    when: (s) => !s.hasSalaryTopic && s.answeredTurnCount >= 1,
  },
  {
    id: 'composure_mid_band',
    priority: 4,
    text: 'When you feel rushed, slow your first sentence — composure on turn one sets the tone for the rest of the talk.',
    when: (s) => s.avgComposure < 0.65 && s.avgComposure >= 0.35,
  },
  {
    id: 'single_turn_only',
    priority: 3,
    text: 'Run a longer session next time — negotiation skill shows up most after the second or third counter.',
    when: (s) => s.turnCount === 1,
  },
  {
    id: 'general_next_step',
    priority: 1,
    text: 'Pick one focus for the next run: a clear range, one trade, or steadier pacing on the hardest question.',
    when: (s) => s.turnCount >= 1,
  },
]

export function pickFromCatalog(
  catalog: FeedbackCatalogEntry[],
  signals: TranscriptSignals,
  cap = REPORT_FEEDBACK_CAP,
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

export function pickTranscriptStrengths(turns: SessionTurn[], cap = REPORT_FEEDBACK_CAP): string[] {
  if (turns.length === 0) {
    return ['Complete a full answer loop in the studio to collect feedback.']
  }
  return pickFromCatalog(STRENGTH_CATALOG, analyzeTranscript(turns), cap)
}

export function pickTranscriptImprovements(turns: SessionTurn[], cap = REPORT_FEEDBACK_CAP): string[] {
  if (turns.length === 0) {
    return ['Finish more turns to unlock tailored improvement tips.']
  }
  return pickFromCatalog(IMPROVEMENT_CATALOG, analyzeTranscript(turns), cap)
}
