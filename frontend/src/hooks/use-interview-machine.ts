import { useCallback, useEffect, useRef, useState } from 'react'
import type { TurnState } from '../lib/contracts'
import { synthesizeSpeech } from '../voice/stt'

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
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakTokenRef = useRef(0)
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
    stopPlaybackOnly()
    speakTokenRef.current += 1
  }, [stopPlaybackOnly])

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
    recorderRef.current = null
  }, [])

  const startRecording = useCallback(() => {
    if (!recordAnswersRef.current) return
    if (!stream || !micEnabledRef.current) return
    const audioTracks = stream.getAudioTracks().filter((t) => t.enabled)
    if (audioTracks.length === 0) return
    const audioStream = new MediaStream(audioTracks)
    chunksRef.current = []
    const recorder = new MediaRecorder(audioStream)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
      onAnswerRef.current?.(blob)
    }
    recorder.start()
    recorderRef.current = recorder
  }, [stream])

  const speakWithBrowser = useCallback((text: string, onDone?: () => void) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      onDone?.()
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.onend = () => onDone?.()
    utteranceRef.current = utterance
    window.speechSynthesis.speak(utterance)
  }, [])

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      stopPlaybackOnly()
      const token = ++speakTokenRef.current
      synthesizeSpeech(text)
        .then(async (buf: ArrayBuffer) => {
          if (token !== speakTokenRef.current) return
          const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }))
          const audio = new Audio(url)
          audioRef.current = audio
          audio.onended = () => {
            URL.revokeObjectURL(url)
            if (audioRef.current === audio) audioRef.current = null
            if (token === speakTokenRef.current) onDone?.()
          }
          try {
            await audio.play()
          } catch {
            if (token !== speakTokenRef.current) return
            stopPlaybackOnly()
            speakWithBrowser(text, onDone)
          }
        })
        .catch(() => {
          if (token !== speakTokenRef.current) return
          speakWithBrowser(text, onDone)
        })
    },
    [speakWithBrowser, stopPlaybackOnly],
  )

  const ask = useCallback(
    (question: string) => {
      stopRecording()
      stopSpeaking()
      setState('ASKING')
      speak(question, () => {
        setState((s) => (s === 'ASKING' ? 'LISTENING' : s))
      })
    },
    [speak, stopRecording, stopSpeaking],
  )

  const listen = useCallback(() => {
    stopSpeaking()
    setState('LISTENING')
    startRecording()
  }, [startRecording, stopSpeaking])

  const think = useCallback(() => {
    stopSpeaking()
    stopRecording()
    setState('THINKING')
  }, [stopRecording, stopSpeaking])

  const finish = useCallback(() => {
    stopSpeaking()
    stopRecording()
    setState('REPORT')
  }, [stopRecording, stopSpeaking])

  const reset = useCallback(() => {
    stopSpeaking()
    stopRecording()
    setState('IDLE')
  }, [stopRecording, stopSpeaking])

  useEffect(() => {
    if (state === 'LISTENING' && !recorderRef.current) {
      startRecording()
    }
  }, [state, startRecording])

  useEffect(() => {
    if (state === 'LISTENING' && !micEnabled) {
      stopRecording()
    } else if (state === 'LISTENING' && micEnabled && !recorderRef.current) {
      startRecording()
    }
  }, [micEnabled, state, startRecording, stopRecording])

  useEffect(() => {
    return () => {
      stopSpeaking()
      stopRecording()
    }
  }, [stopSpeaking, stopRecording])

  return { state, ask, listen, think, finish, reset }
}
