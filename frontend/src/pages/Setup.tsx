import { useCallback, useEffect, useRef, useState } from 'react'

import type { Navigate } from '../App'
import type { DeliveryMood, InterjectTrigger } from '../config/composure-thresholds'
import { interjectDevMode } from '../config/composure-thresholds'
import type { CharacterId } from '../config/character-expressions'
import type { ComposureSample, TurnState } from '../lib/contracts'
import { MODES, SALARY_CHARACTERS, type Character, type Mode } from '../config/modes'
import {
  DEFAULT_SESSION_DURATION_SEC,
  isAllowedSessionDuration,
} from '../config/session-duration'
import { useBrowserSpeechCapture } from '../hooks/use-browser-speech-capture'
import { useComposureReactions, useInterjectDevShortcut } from '../hooks/use-composure-reactions'
import { useComposureSampler } from '../hooks/use-composure-sampler'
import { stageOpponentSrc, useCharacterExpression } from '../hooks/use-character-expression'
import { useFaceComposure } from '../hooks/use-face-composure'
import { useInterviewMachine } from '../hooks/use-interview-machine'
import { useVoiceActivity } from '../hooks/use-voice-activity'
import { useMediaStream } from '../hooks/use-media-stream'
import { usePresageVitals } from '../hooks/use-presage-vitals'
import { presageStatusLabel, usePresageMetrics } from '../hooks/use-presage-metrics'
import { localDirectorAction } from '../lib/local-director'
import {
  createSession,
  getHealth,
  getSession,
  getVoiceStatus,
  getSessionReport,
  postSessionClose,
  postTurn,
  uploadDocument,
} from '../lib/api'
import {
  clearPrepComplete,
  isLiveStudioPath,
  isPrepCompleteInSession,
  markPrepComplete,
  readPrepDefaults,
  writePrepDefaults,
} from '../lib/prep-storage'
import { getStoredSessionId, setStoredSessionId } from '../lib/session-storage'
import { setSession } from '../session'
import { sttBackoffDelayMs, transcribeAudio } from '../voice/stt'
import { StudioLive } from './StudioLive'
import { StudioPrep } from './StudioPrep'
import './Setup.css'

const CONTEXT_FILE_EXT = new Set(['.pdf', '.docx', '.txt'])

function initialSessionDurationSec(): number {
  const fromDefaults = readPrepDefaults().sessionDurationSec
  if (fromDefaults && isAllowedSessionDuration(fromDefaults)) return fromDefaults
  return DEFAULT_SESSION_DURATION_SEC
}

function initialStudioPhase(): 'prep' | 'live' {
  if (typeof window === 'undefined') return 'prep'
  if (isLiveStudioPath(window.location.pathname) && isPrepCompleteInSession()) return 'live'
  return 'prep'
}

