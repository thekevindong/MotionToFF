"use client"

import { useCallback, useEffect, useRef, useState } from "react"

export type MediaStatus = "idle" | "requesting" | "ready" | "denied" | "error"

/**
 * Acquires a single webcam + mic stream that stays live for the whole session.
 * The webcam feed and Presage run across every turn state; only the *audio
 * direction* (TTS out vs. mic capture) changes per state, and that is handled
 * by the interview machine — not here.
 */
export function useMediaStream() {
  const [status, setStatus] = useState<MediaStatus>("idle")
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const request = useCallback(async () => {
    if (streamRef.current) return streamRef.current
    setStatus("requesting")
    setError(null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = media
      setStream(media)
      setStatus("ready")
      return media
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "Error"
      setStatus(name === "NotAllowedError" ? "denied" : "error")
      setError(err instanceof Error ? err.message : "Failed to access camera/mic")
      return null
    }
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
    setStatus("idle")
  }, [])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  return { stream, status, error, request, stop }
}
