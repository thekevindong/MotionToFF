import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { SpeakingTeleprompter } from '../components/SpeakingTeleprompter'
import type { Mode } from '../config/modes'
import type { TurnState } from '../lib/contracts'
import { useAudienceReaction } from '../hooks/use-audience-reaction'
import { useBrowserSpeechCapture } from '../hooks/use-browser-speech-capture'
import { useComposureSampler } from '../hooks/use-composure-sampler'
import { useFaceComposure } from '../hooks/use-face-composure'
import { useMediaStream } from '../hooks/use-media-stream'
import { presageStatusLabel, usePresageMetrics } from '../hooks/use-presage-metrics'
import { usePresageVitals } from '../hooks/use-presage-vitals'
import { useSpeakingSession, type SpeakingFlowState } from '../hooks/use-speaking-session'
import { getVoiceStatus } from '../lib/api'
import type { SpeakingPrepareResponse } from '../lib/api-types'
import { getStoredSessionId } from '../lib/session-storage'
import { StudioLive } from './StudioLive'

function flowToTurnState(flow: SpeakingFlowState): TurnState {
  switch (flow) {
    case 'READY':
      return 'IDLE'
    case 'DELIVERING':
      return 'LISTENING'
    case 'SUBMITTING':
      return 'THINKING'
    case 'DONE':
      return 'REPORT'
    default:
      return 'IDLE'
  }
}

type Props = {
  mode: Mode
  prep: SpeakingPrepareResponse
  speakingSummary: { title: string; speaker: string }
  sessionDurationSec: number
  onLeaveStudio: () => void
  onNavigateResults: () => void
  restartNote?: string | null
}

export function SpeakingLive({
  mode,
  prep,
  speakingSummary,
  sessionDurationSec,
  onLeaveStudio,
  onNavigateResults,
  restartNote,
}: Props) {
  const [statsOpen, setStatsOpen] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [videoOn, setVideoOn] = useState(true)
  const [voiceHint, setVoiceHint] = useState<string | null>(null)
  const [cloudSttConfigured, setCloudSttConfigured] = useState(false)
  const [bootError, setBootError] = useState<string | null>(null)
  const [userCaption, setUserCaption] = useState('')

  const selfVideoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef('')

  const { stream, status: mediaStatus, error: mediaError, request, stop, setMicEnabled, setVideoEnabled } =
    useMediaStream()

  const deliveryExtrasRef = useRef({ avg_wpm: null as number | null, filler_count: 0, presage_degraded: false })
  const presageDegradedRef = useRef(false)

  const {
    flow,
    started,
    seconds,
    submitError,
    generatingReport,
    startDelivery,
    completeDelivery,
    attachRecorder,
    pushSample,
  } = useSpeakingSession({
    prep,
    sessionDurationSec,
    modeTitle: mode.title,
    speakerLabel: speakingSummary.speaker,
    onNavigateResults,
    getTranscript: () => transcriptRef.current,
    getDeliveryExtras: () => deliveryExtrasRef.current,
    cloudSttConfigured,
  })

  const delivering = flow === 'DELIVERING'
  const sessionLive = flow !== 'DONE'

  const browserSpeech = useBrowserSpeechCapture(delivering && micOn)
  transcriptRef.current = browserSpeech.getTranscript().trim() || browserSpeech.getLiveCaption().trim()

  useEffect(() => {
    if (!delivering || !micOn) {
      setUserCaption('')
      return
    }
    const id = window.setInterval(() => {
      setUserCaption(browserSpeech.getLiveCaption())
    }, 200)
    return () => window.clearInterval(id)
  }, [browserSpeech, delivering, micOn])

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
    if (flow === 'DELIVERING' && stream) {
      attachRecorder(stream)
    }
  }, [attachRecorder, flow, stream])

  const faceAnalysisActive = delivering && videoOn && mediaStatus === 'ready'
  const presageDegraded = delivering && (!videoOn || mediaStatus !== 'ready')
  useEffect(() => {
    if (presageDegraded) presageDegradedRef.current = true
  }, [presageDegraded])
  const { ready: faceReady, getMetrics } = useFaceComposure(selfVideoRef, faceAnalysisActive)
  const sessionId = getStoredSessionId() ?? 'speaking'
  const { latest: composureSample } = useComposureSampler({
    active: delivering,
    sessionId,
    questionId: 'speaking_delivery',
    getMetrics,
    onSample: pushSample,
  })

  const presageVitals = usePresageVitals(delivering, getStoredSessionId())
  const presageMetricsBundle = usePresageMetrics({
    sample: composureSample,
    turnState: flowToTurnState(flow),
    backendComposure: null,
    faceReady,
    getTranscript: browserSpeech.getTranscript,
    listening: delivering && micOn,
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

  const { backdrop: stageBackgroundSrc } = useAudienceReaction({
    sample: composureSample,
    basePhase: 'house',
    enabled: delivering && faceAnalysisActive,
  })

  const state = flowToTurnState(flow)
  const controlsBusy = flow === 'SUBMITTING'

  const handleStart = useCallback(() => {
    setBootError(null)
    if (mediaStatus !== 'ready' || !stream) {
      setBootError(mediaError ?? 'Microphone and camera access are required to start.')
      return
    }
    const audioLive = stream.getAudioTracks().some((t) => t.readyState === 'live' && t.enabled)
    if (!audioLive) {
      setBootError('Microphone and camera access are required to start.')
      return
    }
    browserSpeech.reset()
    transcriptRef.current = ''
    startDelivery()
  }, [browserSpeech, mediaStatus, startDelivery, stream])

  const handleFinish = useCallback(() => {
    void completeDelivery('user', cloudSttConfigured)
  }, [cloudSttConfigured, completeDelivery])

  const handleEndEarly = useCallback(() => {
    const ok = window.confirm('End this speech early and get your report?')
    if (!ok) return
    void completeDelivery('early_exit', cloudSttConfigured)
  }, [cloudSttConfigured, completeDelivery])

  const displayError = bootError ?? submitError ?? (mediaStatus === 'denied' ? mediaError : null)

  return (
    <div className="studio studio--speaking-live">
      <StudioLive
        onLeaveStudio={onLeaveStudio}
        mode={mode}
        character={null}
        speakingSummary={speakingSummary}
        sessionLive={sessionLive}
        sessionClosing={flow === 'SUBMITTING'}
        started={started}
        seconds={seconds}
        sessionDurationSec={sessionDurationSec}
        state={state}
        speakingFlow={flow}
        statsOpen={statsOpen}
        onToggleStats={() => setStatsOpen((s) => !s)}
        presageMetrics={presageMetricsBundle.metrics}
        presageStatus={presageStatusLabel({
          sessionLive: delivering,
          faceReady,
          sample: composureSample,
          vitals: presageVitals,
          cameraDegraded: presageDegraded,
        })}
        opponentImg=""
        stageBackgroundSrc={stageBackgroundSrc}
        aiCaptionLine={null}
        userCaption={userCaption}
        userCaptionsEnabled={delivering}
        captionPriority="user"
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
        onSubmitAnswer={handleFinish}
        onAnswerNow={handleStart}
        onEndSession={handleEndEarly}
        transcribing={flow === 'SUBMITTING'}
        generatingReport={generatingReport}
        teleprompterOverlay={
          <SpeakingTeleprompter
            lines={prep.lines}
            title={speakingSummary.title}
            speaker={speakingSummary.speaker}
            elapsedSec={seconds}
            active={delivering}
          />
        }
      />
    </div>
  )
}
