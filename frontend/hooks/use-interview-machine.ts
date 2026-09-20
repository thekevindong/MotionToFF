"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { TurnState } from "@/lib/contracts"

/**
 * The turn state machine. Its one hard invariant: exactly one audio direction
 * is active at a time.
 *
 *   ASKING     -> TTS playing, mic closed
 *   LISTENING  -> MediaRecorder capturing, TTS stopped
 *   THINKING   -> neither (both model calls running)
 *
 * Webcam + Presage keep running across all states (owned elsewhere). Every
 * transition tears down the previous audio direction before starting the next,
 * so out/in can never overlap.
 *
 * TTS calls the ElevenLabs route (`/api/tts`) and plays the returned audio,
 * falling back to browser speechSynthesis if that fails. The recorded answer
 * blob is handed back to the caller, which transcribes it via `/api/stt`.
 */

interface MachineArgs {
  stream: MediaStream | null
  onAnswerRecorded?: (blob: Blob) => void
}

export function useInterviewMachine({ stream, onAnswerRecorded }: MachineArgs) {
  const [state, setState] = useState<TurnState>("IDLE")
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const speakTokenRef = useRef(0)
  const onAnswerRef = useRef(onAnswerRecorded)
  onAnswerRef.current = onAnswerRecorded

  // --- Audio OUT (TTS) ------------------------------------------------------
  const stopPlaybackOnly = useCallback(() => {
    if (typeof window === "undefined") return
    window.speechSynthesis?.cancel()
    utteranceRef.current = null
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      if (audio.src) URL.revokeObjectURL(audio.src)
      audio.removeAttribute("src")
      audioRef.current = null
    }
  }, [])

  const stopSpeaking = useCallback(() => {
    stopPlaybackOnly()
    // Invalidate any in-flight speak() so a late-arriving fetch can't start playing.
    speakTokenRef.current += 1
  }, [stopPlaybackOnly])

  // --- Audio IN (MediaRecorder) --------------------------------------------
  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      recorder.stop() // fires onstop -> hands back the blob
    }
    recorderRef.current = null
  }, [])

  const startRecording = useCallback(() => {
    if (!stream) {
      console.log("[v0] cannot record: no media stream")
      return
    }
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) {
      console.log("[v0] cannot record: no audio track")
      return
    }
    const audioStream = new MediaStream(audioTracks)
    chunksRef.current = []
    const recorder = new MediaRecorder(audioStream)
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
      console.log("[v0] answer recorded", blob.size, "bytes")
      onAnswerRef.current?.(blob)
    }
    recorder.start()
    recorderRef.current = recorder
    console.log("[v0] recording started")
  }, [stream])

  const speakWithBrowser = useCallback((text: string, onDone?: () => void) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      onDone?.()
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    utterance.onend = () => onDone?.()
    utteranceRef.current = utterance
    window.speechSynthesis.speak(utterance)
    console.log("[v0] speaking (browser):", text)
  }, [])

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      stopPlaybackOnly()
      const token = ++speakTokenRef.current
      console.log("[v0] speaking (elevenlabs):", text)
      fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`tts ${res.status}`)
          const buf = await res.arrayBuffer()
          // A newer speak() or a teardown happened while we were fetching — abort.
          if (token !== speakTokenRef.current) return
          const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }))
          const audio = new Audio(url)
          audioRef.current = audio
          audio.onended = () => {
            URL.revokeObjectURL(url)
            if (audioRef.current === audio) audioRef.current = null
            if (token === speakTokenRef.current) onDone?.()
          }
          try {
            await audio.play()
          } catch (playErr) {
            if (token !== speakTokenRef.current) return
            console.log("[v0] audio.play failed, falling back to browser:", String(playErr))
            stopPlaybackOnly()
            speakWithBrowser(text, onDone)
          }
        })
        .catch((err) => {
          if (token !== speakTokenRef.current) return
          console.log("[v0] tts failed, falling back to browser:", String(err))
          speakWithBrowser(text, onDone)
        })
    },
    [speakWithBrowser, stopPlaybackOnly],
  )

  // --- Transitions: tear down the old direction, start the new one ----------
  const ask = useCallback(
    (question: string) => {
      stopRecording()
      stopSpeaking()
      setState("ASKING")
      speak(question, () => {
        // Auto-advance to LISTENING when the interviewer finishes speaking.
        setState((s) => (s === "ASKING" ? "LISTENING" : s))
      })
    },
    [speak, stopRecording, stopSpeaking],
  )

  const listen = useCallback(() => {
    stopSpeaking()
    setState("LISTENING")
    startRecording()
  }, [startRecording, stopSpeaking])

  const think = useCallback(() => {
    stopSpeaking()
    stopRecording()
    setState("THINKING")
  }, [stopRecording, stopSpeaking])

  const finish = useCallback(() => {
    stopSpeaking()
    stopRecording()
    setState("REPORT")
  }, [stopRecording, stopSpeaking])

  const reset = useCallback(() => {
    stopSpeaking()
    stopRecording()
    setState("IDLE")
  }, [stopRecording, stopSpeaking])

  // When entering LISTENING, ensure the recorder is running (covers the
  // auto-advance path from ASKING's onend).
  useEffect(() => {
    if (state === "LISTENING" && !recorderRef.current) {
      startRecording()
    }
  }, [state, startRecording])

  useEffect(() => {
    return () => {
      stopSpeaking()
      stopRecording()
    }
  }, [stopSpeaking, stopRecording])

  return { state, ask, listen, think, finish, reset }
}
