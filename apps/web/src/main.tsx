import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { logger } from './lib/logger'

window.addEventListener('error', (event) => {
  logger.error('app', 'Uncaught error', { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno, error: event.error?.stack ?? String(event.error) })
})
window.addEventListener('unhandledrejection', (event) => {
  logger.error('app', 'Unhandled promise rejection', { reason: event.reason?.stack ?? String(event.reason) })
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
