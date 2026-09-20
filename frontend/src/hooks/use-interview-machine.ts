import { useCallback, useEffect, useRef, useState } from 'react'

import type { TurnState } from '../lib/contracts'

import { synthesizeSpeech } from '../voice/stt'



export type SpeakingPhase = 'idle' | 'loading' | 'audible'



/**

 * Turn state machine — exactly one audio direction active at a time.

 */

interface MachineArgs {

  stream: MediaStream | null

  micEnabled: boolean

  recordAnswers?: boolean

  onAnswerRecorded?: (blob: Blob) => void

}



export function useInterviewMachine({

  stream,

  micEnabled,

  recordAnswers = true,

  onAnswerRecorded,

}: MachineArgs) {

  const [state, setState] = useState<TurnState>('IDLE')

  const [speakingPhase, setSpeakingPhase] = useState<SpeakingPhase>('idle')

  const recorderRef = useRef<MediaRecorder | null>(null)

  const chunksRef = useRef<Blob[]>([])

  const preRollChunksRef = useRef<Blob[]>([])

  const preRollRecorderRef = useRef<MediaRecorder | null>(null)

  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)

  const audioRef = useRef<HTMLAudioElement | null>(null)

  const speakTokenRef = useRef(0)

  /** Correlate MediaRecorder.onstop with an intentional finalizeUserTurn (ignore stray stops). */
  const utteranceCaptureIdRef = useRef(0)
  const finalizeCaptureIdRef = useRef<number | null>(null)

  const onAnswerRef = useRef(onAnswerRecorded)

  onAnswerRef.current = onAnswerRecorded

  const micEnabledRef = useRef(micEnabled)

  micEnabledRef.current = micEnabled

  const recordAnswersRef = useRef(recordAnswers)

  recordAnswersRef.current = recordAnswers



  const stopPlaybackOnly = useCallback(() => {

    if (typeof window === 'undefined') return

    window.speechSynthesis?.cancel()

    utteranceRef.current = null

    const audio = audioRef.current

    if (audio) {

      audio.pause()

      if (audio.src) URL.revokeObjectURL(audio.src)

      audio.removeAttribute('src')

      audioRef.current = null

    }

  }, [])



  const stopSpeaking = useCallback(() => {

    const audio = audioRef.current

    if (audio && !audio.paused) {

      audio.volume = 0.2

      window.setTimeout(() => {

        stopPlaybackOnly()

      }, 150)

    } else {

      stopPlaybackOnly()

    }

    speakTokenRef.current += 1

    setSpeakingPhase('idle')

  }, [stopPlaybackOnly])



  const stopPreRoll = useCallback(() => {

    const rec = preRollRecorderRef.current

    if (rec && rec.state !== 'inactive') rec.stop()

    preRollRecorderRef.current = null

    preRollChunksRef.current = []

  }, [])



  const stopRecording = useCallback(() => {

    const recorder = recorderRef.current

    if (recorder && recorder.state !== 'inactive') {

      recorder.stop()

    }

    recorderRef.current = null

  }, [])



  const startPreRollCapture = useCallback(() => {

    if (!recordAnswersRef.current) return

    if (!stream || !micEnabledRef.current) return

    if (preRollRecorderRef.current) return

    if (recorderRef.current && recorderRef.current.state !== 'inactive') return

    const audioTracks = stream.getAudioTracks().filter((t) => t.enabled)

    if (audioTracks.length === 0) return

    const audioStream = new MediaStream(audioTracks)

    preRollChunksRef.current = []

    const recorder = new MediaRecorder(audioStream)

    recorder.ondataavailable = (e) => {

      if (e.data.size > 0) {

        preRollChunksRef.current.push(e.data)

        if (preRollChunksRef.current.length > 6) {

          preRollChunksRef.current.shift()

        }

      }

    }

    try {

      recorder.start(50)

      preRollRecorderRef.current = recorder

    } catch {

      preRollRecorderRef.current = null

    }

  }, [stream])



  const startUtteranceRecording = useCallback(() => {

    if (!recordAnswersRef.current) return

    if (!stream || !micEnabledRef.current) return

    if (recorderRef.current) return

    const audioTracks = stream.getAudioTracks().filter((t) => t.enabled)

    if (audioTracks.length === 0) return

    const audioStream = new MediaStream(audioTracks)

    chunksRef.current = [...preRollChunksRef.current]

    stopPreRoll()

    utteranceCaptureIdRef.current += 1
    const captureId = utteranceCaptureIdRef.current

    const recorder = new MediaRecorder(audioStream)

    recorder.ondataavailable = (e) => {

      if (e.data.size > 0) chunksRef.current.push(e.data)

    }

    recorder.onstop = () => {

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })

      chunksRef.current = []

      const expected = finalizeCaptureIdRef.current
      if (expected !== captureId) return

      finalizeCaptureIdRef.current = null

      onAnswerRef.current?.(blob)

    }

    try {
      recorder.start()
      recorderRef.current = recorder
    } catch {
      recorderRef.current = null
    }

  }, [stream, stopPreRoll])



  const markAudible = useCallback((token: number) => {

    if (token === speakTokenRef.current) setSpeakingPhase('audible')

  }, [])



  const speakWithBrowser = useCallback(

    (text: string, token: number, onDone?: () => void) => {

      if (typeof window === 'undefined' || !window.speechSynthesis) {

        onDone?.()

        return

      }

      window.speechSynthesis.cancel()

      const utterance = new SpeechSynthesisUtterance(text)

      utterance.rate = 1

      utterance.onstart = () => markAudible(token)

      utterance.onend = () => onDone?.()

      utteranceRef.current = utterance

      window.speechSynthesis.speak(utterance)

    },

    [markAudible],

  )



  const speak = useCallback(

    (text: string, onDone?: () => void) => {

      stopPlaybackOnly()

      const token = ++speakTokenRef.current

      setSpeakingPhase('loading')

      synthesizeSpeech(text)

        .then(async (buf: ArrayBuffer) => {

          if (token !== speakTokenRef.current) return

          const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))

          const audio = new Audio(url)

          audioRef.current = audio

          audio.onplaying = () => markAudible(token)

          audio.onended = () => {

            URL.revokeObjectURL(url)

            if (audioRef.current === audio) audioRef.current = null

            if (token === speakTokenRef.current) {

              setSpeakingPhase('idle')

              onDone?.()

            }

          }

          try {

            await audio.play()

          } catch {

            if (token !== speakTokenRef.current) return

            stopPlaybackOnly()

            speakWithBrowser(text, token, () => {

              if (token === speakTokenRef.current) {

                setSpeakingPhase('idle')

                onDone?.()

              }

            })

          }

        })

        .catch(() => {

          if (token !== speakTokenRef.current) return

          speakWithBrowser(text, token, () => {

            if (token === speakTokenRef.current) {

              setSpeakingPhase('idle')

              onDone?.()

            }

          })

        })

    },

    [markAudible, speakWithBrowser, stopPlaybackOnly],

  )

  /** Short overlay line (e.g. composure interjection) — does not stop answer capture or change turn state. */
  const speakInterjection = useCallback(
    (text: string, onDone?: () => void) => {
      speak(text, onDone)
    },
    [speak],
  )



  const ask = useCallback(

    (question: string, options?: { onSpoken?: () => void }) => {

      stopRecording()

      stopPreRoll()

      stopSpeaking()

      setState('ASKING')

      setSpeakingPhase('loading')

      speak(question, () => {

        setState((s) => (s === 'ASKING' ? 'LISTENING' : s))

        options?.onSpoken?.()

      })

    },

    [speak, stopPreRoll, stopRecording, stopSpeaking],

  )



  const armListenMode = useCallback(() => {

    finalizeCaptureIdRef.current = null

    stopSpeaking()

    stopRecording()

    stopPreRoll()

    setState('LISTENING')

    startPreRollCapture()

  }, [startPreRollCapture, stopPreRoll, stopRecording, stopSpeaking])



  const listen = useCallback(() => {

    armListenMode()

  }, [armListenMode])



  const finalizeUserTurn = useCallback((): boolean => {

    const hadUtteranceRecording =
      !!recorderRef.current && recorderRef.current.state !== 'inactive'

    if (hadUtteranceRecording) {
      finalizeCaptureIdRef.current = utteranceCaptureIdRef.current
    }

    stopSpeaking()

    stopPreRoll()

    stopRecording()

    setState('THINKING')

    return hadUtteranceRecording

  }, [stopPreRoll, stopRecording, stopSpeaking])



  const think = useCallback(() => {

    finalizeUserTurn()

  }, [finalizeUserTurn])



  const finish = useCallback(() => {

    stopSpeaking()

    stopRecording()

    stopPreRoll()

    setState('REPORT')

  }, [stopPreRoll, stopRecording, stopSpeaking])



  const reset = useCallback(() => {

    stopSpeaking()

    stopRecording()

    stopPreRoll()

    setState('IDLE')

  }, [stopPreRoll, stopRecording, stopSpeaking])



  useEffect(() => {

    if (state === 'LISTENING' && recordAnswersRef.current && micEnabled) {

      startPreRollCapture()

    } else if (state !== 'LISTENING') {

      stopPreRoll()

    }

  }, [micEnabled, state, startPreRollCapture, stopPreRoll])



  useEffect(() => {

    if (state === 'LISTENING' && !micEnabled) {

      stopRecording()

      stopPreRoll()

    }

  }, [micEnabled, state, stopPreRoll, stopRecording])



  useEffect(() => {

    return () => {

      stopSpeaking()

      stopRecording()

      stopPreRoll()

    }

  }, [stopPreRoll, stopSpeaking, stopRecording])



  return {

    state,

    speakingPhase,

    ask,

    listen,

    armListenMode,

    startUtteranceRecording,

    finalizeUserTurn,

    think,

    finish,

    reset,

    stopSpeaking,

    speakInterjection,

  }

}


