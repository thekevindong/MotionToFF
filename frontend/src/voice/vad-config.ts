/** RMS voice-activity detection — tune in QA for room noise. */
export const VAD_CONFIG = {
  /** dBFS floor; speech when RMS exceeds calibrated noise + margin. */
  speakThresholdDb: -45 as number,
  /** ms of sub-threshold audio after speech to finalize utterance. */
  silenceHangoverMs: 1050,
  /** ignore bursts shorter than this. */
  minSpeechMs: 400,
  /** force finalize even if still talking. */
  maxUtteranceMs: 120_000,
  /** noise floor calibration duration on listen arm. */
  noiseCalibrateMs: 300,
  /** dB above calibrated noise floor to count as speech. */
  noiseMarginDb: 12,
  /** sustained speech while AI is audible before barge-in. */
  bargeInMinMs: 250,
  /** analyser poll interval. */
  tickMs: 50,
  fftSize: 2048,
  smoothingTimeConstant: 0.85,
} as const

export type VadMode = 'utterance' | 'barge-in'
