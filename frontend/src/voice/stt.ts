import { getApiBase } from '../lib/api'

export type SttResult = {
  transcript: string
  languageCode: string | null
  words: unknown[]
}

export async function transcribeAudio(blob: Blob): Promise<SttResult> {
  const form = new FormData()
  form.append('audio', blob, 'answer.webm')
  const res = await fetch(`${getApiBase()}/api/stt`, { method: 'POST', body: form })
  if (!res.ok) {
    let message = `STT failed (${res.status})`
    try {
      const body = await res.json()
      if (typeof body.detail === 'string') message = body.detail
      else if (body.error) message = String(body.error)
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  const data = await res.json()
  return {
    transcript: typeof data.transcript === 'string' ? data.transcript.trim() : '',
    languageCode: data.languageCode ?? null,
    words: Array.isArray(data.words) ? data.words : [],
  }
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
