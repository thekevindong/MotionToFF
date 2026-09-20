import { getApiBase } from '../lib/api'

export type SttResult = {
  transcript: string
  languageCode: string | null
  words: unknown[]
}

export class SttRequestError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'SttRequestError'
    this.status = status
  }
}

const DEFAULT_STT_MAX_ATTEMPTS = 4
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

/** Shared exponential backoff (in-turn retries and between-turn cloud STT cooldown). */
export function sttBackoffDelayMs(attempt: number): number {
  const base = 400 * 2 ** (attempt - 1)
  const jitter = Math.floor(Math.random() * 250)
  return Math.min(8_000, base + jitter)
}

function isRetryableSttError(err: unknown): boolean {
  if (err instanceof SttRequestError) {
    return RETRYABLE_STATUS.has(err.status)
  }
  if (err instanceof TypeError) {
    // Network / CORS / connection reset
    return true
  }
  return false
}

async function transcribeAudioOnce(blob: Blob): Promise<SttResult> {
  const form = new FormData()
  form.append('audio', blob, 'answer.webm')
  const res = await fetch(`${getApiBase()}/api/stt`, { method: 'POST', body: form })
  if (!res.ok) {
    let message = `STT failed (${res.status})`
    try {
      const body = await res.json()
      const detail = body.detail
      if (typeof detail === 'string') {
        message = detail
      } else if (detail && typeof detail === 'object') {
        const err = (detail as { error?: string }).error
        const extra = (detail as { detail?: string }).detail
        message = [err, extra].filter(Boolean).join(': ') || message
      } else if (body.error) {
        message = String(body.error)
      }
    } catch {
      /* ignore */
    }
    throw new SttRequestError(message, res.status)
  }
  const data = await res.json()
  return {
    transcript: typeof data.transcript === 'string' ? data.transcript.trim() : '',
    languageCode: data.languageCode ?? null,
    words: Array.isArray(data.words) ? data.words : [],
  }
}

export type TranscribeAudioOptions = {
  maxAttempts?: number
  onRetry?: (info: { attempt: number; maxAttempts: number; delayMs: number; error: Error }) => void
}

/** Cloud STT with retries on transient failures (502/503, rate limits, network blips). */
export async function transcribeAudio(blob: Blob, options?: TranscribeAudioOptions): Promise<SttResult> {
  const maxAttempts = Math.max(1, options?.maxAttempts ?? DEFAULT_STT_MAX_ATTEMPTS)
  let lastError: Error = new Error('STT failed')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await transcribeAudioOnce(blob)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (!isRetryableSttError(err) || attempt >= maxAttempts) {
        throw lastError
      }
      const delayMs = sttBackoffDelayMs(attempt)
      options?.onRetry?.({ attempt, maxAttempts, delayMs, error: lastError })
      await sleep(delayMs)
    }
  }

  throw lastError
}

export async function synthesizeSpeech(text: string, voiceId?: string): Promise<ArrayBuffer> {
  const res = await fetch(`${getApiBase()}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voiceId }),
  })
  if (!res.ok) {
    throw new Error(`TTS failed (${res.status})`)
  }
  return res.arrayBuffer()
}
