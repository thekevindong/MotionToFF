import { useEffect, useMemo, useRef } from 'react'

import './SpeakingTeleprompter.css'

type Props = {
  lines: string[]
  title: string
  speaker: string
  /** Elapsed seconds while delivering (0 before start). */
  elapsedSec: number
  active: boolean
}

/** Rough scroll highlight: ~2.5 words/sec across all lines. */
function activeLineIndex(lines: string[], elapsedSec: number): number {
  if (lines.length === 0 || elapsedSec <= 0) return 0
  const wordsBefore = Math.floor(elapsedSec * 2.5)
  let acc = 0
  for (let i = 0; i < lines.length; i++) {
    const w = lines[i].trim().split(/\s+/).filter(Boolean).length
    acc += w
    if (wordsBefore < acc) return i
  }
  return lines.length - 1
}

export function SpeakingTeleprompter({ lines, title, speaker, elapsedSec, active }: Props) {
  const current = useMemo(() => activeLineIndex(lines, elapsedSec), [lines, elapsedSec])
  const linesRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (!active) return
    const list = linesRef.current
    if (!list) return
    const item = list.children[current] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [active, current])

  if (!lines.length) return null

  return (
    <aside className="speaking-teleprompter" aria-label="Teleprompter">
      <header className="speaking-teleprompter-head">
        <p className="speaking-teleprompter-title">{title}</p>
        <p className="speaking-teleprompter-speaker">{speaker}</p>
      </header>
      <ol className="speaking-teleprompter-lines" ref={linesRef}>
        {lines.map((line, i) => (
          <li
            key={`${i}-${line.slice(0, 24)}`}
            className={`speaking-teleprompter-line ${active && i === current ? 'is-active' : ''} ${
              active && i < current ? 'is-past' : ''
            }`}
          >
            {line}
          </li>
        ))}
      </ol>
    </aside>
  )
}
