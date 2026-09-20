"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"
import { ArrowLeft, ArrowRight, FileUp, Loader2 } from "lucide-react"
import { createSession, uploadDocument } from "@/lib/api"
import { clearStoredSessionId, setStoredSessionId } from "@/lib/session-storage"

const ACCEPT = ".pdf,.docx,.txt"

export default function SetupPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [jobTitle, setJobTitle] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function onPickFiles(list: FileList | null) {
    if (!list?.length) return
    setFiles((prev) => [...prev, ...Array.from(list)])
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleStart() {
    setError(null)
    setBusy(true)
    try {
      const { session_id } = await createSession(jobTitle.trim() || undefined)
      for (const file of files) {
        await uploadDocument(session_id, file)
      }
      setStoredSessionId(session_id)
      router.push("/interview")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Setup failed"
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-svh bg-background text-foreground">
      <div className="mx-auto max-w-xl px-6 py-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          Back
        </Link>

        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Interview setup</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Add a role title and optional resume or job description. Your session is saved on the server so
          you can restart the API and still open your report.
        </p>

        <div className="mt-8 space-y-6">
          <label className="block">
            <span className="text-sm font-medium">Target role (optional)</span>
            <input
              type="text"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder="e.g. Software engineer intern"
              className="mt-2 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm outline-none ring-emerald-500/30 focus:ring-2"
            />
          </label>

          <div>
            <span className="text-sm font-medium">Documents (optional)</span>
            <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX, or plain text — up to 10 MB each.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => {
                onPickFiles(e.target.files)
                e.target.value = ""
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 inline-flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <FileUp className="size-4" />
              Add files
            </button>
            {files.length > 0 && (
              <ul className="mt-3 space-y-2">
                {files.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm"
                  >
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(index)}
                      className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error && (
          <p className="mt-6 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {error}
          </p>
        )}

        <div className="mt-10 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleStart}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
            Start interview
          </button>
          <Link
            href="/interview"
            className="inline-flex items-center rounded-full border border-border px-6 py-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => clearStoredSessionId()}
          >
            Skip setup (legacy session)
          </Link>
        </div>
      </div>
    </main>
  )
}
