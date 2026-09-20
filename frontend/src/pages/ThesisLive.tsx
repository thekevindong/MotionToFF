import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { ThesisDefensePrompt } from '../components/ThesisDefensePrompt'
import type { Character, Mode } from '../config/modes'
import type { CharacterGender } from '../config/character-voices'
import type { TurnState } from '../lib/contracts'
import { useAudienceReaction } from '../hooks/use-audience-reaction'
import { useBrowserSpeechCapture } from '../hooks/use-browser-speech-capture'
import { useComposureSampler } from '../hooks/use-composure-sampler'
import { useFaceComposure } from '../hooks/use-face-composure'
import { useInterviewMachine } from '../hooks/use-interview-machine'
import { useMediaStream } from '../hooks/use-media-stream'
import { useVoiceActivity } from '../hooks/use-voice-activity'
import { presageStatusLabel, usePresageMetrics } from '../hooks/use-presage-metrics'
import { usePresageVitals } from '../hooks/use-presage-vitals'
import type { ThesisPresentationFlow } from '../hooks/use-thesis-session'
import { useThesisPresentationSession } from '../hooks/use-thesis-session'
import { getSession, getSessionReport, getVoiceStatus, postThesisQaStart, postTurn } from '../lib/api'
import type { ThesisPrepareResponse, ThesisPresentationCompleteResponse, TurnResponse } from '../lib/api-types'
import { getStoredSessionId } from '../lib/session-storage'
import { setSession } from '../session'
import { StudioLive } from './StudioLive'

function presentationFlowToSpeakingFlow(
  flow: ThesisPresentationFlow,
): 'READY' | 'DELIVERING' | 'SUBMITTING' | 'DONE' {
  switch (flow) {
    case 'READY':
      return 'READY'
    case 'PRESENTING':
      return 'DELIVERING'
    case 'PRESENTATION_SUBMIT':
      return 'SUBMITTING'
    case 'DONE':
      return 'DONE'
    default:
      return 'READY'
  }
}

function flowToTurnState(flow: ThesisPresentationFlow, qaState: TurnState): TurnState {
  if (flow !== 'DONE') {
    switch (flow) {
      case 'READY':
        return 'IDLE'
      case 'PRESENTING':
        return 'LISTENING'
      case 'PRESENTATION_SUBMIT':
        return 'THINKING'
      default:
        return 'IDLE'
    }
  }
  return qaState
}

function turnRequestsReportEnd(data: TurnResponse): boolean {
  return Boolean(data.end_session || data.next_question.end_session)
}

function randomCommitteeVoice(): CharacterGender {
  return Math.random() < 0.5 ? 'male' : 'female'
}

function qaQuestionCountFromPrep(prep: ThesisPrepareResponse): number {
  if (prep.qa_question_count > 0) return prep.qa_question_count
  return prep.thesis_pack === 'long' ? 5 : 3
}

type Props = {
  mode: Mode
  prep: ThesisPrepareResponse
  character: Character
  onLeaveStudio: () => void
  onNavigateResults: () => void
  restartNote?: string | null
}

