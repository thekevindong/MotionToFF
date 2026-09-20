import { useCallback, useEffect, useState } from 'react'
import Home from './pages/Home'
import Setup from './pages/Setup'

export type Navigate = (path: string) => void

type View = 'home' | 'start'

function viewFromPath(path: string): View {
  const clean = path.replace(/\/$/, '') || '/'
  return clean === '/start' ? 'start' : 'home'
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

  return view === 'start' ? <Setup navigate={navigate} /> : <Home navigate={navigate} />
}

export default App
