import type {
  CreateSessionResponse,
  HealthResponse,
  SessionResponse,
  TurnResponse,
  UploadDocumentResponse,
} from "@/lib/api-types"

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8000"

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
    throw new Error("Health check returned ok: false")
  }
  return data
}

export async function createSession(jobTitle?: string): Promise<CreateSessionResponse> {
  const res = await fetch(`${API_BASE}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job_title: jobTitle?.trim() || null }),
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
  form.append("file", file, file.name)
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/documents`, {
    method: "POST",
    body: form,
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function getSession(sessionId?: string): Promise<SessionResponse> {
  const path = sessionId ? `/sessions/${sessionId}` : "/session"
  const res = await fetch(`${API_BASE}${path}`)
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postTurn(answer: string, sessionId?: string): Promise<TurnResponse> {
  const path = sessionId ? `/sessions/${sessionId}/turn` : "/turn"
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: answer.trim() }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}
