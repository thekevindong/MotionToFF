import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// Default ElevenLabs voice ("Rachel"). Override per-request with `voiceId`.
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"
const MODEL_ID = "eleven_turbo_v2_5"

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured." }, { status: 500 })
  }

  let text: string
  let voiceId: string
  try {
    const body = await req.json()
    text = String(body.text ?? "").trim()
    voiceId = String(body.voiceId ?? DEFAULT_VOICE_ID)
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  if (!text) {
    return NextResponse.json({ error: "Missing `text`." }, { status: 400 })
  }

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    return NextResponse.json({ error: "TTS request failed.", detail }, { status: 502 })
  }

  return new NextResponse(res.body, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  })
}
