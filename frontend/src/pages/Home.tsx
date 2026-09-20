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
  { text: 'Confidence', top: '4%', left: '12%', delay: '0s', dur: '7.5s', scale: 1 },
  { text: 'Poise', top: '16%', left: '84%', delay: '1.1s', dur: '8.5s', scale: 0.88 },
  { text: 'Clarity', top: '2%', left: '62%', delay: '0.6s', dur: '9s', scale: 0.8 },
  { text: 'Presence', top: '58%', left: '4%', delay: '1.8s', dur: '8s', scale: 0.92 },
  { text: 'Calm', top: '70%', left: '88%', delay: '0.3s', dur: '7s', scale: 0.78 },
  { text: 'Tone', top: '34%', left: '2%', delay: '2.2s', dur: '9.5s', scale: 0.74 },
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

/* asendia-style hero media: an always-on looping session preview with floating
   UI cards. Clicking anywhere opens the real demo video. */
function HeroShowcase({ onPlay }: { onPlay: () => void }) {
  return (
    <div className="showcase">
      <button
        type="button"
        className="showcase-frame"
        onClick={onPlay}
        aria-label="Play the SpeakUp demo video"
      >
        <div className="stage" aria-hidden="true">
          <div className="stage-top">
            <span className="stage-live">
              <span className="stage-live-dot" />
              Live session
            </span>
            <span className="stage-mode">Salary Negotiation · HR Lead</span>
            <span className="stage-time">12:04</span>
          </div>

          <div className="stage-speaker">
            <img src="/images/hr/neutral-0.png" alt="" />
            <div className="stage-caption">
              <span className="stage-name">Elena — HR Lead</span>
              <div className="stage-wave">
                {Array.from({ length: 22 }).map((_, i) => (
                  <span key={i} style={{ animationDelay: `${(i % 11) * 0.09}s` }} />
                ))}
              </div>
            </div>
          </div>

          <div className="stage-self">
            <div className="stage-self-inner">
              <span className="stage-self-label">You</span>
            </div>
          </div>

          <div className="stage-controls">
            <span className="stage-ctrl stage-ctrl--mic" />
            <span className="stage-ctrl stage-ctrl--cam" />
            <span className="stage-ctrl stage-ctrl--end" />
          </div>
        </div>

        <span className="showcase-play">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
          </svg>
          Watch the demo
        </span>
      </button>

      <div className="card card--composure" aria-hidden="true">
        <span className="card-label">Composure</span>
        <span className="card-value">
          84<small>%</small>
        </span>
        <span className="card-trend">Holding steady</span>
        <div className="card-meter">
          <span />
        </div>
      </div>

      <div className="card card--tip" aria-hidden="true">
        <span className="card-dot" />
        <div>
          <strong>Steady pace</strong>
          <p>Filler words down 40% this round</p>
        </div>
      </div>

      <div className="card card--chat" aria-hidden="true">
        <span className="card-chat-name">Elena</span>
        <p>"Walk me through the number you have in mind."</p>
      </div>
    </div>
  )
}

const TRUST = ['Job seekers', 'New grads', 'Founders', 'Sales teams', 'PhD candidates']

export default function Home({ navigate }: { navigate: Navigate }) {
  const mounted = useMounted()
  const [videoOpen, setVideoOpen] = useState(false)

  return (
    <div className={`home ${mounted ? 'is-mounted' : ''}`}>
      <div className="home-orb home-orb--a" aria-hidden="true" />
      <div className="home-orb home-orb--b" aria-hidden="true" />

      <header className="home-nav">
        <img
          className="home-logo"
          src="/brand/speakup-logo-horizontal.png"
          alt="SpeakUp"
          width={150}
          height={40}
        />
        <nav className="home-links">
          <button type="button" onClick={() => navigate('/start')}>
            Modes
          </button>
          <button type="button" onClick={() => setVideoOpen(true)}>
            Demo
          </button>
        </nav>
        <button type="button" className="btn btn-dark btn-sm" onClick={() => navigate('/start')}>
          Enter studio
        </button>
      </header>

      <main className="home-main">
        <section className="hero">
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

          <span className="hero-badge">Practice out loud</span>
          <h1 className="hero-title">
            Practice interviews that watch your <span className="hl">composure</span>, not just
            your answers.
          </h1>
          <p className="hero-lede">
            SpeakUp puts you in the room with realistic characters and reads how steady you stay
            under pressure. Rehearse the hard conversation before it counts.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn btn-dark" onClick={() => setVideoOpen(true)}>
              Get a demo
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" />
              </svg>
            </button>
            <button type="button" className="btn btn-line" onClick={() => navigate('/start')}>
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
          </div>
        </section>

        <HeroShowcase onPlay={() => setVideoOpen(true)} />

        <section className="trust">
          <p className="trust-label">Built for anyone who has to perform under pressure</p>
          <ul className="trust-list">
            {TRUST.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="home-foot">
        <img src="/brand/speakup-logo-horizontal.png" alt="SpeakUp" width={116} height={30} />
        <span className="home-foot-dim">Practice out loud</span>
      </footer>

      {videoOpen && <VideoModal onClose={() => setVideoOpen(false)} />}
    </div>
  )
}