export default function Setup({ navigate }: { navigate: Navigate }) {
  const defaults = readPrepDefaults()
  const [studioPhase, setStudioPhase] = useState<'prep' | 'live'>(initialStudioPhase)
  const [modeId, setModeId] = useState<string | null>(defaults.modeId ?? 'salary')
  const [charId, setCharId] = useState<string | null>(defaults.characterId ?? null)
  const [started, setStarted] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [sessionDurationSec, setSessionDurationSec] = useState(initialSessionDurationSec)
  const sessionTimeUpHandledRef = useRef(false)
  const sessionClosingRef = useRef(false)
  const [sessionClosing, setSessionClosing] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const [sessionTimeUpPending, setSessionTimeUpPending] = useState(false)
  const sessionTimeUpPendingRef = useRef(false)
  const secondsRef = useRef(0)
  const endSessionRef = useRef<() => void>(() => {})
  const playTimedSessionCloseRef = useRef<() => Promise<void>>(async () => {})
  const [statsOpen, setStatsOpen] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [turnError, setTurnError] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const transcribingRef = useRef(false)
  const [cloudSttConfigured, setCloudSttConfigured] = useState(false)
  const [cloudSttPausedUntil, setCloudSttPausedUntil] = useState(0)
  const cloudSttFailureStreakRef = useRef(0)
  const cloudSttConfiguredRef = useRef(false)
  const cloudSttPausedUntilRef = useRef(0)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [currentQuestion, setCurrentQuestion] = useState<string | null>(null)
  const [lastDirector, setLastDirector] = useState<{ action?: string; overall?: number } | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const [backendComposure, setBackendComposure] = useState<number | null>(null)
  const [contextJobTitle, setContextJobTitle] = useState('')
  const [pendingContextFiles, setPendingContextFiles] = useState<File[]>([])
  const selfVideoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [userCaption, setUserCaption] = useState('')
  const [lingeringUserCaption, setLingeringUserCaption] = useState('')
  const [userUtteranceActive, setUserUtteranceActive] = useState(false)
  const [interjectionCaption, setInterjectionCaption] = useState<string | null>(null)
  const [lastInterjectionTrigger, setLastInterjectionTrigger] = useState<InterjectTrigger | null>(null)
  const [deliveryMood, setDeliveryMood] = useState<DeliveryMood>('neutral')
  const [devForceStress, setDevForceStress] = useState(() => interjectDevMode())
  const composureSampleRef = useRef<ComposureSample | null>(null)

  const mode = MODES.find((m) => m.id === modeId) ?? null
  const character = SALARY_CHARACTERS.find((c) => c.id === charId) ?? null
  const characterId = character?.id ?? null

  const { stream, status: mediaStatus, error: mediaError, request, stop, setMicEnabled, setVideoEnabled } =
    useMediaStream()

  const askRef = useRef<(q: string, options?: { onSpoken?: () => void }) => void>(() => {})

  useInterjectDevShortcut(() => {
    setDevForceStress((on) => {
      const next = !on
      try {
        localStorage.setItem('speakup_dev_interject', next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  })
  const armListenRef = useRef<() => void>(() => {})

  cloudSttConfiguredRef.current = cloudSttConfigured
  cloudSttPausedUntilRef.current = cloudSttPausedUntil

  const isCloudSttActiveNow = useCallback(() => {
    const until = cloudSttPausedUntilRef.current
    return cloudSttConfiguredRef.current && (until <= 0 || Date.now() >= until)
  }, [])

  const cloudSttActive = cloudSttConfigured && isCloudSttActiveNow()

  const pauseCloudSttAfterFailure = useCallback(() => {
    const streak = cloudSttFailureStreakRef.current + 1
    cloudSttFailureStreakRef.current = streak
    const delayMs = sttBackoffDelayMs(streak)
    const until = Date.now() + delayMs
    setCloudSttPausedUntil(until)
    const sec = Math.max(1, Math.ceil(delayMs / 1000))
    setVoiceHint(
      `Cloud STT paused ~${sec}s — using browser captions for this turn. Cloud will retry automatically after that (or on your next answer).`,
    )
    return delayMs
  }, [])

  const markCloudSttSuccess = useCallback(() => {
    cloudSttFailureStreakRef.current = 0
    setCloudSttPausedUntil(0)
  }, [])

  const processTurnAnswer = useCallback(
    async (rawText: string, manual = false, sttFailed = false) => {
      const text = rawText.trim()
      const sessionId = getStoredSessionId() ?? undefined
      if (!text) {
        if (manual) {
          setTurnError(
            cloudSttConfigured
              ? 'No speech detected — try again.'
              : 'No speech detected. Allow the mic and speak clearly, or set ELEVENLABS_API_KEY on the backend for cloud STT.',
          )
        } else if (sttFailed) {
          setTurnError(
            'Cloud transcription failed — check ElevenLabs on the backend or speak again (browser captions used when available).',
          )
        } else {
          setTurnError(null)
        }
        armListenRef.current()
        return
      }
      setTurnError(null)
      const optimisticComposure =
        composureSampleRef.current?.composure ?? backendComposure ?? 0.5
      setLastDirector({
        action: localDirectorAction(optimisticComposure, text, turnCount),
      })
      try {
        const data = await postTurn(text, sessionId)
        const snapshot = data.decision.input_snapshot as { composure?: number } | undefined
        if (typeof snapshot?.composure === 'number') {
          setBackendComposure(snapshot.composure)
        }
        setTurnCount((n) => n + 1)
        setLastDirector({ action: data.decision.action, overall: data.scores.overall })
        setLingeringUserCaption('')
        if (sessionTimeUpPendingRef.current) {
          void playTimedSessionCloseRef.current()
          return
        }
        setCurrentQuestion(data.next_question.text)
        if (data.end_session) {
          sessionClosingRef.current = true
          setSessionClosing(true)
          askRef.current(data.next_question.text, {
            onSpoken: () => endSessionRef.current(),
          })
          return
        }
        askRef.current(data.next_question.text)
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Submit failed'
        setTurnError(message)
        armListenRef.current()
      }
    },
    [backendComposure, cloudSttConfigured, turnCount],
  )

  const processTurnAnswerRef = useRef(processTurnAnswer)
  processTurnAnswerRef.current = processTurnAnswer
  const manualSubmitRef = useRef(false)
  const stateRef = useRef<TurnState>('IDLE')
  const speakingPhaseRef = useRef<'idle' | 'loading' | 'audible'>('idle')
  const browserSpeechApiRef = useRef<{
    getTranscript: () => string
    reset: () => void
    stop: () => void
  }>({
    getTranscript: () => '',
    reset: () => {},
    stop: () => {},
  })
  const turnWatchdogRef = useRef<ReturnType<typeof window.setTimeout>[]>([])

  const clearTurnWatchdog = useCallback(() => {
    for (const id of turnWatchdogRef.current) {
      window.clearTimeout(id)
    }
    turnWatchdogRef.current = []
  }, [])

  const armTurnWatchdog = useCallback(() => {
    clearTurnWatchdog()
    turnWatchdogRef.current.push(
      window.setTimeout(() => {
        if (stateRef.current !== 'THINKING' || transcribingRef.current) return
        setTurnError('Could not read your answer — try speaking again.')
        armListenRef.current()
      }, 20_000),
    )
    turnWatchdogRef.current.push(
      window.setTimeout(() => {
        if (stateRef.current !== 'THINKING') return
        setTurnError('Audio processing timed out — try speaking again.')
        armListenRef.current()
      }, 130_000),
    )
  }, [clearTurnWatchdog])

  const {
    state,
    speakingPhase,
    ask,
    listen,
    armListenMode,
    startUtteranceRecording,
    finalizeUserTurn,
    finish,
    reset,
    stopSpeaking,
    speakInterjection,
  } = useInterviewMachine({
    stream,
    micEnabled: micOn,
    recordAnswers: cloudSttActive,
    onAnswerRecorded: async (blob) => {
      clearTurnWatchdog()
      setTranscribing(true)
      setTurnError(null)
      let text = ''
      let sttFailed = false
      try {
        const result = await transcribeAudio(blob, {
          onRetry: ({ attempt, maxAttempts }) => {
            setTurnError(`Cloud transcription failed — retrying (${attempt + 1}/${maxAttempts})…`)
            clearTurnWatchdog()
            armTurnWatchdog()
          },
        })
        text = result.transcript
        markCloudSttSuccess()
      } catch (err) {
        sttFailed = true
        const message = err instanceof Error ? err.message : 'Transcription failed'
        pauseCloudSttAfterFailure()
        setTurnError(message)
        const fallback = browserSpeechApiRef.current.getTranscript()
        if (fallback) {
          text = fallback
          sttFailed = false
        }
      } finally {
        setTranscribing(false)
      }
      browserSpeechApiRef.current.stop()
      const linger =
        browserSpeechApiRef.current.getTranscript().trim() || text.trim()
      if (linger) setLingeringUserCaption(linger)
      browserSpeechApiRef.current.reset()
      setUserCaption('')
      await processTurnAnswerRef.current(text, manualSubmitRef.current, sttFailed)
      manualSubmitRef.current = false
    },
  })

  const playMainQuestion = useCallback(
    (text: string, options?: { onSpoken?: () => void }) => {
      setInterjectionCaption(null)
      setLastInterjectionTrigger(null)
      ask(text, options)
    },
    [ask],
  )

  const onPresageInterjection = useCallback(
    (text: string, trigger: InterjectTrigger) => {
      setInterjectionCaption(text)
      setLastInterjectionTrigger(trigger)
      const clearOverlay = () => {
        setInterjectionCaption(null)
        setLastInterjectionTrigger(null)
      }
      if (stateRef.current === 'LISTENING' || stateRef.current === 'THINKING') {
        speakInterjection(text, clearOverlay)
        return
      }
      ask(text, { onSpoken: clearOverlay })
    },
    [ask, speakInterjection],
  )

  askRef.current = playMainQuestion
  armListenRef.current = armListenMode
  stateRef.current = state
  speakingPhaseRef.current = speakingPhase

  const sessionLive = studioPhase === 'live' && started && state !== 'IDLE' && state !== 'REPORT'
  const sessionInteractive = sessionLive && !sessionClosing
  const composureSessionId = getStoredSessionId() ?? 'studio'
  const questionId = `q_${String(turnCount + 1).padStart(3, '0')}`
  const faceAnalysisActive = sessionLive && videoOn && mediaStatus === 'ready'
  const { ready: faceReady, getMetrics } = useFaceComposure(selfVideoRef, faceAnalysisActive)
  const { latest: composureSample } = useComposureSampler({
    active: sessionLive,
    sessionId: composureSessionId,
    questionId,
    getMetrics,
  })
  // User owns the floor only in LISTENING with no AI TTS (main question or interjection overlay).
  const userOwnsFloor =
    sessionInteractive && micOn && state === 'LISTENING' && speakingPhase === 'idle'
  const userCaptionFloor = userOwnsFloor || userUtteranceActive
  // Live user captions on the user's floor; cloud STT still uses MediaRecorder for /turn.
  const browserListenActive = userCaptionFloor
  const browserSpeech = useBrowserSpeechCapture(browserListenActive)
  browserSpeechApiRef.current = {
    getTranscript: browserSpeech.getTranscript,
    reset: browserSpeech.reset,
    stop: browserSpeech.stop,
  }
  const userCaptionLingerActive =
    Boolean(lingeringUserCaption.trim()) && (state === 'THINKING' || transcribing)
  const showUserCaptions = userCaptionFloor || userCaptionLingerActive
  const coachOverlayPlaying =
    Boolean(interjectionCaption) && state === 'LISTENING' && speakingPhase !== 'idle'
  /** Barge-in / answer turn: user over AI. Main question + coach overlay: AI over user. */
  const captionPriority: 'user' | 'ai' =
    (userCaptionFloor && !coachOverlayPlaying) ||
    (userCaptionLingerActive && !coachOverlayPlaying)
      ? 'user'
      : 'ai'
  const stageUserCaption = userCaptionFloor ? userCaption : lingeringUserCaption

  const commitUserTurn = useCallback(
    async (manual: boolean) => {
      if (sessionClosingRef.current) return
      if (stateRef.current !== 'LISTENING') return
      setUserUtteranceActive(false)
      manualSubmitRef.current = manual
      const hadRecording = finalizeUserTurn()
      if (!isCloudSttActiveNow()) {
        browserSpeech.stop()
        const text = browserSpeech.getTranscript()
        const live = browserSpeech.getLiveCaption().trim() || text.trim()
        if (live) setLingeringUserCaption(live)
        browserSpeech.reset()
        setUserCaption('')
        await processTurnAnswerRef.current(text, manual)
        manualSubmitRef.current = false
        return
      }
      if (!hadRecording) {
        await processTurnAnswerRef.current('', manual)
        manualSubmitRef.current = false
        return
      }
      armTurnWatchdog()
    },
    [armTurnWatchdog, browserSpeech, finalizeUserTurn, isCloudSttActiveNow],
  )

  const vadMode =
    state === 'ASKING' && speakingPhase === 'audible' ? 'barge-in' : 'utterance'
  const vadEnabled =
    sessionInteractive &&
    micOn &&
    ((state === 'LISTENING' && speakingPhase === 'idle') ||
      (state === 'ASKING' && speakingPhase === 'audible'))

  useVoiceActivity(stream, vadEnabled, vadMode, {
    onSpeechStart: () => {
      if (stateRef.current !== 'LISTENING') return
      setUserUtteranceActive(true)
      browserSpeech.reset()
      setUserCaption('')
      setLingeringUserCaption('')
      startUtteranceRecording()
    },
    onSpeechEnd: (hadMinSpeech) => {
      if (stateRef.current !== 'LISTENING') return
      if (!hadMinSpeech) {
        setUserUtteranceActive(false)
        armListenMode()
        return
      }
      void commitUserTurn(false)
    },
    onBargeIn: () => {
      if (stateRef.current !== 'ASKING' || speakingPhaseRef.current !== 'audible') return
      stopSpeaking()
      browserSpeech.reset()
      setUserCaption('')
      armListenMode()
    },
  })
  const reactionSessionId = started ? getStoredSessionId() : null
  const presageVitals = usePresageVitals(sessionLive, reactionSessionId)

  const presageMetricsBundle = usePresageMetrics({
    sample: composureSample,
    turnState: state,
    backendComposure,
    faceReady,
    getTranscript: browserSpeech.getTranscript,
    listening: userOwnsFloor,
    vitals: presageVitals,
  })
  const presageMetrics = presageMetricsBundle.metrics
  const speechWpm = presageMetricsBundle.speechWpm

  useComposureReactions({
    active: sessionInteractive && !!reactionSessionId,
    sessionId: reactionSessionId,
    sample: composureSample,
    vitals: presageVitals,
    turnState: state,
    speakingPhase,
    speechWpm,
    devForceStress,
    onInterjection: onPresageInterjection,
    onInterjectionArm: setLastInterjectionTrigger,
    onDeliveryMood: setDeliveryMood,
  })
  const presageStatus = presageStatusLabel({
    sessionLive,
    faceReady,
    sample: composureSample,
    vitals: presageVitals,
  })

  const { src: expressionSrc } = useCharacterExpression(
    characterId as CharacterId | null,
    sessionLive,
    state,
    lastDirector,
    speakingPhase,
    lastInterjectionTrigger,
    deliveryMood,
  )

  useEffect(() => {
    if (!userCaptionFloor) {
      if (!userCaptionLingerActive) setUserCaption('')
      return
    }
    const id = window.setInterval(() => {
      const live = browserSpeech.getLiveCaption()
      setUserCaption(live)
      if (live.trim()) setLingeringUserCaption(live)
    }, 200)
    return () => window.clearInterval(id)
  }, [userCaptionFloor, userCaptionLingerActive, browserSpeech])

  composureSampleRef.current = composureSample

  useEffect(() => {
    if (state !== 'LISTENING' || speakingPhase !== 'idle') {
      setUserUtteranceActive(false)
    }
  }, [state, speakingPhase])

  useEffect(() => {
    transcribingRef.current = transcribing
  }, [transcribing])

  useEffect(() => {
    if (!cloudSttConfigured || cloudSttPausedUntil <= Date.now()) return
    const ms = cloudSttPausedUntil - Date.now()
    const id = window.setTimeout(() => {
      setCloudSttPausedUntil(0)
      setVoiceHint('Cloud STT ready — your next answer will use ElevenLabs again.')
    }, ms)
    return () => window.clearTimeout(id)
  }, [cloudSttConfigured, cloudSttPausedUntil])

  useEffect(() => {
    if (state !== 'THINKING') return
    const id = window.setTimeout(() => {
      if (stateRef.current !== 'THINKING') return
      setTurnError('That took too long — try speaking again.')
      armListenRef.current()
    }, 75_000)
    return () => window.clearTimeout(id)
  }, [state])

  useEffect(() => {
    if (!started) {
      sessionTimeUpHandledRef.current = false
      return
    }
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [started])

  useEffect(() => {
    secondsRef.current = seconds
  }, [seconds])

  useEffect(() => {
    sessionTimeUpPendingRef.current = sessionTimeUpPending
  }, [sessionTimeUpPending])

  useEffect(() => {
    setMicEnabled(micOn)
  }, [micOn, setMicEnabled])

  useEffect(() => {
    setVideoEnabled(videoOn)
  }, [videoOn, setVideoEnabled])

  useEffect(() => {
    const clean = window.location.pathname.replace(/\/$/, '') || '/'
    if (clean === '/start') {
      clearPrepComplete()
      setStudioPhase('prep')
    }
  }, [])

  useEffect(() => {
    const onPop = () => {
      const live = isLiveStudioPath(window.location.pathname)
      if (live && isPrepCompleteInSession()) {
        setStudioPhase('live')
      } else {
        setStudioPhase('prep')
        if (!live) clearPrepComplete()
      }
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    if (studioPhase === 'live' && !isPrepCompleteInSession() && !started) {
      navigate('/start')
      setStudioPhase('prep')
    }
  }, [studioPhase, started, navigate])

  const resetStudio = useCallback(() => {
    finish()
    reset()
    stop()
    browserSpeech.stop()
    setStarted(false)
    setSeconds(0)
    setCurrentQuestion(null)
    setLastDirector(null)
    setTurnCount(0)
    setBackendComposure(null)
    setTurnError(null)
    setStartError(null)
    setTranscribing(false)
    setInterjectionCaption(null)
    setLastInterjectionTrigger(null)
    setDeliveryMood('neutral')
    setDevForceStress(interjectDevMode())
    sessionClosingRef.current = false
    setSessionClosing(false)
    setSessionTimeUpPending(false)
    sessionTimeUpHandledRef.current = false
    setLingeringUserCaption('')
    setGeneratingReport(false)
    clearPrepComplete()
    setStudioPhase('prep')
  }, [browserSpeech, finish, reset, stop])

  const startSession = async () => {
    if (!mode || !character || !mode.ready || starting) return false
    setStartError(null)
    setTurnError(null)
    setVoiceHint(null)
    setStarting(true)
    try {
      await getHealth()
      const voice = await getVoiceStatus()
      setCloudSttConfigured(voice.stt)
      cloudSttFailureStreakRef.current = 0
      setCloudSttPausedUntil(0)
      if (!voice.tts) {
        setVoiceHint('Interviewer voice uses your browser until ELEVENLABS_API_KEY is set on the backend.')
      }
      if (!voice.stt) {
        setVoiceHint(
          (prev) =>
            prev ??
            'Answers use browser speech recognition until ELEVENLABS_API_KEY is set on the backend.',
        )
      }
      const media = await request()
      if (!media) {
        setStartError(mediaError ?? 'Microphone and camera access are required to start.')
        return false
      }
      setVideoOn(true)
      const jobTitle =
        contextJobTitle.trim() ||
        (mode.id === 'salary' ? `Salary negotiation — ${character.name}` : character.name)
      const { session_id } = await createSession({
        jobTitle,
        scenarioId: mode.id,
        characterId: character.id,
        sessionDurationSec,
      })
      for (const file of pendingContextFiles) {
        await uploadDocument(session_id, file)
      }
      setStoredSessionId(session_id)
      const session = await getSession(session_id)
      setSeconds(0)
      setStarted(true)
      setCurrentQuestion(session.current_question.text)
      ask(session.current_question.text)
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not start session'
      setStartError(message.includes('fetch') ? 'API offline — start the backend on port 8000.' : message)
      resetStudio()
      return false
    } finally {
      setStarting(false)
    }
  }

  const enterStudio = async () => {
    if (!mode || !character) return
    writePrepDefaults({
      modeId: mode.id,
      characterId: character.id,
      sessionDurationSec,
    })
    markPrepComplete()
    setStudioPhase('live')
    if (window.location.pathname !== '/start/live') {
      navigate('/start/live')
    }
    const ok = await startSession()
    if (!ok) {
      navigate('/start')
    }
  }

  const submitAnswer = () => {
    if (state !== 'LISTENING') return
    void commitUserTurn(true)
  }

  const endSession = useCallback(async () => {
    finish()
    stop()
    browserSpeech.stop()
    const sessionId = getStoredSessionId()
    if (sessionId) {
      void getSessionReport(sessionId).catch(() => {
        /* Results page loads baseline first, then retries /report */
      })
    }
    if (mode && character) {
      setSession({
        sessionId: sessionId ?? undefined,
        mode: mode.title,
        opponent: character.name,
        opponentRole: character.role,
        tone: character.tone,
        opponentImg: character.img,
        durationSec: seconds,
      })
    }
    navigate('/results')
  }, [browserSpeech, character, finish, mode, navigate, seconds, stop])

  endSessionRef.current = endSession

  const playTimedSessionClose = useCallback(async () => {
    if (sessionClosingRef.current) return
    sessionClosingRef.current = true
    sessionTimeUpHandledRef.current = true
    setSessionTimeUpPending(false)
    setSessionClosing(true)
    setTurnError(null)
    browserSpeech.stop()

    const fallback =
      "That's our time for today — thank you for practicing with me. Let's wrap up here."
    let line = fallback
    const sessionId = getStoredSessionId()
    if (sessionId) {
      try {
        const res = await postSessionClose(sessionId, {
          elapsedSec: secondsRef.current,
          durationSec: sessionDurationSec,
        })
        if (res.text.trim()) line = res.text.trim()
      } catch {
        line = fallback
      }
    }

    setInterjectionCaption(null)
    setLastInterjectionTrigger(null)
    setCurrentQuestion(line)

    const afterSpoken = () => endSessionRef.current()
    if (stateRef.current === 'LISTENING' && speakingPhaseRef.current === 'idle') {
      speakInterjection(line, afterSpoken)
    } else {
      ask(line, { onSpoken: afterSpoken })
    }
  }, [ask, browserSpeech, sessionDurationSec, speakInterjection])

  playTimedSessionCloseRef.current = playTimedSessionClose

  useEffect(() => {
    if (!started || sessionDurationSec <= 0) return
    if (seconds < sessionDurationSec) return
    if (sessionTimeUpHandledRef.current || sessionTimeUpPending) return
    setSessionTimeUpPending(true)
  }, [seconds, sessionDurationSec, started, sessionTimeUpPending])

  useEffect(() => {
    if (!sessionTimeUpPending || sessionClosingRef.current) return
    if (state === 'THINKING' || transcribing) return
    if (state === 'ASKING' && speakingPhase !== 'idle') return
    void playTimedSessionClose()
  }, [sessionTimeUpPending, state, speakingPhase, transcribing, playTimedSessionClose])

  const leaveStudio = () => {
    if (sessionLive) {
      const ok = window.confirm('Leave the session? Your progress is saved on the server.')
      if (!ok) return
    }
    resetStudio()
    navigate('/')
  }

  const leavePrep = () => {
    navigate('/')
  }

  const addContextFiles = (picked: FileList | null) => {
    if (!picked?.length) return
    const next: File[] = []
    for (const file of Array.from(picked)) {
      const dot = file.name.lastIndexOf('.')
      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : ''
      if (!CONTEXT_FILE_EXT.has(ext)) {
        setStartError('Only PDF, DOCX, and TXT files are supported.')
        continue
      }
      next.push(file)
    }
    if (next.length) {
      setStartError(null)
      setPendingContextFiles((prev) => [...prev, ...next])
    }
  }

  const onModeChange = (m: Mode) => {
    setModeId(m.id)
    setCharId(null)
    writePrepDefaults({ modeId: m.id })
  }

  const onCharChange = (c: Character) => {
    setCharId(c.id)
    writePrepDefaults({ characterId: c.id })
  }

  const opponentImg = stageOpponentSrc(
    characterId as CharacterId | null,
    character?.img,
    sessionLive,
    expressionSrc,
  )

  const aiCaptionLine =
    sessionLive && (interjectionCaption ?? currentQuestion) ? interjectionCaption ?? currentQuestion : null
  const aiCaptionInterjection = Boolean(interjectionCaption)
  const controlsBusy = state === 'THINKING' || transcribing || sessionClosing
  const displayError = startError ?? turnError ?? (mediaStatus === 'denied' ? mediaError : null)

  if (studioPhase === 'prep') {
    return (
      <div className="studio studio--prep">
        <header className="studio-top">
          <button type="button" className="studio-brand" onClick={leavePrep} aria-label="SpeakUp home">
            <img src="/brand/speakup-logo-horizontal.png" alt="SpeakUp" height={26} />
          </button>
          <p className="studio-prep-tag">Set up your session</p>
          <div className="studio-top-right">
            <button type="button" className="prep-home-link" onClick={leavePrep}>
              Back to home
            </button>
          </div>
        </header>
        <StudioPrep
          modeId={modeId}
          charId={charId}
          onModeChange={onModeChange}
          onCharChange={onCharChange}
          contextJobTitle={contextJobTitle}
          onContextJobTitleChange={setContextJobTitle}
          pendingContextFiles={pendingContextFiles}
          onAddContextFiles={addContextFiles}
          onRemoveContextFile={(index) => setPendingContextFiles((prev) => prev.filter((_, i) => i !== index))}
          contextError={startError}
          sessionDurationSec={sessionDurationSec}
          onSessionDurationChange={setSessionDurationSec}
          entering={starting}
          enterError={startError}
          onEnterStudio={() => void enterStudio()}
        />
      </div>
    )
  }

  if (!mode || !character) {
    navigate('/start')
    return null
  }

  return (
    <div className="studio">
      <StudioLive
        onLeaveStudio={leaveStudio}
        mode={mode}
        character={character}
        sessionLive={sessionLive}
        sessionClosing={sessionClosing || sessionTimeUpPending}
        started={started}
        seconds={seconds}
        sessionDurationSec={sessionDurationSec}
        state={state}
        statsOpen={statsOpen}
        onToggleStats={() => setStatsOpen((s) => !s)}
        presageMetrics={presageMetrics}
        presageStatus={presageStatus}
        opponentImg={opponentImg}
        aiCaptionLine={aiCaptionLine}
        aiCaptionInterjection={aiCaptionInterjection}
        userCaption={showUserCaptions ? stageUserCaption : ''}
        userCaptionsEnabled={showUserCaptions}
        captionPriority={captionPriority}
        displayError={displayError}
        voiceHint={voiceHint}
        stream={stream}
        mediaStatus={mediaStatus}
        videoOn={videoOn}
        onToggleVideo={() => setVideoOn((v) => !v)}
        videoRef={selfVideoRef}
        stageRef={stageRef}
        micOn={micOn}
        onToggleMic={() => setMicOn((m) => !m)}
        controlsBusy={controlsBusy}
        onSubmitAnswer={submitAnswer}
        onAnswerNow={() => listen()}
        onEndSession={() => void endSession()}
        transcribing={transcribing}
        generatingReport={generatingReport}
      />
    </div>
  )
}
