import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { AppShell } from '@/components/AppShell'
import './index.css'
import App from './App.jsx'

/*
 * Register the offline shell — production only.
 *
 * In dev a service worker sits between Vite and the browser and intercepts the very module
 * requests HMR depends on, which turns "my edit didn't apply" into a ten-minute mystery. The
 * production build is also the only place the hashed `/assets/` paths the worker caches
 * actually exist.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      // Not fatal: without it the app simply behaves as it did before — online only.
      console.error('[sw] registration failed', err)
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppShell>
          <App />
        </AppShell>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
