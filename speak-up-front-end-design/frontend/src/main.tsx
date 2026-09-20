import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import Diag from './Diag.tsx'
import Report from './Report.tsx'

function pageAtPath(pathname: string): 'diag' | 'report' | 'app' {
  const path = pathname.replace(/\/$/, '') || '/'
  if (path === '/diag') {
    return 'diag'
  }
  if (path === '/report') {
    return 'report'
  }
  return 'app'
}

const page =
  typeof window !== 'undefined'
    ? pageAtPath(window.location.pathname)
    : 'app'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {page === 'diag' ? <Diag /> : page === 'report' ? <Report /> : <App />}
  </StrictMode>,
)
