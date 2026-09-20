/** Mirrors backend/director.py _local_decide — instant sprite pacing before /turn returns. */

const DEFAULT_ACTION = 'follow_up'

function answerDepth(answer: string) {
  const words = answer.trim() ? answer.trim().split(/\s+/).length : 0
  return {
    answer_words: words,
    answer_substantive: words >= 22,
    answer_very_brief: words < 10 && Boolean(answer.trim()),
  }
}

export function localDirectorAction(composure: number, answer: string, turnPairs: number): string {
  const comp = Math.max(0, Math.min(1, composure))
  const signals = answerDepth(answer)

  if (comp < 0.28 || (comp < 0.38 && signals.answer_very_brief)) return 'ease_off'
  if (comp < 0.42) return 'follow_up'
  if (comp > 0.86 && signals.answer_substantive && turnPairs >= 2) return 'press_harder'
  if (comp > 0.82 && turnPairs >= 4 && signals.answer_substantive) return 'curveball'
  if (signals.answer_very_brief && comp < 0.55) return 'follow_up'
  return DEFAULT_ACTION
}
