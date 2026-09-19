import type {
  HealthResponse,
  SessionResponse,
  TurnResponse,
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

export async function getSession(): Promise<SessionResponse> {
  const res = await fetch(`${API_BASE}/session`)
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}

export async function postTurn(answer: string): Promise<TurnResponse> {
  const res = await fetch(`${API_BASE}/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ answer: answer.trim() }),
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  return res.json()
}
