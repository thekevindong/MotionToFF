import { useCallback, useEffect, useState } from 'react'
import Home from './pages/Home'
import Setup from './pages/Setup'
import Results from './pages/Results'

export type Navigate = (path: string) => void

type View = 'home' | 'start' | 'results'

function viewFromPath(path: string): View {
  const clean = path.replace(/\/$/, '') || '/'
  if (
    clean === '/start' ||
    clean === '/start/live' ||
    clean === '/start/call' ||
    clean === '/setup' ||
    clean === '/interview'
  )
    return 'start'
  if (clean === '/results' || clean === '/report') return 'results'
  return 'home'
}

function App() {
  const [view, setView] = useState<View>(() =>
    typeof window !== 'undefined' ? viewFromPath(window.location.pathname) : 'home',
  )

  useEffect(() => {
    const onPop = () => setView(viewFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = useCallback<Navigate>((path) => {
    if (window.location.pathname !== path) {
      window.history.pushState(null, '', path)
    }
    setView(viewFromPath(path))
    window.scrollTo({ top: 0 })
  }, [])

  if (view === 'start') return <Setup navigate={navigate} />
  if (view === 'results') return <Results navigate={navigate} />
  return <Home navigate={navigate} />
}

export default App
