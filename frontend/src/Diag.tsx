import { useCallback, useEffect, useRef, useState } from 'react'
import './Diag.css'
import {
  type BrowserSpeechRecognition,
  type SpeechRecognitionErrorEvent,
  type SpeechRecognitionEvent,
  getSpeechRecognition,
} from './speechRecognition'

const SAMPLE_INTERVIEWER_LINE =
  'Tell me about a time you had to deliver difficult feedback to a teammate.'

const MAX_LOG_LINES = 40

function timestamp() {
  return new Date().toLocaleTimeString()
}

export default function Diag() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const wantListeningRef = useRef(true)
  const pauseRecognitionDuringTtsRef = useRef(true)
  const recognitionPausedForTtsRef = useRef(false)

  const [cameraStatus, setCameraStatus] = useState<
    'pending' | 'live' | 'error'
  >('pending')
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [recognitionSupported, setRecognitionSupported] = useState(true)
  const [listening, setListening] = useState(false)
  const [recognitionPausedForTts, setRecognitionPausedForTts] = useState(false)
  const [finalTranscript, setFinalTranscript] = useState('')
  const [interimTranscript, setInterimTranscript] = useState('')
  const [ttsStatus, setTtsStatus] = useState<'idle' | 'speaking'>('idle')
  const [pauseRecognitionDuringTts, setPauseRecognitionDuringTts] =
    useState(true)
  const [logLines, setLogLines] = useState<string[]>([])

  const appendLog = useCallback((line: string) => {
    setLogLines((prev) => {
      const next = [...prev, `[${timestamp()}] ${line}`]
      return next.slice(-MAX_LOG_LINES)
    })
  }, [])

  pauseRecognitionDuringTtsRef.current = pauseRecognitionDuringTts

  const stopRecognition = useCallback(() => {
    const rec = recognitionRef.current
    if (rec) {
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
    }
    setListening(false)
  }, [])

  const startRecognition = useCallback(() => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      setRecognitionSupported(false)
      return
    }

    stopRecognition()

    const rec = new Ctor()
    recognitionRef.current = rec
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.maxAlternatives = 1

    rec.onstart = () => {
      setListening(true)
      appendLog('Speech recognition started')
    }

    rec.onresult = (ev: SpeechRecognitionEvent) => {
      let interim = ''
      let finalChunk = ''
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i]
        const text = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalChunk += text
        } else {
          interim += text
        }
      }
      if (finalChunk) {
        setFinalTranscript((prev) => `${prev}${finalChunk}`.trim() + ' ')
        setInterimTranscript('')
        appendLog(`Final: "${finalChunk.trim()}"`)
      } else {
        setInterimTranscript(interim)
      }
    }

    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (ev.error === 'aborted') {
        return
      }
      appendLog(`Recognition error: ${ev.error}${ev.message ? ` — ${ev.message}` : ''}`)
      if (ev.error === 'not-allowed') {
        setRecognitionSupported(false)
      }
    }

    rec.onend = () => {
      setListening(false)
      // Chrome stops continuous recognition periodically; restart if we still want audio.
      if (wantListeningRef.current && !recognitionPausedForTtsRef.current) {
        try {
          rec.start()
        } catch {
          appendLog('Recognition restart failed (may already be starting)')
        }
      }
    }

    try {
      rec.start()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'start failed'
      appendLog(`Could not start recognition: ${message}`)
    }
  }, [appendLog, stopRecognition])

  useEffect(() => {
    let cancelled = false

    async function openCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStatus('error')
        setCameraError('getUserMedia is not available in this browser.')
        return
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user' },
          audio: true,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        mediaStreamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
        }
        setCameraStatus('live')
        appendLog('Webcam + mic stream acquired')
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Permission or device error'
        setCameraStatus('error')
        setCameraError(message)
        appendLog(`Camera/mic error: ${message}`)
      }
    }

    void openCamera()

    const Ctor = getSpeechRecognition()
    if (!Ctor) {
      setRecognitionSupported(false)
      appendLog('Web Speech recognition API not found (try Chrome or Edge)')
    } else {
      wantListeningRef.current = true
      startRecognition()
    }

    return () => {
      cancelled = true
      wantListeningRef.current = false
      stopRecognition()
      recognitionRef.current = null
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop())
      mediaStreamRef.current = null
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel()
      }
    }
  }, [appendLog, startRecognition, stopRecognition])

  const resumeRecognitionAfterTts = useCallback(() => {
    recognitionPausedForTtsRef.current = false
    setRecognitionPausedForTts(false)
    if (wantListeningRef.current) {
      startRecognition()
      appendLog('Resumed recognition after TTS')
    }
  }, [appendLog, startRecognition])

  const playTts = useCallback(() => {
    if (!window.speechSynthesis) {
      appendLog('speechSynthesis not available')
      return
    }

    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(SAMPLE_INTERVIEWER_LINE)
    utterance.rate = 1
    utterance.pitch = 1

    utterance.onstart = () => {
      setTtsStatus('speaking')
      appendLog('TTS playback started')
      if (pauseRecognitionDuringTtsRef.current) {
        recognitionPausedForTtsRef.current = true
        setRecognitionPausedForTts(true)
        stopRecognition()
        appendLog('Paused recognition during TTS (checkbox on)')
      } else {
        appendLog('Recognition left running during TTS (checkbox off)')
      }
    }

    utterance.onend = () => {
      setTtsStatus('idle')
      appendLog('TTS playback ended')
      if (pauseRecognitionDuringTtsRef.current) {
        resumeRecognitionAfterTts()
      }
    }

    utterance.onerror = () => {
      setTtsStatus('idle')
      appendLog('TTS error or cancelled')
      if (pauseRecognitionDuringTtsRef.current) {
        resumeRecognitionAfterTts()
      }
    }

    window.speechSynthesis.speak(utterance)
  }, [appendLog, resumeRecognitionAfterTts, stopRecognition])

  const clearTranscript = useCallback(() => {
    setFinalTranscript('')
    setInterimTranscript('')
    appendLog('Transcript cleared')
  }, [appendLog])

  return (
    <main className="diag">
      <header className="diag-header">
        <h1>Media diagnostic</h1>
        <p>
          Step 4 check: webcam, live speech recognition, and interviewer TTS at
          the same time. Use Chrome or Edge. Toggle &quot;pause recognition during
          TTS&quot; to see whether playback breaks the mic.
        </p>
      </header>

      <p className="diag-nav">
        <a href="/">← Back to interview</a>
      </p>

      <div className="diag-status-row">
        <span
          className={`diag-pill ${
            cameraStatus === 'live'
              ? 'diag-pill--ok'
              : cameraStatus === 'error'
                ? 'diag-pill--err'
                : 'diag-pill--warn'
          }`}
        >
          Camera: {cameraStatus}
        </span>
        <span
          className={`diag-pill ${
            recognitionSupported && listening
              ? 'diag-pill--ok'
              : recognitionPausedForTts
                ? 'diag-pill--warn'
                : recognitionSupported
                  ? 'diag-pill--warn'
                  : 'diag-pill--err'
          }`}
        >
          Mic STT:{' '}
          {!recognitionSupported
            ? 'unsupported'
            : recognitionPausedForTts
              ? 'paused for TTS'
              : listening
                ? 'listening'
                : 'idle'}
        </span>
        <span
          className={`diag-pill ${
            ttsStatus === 'speaking' ? 'diag-pill--warn' : 'diag-pill--ok'
          }`}
        >
          TTS: {ttsStatus}
        </span>
      </div>

      <div className="diag-grid">
        <section className="diag-panel">
          <h2>Webcam</h2>
          <div className="diag-video-wrap">
            <video
              ref={videoRef}
              className="diag-video"
              playsInline
              muted
              autoPlay
            />
            {cameraStatus !== 'live' && (
              <div className="diag-video-placeholder">
                {cameraStatus === 'pending'
                  ? 'Requesting camera…'
                  : (cameraError ?? 'Camera unavailable')}
              </div>
            )}
          </div>
          {cameraError && cameraStatus === 'error' && (
            <p className="diag-error">{cameraError}</p>
          )}
        </section>

        <section className="diag-panel">
          <h2>Live transcript</h2>
          <p className="diag-transcript">
            {finalTranscript}
            {interimTranscript && (
              <span className="diag-transcript-interim">
                {finalTranscript ? ' ' : ''}
                {interimTranscript}
              </span>
            )}
            {!finalTranscript && !interimTranscript && (
              <span className="diag-transcript-interim">
                Speak after allowing mic access…
              </span>
            )}
          </p>
        </section>
      </div>

      <section className="diag-panel">
        <h2>TTS + recognition</h2>
        <div className="diag-controls">
          <button
            type="button"
            className="diag-btn"
            onClick={playTts}
            disabled={ttsStatus === 'speaking'}
          >
            Play interviewer line (TTS)
          </button>
          <button
            type="button"
            className="diag-btn diag-btn--secondary"
            onClick={clearTranscript}
          >
            Clear transcript
          </button>
          <label className="diag-checkbox">
            <input
              type="checkbox"
              checked={pauseRecognitionDuringTts}
              onChange={(e) => setPauseRecognitionDuringTts(e.target.checked)}
            />
            Pause recognition during TTS
          </label>
        </div>
        <p style={{ margin: '0.65rem 0 0', fontSize: '0.9rem', color: '#444' }}>
          Sample line: &ldquo;{SAMPLE_INTERVIEWER_LINE}&rdquo;
        </p>
      </section>

      <section className="diag-panel">
        <h2>Event log</h2>
        <ul className="diag-log">
          {logLines.length === 0 ? (
            <li>Waiting for events…</li>
          ) : (
            logLines.map((line, i) => <li key={`${i}-${line}`}>{line}</li>)
          )}
        </ul>
      </section>
    </main>
  )
}
