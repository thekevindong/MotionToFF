import '../components/SpeakingTeleprompter.css'

type Props = {
  filename: string
  preview: string
}

export function ThesisDefensePrompt({ filename, preview }: Props) {
  return (
    <aside className="speaking-teleprompter" aria-label="Defense prompt">
      <header className="speaking-teleprompter-head">
        <p className="speaking-teleprompter-title">Present your defense</p>
        <p className="speaking-teleprompter-speaker">{filename}</p>
      </header>
      <p className="speaking-teleprompter-line is-active" style={{ listStyle: 'none', margin: 0 }}>
        {preview || 'Summarize and defend the claims in your uploaded text.'}
      </p>
      <p className="speaking-teleprompter-speaker" style={{ marginTop: '0.75rem', opacity: 0.85 }}>
        Summarize and defend the claims in your uploaded text — no teleprompter scroll.
      </p>
    </aside>
  )
}
