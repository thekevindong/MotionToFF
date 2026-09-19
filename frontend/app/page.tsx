import Link from "next/link"
import { ArrowRight, Activity, Brain, MessageSquareText } from "lucide-react"

const PILLARS = [
  {
    icon: Activity,
    title: "Live composure",
    body: "Webcam + Presage read expression, engagement, and vitals as a rolling signal — with a graceful fallback when the SDK is unavailable.",
  },
  {
    icon: Brain,
    title: "Adaptive director",
    body: "Nemotron scores every answer on a fixed rubric and decides the next move: press harder, follow up, move on, curveball, or ease off.",
  },
  {
    icon: MessageSquareText,
    title: "Voice-native turns",
    body: "Gemini asks, you answer out loud. One audio direction at a time — speak, listen, think — so the mic and voice never collide.",
  },
]

export default function Page() {
  return (
    <main className="relative min-h-svh bg-background text-foreground">
      <div className="mx-auto flex min-h-svh max-w-5xl flex-col px-6 py-10">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block size-2.5 rounded-full bg-emerald-500" />
            <span className="text-sm font-medium tracking-tight">Composure</span>
          </div>
          <span className="text-xs text-muted-foreground">AI interview coach</span>
        </header>

        <section className="flex flex-1 flex-col justify-center py-16">
          <p className="mb-4 text-sm font-medium text-emerald-500">Practice under pressure</p>
          <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            A mock interviewer that watches how you hold up, not just what you say.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground">
            Answer real questions out loud. A director model reads your composure and the substance of each
            answer, then steers the next question. Afterward, get a timeline of how you held up and the three
            things to fix.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link
              href="/interview"
              className="inline-flex items-center gap-2 rounded-full bg-foreground px-6 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              Start a mock interview
              <ArrowRight className="size-4" />
            </Link>
            <span className="text-xs text-muted-foreground">Needs camera + microphone access</span>
            <Link
              href="/report"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Session report
            </Link>
          </div>
        </section>

        <section className="grid gap-4 pb-6 sm:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div
              key={pillar.title}
              className="rounded-2xl border border-border bg-card p-5 text-card-foreground"
            >
              <pillar.icon className="size-5 text-emerald-500" aria-hidden="true" />
              <h2 className="mt-4 text-sm font-semibold tracking-tight">{pillar.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
            </div>
          ))}
        </section>
      </div>
    </main>
  )
}