export function ThesisLive({
  mode,
  prep,
  character: _character,
  onLeaveStudio,
  onNavigateResults,
  restartNote,
}: Props) {
  const [sessionPhase, setSessionPhase] = useState<'presentation' | 'qa'>('presentation')
  const [handoffLine, setHandoffLine] = useState<string | null>(null)
  const [qaStarted, setQaStarted] = useState(false)
  const [qaAnswersCompleted, setQaAnswersCompleted] = useState(0)
  const [currentQuestion, setCurrentQuestion] = useState('')
  const [turnError, setTurnError] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(false)
  const [sessionClosing, setSessionClosing] = useState(false)
  const [generatingReport, setGeneratingReport] = useState(false)
  const sessionClosingRef = useRef(false)
  const handoffPlayedRef = useRef(false)
  const restoredQaEntryRef = useRef(
    prep.thesis_phase === 'qa' && prep.source === 'session',
  )
  const restoredQuestionPlayedRef = useRef(false)

  const [statsOpen, setStatsOpen] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [cloudSttConfigured, setCloudSttConfigured] = useState(false)
  const [bootError, setBootError] = useState(null as string | null)
  const [userCaption, setUserCaption] = useState('')
  const [lingeringUserCaption, setLingeringUserCaption] = useState('')
  const [userAnswerCaptionHold, setUserAnswerCaptionHold] = useState(false)
  const [aiCaption, setAiCaption] = useState<string | null>(null)
  const [qaElapsedSec, setQaElapsedSec] = useState(0)

  const selfVideoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef('')
  const deliveryExtrasRef = useRef({ avg_wpm: null as number | null, filler_count: 0, presage_degraded: false })
  const presageDegradedRef = useRef(false)
  const processingQaRef = useRef(false)
  const qaStateRef = useRef<TurnState>('IDLE')
  const speakingPhaseRef = useRef<'idle' | 'loading' | 'audible'>('idle')
  const submitQaAnswerRef = useRef<() => Promise<void>>(async () => {})

  const releaseUserAnswerCaption = useCallback(() => {
    setUserAnswerCaptionHold(false)
    setLingeringUserCaption('')
    setUserCaption('')
  }, [])

  const qaQuestionCount = qaQuestionCountFromPrep(prep)
  const handoffVoiceGender: CharacterGender =
    prep.committee_voice_gender === 'male' ? 'male' : 'female'

  const navigateResultsWithSession = useCallback(async () => {
    const sessionId = getStoredSessionId()
    setGeneratingReport(true)
    if (sessionId) {
      try {
        await getSessionReport(sessionId)
      } catch {
        /* Results page may retry */
      }
    }
    setSession({
      sessionId: sessionId ?? undefined,
      mode: mode.title,
      opponent: 'Committee',
      opponentRole: 'Thesis defense',
      tone: 'Voice from audience',
      opponentImg: '/brand/speakup-icon-white.png',
      durationSec: prep.presentation_duration_sec,
    })
    onNavigateResults()
  }, [mode.title, onNavigateResults, prep.presentation_duration_sec])

  const bootstrapQa = useCallback(async (handoff?: string | null) => {
    setSessionPhase('qa')
    handoffPlayedRef.current = false
    setQaStarted(true)
    setQaAnswersCompleted(0)
    setQaElapsedSec(0)
    const sessionId = getStoredSessionId()
    if (!sessionId) {
      setQaStarted(false)
      setTurnError('Missing session — return to prep.')
      return
    }
    try {
      if (restoredQaEntryRef.current) {
        handoffPlayedRef.current = true
      }
      const start = await postThesisQaStart(sessionId)
      const questionText = start.question.text?.trim()
      if (!questionText) {
        throw new Error('Committee returned an empty question — try again.')
      }
      if (handoff !== undefined) {
        setHandoffLine(handoff?.trim() || "Thank you. Let's move to questions about your work.")
      }
      setCurrentQuestion(questionText)
      setAiCaption(questionText)
      setTurnError(null)
    } catch (err) {
      setQaStarted(false)
      setSessionPhase('presentation')
      setTurnError(err instanceof Error ? err.message : 'Could not start Q&A')
    }
  }, [])

  const beginQa = useCallback(
    async (result: ThesisPresentationCompleteResponse) => {
      await bootstrapQa(result.handoff_line ?? null)
    },
    [bootstrapQa],
  )

  const {
    flow: presentationFlow,
    started: presentationStarted,
    seconds: presentationSeconds,
    durationSec: presentationDurationSec,
    submitError,
    startPresentation,
    completePresentation,
    attachRecorder,
    pushSample,
  } = useThesisPresentationSession({
    prep,
    onNavigateResults: navigateResultsWithSession,
    onPresentationComplete: beginQa,
    getTranscript: () => transcriptRef.current,
    getDeliveryExtras: () => deliveryExtrasRef.current,
    cloudSttConfigured,
  })

  const { stream, status: mediaStatus, error: mediaError, request, stop, setMicEnabled, setVideoEnabled } =
    useMediaStream()

  const {
    state: qaState,
    speakingPhase,
    ask,
    listen,
    armListenMode,
    finalizeUserTurn,
    finish,
    startUtteranceRecording,
    stopSpeaking,
  } = useInterviewMachine({
    stream,
    micEnabled: micOn,
    characterId: null,
    voiceGender: handoffVoiceGender,
  })

  useEffect(() => {
    if (prep.thesis_phase !== 'qa' || prep.source !== 'session' || qaStarted) return
    void bootstrapQa(null)
  }, [bootstrapQa, prep.source, prep.thesis_phase, qaStarted])

  useEffect(() => {
    if (prep.thesis_phase !== 'qa' || prep.source !== 'session' || !qaStarted) return
    const sessionId = getStoredSessionId()
    if (!sessionId) return
    void (async () => {
      try {
        const data = await getSession(sessionId)
        const qaTurns = Math.max(0, (data.turns?.length ?? 1) - 1)
        setQaAnswersCompleted(qaTurns)
        const q = data.current_question?.text?.trim()
        if (q) {
          setCurrentQuestion(q)
          setAiCaption(q)
        }
      } catch {
        /* handoff effect will still play if currentQuestion was set by bootstrap */
      }
    })()
  }, [prep.source, prep.thesis_phase, qaStarted])

  const askCommittee = useCallback(
    (
      text: string,
      options?: {
        holdFloor?: boolean
        voiceGender?: CharacterGender
        onSpoken?: () => void
      },
    ) => {
      releaseUserAnswerCaption()
      setAiCaption(text)
      ask(text, options)
    },
    [ask, releaseUserAnswerCaption],
  )

  qaStateRef.current = qaState
  speakingPhaseRef.current = speakingPhase

  const presenting = sessionPhase === 'presentation' && presentationFlow === 'PRESENTING'
  const qaLive = sessionPhase === 'qa' && qaStarted && qaState !== 'REPORT'
  const sessionLive =
    sessionPhase === 'presentation'
      ? presentationFlow !== 'DONE'
      : qaStarted && qaState !== 'REPORT' && !sessionClosing

  const browserSpeech = useBrowserSpeechCapture(
    (presenting && micOn) || (qaLive && micOn && qaState === 'LISTENING' && speakingPhase === 'idle'),
  )

  if (presenting) {
    transcriptRef.current = browserSpeech.getTranscript().trim() || browserSpeech.getLiveCaption().trim()
  }

  useEffect(() => {
    if (!presenting || !micOn) {
      if (sessionPhase === 'presentation') setUserCaption('')
      return
    }
    const id = window.setInterval(() => setUserCaption(browserSpeech.getLiveCaption()), 200)
    return () => window.clearInterval(id)
  }, [browserSpeech, micOn, presenting, sessionPhase])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const voice = await getVoiceStatus()
      if (cancelled) return
      setCloudSttConfigured(voice.stt)
      if (!voice.stt) {
        setVoiceHint(
          'Speech captions use browser recognition until ELEVENLABS_API_KEY is set on the backend.',
        )
      }
      const media = await request()
      if (cancelled) return
      if (!media) {
        setBootError(mediaError ?? 'Microphone and camera access are required.')
      } else {
        setVideoOn(true)
      }
    })()
    return () => {
      cancelled = true
      stop()
      browserSpeech.stop()
    }
  }, [])

  useLayoutEffect(() => {
    setMicEnabled(micOn)
  }, [micOn, setMicEnabled])

  useLayoutEffect(() => {
    setVideoEnabled(videoOn)
  }, [videoOn, setVideoEnabled])

  useEffect(() => {
    if (presentationFlow === 'PRESENTING' && stream) {
      attachRecorder(stream)
    }
  }, [attachRecorder, presentationFlow, stream])

  const faceAnalysisActive = (presenting || qaLive) && videoOn && mediaStatus === 'ready'
  const presageDegraded = (presenting || qaLive) && (!videoOn || mediaStatus !== 'ready')
  useEffect(() => {
    if (presageDegraded) presageDegradedRef.current = true
  }, [presageDegraded])

  const { ready: faceReady, getMetrics } = useFaceComposure(selfVideoRef, faceAnalysisActive)
  const sessionId = getStoredSessionId() ?? 'thesis'
  const { latest: composureSample } = useComposureSampler({
    active: presenting || qaLive,
    sessionId,
    questionId: sessionPhase === 'qa' ? 'thesis_qa' : 'thesis_presentation',
    getMetrics,
    onSample: pushSample,
  })

  const presageVitals = usePresageVitals(presenting || qaLive, getStoredSessionId())
  const turnStateForMetrics =
    sessionPhase === 'presentation' ? flowToTurnState(presentationFlow, qaState) : qaState
  const presageMetricsBundle = usePresageMetrics({
    sample: composureSample,
    turnState: turnStateForMetrics,
    backendComposure: null,
    faceReady,
    getTranscript: browserSpeech.getTranscript,
    listening: presenting && micOn,
    vitals: presageVitals,
  })
  deliveryExtrasRef.current = {
    avg_wpm: presageMetricsBundle.speechWpm,
    filler_count:
      typeof presageMetricsBundle.metrics.find((m) => m.label === 'Filler words')?.value === 'number'
        ? (presageMetricsBundle.metrics.find((m) => m.label === 'Filler words')!.value as number)
        : 0,
    presage_degraded: presageDegradedRef.current,
  }

  const audienceBase =
    sessionPhase === 'presentation' && presentationFlow === 'READY' ? 'empty' : 'house'
  const { backdrop: stageBackgroundSrc } = useAudienceReaction({
    sample: composureSample,
    basePhase: audienceBase,
    enabled: (presenting || qaLive) && faceAnalysisActive,
  })

  const processQaAnswer = useCallback(
    async (rawText: string) => {
      if (processingQaRef.current || sessionClosingRef.current) return
      const text = rawText.trim()
      const sid = getStoredSessionId()
      if (!text) {
        setTurnError('No speech detected — try again.')
        armListenMode()
        return
      }
      setTurnError(null)
      processingQaRef.current = true
      setTranscribing(true)
      try {
        const data = await postTurn(text, sid ?? undefined)
        setQaAnswersCompleted((n) => n + 1)
        setAiCaption(data.next_question.text)
        if (turnRequestsReportEnd(data)) {
          sessionClosingRef.current = true
          setSessionClosing(true)
          askCommittee(data.next_question.text, {
            holdFloor: true,
            voiceGender: randomCommitteeVoice(),
            onSpoken: () => navigateResultsWithSession(),
          })
          return
        }
        setCurrentQuestion(data.next_question.text)
        askCommittee(data.next_question.text, {
          voiceGender: randomCommitteeVoice(),
          onSpoken: () => listen(),
        })
      } catch (err) {
        setTurnError(err instanceof Error ? err.message : 'Submit failed')
        armListenMode()
      } finally {
        processingQaRef.current = false
        setTranscribing(false)
      }
    },
    [armListenMode, askCommittee, listen, navigateResultsWithSession],
  )

  useEffect(() => {
    if (restoredQaEntryRef.current) return
    if (sessionPhase !== 'qa' || !qaStarted || !currentQuestion || handoffPlayedRef.current) return
    if (qaState !== 'IDLE') return
    if (sessionClosingRef.current) return
    handoffPlayedRef.current = true
    const playFirstQuestion = () => {
      askCommittee(currentQuestion, {
        voiceGender: randomCommitteeVoice(),
        onSpoken: () => listen(),
      })
    }
    const line = handoffLine?.trim()
    if (line) {
      askCommittee(line, {
        voiceGender: handoffVoiceGender,
        onSpoken: playFirstQuestion,
      })
    } else {
      playFirstQuestion()
    }
  }, [
    askCommittee,
    currentQuestion,
    handoffLine,
    handoffVoiceGender,
    listen,
    qaStarted,
    qaState,
    sessionPhase,
  ])

  useEffect(() => {
    if (!restoredQaEntryRef.current) return
    if (sessionPhase !== 'qa' || !qaStarted || !currentQuestion.trim()) return
    if (restoredQuestionPlayedRef.current || sessionClosingRef.current) return
    if (qaState !== 'IDLE') return
    restoredQuestionPlayedRef.current = true
    askCommittee(currentQuestion, {
      voiceGender: randomCommitteeVoice(),
      onSpoken: () => listen(),
    })
  }, [
    askCommittee,
    currentQuestion,
    listen,
    qaStarted,
    qaState,
    sessionPhase,
  ])

  const userCaptionLingerActive =
    Boolean(lingeringUserCaption.trim()) && (qaState === 'THINKING' || transcribing)
  const qaUserCaptionFloor =
    qaLive && userAnswerCaptionHold && qaState === 'LISTENING' && speakingPhase === 'idle'
  const showQaUserCaptions = qaUserCaptionFloor || userCaptionLingerActive

  useEffect(() => {
    if (!qaUserCaptionFloor) {
      if (!userCaptionLingerActive) setUserCaption('')
      return
    }
    const id = window.setInterval(() => {
      const live = browserSpeech.getLiveCaption()
      setUserCaption(live)
      if (live.trim()) setLingeringUserCaption(live)
    }, 200)
    return () => window.clearInterval(id)
  }, [browserSpeech, qaUserCaptionFloor, userCaptionLingerActive])

  useEffect(() => {
    if (sessionPhase !== 'qa' || !qaStarted) return
    const id = window.setInterval(() => setQaElapsedSec((s) => s + 1), 1000)
    return () => window.clearInterval(id)
  }, [qaStarted, sessionPhase])

  const submitQaAnswer = useCallback(async () => {
    if (processingQaRef.current || transcribing || sessionClosingRef.current) return
    if (qaState !== 'LISTENING' || speakingPhase !== 'idle') return
    browserSpeech.stop()
    const text = browserSpeech.getTranscript().trim() || browserSpeech.getLiveCaption().trim()
    finalizeUserTurn()
    const linger = text.trim() || lingeringUserCaption.trim()
    if (linger) setLingeringUserCaption(linger)
    browserSpeech.reset()
    setUserCaption('')
    await processQaAnswer(text)
  }, [browserSpeech, finalizeUserTurn, processQaAnswer, qaState, speakingPhase, transcribing])

  submitQaAnswerRef.current = submitQaAnswer

  const vadMode =
    qaState === 'ASKING' && speakingPhase === 'audible' ? 'barge-in' : 'utterance'
  const vadEnabled =
    qaLive &&
    micOn &&
    !transcribing &&
    !sessionClosing &&
    ((qaState === 'LISTENING' && speakingPhase === 'idle') ||
      (qaState === 'ASKING' && speakingPhase === 'audible'))

  useVoiceActivity(
    stream,
    vadEnabled,
    vadMode,
    {
      onSpeechStart: () => {
        if (qaStateRef.current !== 'LISTENING') return
        setUserAnswerCaptionHold(true)
        browserSpeech.reset()
        setUserCaption('')
        setLingeringUserCaption('')
        startUtteranceRecording()
      },
      onSpeechEnd: (hadMinSpeech) => {
        if (qaStateRef.current !== 'LISTENING') return
        if (!hadMinSpeech) {
          armListenMode()
          return
        }
        void submitQaAnswerRef.current()
      },
      onBargeIn: () => {
        if (qaStateRef.current !== 'ASKING' || speakingPhaseRef.current !== 'audible') return
        stopSpeaking()
        setUserAnswerCaptionHold(true)
        browserSpeech.reset()
        setUserCaption('')
        armListenMode()
      },
    },
    micOn,
  )

  const handleStartPresentation = useCallback(() => {
    setBootError(null)
    if (mediaStatus !== 'ready' || !stream) {
      setBootError(mediaError ?? 'Microphone and camera access are required to start.')
      return
    }
    browserSpeech.reset()
    transcriptRef.current = ''
    startPresentation()
  }, [browserSpeech, mediaStatus, mediaError, startPresentation, stream])

  const handleFinishPresentation = useCallback(() => {
    void completePresentation('user', false)
  }, [completePresentation])

  const handleSkipQa = useCallback(() => {
    const ok = window.confirm('Skip committee Q&A and go straight to your report?')
    if (!ok) return
    void completePresentation('user', true)
  }, [completePresentation])

  const handleEndEarly = useCallback(() => {
    if (sessionPhase === 'presentation') {
      const ok = window.confirm('End this session early and get your report?')
      if (!ok) return
      void completePresentation('early_exit', true)
      return
    }
    const ok = window.confirm('End Q&A early and get your report?')
    if (!ok) return
    finish()
    navigateResultsWithSession()
  }, [completePresentation, finish, navigateResultsWithSession, sessionPhase])

  const displayError = bootError ?? submitError ?? turnError ?? (mediaStatus === 'denied' ? mediaError : null)
  const speakingFlow = presentationFlowToSpeakingFlow(presentationFlow)
  const uiState =
    sessionPhase === 'presentation' ? flowToTurnState(presentationFlow, qaState) : qaState

  const timerStarted = sessionPhase === 'presentation' ? presentationStarted : qaStarted
  const timerSeconds = sessionPhase === 'presentation' ? presentationSeconds : qaElapsedSec
  const timerDuration = sessionPhase === 'presentation' ? presentationDurationSec : 0
  const qaQuestionLabel =
    sessionPhase === 'qa' && qaStarted
      ? `Q&A · Question ${Math.min(qaAnswersCompleted + 1, qaQuestionCount)}/${qaQuestionCount}`
      : null

  const stageUserCaption = qaUserCaptionFloor ? userCaption : lingeringUserCaption
  const captionPriority: 'user' | 'ai' =
    (presenting && Boolean(userCaption.trim())) ||
    (sessionPhase === 'qa' && (showQaUserCaptions || userAnswerCaptionHold))
      ? 'user'
      : 'ai'

  const controlsBusy =
    presentationFlow === 'PRESENTATION_SUBMIT' || transcribing || sessionClosing

  return (
    <div className="studio studio--thesis-live studio--speaking-live">
      <StudioLive
        onLeaveStudio={onLeaveStudio}
        mode={mode}
        character={null}
        speakingSummary={null}
        sessionLive={sessionLive}
        sessionClosing={sessionClosing || presentationFlow === 'PRESENTATION_SUBMIT'}
        started={timerStarted}
        seconds={timerSeconds}
        sessionDurationSec={timerDuration}
        state={uiState}
        statsOpen={statsOpen}
        onToggleStats={() => setStatsOpen((s) => !s)}
        presageMetrics={presageMetricsBundle.metrics}
        presageStatus={presageStatusLabel({
          sessionLive: presenting || qaLive,
          faceReady,
          sample: composureSample,
          vitals: presageVitals,
          cameraDegraded: presageDegraded,
        })}
        opponentImg=""
        stageBackgroundSrc={stageBackgroundSrc}
        aiCaptionLine={
          sessionPhase === 'qa' && (aiCaption ?? currentQuestion)
            ? aiCaption ?? currentQuestion
            : null
        }
        userCaption={presenting ? userCaption : showQaUserCaptions ? stageUserCaption : ''}
        userCaptionsEnabled={
          (presenting && Boolean(userCaption.trim())) || showQaUserCaptions
        }
        captionPriority={captionPriority}
        displayError={displayError}
        voiceHint={restartNote ?? voiceHint}
        stream={stream}
        mediaStatus={mediaStatus}
        videoOn={videoOn}
        onToggleVideo={() => setVideoOn((v) => !v)}
        videoRef={selfVideoRef}
        stageRef={stageRef}
        micOn={micOn}
        onToggleMic={() =>
          setMicOn((m) => {
            const next = !m
            setMicEnabled(next)
            return next
          })
        }
        controlsBusy={controlsBusy}
        onSubmitAnswer={
          sessionPhase === 'presentation' ? handleFinishPresentation : () => void submitQaAnswer()
        }
        onAnswerNow={
          sessionPhase === 'presentation' ? handleStartPresentation : () => listen()
        }
        onEndSession={handleEndEarly}
        onSkipQa={sessionPhase === 'presentation' ? handleSkipQa : undefined}
        transcribing={presentationFlow === 'PRESENTATION_SUBMIT' || transcribing}
        generatingReport={generatingReport}
        speakingFlow={sessionPhase === 'presentation' ? speakingFlow : undefined}
        thesisSessionPhase={sessionPhase}
        thesisQaTimerLabel={qaQuestionLabel}
        teleprompterOverlay={
          sessionPhase === 'presentation' ? (
            <ThesisDefensePrompt filename={prep.defense_filename} preview={prep.defense_text_preview} />
          ) : undefined
        }
        isThesisPresentationRail={sessionPhase === 'presentation'}
        thesisFloatingCamera
      />
    </div>
  )
}
