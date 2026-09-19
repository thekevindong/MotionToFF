import { type NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// ElevenLabs Scribe speech-to-text.
const SCRIBE_MODEL_ID = "scribe_v1"

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not configured." }, { status: 500 })
  }

  let audio: File | null = null
  try {
    const form = await req.formData()
    const entry = form.get("audio")
    if (entry instanceof File) audio = entry
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data with an `audio` file." }, { status: 400 })
  }

  if (!audio) {
    return NextResponse.json({ error: "Missing `audio` file." }, { status: 400 })
  }

  const upstream = new FormData()
  upstream.append("file", audio, audio.name || "answer.webm")
  upstream.append("model_id", SCRIBE_MODEL_ID)

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: upstream,
  })

  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    return NextResponse.json({ error: "STT request failed.", detail }, { status: 502 })
  }

  const data = await res.json()
  return NextResponse.json({
    transcript: typeof data.text === "string" ? data.text : "",
    languageCode: data.language_code ?? null,
    words: Array.isArray(data.words) ? data.words : [],
  })
}
