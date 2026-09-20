import { useCallback, useEffect, useRef } from 'react'
import {
  type BrowserSpeechRecognition,
  type SpeechRecognitionErrorEvent,
  type SpeechRecognitionEvent,
  getSpeechRecognition,
} from '../speechRecognition'

/** Browser speech recognition fallback when ElevenLabs STT is unavailable. */
export function useBrowserSpeechCapture(active: boolean) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const transcriptRef = useRef('')
  const wantActiveRef = useRef(false)

  const reset = useCallback(() => {
    transcriptRef.current = ''
  }, [])

  const stop = useCallback(() => {
    wantActiveRef.current = false
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.abort()
      } catch {
        /* ignore */
      }
    }
    recognitionRef.current = null
  }, [])

  const getTranscript = useCallback(() => transcriptRef.current.trim(), [])

  useEffect(() => {
    wantActiveRef.current = active
    if (!active) {
      stop()
      return
    }

    const Ctor = getSpeechRecognition()
    if (!Ctor) return

    stop()
    wantActiveRef.current = true
    transcriptRef.current = ''

    const rec = new Ctor()
    recognitionRef.current = rec
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let chunk = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i]
        if (result.isFinal) {
          chunk += result[0]?.transcript ?? ''
        }
      }
      if (chunk) {
        transcriptRef.current = `${transcriptRef.current} ${chunk}`.trim()
      }
    }

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === 'aborted') return
    }

    rec.onend = () => {
      if (wantActiveRef.current && recognitionRef.current === rec) {
        try {
          rec.start()
        } catch {
          /* ignore */
        }
      }
    }

    try {
      rec.start()
    } catch {
      /* ignore */
    }

    return () => {
      wantActiveRef.current = false
      try {
        rec.abort()
      } catch {
        /* ignore */
      }
      if (recognitionRef.current === rec) recognitionRef.current = null
    }
  }, [active, stop])

  return { getTranscript, reset, stop }
}
