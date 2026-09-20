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
import { getSessionReport, getVoiceStatus, postThesisQaStart, postTurn } from '../lib/api'
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

  const [statsOpen, setStatsOpen] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [cloudSttConfigured, setCloudSttConfigured] = useState(false)
  const [bootError, setBootError] = useState(null as string | null)
  const [userCaption, setUserCaption] = useState('')
  const [aiCaption, setAiCaption] = useState<string | null>(null)

  const selfVideoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef('')
  const deliveryExtrasRef = useRef({ avg_wpm: null as number | null, filler_count: 0, presage_degraded: false })
  const presageDegradedRef = useRef(false)
  const processingQaRef = useRef(false)
  const qaStateRef = useRef<TurnState>('IDLE')
  const speakingPhaseRef = useRef<'idle' | 'loading' | 'audible'>('idle')
  const submitQaAnswerRef = useRef<() => Promise<void>>(async () => {})

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

  const beginQa = useCallback(async (result: ThesisPresentationCompleteResponse) => {
    setHandoffLine(result.handoff_line?.trim() || "Thank you. Let's move to questions about your work.")
    setSessionPhase('qa')
    handoffPlayedRef.current = false
    const sessionId = getStoredSessionId()
    if (!sessionId) {
      setTurnError('Missing session — return to prep.')
      return
    }
    try {
      const start = await postThesisQaStart(sessionId)
      setCurrentQuestion(start.question.text)
      setAiCaption(start.question.text)
      setQaStarted(true)
      setQaAnswersCompleted(0)
    } catch (err) {
      setTurnError(err instanceof Error ? err.message : 'Could not start Q&A')
    }
  }, [])

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
          ask(data.next_question.text, {
            holdFloor: true,
            voiceGender: randomCommitteeVoice(),
            onSpoken: () => navigateResultsWithSession(),
          })
          return
        }
        setCurrentQuestion(data.next_question.text)
        ask(data.next_question.text, {
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
    [armListenMode, ask, listen, navigateResultsWithSession],
  )

  useEffect(() => {
    if (sessionPhase !== 'qa' || !qaStarted || !currentQuestion || handoffPlayedRef.current) return
    if (qaState !== 'IDLE') return
    if (sessionClosingRef.current) return
    handoffPlayedRef.current = true
    const playFirstQuestion = () => {
      setAiCaption(currentQuestion)
      ask(currentQuestion, {
        voiceGender: randomCommitteeVoice(),
        onSpoken: () => listen(),
      })
    }
    const line = handoffLine?.trim()
    if (line) {
      setAiCaption(line)
      ask(line, {
        voiceGender: handoffVoiceGender,
        onSpoken: playFirstQuestion,
      })
    } else {
      playFirstQuestion()
    }
  }, [
    ask,
    currentQuestion,
    handoffLine,
    handoffVoiceGender,
    listen,
    qaStarted,
    qaState,
    sessionPhase,
  ])

  useEffect(() => {
    if (sessionPhase !== 'qa' || !qaLive) return
    const id = window.setInterval(() => {
      if (qaState === 'LISTENING' && speakingPhase === 'idle') {
        setUserCaption(browserSpeech.getLiveCaption())
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [browserSpeech, qaLive, qaState, sessionPhase, speakingPhase])

  const submitQaAnswer = useCallback(async () => {
    if (processingQaRef.current || transcribing || sessionClosingRef.current) return
    if (qaState !== 'LISTENING' || speakingPhase !== 'idle') return
    browserSpeech.stop()
    const text = browserSpeech.getTranscript().trim() || browserSpeech.getLiveCaption().trim()
    finalizeUserTurn()
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
        browserSpeech.reset()
        setUserCaption('')
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
  const timerSeconds = sessionPhase === 'presentation' ? presentationSeconds : qaAnswersCompleted
  const timerDuration = sessionPhase === 'presentation' ? presentationDurationSec : 0
  const qaQuestionLabel =
    sessionPhase === 'qa' && qaStarted
      ? `Question ${Math.min(qaAnswersCompleted + 1, qaQuestionCount)}/${qaQuestionCount}`
      : null

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
        aiCaptionLine={sessionPhase === 'qa' ? aiCaption ?? currentQuestion : null}
        userCaption={userCaption}
        userCaptionsEnabled={presenting || (qaLive && qaState === 'LISTENING')}
        captionPriority={sessionPhase === 'qa' && qaState === 'ASKING' ? 'ai' : 'user'}
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
        thesisFloatingCamera={sessionPhase === 'presentation'}
      />
    </div>
  )
}
