import { useEffect, useRef } from 'react'
import { VAD_CONFIG } from '../voice/vad-config'
import { computeRms, rmsToDb, vadTick, type VadPhase } from '../voice/vad'

export type VoiceActivityCallbacks = {
  onSpeechStart?: () => void
  onSpeechEnd?: (hadMinSpeech: boolean) => void
  onBargeIn?: () => void
}

/**
 * Lightweight RMS VAD on an existing mic MediaStream.
 */
export function useVoiceActivity(
  stream: MediaStream | null,
  enabled: boolean,
  mode: 'utterance' | 'barge-in',
  callbacks: VoiceActivityCallbacks,
  /** Re-bind when mic hardware mute toggles (tracks may enable after `enabled` flips). */
  micGate = true,
) {
  const cbRef = useRef(callbacks)
  cbRef.current = callbacks
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    if (!enabled || !stream) return

    const audioTracks = stream.getAudioTracks().filter((t) => t.enabled)
    if (audioTracks.length === 0) return

    const audioCtx = new AudioContext()
    void audioCtx.resume()
    const source = audioCtx.createMediaStreamSource(new MediaStream(audioTracks))
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = VAD_CONFIG.fftSize
    analyser.smoothingTimeConstant = VAD_CONFIG.smoothingTimeConstant
    source.connect(analyser)

    const buf = new Float32Array(analyser.fftSize)
    let phase: VadPhase = 'idle'
    let speechStartedAtMs: number | null = null
    let hangoverStartedAtMs: number | null = null
    let noiseFloorDb = VAD_CONFIG.speakThresholdDb
    let calibrateUntil =
      modeRef.current === 'barge-in'
        ? performance.now()
        : performance.now() + VAD_CONFIG.noiseCalibrateMs
    let thresholdDb = noiseFloorDb + VAD_CONFIG.noiseMarginDb

    const id = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf)
      const rmsDb = rmsToDb(computeRms(buf))
      const nowMs = performance.now()

      if (nowMs < calibrateUntil) {
        noiseFloorDb = Math.min(noiseFloorDb, rmsDb)
        thresholdDb = Math.max(
          VAD_CONFIG.speakThresholdDb,
          noiseFloorDb + VAD_CONFIG.noiseMarginDb,
        )
        return
      }

      const result = vadTick({
        rmsDb,
        thresholdDb,
        nowMs,
        phase,
        speechStartedAtMs,
        hangoverStartedAtMs,
        mode: modeRef.current,
      })
      phase = result.phase
      speechStartedAtMs = result.speechStartedAtMs
      hangoverStartedAtMs = result.hangoverStartedAtMs

      if (result.speechStart) cbRef.current.onSpeechStart?.()
      if (result.speechEnd) cbRef.current.onSpeechEnd?.(result.hadMinSpeech)
      if (result.bargeIn) cbRef.current.onBargeIn?.()
    }, VAD_CONFIG.tickMs)

    return () => {
      window.clearInterval(id)
      source.disconnect()
      void audioCtx.close()
    }
  }, [enabled, stream, micGate])
}
