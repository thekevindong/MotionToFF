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
  const interimRef = useRef('')
  const wantActiveRef = useRef(false)

  const reset = useCallback(() => {
    transcriptRef.current = ''
    interimRef.current = ''
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

  const getLiveCaption = useCallback(() => {
    const final = transcriptRef.current.trim()
    const interim = interimRef.current.trim()
    if (!interim) return final
    return final ? `${final} ${interim}` : interim
  }, [])

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
      let finalChunk = ''
      let interimChunk = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalChunk += text
        } else {
          interimChunk += text
        }
      }
      if (finalChunk) {
        transcriptRef.current = `${transcriptRef.current} ${finalChunk}`.trim()
      }
      interimRef.current = interimChunk.trim()
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

  return { getTranscript, getLiveCaption, reset, stop }
}
