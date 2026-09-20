import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Diag from './Diag.tsx'

function pageAtPath(pathname: string): 'diag' | 'app' {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/diag') {
    return 'diag'
  }
  return 'app'
}

const page =
  typeof window !== 'undefined'
    ? pageAtPath(window.location.pathname)
    : 'app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {page === 'diag' ? <Diag /> : <App />}
  </StrictMode>,
)
