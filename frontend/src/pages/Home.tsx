import { useEffect, useState } from 'react'
import type { Navigate } from '../App'
import './Home.css'

/* Swap this for the real SpeakUp demo once it is published on YouTube. */
const DEMO_VIDEO_ID = 'ScMzIvxBSi4'

type FloatingWord = {
  text: string
  top: string
  left: string
  delay: string
  dur: string
  scale: number
}

const FLOATING_WORDS: FloatingWord[] = [
  { text: 'Confidence', top: '6%', left: '10%', delay: '0s', dur: '7.5s', scale: 1.05 },
  { text: 'Poise', top: '20%', left: '80%', delay: '1.1s', dur: '8.5s', scale: 0.9 },
  { text: 'Clarity', top: '2%', left: '58%', delay: '0.6s', dur: '9s', scale: 0.82 },
  { text: 'Presence', top: '68%', left: '6%', delay: '1.8s', dur: '8s', scale: 0.95 },
  { text: 'Calm', top: '78%', left: '30%', delay: '0.3s', dur: '7s', scale: 0.78 },
  { text: 'Tone', top: '30%', left: '2%', delay: '2.2s', dur: '9.5s', scale: 0.74 },
  { text: 'Pace', top: '84%', left: '70%', delay: '1.4s', dur: '8.2s', scale: 0.8 },
  { text: 'Composure', top: '60%', left: '84%', delay: '0.9s', dur: '9.2s', scale: 1 },
]

function useMounted() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return mounted
}

function VideoModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="SpeakUp demo video">
      <button type="button" className="modal-scrim" aria-label="Close demo" onClick={onClose} />
      <div className="modal-frame">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close demo">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
        <div className="modal-video">
          <iframe
            src={`https://www.youtube.com/embed/${DEMO_VIDEO_ID}?autoplay=1&rel=0`}
            title="SpeakUp demo"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
    </div>
  )
}

function DemoPreview({ onPlay }: { onPlay: () => void }) {
  return (
    <button type="button" className="demo" onClick={onPlay} aria-label="Play the SpeakUp demo">
      <div className="demo-loop" aria-hidden="true">
        <div className="demo-window">
          <span className="demo-dot" />
          <span className="demo-dot" />
          <span className="demo-dot" />
          <p className="demo-caption">Live session preview</p>
        </div>
        <div className="demo-wave">
          {Array.from({ length: 28 }).map((_, i) => (
            <span key={i} style={{ animationDelay: `${(i % 14) * 0.08}s` }} />
          ))}
        </div>
      </div>
      <span className="demo-play">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
        </svg>
      </span>
      <span className="demo-label">Watch the 60 second demo</span>
    </button>
  )
}

export default function Home({ navigate }: { navigate: Navigate }) {
  const mounted = useMounted()
  const [videoOpen, setVideoOpen] = useState(false)

  return (
    <div className={`home ${mounted ? 'is-mounted' : ''}`}>
      <div className="home-glow home-glow--a" aria-hidden="true" />
      <div className="home-glow home-glow--b" aria-hidden="true" />
      <div className="home-grid" aria-hidden="true" />

      <header className="home-nav">
        <img
          className="home-logo"
          src="/brand/speakup-logo-horizontal-white.png"
          alt="SpeakUp"
          width={168}
          height={44}
        />
        <button type="button" className="btn btn-ghost-light" onClick={() => navigate('/start')}>
          Enter studio
        </button>
      </header>

      <main className="home-main">
        <section className="hero-stage">
          <div className="floaters" aria-hidden="true">
            {FLOATING_WORDS.map((w) => (
              <span
                key={w.text}
                className="floater"
                style={{
                  top: w.top,
                  left: w.left,
                  animationDelay: w.delay,
                  animationDuration: w.dur,
                  ['--scale' as string]: w.scale,
                }}
              >
                {w.text}
              </span>
            ))}
          </div>

          <div className="hero-core">
            <span className="hero-eyebrow">Practice out loud</span>
            <h1 className="hero-title">
              Practice interviews that watch your composure, not just your answers.
            </h1>
            <p className="hero-lede">
              SpeakUp puts you in the room with realistic characters and reads how steady you stay
              under pressure. Rehearse the hard conversation before it counts.
            </p>
            <div className="hero-actions">
              <button type="button" className="btn btn-solid-light" onClick={() => navigate('/start')}>
                Get started
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M5 12h14m-6-6 6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <DemoPreview onPlay={() => setVideoOpen(true)} />
            </div>
          </div>
        </section>
      </main>

      <footer className="home-foot">
        <span>SpeakUp</span>
        <span className="home-foot-dim">Practice out loud</span>
      </footer>

      {videoOpen && <VideoModal onClose={() => setVideoOpen(false)} />}
    </div>
  )
}
