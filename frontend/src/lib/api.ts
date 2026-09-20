import type { SpeakingDurationId } from '../config/speaking-duration'
import type {
  CreateSessionResponse,
  HealthResponse,
  InterjectRequest,
  InterjectResponse,
  SessionCloseRequest,
  SessionCloseResponse,
  SessionVitalsResponse,
  SessionResponse,
  TurnResponse,
  CreateSessionInput,
  UploadDocumentResponse,
  VoiceStatusResponse,
  SpeechesCatalogResponse,
  SpeakingPrepareResponse,
  SpeakingCompleteInput,
  SpeakingCompleteResponse,
  ThesisPackId,
  ThesisPrepareResponse,
  ThesisPresentationCompleteInput,
  ThesisPresentationCompleteResponse,
  ThesisQaStartResponse,
} from './api-types'

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8000'

async function parseError(res: Response): Promise<string> {
  const text = await res.text()
  return text || `HTTP ${res.status}`
}

export function getApiBase(): string {
  return API_BASE
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`)
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  const data: HealthResponse = await res.json()
  if (!data.ok) {
    throw new Error('Health check returned ok: false')
  }
  return data
}

export async function getVoiceStatus(): Promise<VoiceStatusResponse> {
  const res = await fetch(`${API_BASE}/health/voice`)
  if (!res.ok) {
    return { stt: false, tts: false }
  }
  return res.json()
}

export async function createSession(input?: CreateSessionInput): Promise<CreateSessionResponse> {
  const jobTitle = input?.jobTitle?.trim()
  const scenarioId = input?.scenarioId?.trim()
  const characterId = input?.characterId?.trim()
  const sessionDurationSec = input?.sessionDurationSec
  const speakingDuration =
    scenarioId === 'speaking' && typeof sessionDurationSec === 'number'
  const res = await fetch(`${API_BASE}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      job_title: jobTitle || null,
      scenario_id: scenarioId || null,
      character_id: characterId || null,
      session_duration_sec: speakingDuration
        ? sessionDurationSec
        : typeof sessionDurationSec === 'number' && sessionDurationSec > 0
          ? sessionDurationSec
          : null,
    }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function uploadDocument(
  sessionId: string,
  file: File,
): Promise<UploadDocumentResponse> {
  const form = new FormData()
  form.append('file', file, file.name)
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function getSpeeches(): Promise<SpeechesCatalogResponse> {
  const res = await fetch(`${API_BASE}/speeches`)
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postSpeakingComplete(
  sessionId: string,
  body: SpeakingCompleteInput,
): Promise<SpeakingCompleteResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/speaking/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: body.transcript,
      elapsed_sec: body.elapsedSec,
      finished_in_time: body.finishedInTime,
      ended_by: body.endedBy,
      samples: body.samples,
      summary: body.summary,
    }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postSpeakingPrepare(
  sessionId: string,
  body: {
    speechId?: string
    durationMode: SpeakingDurationId
    customExcerpt?: string
    customTitle?: string
    customSpeaker?: string
  },
): Promise<SpeakingPrepareResponse> {
  const payload: Record<string, string> = { duration_mode: body.durationMode }
  const excerpt = body.customExcerpt?.trim()
  if (excerpt) {
    payload.custom_excerpt = excerpt
    if (body.customTitle?.trim()) payload.custom_title = body.customTitle.trim()
    if (body.customSpeaker?.trim()) payload.custom_speaker = body.customSpeaker.trim()
  } else if (body.speechId) {
    payload.speech_id = body.speechId
  }
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/speaking/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postThesisPrepare(
  sessionId: string,
  body: { thesisPack: ThesisPackId },
): Promise<ThesisPrepareResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/thesis/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ thesis_pack: body.thesisPack }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postThesisPresentationComplete(
  sessionId: string,
  body: ThesisPresentationCompleteInput,
): Promise<ThesisPresentationCompleteResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/thesis/presentation/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: body.transcript,
      elapsed_sec: body.elapsedSec,
      finished_in_time: body.finishedInTime,
      ended_by: body.endedBy,
      samples: body.samples,
      summary: body.summary,
      skip_qa: body.skipQa,
    }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postThesisQaStart(sessionId: string): Promise<ThesisQaStartResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/thesis/qa/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function getSession(sessionId?: string): Promise<SessionResponse> {
  const path = sessionId ? `/sessions/${sessionId}` : '/session'
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

/** Loads session + Presage heuristic rubric for charts. */
export async function getSessionReport(sessionId: string): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/report`)
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postTurn(
  answer: string,
  sessionId?: string,
  options?: { qaTimeRemainingSec?: number; qaExpired?: boolean },
): Promise<TurnResponse> {
  const path = sessionId ? `/sessions/${sessionId}/turn` : '/turn'
  const payload: Record<string, unknown> = { answer: answer.trim() }
  if (typeof options?.qaTimeRemainingSec === 'number') {
    payload.qa_time_remaining_sec = options.qaTimeRemainingSec
  }
  if (options?.qaExpired) {
    payload.qa_expired = true
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function getSessionVitals(sessionId: string): Promise<SessionVitalsResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/vitals`)
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postInterject(
  sessionId: string,
  body: InterjectRequest,
): Promise<InterjectResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/interject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postSessionClose(
  sessionId: string,
  body: SessionCloseRequest = {},
): Promise<SessionCloseResponse> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/close`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      elapsed_sec: body.elapsedSec,
      duration_sec: body.durationSec,
    }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}
