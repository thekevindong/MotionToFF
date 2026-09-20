import { VAD_CONFIG } from './vad-config'

export type VadPhase = 'idle' | 'speech' | 'hangover'

export type VadTickInput = {
  rmsDb: number
  thresholdDb: number
  nowMs: number
  phase: VadPhase
  speechStartedAtMs: number | null
  hangoverStartedAtMs: number | null
  mode: 'utterance' | 'barge-in'
}

export type VadTickResult = {
  phase: VadPhase
  speechStartedAtMs: number | null
  hangoverStartedAtMs: number | null
  speechStart: boolean
  speechEnd: boolean
  bargeIn: boolean
  hadMinSpeech: boolean
}

function isAboveThreshold(rmsDb: number, thresholdDb: number) {
  return rmsDb >= thresholdDb
}

/** Pure hangover state machine — unit-testable without Web Audio. */
export function vadTick(input: VadTickInput): VadTickResult {
  const { rmsDb, thresholdDb, nowMs, mode } = input
  let { phase, speechStartedAtMs, hangoverStartedAtMs } = input
  const loud = isAboveThreshold(rmsDb, thresholdDb)

  let speechStart = false
  let speechEnd = false
  let bargeIn = false
  let hadMinSpeech = false

  if (mode === 'barge-in') {
    if (loud) {
      if (speechStartedAtMs === null) speechStartedAtMs = nowMs
      const dur = nowMs - speechStartedAtMs
      if (dur >= VAD_CONFIG.bargeInMinMs) {
        bargeIn = true
        speechStartedAtMs = null
      }
    } else {
      speechStartedAtMs = null
    }
    return {
      phase: 'idle',
      speechStartedAtMs,
      hangoverStartedAtMs: null,
      speechStart: false,
      speechEnd: false,
      bargeIn,
      hadMinSpeech: false,
    }
  }

  if (phase === 'idle') {
    if (loud) {
      phase = 'speech'
      speechStartedAtMs = nowMs
      hangoverStartedAtMs = null
      speechStart = true
    }
  } else if (phase === 'speech') {
    if (!loud) {
      phase = 'hangover'
      hangoverStartedAtMs = nowMs
    } else if (
      speechStartedAtMs !== null &&
      nowMs - speechStartedAtMs >= VAD_CONFIG.maxUtteranceMs
    ) {
      hadMinSpeech = true
      speechEnd = true
      phase = 'idle'
      speechStartedAtMs = null
      hangoverStartedAtMs = null
    }
  } else if (phase === 'hangover') {
    if (loud) {
      phase = 'speech'
      hangoverStartedAtMs = null
    } else if (
      hangoverStartedAtMs !== null &&
      nowMs - hangoverStartedAtMs >= VAD_CONFIG.silenceHangoverMs
    ) {
      const speechMs =
        speechStartedAtMs !== null && hangoverStartedAtMs !== null
          ? hangoverStartedAtMs - speechStartedAtMs
          : 0
      hadMinSpeech = speechMs >= VAD_CONFIG.minSpeechMs
      if (hadMinSpeech) speechEnd = true
      phase = 'idle'
      speechStartedAtMs = null
      hangoverStartedAtMs = null
    }
  }

  return {
    phase,
    speechStartedAtMs,
    hangoverStartedAtMs,
    speechStart,
    speechEnd,
    bargeIn: false,
    hadMinSpeech,
  }
}

export function rmsToDb(rms: number) {
  if (rms <= 1e-8) return -100
  return 20 * Math.log10(rms)
}

export function computeRms(timeDomain: Float32Array) {
  let sum = 0
  for (let i = 0; i < timeDomain.length; i++) {
    const v = timeDomain[i]
    sum += v * v
  }
  return Math.sqrt(sum / timeDomain.length)
}
