import { useCallback, useEffect, useRef, useState } from 'react'

export type MediaStatus = 'idle' | 'requesting' | 'ready' | 'denied' | 'error'

/**
 * Single webcam + mic stream for the studio session.
 * Audio direction (TTS vs capture) is owned by the interview machine.
 */
export function useMediaStream() {
  const [status, setStatus] = useState<MediaStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)

  const request = useCallback(async () => {
    if (streamRef.current) return streamRef.current
    setStatus('requesting')
    setError(null)
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      streamRef.current = media
      setStream(media)
      setStatus('ready')
      return media
    } catch (err) {
      const name = err instanceof DOMException ? err.name : 'Error'
      setStatus(name === 'NotAllowedError' ? 'denied' : 'error')
      setError(err instanceof Error ? err.message : 'Failed to access camera/mic')
      return null
    }
  }, [])

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    setStream(null)
    setStatus('idle')
  }, [])

  const setMicEnabled = useCallback((enabled: boolean) => {
    streamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = enabled
    })
  }, [])

  const setVideoEnabled = useCallback((enabled: boolean) => {
    streamRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = enabled
    })
  }, [])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  return { stream, status, error, request, stop, setMicEnabled, setVideoEnabled }
}
